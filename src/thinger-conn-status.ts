import * as vscode from 'vscode';

export class TxRxStatus {
  private txRxStatusBar: vscode.StatusBarItem;
  private txBytes: number = 0;
  private rxBytes: number = 0;
  private totalTxBytes: number = 0;
  private totalRxBytes: number = 0;
  private txTimeout: NodeJS.Timeout | null = null;
  private rxTimeout: NodeJS.Timeout | null = null;

  constructor(context: vscode.ExtensionContext) {
    // Create a status bar item
    this.txRxStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
    context.subscriptions.push(this.txRxStatusBar);
    
    // Initialize the status bar item
    this.updateTxRxStatusBar();
  }

  public updateTxBytes(newTxBytes: number) {
    this.txBytes = newTxBytes;
    this.totalTxBytes += newTxBytes;
    this.updateTxRxStatusBar();
    this.resetTxBytesAfterDelay();
  }

  public updateRxBytes(newRxBytes: number) {
    this.rxBytes = newRxBytes;
    this.totalRxBytes += newRxBytes;
    this.updateTxRxStatusBar();
    this.resetRxBytesAfterDelay();
  }

  private resetTxBytesAfterDelay() {
    if (this.txTimeout) {
      clearTimeout(this.txTimeout);
    }
    this.txTimeout = setTimeout(() => {
      this.txBytes = 0;
      this.updateTxRxStatusBar();
    }, 300);
  }

  private resetRxBytesAfterDelay() {
    if (this.rxTimeout) {
      clearTimeout(this.rxTimeout);
    }
    this.rxTimeout = setTimeout(() => {
      this.rxBytes = 0;
      this.updateTxRxStatusBar();
    }, 300);
  }

  private updateTxRxStatusBar() {
    // Create a visual representation using ASCII art
    const txVisual = this.txBytes ? '●' : '○';
    const rxVisual = this.rxBytes ? '●' : '○';

    this.txRxStatusBar.text = `$(arrow-up) ${txVisual} $(arrow-down) ${rxVisual}`;
    this.txRxStatusBar.tooltip = new vscode.MarkdownString(`$(arrow-up) **Total Bytes Sent:** ${this.totalTxBytes}\n\n$(arrow-down) **Total Bytes Received:** ${this.totalRxBytes}`, true);
  }

  public hide() {
    this.txRxStatusBar.hide();
  }

  public show(){
    this.txRxStatusBar.show();
  }

  public clear(){
    this.txBytes = 0;
    this.rxBytes = 0;
    this.totalTxBytes = 0;
    this.totalRxBytes = 0;
    this.updateTxRxStatusBar();
    if(this.txTimeout){
      clearTimeout(this.txTimeout);
    }
    if(this.rxTimeout){
      clearTimeout(this.rxTimeout);
    }
  }

  public deactivate() {
    if (this.txRxStatusBar) {
      this.txRxStatusBar.dispose();
    }
    if (this.txTimeout) {
      clearTimeout(this.txTimeout);
    }
    if (this.rxTimeout) {
      clearTimeout(this.rxTimeout);
    }
  }
}