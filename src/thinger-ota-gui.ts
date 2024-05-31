import * as vscode from 'vscode';
const eventSource = require("eventsource");
import { ThingerOTATarget, ThingerConfig } from './thinger-config';
import { ThingerOTA } from './thinger-ota';
import { TxRxStatus } from './thinger-conn-status';
import { ThingerOTATargetPicker } from './thinger-ota-target';

const flashCommand          = 'thinger-io.uploadFirmware';
const switchTargetCommand   = 'thinger-io.switchTarget';
const clearTargetCommand    = 'thinger-io.clearTarget';

export class ThingerOTAGUI {
    // vscode context
    private context!: vscode.ExtensionContext;

    // tx/rx status bar
    private txRxStatus!: TxRxStatus;

    // thinger.io configuration 
    private config!: ThingerConfig;

    // thinger.io ota for firmware upload
    private thingerOTA!: ThingerOTA;

    // event source for device status
    private evtSource: any;

    // status bar items
    private switchTargetBarItem!: vscode.StatusBarItem;
    private uploadTargetBarItem!: vscode.StatusBarItem;

    // target picker to change target settings
    private targetPicker!: ThingerOTATargetPicker;

    async activate(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = new ThingerConfig(context);
        this.targetPicker = new ThingerOTATargetPicker(this.config);
        this.thingerOTA = new ThingerOTA(context);
        this.txRxStatus = new TxRxStatus(context);
        await this.createSwitchTargetBarItem();
        await this.createUploadFirmwareBarItem();
    }

    async deactivate() {
        this.evtSource?.close();
        this.switchTargetBarItem.dispose();
        this.uploadTargetBarItem.dispose();
        this.txRxStatus.clear();
        this.txRxStatus.hide();
    }

    private getTargetIcon(target: string | undefined) {
        if (target === 'device') {return '$(rocket)';}
        if (target === 'product') {return '$(package)';}
        return '$(rocket)';
    }

    private getUploadIcon(target: string | undefined) {
        if (target === 'device') {return '$(debug-start)';}
        if (target === 'product') {return '$(cloud-upload)';}
        return '$(debug-start)';
    }

    private updateTargetBarItem(target: ThingerOTATarget | undefined) {
        this.switchTargetBarItem.text = `${this.getTargetIcon(target?.type)} ${target?.id || ''}`;
        this.initStateListener(this.switchTargetBarItem);
    }

    private async createSwitchTargetBarItem(){
        // register command for target switch
        this.context.subscriptions.push(vscode.commands.registerCommand(switchTargetCommand, async () => {
            const target = await this.selectTarget();
            this.updateTargetBarItem(target);
            this.updateUploadStatusBar(false);
        }));

        // register command for target clear
        this.context.subscriptions.push(vscode.commands.registerCommand(clearTargetCommand, async () => {
            await this.context.workspaceState.update('target', undefined);
            this.updateTargetBarItem(undefined);
        }));

        // fallback for previus target configuration (1.x version)
        const device = this.context.workspaceState.get<string>('device');
        if (device) {
            await this.context.workspaceState.update('target', { type: 'device', id: device });
            await this.context.workspaceState.update('device', undefined);
        }

        // create status bar item
        this.switchTargetBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 2);

        // updte target bar item
        const target = this.context.workspaceState.get<ThingerOTATarget>('target');
        this.updateTargetBarItem(target);
        this.switchTargetBarItem.tooltip = `Switch Thinger.io OTA Target`;
        this.switchTargetBarItem.command = switchTargetCommand;
        this.switchTargetBarItem.show();
        
