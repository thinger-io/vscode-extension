import * as vscode from 'vscode';
import { ThingerAPI } from './thinger-api';
import axios from 'axios';
import { LZSS } from './util/lzss';
import { otaReport } from './thinger-ota-report';

export enum OTAUpdateResult {
    SUCCESS = 'SUCCESS',
    FAILURE = 'FAILURE',
    ALREADY_UPDATED = 'ALREADY_UPDATED'
}

export interface OTAResult {
    device?: string;
    result: OTAUpdateResult;
    description: string;
    duration?: number;
}

export interface OTAOptions{
    firmware?: string;
    version?: string;
    size?: number;
    chunk_size?: number;
    checksum?: string;
    compression?: string;
    compressed_size?: number;
    compressed_checksum?: string;
}

export interface ThingerFirmware{
    path: vscode.Uri;
    environment: string;
    version: string | null;
}

export class ThingerOTAInstance {

    private api: ThingerAPI;
    private cancelTokenSource = axios.CancelToken.source();

    private firmware: ThingerFirmware;
    private file!: Uint8Array;
    private deflated: Uint8Array | undefined;
    private compression: string | undefined;
    private environment: string;
    private chunkSize: number = 8192;
    private otaOptions: OTAOptions = {};
    private startTime: Date | undefined;

    private cancelled: boolean = false;
    private sent: number = 0;

    constructor(api: ThingerAPI, firmware: ThingerFirmware, environment: string = 'default') {
        this.api = api;
        this.firmware = firmware;
        this.environment = environment;
    }

    private getChecksum(hash: string, data: Uint8Array) {
        try {
            const crypto = require('crypto');
            return crypto.createHash(hash).update(data).digest('hex');
        } catch (e: any) {
            return undefined;
        }
    }

    private async initializeOTA(device: string, progress: vscode.Progress<{ message?: string; increment?: number }>) : Promise<OTAResult> {        
        // report progress
        progress.report({
            message: 'Initializing OTA Update ...',
        });

        // reset internal state
        this.sent = 0;
        this.chunkSize = 8192;
        this.cancelled = false;
        this.startTime = new Date();

        // initialize basic begin options
        this.otaOptions = {
            firmware: this.environment,
            version: '',
            size: this.file.byteLength,
            chunk_size: this.chunkSize
        };

        // configure OTA based on device options
        try {
            const options = await this.api.getDeviceOTAOptions(device, this.cancelTokenSource.token);

            console.log('Got device OTA options:', options.data);

            if(options.data.version && options.data.version===this.firmware.version){
                this.showDeviceInfo(device, `Firmware version is already up-to-date!`);
                return { result: OTAUpdateResult.ALREADY_UPDATED, description: 'Firmware version is already up-to-date' };
            }

            // check OTA is enabled for the device
            if (!options.data.enabled) {
                this.showDeviceError(device, 'Device has OTA disabled!');
                return { result: OTAUpdateResult.FAILURE, description: 'OTA Disabled' };
            }

            // adjust chunk size based on device settings
            if (options.data.block_size) {
                console.log("Setting chunk size from device to:", options.data.block_size);
                this.chunkSize = options.data.block_size;
                this.otaOptions.chunk_size = this.chunkSize;
            }

            // check if supports compressed firmware
            if (options.data.compression) {
                try {
                    switch (options.data.compression) {
                        case 'zlib': {
                            const zlib = require('zlib');
                            this.deflated = zlib.deflateSync(this.file);
                            this.otaOptions.compression = 'zlib';
                            this.otaOptions.compressed_size = this.deflated?.byteLength;
                        }
                            break;
                        case 'gzip': {
                            const zlib = require('zlib');
                            this.deflated = zlib.gzipSync(this.file);
                            this.otaOptions.compression = 'zlib';
                            this.otaOptions.compressed_size = this.deflated?.byteLength;
                        }
                            break;
                        case 'lzss': {
                            const lzss = new LZSS();
                            this.deflated = lzss.encode(Buffer.from(this.file));
                            this.otaOptions.compressed_size = this.deflated?.byteLength;
                            this.otaOptions.compression = 'lzss';
                        }
                            break;
                        default:
                            console.error(`Unsupported compresssion schema: ${options.data.compression}`);
                            break;
                    }
                    if(this.otaOptions.compression){
                        otaReport.logCompressionResult(options.data.compression, this.file.byteLength, this.deflated?.byteLength ?? 0);
                    }
                } catch (error: any) {
                    console.error(error);
                }
            }

            // generate checksumm from original file and compressed 
            if (options.data.checksum === 'md5') {
                // generate checksum for original binary
                this.otaOptions.checksum = this.getChecksum('md5', this.file);

                // generate checksum for compressed version
                if (this.deflated && this.deflated.byteLength > 0) {
                    this.otaOptions.compressed_checksum = this.getChecksum('md5', this.deflated);
                }
            }
        } catch (error: any) {
            if (!axios.isCancel(error)) {
                if (error.response.status === 403) {
                    this.showDeviceError(device, 'Cannot retrieve device OTA options.');
                    return { result: OTAUpdateResult.FAILURE, description: 'Cannot retrieve device OTA options.' };
                } else if (error.response.status === 404) {
                    this.showDeviceError(device, 'Not connected or does not support OTA.');
                    return { result: OTAUpdateResult.FAILURE, description: 'Disconnected or not supporting OTA' };
                } else {
                    this.showDeviceError(device, 'Cannot initialize OTA: ' + error);
                    return { result: OTAUpdateResult.FAILURE, description: `Cannot initialize OTA: ${error}` };
                }
            } else {
                return { result: OTAUpdateResult.FAILURE, description: 'Operation cancelled' };
            }
        }

        return { result: OTAUpdateResult.SUCCESS, description: 'OK' };
    }

