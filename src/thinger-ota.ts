import * as vscode from 'vscode';
import { TxRxStatus } from './thinger-conn-status';
import { ThingerOTATarget, ThingerConfig } from './thinger-config';
import { ThingerAPI } from './thinger-api';
import axios from 'axios';
import { otaReport } from './thinger-ota-report';
import { OTAResult, OTAUpdateResult, ThingerFirmware, ThingerOTAInstance } from './thinger-ota-instance';
import { pio } from './util/platformio';

export class ThingerOTA {

    private config: ThingerConfig;
    private api: ThingerAPI;

    constructor(context: vscode.ExtensionContext) {
        console.log('Thinger OTA initialized');
        this.config = new ThingerConfig(context);
        this.api = new ThingerAPI(this.config);
    }

    private async uploadToProduct(target: ThingerOTATarget, firmware: ThingerFirmware, environment: string): Promise<OTAResult[]> {
        // start a progress window for the upload
        return vscode.window.withProgress({
            cancellable: true,
            location: vscode.ProgressLocation.Notification,
            title: 'Thinger.io',
        }, async (progress, cancelToken): Promise<OTAResult[]> => {

            let cancelled = false;
            const cancelTokenSource = axios.CancelToken.source();

            cancelToken.onCancellationRequested(() => {
                cancelTokenSource.cancel();
                cancelled = true;
            });

            otaReport.initReport(target, firmware);

            const results: OTAResult[] = [];

            try {
                const otaInstance = new ThingerOTAInstance(this.api, firmware, environment);
                const response = await this.api.getProductDevices(target.id, cancelTokenSource.token);
                const devices = response?.data;

                if (!devices || devices.length === 0) {
                    vscode.window.showErrorMessage('No devices found in product!');
                    return [];
                }

                // Initialize progress reporting
                progress.report({ message: `Uploading Firmware to ${devices.length} devices...`, increment: 0 });

                // Use for...of loop to handle async/await correctly
                for (let i = 0; i < devices.length; i++) {

                    const device = devices[i].device;

                    if (cancelled) {
                        results.push({ device: device, result: OTAUpdateResult.FAILURE, description: 'Operation cancelled' });
                    } else {
                        const result = await otaInstance.upload(device);
                        results.push(result);
                    }

                    otaReport.logResult(results[results.length - 1]);

                    // Update progress incrementally
                    progress.report({
                        message: `Uploading Firmware to ${devices.length} devices...`,
                        increment: ((i + 1) / devices.length) * 100
                    });
                }

                otaReport.endReport();

            } catch (error: any) {
                if (!axios.isCancel(error)) {
                    console.error('Error while uploading to product:', error);
                    vscode.window.showErrorMessage(`Error while uploading to product: ${error.message}`);
                }
            }

            return results;
        });
    }

    private async uploadToDevice(target: ThingerOTATarget, firmware: ThingerFirmware, environment: string): Promise<OTAResult> {
        otaReport.initReport(target, firmware);
        const result = await new ThingerOTAInstance(this.api, firmware, environment).upload(target.id);
        otaReport.logResult(result);
        otaReport.endReport();
        return result;
    }

    private async uploadTarget(user: string, target: ThingerOTATarget, firmware: ThingerFirmware, environment: string) : Promise<OTAResult | OTAResult[]>{
        if (target.type === 'device') {
            return this.uploadToDevice(target, firmware, environment);
        } else if (target.type === 'product') {
            return this.uploadToProduct(target, firmware, environment);
        } else {
            vscode.window.showErrorMessage('Target type not supported!');
            return { result: OTAUpdateResult.FAILURE, description: 'Target type not supported!' };
        }
    }

    async uploadFirmware(target : ThingerOTATarget): Promise<OTAResult[] | OTAResult | undefined> {
        // get user for the ota process
        const user = await this.config.getUser();
        if (!user) {return;}

        // get firmware from platformio
        const firmware = await pio.getFirmware();
        if (!firmware) {return;}

        // Show a confirmation dialog with firmware information
        const firmwareInfo = `${target.type==='device' ? 'Device' : 'Product'}: ${target.id}\nFirmware Version: ${firmware.version ?? 'Unknown'}\nEnvironment: ${firmware.environment}\n\nFirmware Path: ${firmware.path.fsPath}`;
        const confirmation = await vscode.window.showInformationMessage(
            `Do you want to upload the following firmware?`,
            { modal: true, detail: firmwareInfo},
            'Yes'
        );

        if (confirmation !== 'Yes') {
            return; // User cancelled the update
        }

        // upload firmware to target
        return this.uploadTarget(user, target, firmware, firmware.environment);
    }

}