        // configure switch device button
        this.context.subscriptions.push(this.switchTargetBarItem);
    }
    
    private updateUploadStatusBar(uploading: boolean) {
        if (uploading) {
            this.uploadTargetBarItem.text = `$(loading~spin) Uploading...`;
            this.uploadTargetBarItem.tooltip = `Thinger.io: Uploading Firmware`;
            this.uploadTargetBarItem.command = undefined;
        } else {
            const target = this.context.workspaceState.get<ThingerOTATarget>('target');
            this.uploadTargetBarItem.text = this.getUploadIcon(target?.type);
            this.uploadTargetBarItem.tooltip = `Thinger.io: Upload Firmware`;
            this.uploadTargetBarItem.command = flashCommand;
        }
    }

    private async createUploadFirmwareBarItem() {
        // register command for firmware upload
        this.context.subscriptions.push(vscode.commands.registerCommand(flashCommand, async () => {
            try {
                // get current target
                const target = await this.getTarget();
                if(!target){return;}

                // set gui as uploading
                this.updateUploadStatusBar(true);
                const result = await this.thingerOTA.uploadFirmware(target);
                this.updateUploadStatusBar(false);
            } catch (e: any) {
                vscode.window.showErrorMessage('Error while processing OTA update: ' + e);
                this.updateUploadStatusBar(false);
            }
        }));

        // create the upload firmware button
        this.uploadTargetBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
        this.updateUploadStatusBar(false);
        this.uploadTargetBarItem.show();

        this.context.subscriptions.push(this.uploadTargetBarItem);
    }

    private async initStateListener(item: vscode.StatusBarItem) {
        const host = vscode.workspace.getConfiguration('thinger-io').get('host');
        const port = vscode.workspace.getConfiguration('thinger-io').get('port');
        const ssl = vscode.workspace.getConfiguration('thinger-io').get('ssl');
        const secure = vscode.workspace.getConfiguration('thinger-io').get('secure');
        const target = this.context.workspaceState.get<ThingerOTATarget>('target');

        const targetDevice = target?.type === 'device';
        const device = targetDevice ? target?.id : '';
        const token = await this.config.getToken();
        const user = await this.config.getUser();

        // change color according to connection status
        let setConnected = (connected: boolean) => {
            console.log("SSE - Connected:", connected);
            if (connected) {
                item.backgroundColor = undefined;
            } else {
                item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            }
        };

        if (!host || !port || !user || !token || !device) {
            // close event source if not needed
            this.txRxStatus.clear();
            this.txRxStatus.hide();
            this.evtSource?.close();
            this.evtSource = undefined;
            setConnected(targetDevice ? false : true);
            return;
        }

        // initialize event source 
        this.evtSource?.close();
        let url = `${ ssl ? ' https' : 'http' }://${host}:${port}/v1/users/${user}/devices/${device}/stats`;
        
        let config : any = {};
        config = {
            headers: {
                Authorization: `Bearer ${token}`
            }
        };
        if ( ssl ) {
            config["https"] = { rejectUnauthorized: secure};
        }
        
        this.evtSource = new eventSource(url, config);
        this.evtSource.reconnectInterval = 5000;

        this.evtSource.onerror = (err: any) => {
            if (err) {
                console.error("SSE - Error:", err);
                setConnected(false);
                this.txRxStatus.clear();
                this.txRxStatus.hide();
            }
        };

        this.evtSource.onmessage = (event: any) => {
            if (!event.data) {return;}
            let data = JSON.parse(event.data);
            console.log("SSE - Received message:", data);

            if (data.hasOwnProperty('tx_bytes')) {
                this.txRxStatus.updateTxBytes(data.tx_bytes);
            }

            if (data.hasOwnProperty('rx_bytes')) {
                this.txRxStatus.updateRxBytes(data.rx_bytes);
            }

            if (data.hasOwnProperty('connected')) {
                this.txRxStatus.clear();
                this.txRxStatus.show();
                setConnected(data.connected);
            }
        };

        this.evtSource.addEventListener("connect", (e: any) => {
            console.log("SSE - Connect", e.data);
        });
    }

    public async selectTarget(): Promise<ThingerOTATarget | undefined> {
        // Ensure we have a token
        const token = await this.config.getToken();
        if (!token) { return; }
    
        // Show device picker
        const target = await this.targetPicker.pickTarget();
        if (!target) { return; }
    
        // Update device in configuration
        await this.context.workspaceState.update('target', target);
        
        return target;
      }
    
      public async getTarget(): Promise<ThingerOTATarget | undefined> {
        // Try to get device from configuration
        let target = this.context.workspaceState.get<ThingerOTATarget>('target');
        // If not defined, try to get it from input box
        if (!target) { target = await this.selectTarget(); }
        return target;
      }

}