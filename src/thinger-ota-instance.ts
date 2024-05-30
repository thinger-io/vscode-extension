import * as vscode from 'vscode';
import { ThingerAPI } from './thinger-api';
import axios from 'axios';
import { LZSS } from './util/lzss';
import { otaReport } from './thinger-ota-report';

export interface OTAResult {
    device?: string;
    result: boolean;
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

export class ThingerOTAInstance {

    private api: ThingerAPI;
    private cancelTokenSource = axios.CancelToken.source();

    private file: Uint8Array;
    private deflated: Uint8Array | undefined;
    private compression: string | undefined;
    private environment: string;
    private chunkSize: number = 8192;
    private otaOptions: OTAOptions = {};
    private startTime: Date | undefined;

    private cancelled: boolean = false;
    private sent: number = 0;

    constructor(api: ThingerAPI, file: Uint8Array, environment: string = 'default') {
        this.api = api;
        this.file = file;
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

    private async initializeOTA(device: string, progress: vscode.Progress<{ message?: string; increment?: number }>){        
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

            // check OTA is enabled for the device
            if (!options.data.enabled) {
                vscode.window.showErrorMessage('OTA Updates are disabled on this device!');
                return { result: false, description: 'OTA Disabled' };
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
                    otaReport.logCompressionResult(options.data.compression, this.file.byteLength, this.deflated?.byteLength ?? 0);
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
                    vscode.window.showErrorMessage('Cannot retrieve device OTA options. Please check your Token permissions.');
                    return { result: false, description: 'Cannot retrieve device OTA options.' };
                } else if (error.response.status === 404) {
                    vscode.window.showErrorMessage(`Device '${device}' is not connected or does not support OTA!`);
                    return { result: false, description: 'Disconnected or not supporting OTA' };
                } else {
                    vscode.window.showErrorMessage('Cannot initialize OTA: ' + error);
                    return { result: false, description: `Cannot initialize OTA: ${error}` };
                }
            } else {
                return { result: false, description: 'Operation cancelled' };
            }
        }

        return { result: true, description: 'OK' };
    }

    private async beginOTA(device: string, progress: vscode.Progress<{ message?: string; increment?: number }>) {
        try {
            console.log("Beginning OTA update with the following options:", this.otaOptions);

            // notify the device we are going to begin the OTA process
            const beginOK = await this.api.beginDeviceOTA(device, this.otaOptions, this.cancelTokenSource.token);

            // ensure the device OTA begin is OK! 
            if (beginOK.data.success !== true) {
                if (beginOK.data.error) {
                    vscode.window.showErrorMessage(`Error while initializing OTA: ${beginOK.data.error}`);
                    return { result: false, description: `Error while initializing OTA: ${beginOK.data.error}` };
                } else {
                    vscode.window.showErrorMessage('Device cannot initialize OTA!');
                    return { result: false, description: 'Device cannot initialize OTA!' };
                }
            }
        } catch (error: any) {
            if (!axios.isCancel(error)) {
                console.error(error);
                return { result: false, description: `Cannot begin OTA Upgrade: ${error}` };
            } else {
                return { result: false, description: 'Operation cancelled' };
            }
        }

        return { result: true, description: 'OK' };
    }

    private async writeOTA(device: string, progress: vscode.Progress<{ message?: string; increment?: number }>) {            
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
                        vscode.window.showErrorMessage(`Error while writing to device: ${writeChunk.data.error}`);
                        return { result: false, description: `Error while writing to device: ${writeChunk.data.error}` };
                    } else {
                        vscode.window.showErrorMessage('Error while writing to device: invalid firmware part?');
                        return { result: false, description: 'Error while writing to device: invalid firmware part?' };
                    }
                }

            } catch (error) {
                if (!axios.isCancel(error)) {
                    console.error(error);
                    vscode.window.showErrorMessage('Error while writing to device: ' + error);
                    return { result: false, description: `Error while writing to device: ${error}` };
                } else {
                    return { result: false, description: 'Operation cancelled' };
                }
            }

            // increase window information with current progress
            this.sent += currentChunkSize;
            progress.report({
                message: `Uploading Firmware (${this.environment})...`,
                increment: (currentChunkSize / otaSize) * 100
            });
            console.log("Progress: ", (this.sent / otaSize) * 100);
        }


        // if loop ended due to cancelled state.. do nothing
        if (this.cancelled) {
            return { result: false, description: 'Operation cancelled' };
        }else{
            return { result: true, description: 'OK' };
        }
    }

    private async endOTA(device: string, progress: vscode.Progress<{ message?: string; increment?: number }>) {
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
                    vscode.window.showErrorMessage(errorMsg);
                    return { result: false, description: errorMsg };
                } else {
                    const errorMsg = 'Error while ending OTA update: bad image or checksum?';
                    vscode.window.showErrorMessage(errorMsg);
                    return { result: false, description: errorMsg };
                }
            }
        } catch (error) {
            if (!axios.isCancel(error)) {
                console.error(error);
                const errorMsg = 'Error while ending OTA update: ' + error;
                vscode.window.showErrorMessage(errorMsg);
                return { result: false, description: errorMsg };
            } else {
                return { result: false, description: 'Operation cancelled' };
            }
        }

        // reboot the device so the firmware applies
        try {
            progress.report({ message: 'Rebooting Device ...' });
            const restart = await this.api.rebootDeviceOTA(device, this.cancelTokenSource.token);
            vscode.window.showInformationMessage(`OTA Completed for device: ${device}`);
            return { result: true, description: 'OK' };
        } catch (error) {
            console.error(error);
            const errorMsg = 'Error while rebooting device: ' + error;
            vscode.window.showErrorMessage(errorMsg);
            return { result: false, description: errorMsg };
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
                if(!result.result) {return this.returnResult(device, result);}
            }

            if(!this.cancelled){  
                // begin the OTA process
                const result = await this.beginOTA(device, progress);
                if(!result.result) {return this.returnResult(device, result);}
            }

            if(!this.cancelled){  
                // write the OTA 
                const result = await this.writeOTA(device, progress);
                if(!result.result) {return this.returnResult(device, result);}
            }

            if(!this.cancelled){  
                // end the OTA 
                const result = await this.endOTA(device, progress);
                return this.returnResult(device, result);;
            }
            
            return { result: false, description: 'Operation cancelled' };
        });
    }
}