    private showDeviceInfo(device: string, message: string){
        vscode.window.showInformationMessage(`Device ${device}: ${message}`);
    }

    private showDeviceError(device: string, message: string){
        vscode.window.showErrorMessage(`Device ${device}: ${message}`);
    }

    private async beginOTA(device: string, progress: vscode.Progress<{ message?: string; increment?: number }>) : Promise<OTAResult> {
        try {
            console.log("Beginning OTA update with the following options:", this.otaOptions);

            // notify the device we are going to begin the OTA process
            const beginOK = await this.api.beginDeviceOTA(device, this.otaOptions, this.cancelTokenSource.token);

            // ensure the device OTA begin is OK! 
            if (beginOK.data.success !== true) {
                if (beginOK.data.error) {
                    this.showDeviceError(device, `Error while initializing OTA: ${beginOK.data.error}`);
                    return { result: OTAUpdateResult.FAILURE, description: `Error while initializing OTA: ${beginOK.data.error}` };
                } else {
                    this.showDeviceError(device, 'Error while initializing OTA!');
                    return { result: OTAUpdateResult.FAILURE, description: 'Device cannot initialize OTA!' };
                }
            }
        } catch (error: any) {
            if (!axios.isCancel(error)) {
                console.error(error);
                return { result: OTAUpdateResult.FAILURE, description: `Cannot begin OTA Upgrade: ${error}` };
            } else {
                return { result: OTAUpdateResult.FAILURE, description: 'Operation cancelled' };
            }
        }

        return { result: OTAUpdateResult.SUCCESS, description: 'OK' };
    }

    private async writeOTA(device: string, progress: vscode.Progress<{ message?: string; increment?: number }>) : Promise<OTAResult>{            
        // determine final binary size and number of chunks to send
        const otaFirmware = this.deflated && this.deflated.byteLength > 0 ? this.deflated : this.file;
        const otaSize = otaFirmware.byteLength;
        const otaChunks = Math.ceil(otaSize / this.chunkSize);

        console.log("Sending OTA Firmware:", otaSize, otaFirmware);

        // iterate over all firmware chunks
        for (let i = 0; i < otaChunks && !this.cancelled; i++) {
            // determine current chung size and its data
            const currentChunkSize = Math.min(this.chunkSize, otaSize - this.sent);
            const chunkData = otaFirmware.slice(this.sent, this.sent + currentChunkSize);

            // try to send chunk data to device
            try {
                const writeChunk = await this.api.writeDeviceOTA(device, chunkData, this.cancelTokenSource.token);

                // check ota chunk has been processed correctly
                if (!writeChunk.data.success) {
                    console.error(writeChunk.data);
                    if (writeChunk.data.error) {
                        this.showDeviceError(device, `Error while writing to device: ${writeChunk.data.error}`);
                        return { result: OTAUpdateResult.FAILURE, description: `Error while writing to device: ${writeChunk.data.error}` };
                    } else {
                        this.showDeviceError(device, 'Error while writing to device: invalid firmware part?');
                        return { result: OTAUpdateResult.FAILURE, description: 'Error while writing to device: invalid firmware part?' };
                    }
                }

            } catch (error) {
                if (!axios.isCancel(error)) {
                    console.error(error);
                    this.showDeviceError(device, 'Error while writing to device: ' + error);
                    return { result: OTAUpdateResult.FAILURE, description: `Error while writing to device: ${error}` };
                } else {
                    return { result: OTAUpdateResult.FAILURE, description: 'Operation cancelled' };
                }
            }

            // increase window information with current progress
            this.sent += currentChunkSize;
            progress.report({
                message: `Uploading Firmware (${this.environment})...`,
                increment: (currentChunkSize / otaSize) * 100
            });
            otaReport.logProgress(device, (this.sent / otaSize) * 100);
            console.log("Progress: ", (this.sent / otaSize) * 100);
        }


        // if loop ended due to cancelled state.. do nothing
        if (this.cancelled) {
            return { result: OTAUpdateResult.FAILURE, description: 'Operation cancelled' };
        }else{
            return { result: OTAUpdateResult.SUCCESS, description: 'OK' };
        }
    }

