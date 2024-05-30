import * as vscode from 'vscode';
import { ThingerOTATarget } from './thinger-config';
import { OTAResult } from './thinger-ota-instance';

class OTAReport {
  private outputChannel: vscode.OutputChannel | undefined;
  private startTime: Date | undefined;
  private successCount: number = 0;
  private failureCount: number = 0;

  /**
   * Initializes the OTA report for the specified target.
   * @param target - The ThingerOTATarget object representing the target device or product.
   */
  public initReport(target: ThingerOTATarget) {
    if (this.outputChannel) {
      this.outputChannel.clear();
    } else {
      this.outputChannel = vscode.window.createOutputChannel('Thinger.io OTA Log', 'log');
    }
    this.outputChannel.show();

    this.startTime = new Date();
    this.successCount = 0;
    this.failureCount = 0;

    const timestamp = this.startTime.toISOString();
    const logMessage = `${timestamp} [info] OTA update process started for ${target.type}: ${target.id}`;
    this.outputChannel.appendLine(logMessage);
  }

  /**
   * Ends the OTA report and displays the summary message.
   */
  public endReport() {
    if (this.outputChannel && this.startTime) {
      const endTime = new Date();
      const totalDuration = this.formatDuration(endTime.getTime() - this.startTime.getTime());

      const summaryMessage = `OTA update process completed. Total duration: ${totalDuration}. Success: ${this.successCount}, Failures: ${this.failureCount}`;
      const timestamp = endTime.toISOString();
      const logMessage = `${timestamp} [info] ${summaryMessage}`;

      this.outputChannel.appendLine(logMessage);
      // this.outputChannel.dispose();
      // this.outputChannel = undefined;
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
  
    this.outputChannel.appendLine(logMessage);
  }
  
  /**
   * Logs the result of the upload process.
   * @param result - The OTAResult object representing the result of the upload process.
   */
  public logResult(result: OTAResult) {
    if (!this.outputChannel) {return;}

    const timestamp = new Date().toISOString();
    const logLevel = result.result ? 'info' : 'error';
    const device = result.device || 'Unknown';
    const duration = result.duration ? this.formatDuration(result.duration) : 'N/A';
    const logMessage = `${timestamp} [${logLevel}] Device: ${device}. Duration: ${duration}. Description: ${result.description}`;

    this.outputChannel.appendLine(logMessage);

    if (result.result) {
      this.successCount++;
    } else {
      this.failureCount++;
    }
  }

  /**
   * Formats the duration in milliseconds to a human-readable format.
   * @param duration - The duration in milliseconds.
   * @returns The formatted duration string.
   */
  private formatDuration(duration: number): string {
    const milliseconds = duration % 1000;
    const seconds = Math.floor((duration / 1000) % 60);
    const minutes = Math.floor((duration / (1000 * 60)) % 60);
    const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

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