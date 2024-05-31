import * as vscode from 'vscode';
import { ThingerOTATarget } from './thinger-config';
import { OTAResult, OTAUpdateResult } from './thinger-ota-instance';
import { ThingerFirmware } from './util/platformio';

class OTAReport {
  private outputChannel: vscode.OutputChannel | undefined;
  private startTime: Date | undefined;
  private successCount: number = 0;
  private failureCount: number = 0;
  private alreadyUpdatedCount: number = 0;
  private logMessages: string[] = [];
  private lastProgressIndex: number | undefined;

  /**
   * Initializes the OTA report for the specified target.
   * @param target - The ThingerOTATarget object representing the target device or product.
   */
  public initReport(target: ThingerOTATarget, firmware: ThingerFirmware) {
    if (this.outputChannel) {
      this.outputChannel.clear();
    } else {
      this.outputChannel = vscode.window.createOutputChannel('Thinger.io OTA Log', 'log');
    }
    this.outputChannel.show();
    this.logMessages = [];

    this.startTime = new Date();
    this.successCount = 0;
    this.failureCount = 0;
    this.alreadyUpdatedCount = 0;

    const timestamp = this.startTime.toISOString();
    const logMessage = `${timestamp} [info] OTA update process started. ${target.type==='device' ? 'Device' : 'Product'}: ${target.id}, Firmware Version: ${firmware.version}, Environment: ${firmware.environment}`;
    this.logMessages.push(logMessage);
    this.outputChannel.appendLine(logMessage);
  }

  /**
   * Ends the OTA report and displays the summary message.
   */
  public endReport() {
    if (this.outputChannel && this.startTime) {
      const endTime = new Date();
      const totalDuration = this.formatDuration(endTime.getTime() - this.startTime.getTime());

      const summaryMessage = `OTA update process completed. Total duration: ${totalDuration}. Success: ${this.successCount}, Failures: ${this.failureCount}, Already Updated: ${this.alreadyUpdatedCount}`;
      const timestamp = endTime.toISOString();
      const logMessage = `${timestamp} [info] ${summaryMessage}`;

      this.logMessages.push(logMessage);
      this.outputChannel.appendLine(logMessage);
    }
  }

  /**
   * Logs the result of the compression process.
   * @param compression - The compression algorithm used.
   * @param originalSize - The size of the original file in bytes.
   * @param compressedSize - The size of the compressed file in bytes.
   */
  public logCompressionResult(compression: string, originalSize: number, compressedSize: number) {
    if (!this.outputChannel) { return; }

    const timestamp = new Date().toISOString();
    const ratio = ((compressedSize / originalSize) * 100).toFixed(2);
    const logMessage = `${timestamp} [info] Compression: ${compression.toUpperCase()}. Original size: ${originalSize} bytes. Compressed size: ${compressedSize} bytes. Compression ratio: ${ratio}%`;

    this.logMessages.push(logMessage);
    this.outputChannel.appendLine(logMessage);
  }

  /**
   * Logs the result of the upload process.
   * @param result - The OTAResult object representing the result of the upload process.
   */
  public logResult(result: OTAResult) {
    if (!this.outputChannel) { return; }

    const timestamp = new Date().toISOString();
    let logLevel = 'info';
    if (result.result === OTAUpdateResult.FAILURE) {
      logLevel = 'error';
    }

    const device = result.device || 'Unknown';
    const duration = result.duration ? this.formatDuration(result.duration) : 'N/A';
    const logMessage = `${timestamp} [${logLevel}] Device: ${device}. Status: ${result.result}. Duration: ${duration}. Description: ${result.description}`;

    this.logMessages.push(logMessage);
    this.outputChannel.appendLine(logMessage);

    if (result.result === OTAUpdateResult.SUCCESS) {
      this.successCount++;
    } else if (result.result === OTAUpdateResult.FAILURE) {
      this.failureCount++;
    } else if (result.result === OTAUpdateResult.ALREADY_UPDATED) {
      this.alreadyUpdatedCount++;
    }
  }

  /**
   * Logs the progress of the OTA update.
   * @param progress - The current progress as a percentage (0 to 100).
   */
  public logProgress(device: string, progress: number) {
    if (!this.outputChannel || !this.startTime) { return; }

    const now = new Date();
    const elapsedTime = now.getTime() - this.startTime.getTime();
    const eta = progress > 0 ? (elapsedTime * (100 / progress - 1)) : 0;
    const timestamp = now.toISOString();

    const progressBarLength = 26; // Length of the progress bar
    const filledLength = Math.round(progressBarLength * progress / 100);
    const bar = '█'.repeat(filledLength) + '░'.repeat(progressBarLength - filledLength);
    const logMessage = `${timestamp} [info] ${bar} ${progress.toFixed(2)}% - Device: ${device}, Time spent: ${this.formatDuration(elapsedTime)}, ETA: ${this.formatDuration(eta)}`;

    // Replace the last progress message if it exists
    if (this.lastProgressIndex !== undefined) {
      this.logMessages[this.lastProgressIndex] = logMessage;
    } else {
      this.logMessages.push(logMessage);
      this.lastProgressIndex = this.logMessages.length - 1;
    }

    // Clear the output channel and re-log all messages
    let output = '';
    this.logMessages.forEach(message => output += message + '\n');
    this.outputChannel.replace(output);
  }

  /**
   * Formats the duration in milliseconds to a human-readable format.
   * @param duration - The duration in milliseconds.
   * @returns The formatted duration string.
   */
  private formatDuration(duration: number): string {
    const milliseconds = Math.trunc(duration % 1000);
    const seconds = Math.floor((duration / 1000) % 60);
    const minutes = Math.floor((duration / (1000 * 60)) % 60);
    const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

    if(duration==0) return '0 ms';

    let formatted = '';
    if (hours > 0) {
      formatted += `${hours} h `;
    }
    if (minutes > 0) {
      formatted += `${minutes} m `;
    }
    if (seconds > 0) {
      formatted += `${seconds} s `;
    }
    if (milliseconds > 0) {
      formatted += `${milliseconds} ms `;
    }

    return formatted.trim();
  }
}

export const otaReport = new OTAReport();
