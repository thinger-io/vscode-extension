import * as vscode from 'vscode';
import { ThingerOTAGUI } from './thinger-ota-gui';

let gui = new ThingerOTAGUI();

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    console.log('Thinger.io plugin activated');
    gui.activate(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
    console.log('Thinger.io plugin deactivated');
    gui.deactivate();
}