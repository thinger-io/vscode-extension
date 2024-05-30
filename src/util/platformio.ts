import * as vscode from 'vscode';
import path = require('path');

export interface PlatformioFirmware{
    path: vscode.Uri;
    environment: string;
}

export class Platformio{

    private async executeBuildTask(task: vscode.Task) {
        const execution = await vscode.tasks.executeTask(task);
    
        return new Promise<number | undefined>(resolve => {
            let disposable = vscode.tasks.onDidEndTaskProcess(e => {
                if (e.execution === execution) {
                    disposable.dispose();
                    resolve(e.exitCode);
                }
            });
        });
    }

    private async getPlatformioTask() : Promise<[vscode.Task | undefined, string | undefined]>{
        return new Promise<[vscode.Task | undefined, string | undefined]>(resolve => {
            vscode.tasks.fetchTasks().then((tasks) => {
                
                try{
                    let platformio = vscode.extensions.getExtension('platformio.platformio-ide');
                    let projects = platformio?.exports.context.globalState.get('projects');
                    let lastProjectDir = projects?.lastProjectDir;
                    let activeEnv = lastProjectDir ? projects.projects[lastProjectDir].activeEnv : null;
        
                    for(let i=0; i<tasks.length; i++){
                        const task = tasks[i];
                        if(task.source==='PlatformIO'){
                            if(!activeEnv && task.name==='Build'){
                                return resolve([task, activeEnv]);
                            }else if(activeEnv && task.name === (`Build (${activeEnv})`)){
                                return resolve([task, activeEnv]);
                            }
                        }
                    }
                }catch(e: any){
                    console.error(e);
                }
            
                resolve([undefined, undefined]);
            });
        });
    }

    public async getFirmware(compile : boolean = true) : Promise<PlatformioFirmware |undefined>{
        // default wildcard search inside of .pio/build
        let searchPath = "**";

        // try to determine current pio environment and task to build before upload
        if(compile){
            try {
                const buildTasks = await this.getPlatformioTask();
                if (buildTasks[0]) {
                    // run build task
                    const build = await this.executeBuildTask(buildTasks[0]);
    
                    // if compilation did not succeed... just stop upload
                    if (build !== 0) {return;}
    
                    // replace search path with current project env (if any)
                    if (buildTasks[1]) {
                        searchPath = buildTasks[1];
                    }
                } else {
                    vscode.window.showWarningMessage('Platformio Build Task cannot be found!');
                    return;
                }
            } catch (e: any) {
                console.error(e);
            }
        }

        // find firmware binaries associated to all projects or the selected environment
        const uris = await vscode.workspace.findFiles(`.pio/build/${searchPath}/firmware.bin`, null, 10);

        // define envs structure
        let envs: {
            [key: string]: {
                path: vscode.Uri
            }
        } = {};

        // iterate over all firmware.bin founds and fill available environments
        uris.forEach((uri: vscode.Uri) => {
            let name = path.basename(path.dirname(uri.path));
            envs[name] = {
                path: uri
            };
        });

        // determine environment to use (will show a picker if more than one is available)
        const environments = Object.keys(envs);
        let environment: string | undefined = environments.length === 1 ?
            environments[0] :
            await vscode.window.showQuickPick(Object.keys(envs), { placeHolder: 'select environment' });

        // if no environment is available, then return
        if (!environment) {return;}

        // get firmware file path
        return {
            path: envs[environment].path,
            environment: environment
        };
    }
    
}

export const pio = new Platformio();