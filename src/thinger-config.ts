import * as vscode from 'vscode';
import { jwtDecode } from 'jwt-decode';

export interface ThingerOTATarget {
  type: 'device' | 'product' | 'asset_type' | 'asset_group';
  id: string;
}

export class ThingerConfig {
  // extension context
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  public async getUser(): Promise<string | undefined> {
    const token = await this.getToken();
    if (!token) { return undefined; }
    try {
      const decoded = Object(jwtDecode(token));
      const user = String(decoded.usr);
      return user;
    } catch (e: any) {
      return undefined;
    }
  }

  public async getToken(): Promise<string | undefined> {
    // Try to get token from configuration
    let token: string | undefined = String(vscode.workspace.getConfiguration('thinger-io').get('token'));

    // If not defined, try to initialize it from input box
    if (!token) {

      token = await vscode.window.showInputBox({
        prompt: 'Insert a Thinger.io account Token with permissions for: ListDevices, ListProducts, AccessDeviceResources, ReadDeviceStatistics.'
      });

      if (token) {

        try {
          // decode token JWT token
          const decoded = Object(jwtDecode(token));

          // save token on configuration (decode is ok here)
          await vscode.workspace.getConfiguration('thinger-io').update('token', token, vscode.ConfigurationTarget.Global);

          // save host on configuration
          const host = String(decoded.svr);
          if (host) {
            await vscode.workspace.getConfiguration('thinger-io').update('host', host, vscode.ConfigurationTarget.Global);
          }

        } catch (e: any) {
          vscode.window.showErrorMessage('Error while decoding token: ' + e);
        }

      }
    }
    
    return token;
  }
}