    private async endOTA(device: string, progress: vscode.Progress<{ message?: string; increment?: number }>) : Promise<OTAResult> {
        // try to end OTA update after all chunks are sent
        try {
            progress.report({
                message: 'Ending OTA Update ...'
            });
            const endOK = await this.api.endDeviceOTA(device, this.cancelTokenSource.token);

            // check ota chunk has been processed correctly
            if (!endOK.data.success) {
                if (endOK.data.error) {
                    const errorMsg = `Error while ending OTA update: ${endOK.data.error}`;
                    this.showDeviceError(device, errorMsg);
                    return { result: OTAUpdateResult.FAILURE, description: errorMsg };
                } else {
                    const errorMsg = 'Error while ending OTA update: bad image or checksum?';
                    this.showDeviceError(device, errorMsg);
                    return { result: OTAUpdateResult.FAILURE, description: errorMsg };
                }
            }
        } catch (error) {
            if (!axios.isCancel(error)) {
                console.error(error);
                const errorMsg = 'Error while ending OTA update: ' + error;
                this.showDeviceError(device, errorMsg);
                return { result: OTAUpdateResult.FAILURE, description: errorMsg };
            } else {
                return { result: OTAUpdateResult.FAILURE, description: 'Operation cancelled' };
            }
        }

        // reboot the device so the firmware applies
        try {
            progress.report({ message: 'Rebooting Device ...' });
            const restart = await this.api.rebootDeviceOTA(device, this.cancelTokenSource.token);
            this.showDeviceInfo(device, 'OTA Completed! Device is rebooting...');
            return { result: OTAUpdateResult.SUCCESS, description: 'OK' };
        } catch (error) {
            console.error(error);
            const errorMsg = 'Error while rebooting device: ' + error;
            this.showDeviceError(device, errorMsg);
            return { result: OTAUpdateResult.FAILURE, description: errorMsg };
        }
    }

    private returnResult(device: string, result: OTAResult) {
        if (this.startTime) {
            result.duration = new Date().getTime() - this.startTime.getTime();
        }
        result.device = device;
        return result;
    }

    public async upload(device: string): Promise<OTAResult> {

        // read firmware file
        try{
            this.file = await vscode.workspace.fs.readFile(this.firmware.path);
        }catch(e: any){
            vscode.window.showErrorMessage('Error while reading firmware file: ' + e);
            return this.returnResult(device, { result: OTAUpdateResult.FAILURE, description: 'Error while reading firmware file' });
        }

        // start a progress window for the upload
        return vscode.window.withProgress({
            cancellable: true,
            location: vscode.ProgressLocation.Notification,
            title: 'Thinger.io',
        }, async (progress, cancelToken): Promise<OTAResult> => {

            // register cancel action over upload
            cancelToken.onCancellationRequested(() => {
                this.cancelTokenSource.cancel();
                this.cancelled = true;
            });

            if(!this.cancelled){  
                 // initialize the OTA process
                const result = await this.initializeOTA(device, progress);
                if(result.result!==OTAUpdateResult.SUCCESS) {return this.returnResult(device, result);}
            }

            if(!this.cancelled){  
                // begin the OTA process
                const result = await this.beginOTA(device, progress);
                if(result.result!==OTAUpdateResult.SUCCESS) {return this.returnResult(device, result);}
            }

            if(!this.cancelled){  
                // write the OTA 
                const result = await this.writeOTA(device, progress);
                if(result.result!==OTAUpdateResult.SUCCESS) {return this.returnResult(device, result);}
            }

            if(!this.cancelled){  
                // end the OTA 
                const result = await this.endOTA(device, progress);
                return this.returnResult(device, result);
            }
            
            return { result: OTAUpdateResult.FAILURE, description: 'Operation cancelled' };
        });
    }
}