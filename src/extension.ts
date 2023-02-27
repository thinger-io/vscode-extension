import * as vscode from 'vscode';
import path = require('path');
const EventSource = require("eventsource");
import jwt_decode from "jwt-decode";
import * as axiosConfig from './axios-instance';
import axios, { AxiosRequestConfig } from 'axios';
const axiosInstance = axiosConfig.getInstance();

async function getUser() : Promise<string | undefined>{
    const token = await getToken();
    if(!token) return undefined;
    try{
        const decoded = Object(jwt_decode(token));
        const user = String(decoded.usr);
        return user;
    }catch(e : any){
        return undefined;
    }
}

async function getDevices(search: String, config: AxiosRequestConfig){
    let user = await getUser();
    let resource = `/v1/users/${user}/devices?name=${search}&type=Generic&count=10`;
    return axiosInstance.get(resource, config);
}

async function pickDevice() : Promise<string | undefined> {
    return await new Promise<string | undefined>((resolve, reject) => {
        const input = vscode.window.createQuickPick<vscode.QuickPickItem>();
        input.placeholder = 'Select or search a device';
        input.matchOnDescription = true;
        let source : any = undefined;
        let config : AxiosRequestConfig = {};

        function doSearch(value : string){
            // update the current cancel token
            source = axios.CancelToken.source();
            config = {cancelToken: source.token};

            // if control is busy, clear pending request
            if(input.busy){
                console.log("cancelling pending request");
                source.cancel();
            }

            // do search
            input.busy = true;
            getDevices(value, config).then((response:any) => {
                let items: vscode.QuickPickItem[] = [];
                response.data.forEach((element:any) => {
                    items.push({label: element.device, description: element.name, detail: element.description});
                });
                input.items = items;
            }).catch((error:any) => {
                if(!axios.isCancel(error)){
                    console.error(error);
                }
            }).finally(()=>{
                input.busy = false; 
            });
        }
        input.onDidChangeValue(value => {
            doSearch(value);
        });
        input.onDidChangeSelection(items => {
            const item = items[0];
            resolve(item.label);
            input.hide();
        });
        input.onDidHide(() => {
            resolve(undefined);
            input.dispose();
        });
        input.show();
        doSearch('');
    });
}

async function getToken() : Promise<string | undefined>{
    // try to get token from configuration
    let token : string | undefined = String(vscode.workspace.getConfiguration('thinger-io').get('token'));

    // if not defined, try to initialize it from input box
    if(!token){
        token = await vscode.window.showInputBox({
            prompt: 'Insert a Thinger.io account Token with permissions for: ListDevices, AccessDeviceResources, ReadDeviceStatistics.'
        });
        if(token) await vscode.workspace.getConfiguration('thinger-io').update('token', token, vscode.ConfigurationTarget.Global);
    }
    return token;
} 

async function getDevice(context: vscode.ExtensionContext) : Promise<string | undefined>{
    // try to get device from configuration
    let device = context.workspaceState.get<string>('device');
    // if not defined, try to get it from input box
    if(!device) device = await selectDevice(context);
    return device;
}

async function executeBuildTask(task: vscode.Task) {
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

async function getPlatformioTask() {
    return new Promise<[vscode.Task | undefined, string | undefined]>(resolve => {
        vscode.tasks.fetchTasks().then((tasks) => {
            try{
                let platformio = vscode.extensions.getExtension('platformio.platformio-ide');
                let globalState = platformio?.exports.context.globalState;
                console.info(globalState.get('showedReleaseNotesFor'));

                let majorVersion = parseInt(globalState.get('showedReleaseNotesFor')[0]);

                let projects, lastProjectDir, activeEnv;
                if ( majorVersion >= 3 ) {
                    console.info("Platformio version is >= 3");
                    projects = globalState.get('projects');
                    lastProjectDir = globalState.get('lastProjectDir');
                    activeEnv = projects[lastProjectDir].activeEnv;
                } else {
                    console.info("Platformio version is < 3");

                    projects = globalState.get('projects');
                    lastProjectDir = projects.lastProjectDir;
                    activeEnv = projects.projects[lastProjectDir].activeEnv;
                }

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
                console.error("caracola0");
                console.error(e);
            }

            resolve([undefined, undefined]);
        });
    });
}

function get_checksum(hash : string, data : Uint8Array){
    try{
        const crypto = require('crypto');
        return crypto.createHash(hash).update(data).digest('hex');
    }catch(e: any){
        return undefined;
    }
}

async function uploadFirmware(context: vscode.ExtensionContext): Promise<void>{
    // get user and device for the OTA process
    const user = await getUser();
    if(!user) return;

    // ensure we have a device selected or ask the user for it
    const device : string | undefined = await getDevice(context);
    if(!device) return;

    // default wildcard search inside of .pio/build
    let searchPath = "**";

    // try to determine current pio environment and task to build before upload
    try{
        const buildTasks = await getPlatformioTask();
        if(buildTasks[0]){
            // run build task
            const build = await executeBuildTask(buildTasks[0]);

            // if compilation did not succeed... just stop upload
            if(build!==0) return;

            // replace search path with current project env (if any)
            if(buildTasks[1]){
                searchPath = buildTasks[1];
            }
        }else{
            // stop upload when build task is not found
            vscode.window.showWarningMessage('Platformio Build Task cannot be found!');
            return;
        }
    }catch(e: any){
        console.error(e);
    }

    // find firmware binaries associated to all projects or the selected environment
    const uris = await vscode.workspace.findFiles(`.pio/build/${searchPath}/firmware.bin`, null, 10);

    // define envs structure
    let envs : {
        [key: string] : {
            path: vscode.Uri
        }
    } = {};

    // iterate over all firmware.bin founds and fill available environments
    uris.forEach((uri: vscode.Uri) => { 
        let name = path.basename(path.dirname(uri.path));
        envs[name]= {
            path: uri
        }
    });

    // determine environment to use (will show a picker if more than one is available)
    const environments = Object.keys(envs);
    let environment :string |undefined = environments.length===1 ?
        environments[0] :
        await vscode.window.showQuickPick( Object.keys(envs),{ placeHolder: 'select environment' });

    // if no environment is available, then return
    if(!environment) return;

    // get firmware file path
    let firmwareFile = envs[environment].path;

    // read firmware file
    let file = await vscode.workspace.fs.readFile(firmwareFile);
    console.log("Read file: ", firmwareFile);

    // initialize optional deflated array to hold compressed firmwre
    let deflated = new Uint8Array();

    // start a progress window for the upload
    return vscode.window.withProgress({
        cancellable: true,
        location: vscode.ProgressLocation.Notification,
        title: 'Thinger.io',
    }, async (progress, cancelToken): Promise<void> => {
        const resource = `/v3/users/${user}/devices/${device}/resources/$ota/`;

        // inialize some parameters used for the upload
        let chunkSize = 8192;
        let sent = 0;
        let cancelled = false;

        // create a cancel token for stopping axios requests
        const source = axios.CancelToken.source();
        const config = {cancelToken: source.token};

        // register cancel action over upload
        cancelToken.onCancellationRequested(() => {
            source.cancel();
            cancelled = true;
        });

        // report progress
        progress.report({
            message: 'Initializing OTA Update ...',
        });

        // initialize basic begin options
        let beginOptions : any = {
            firmware: environment,
            version: '',
            size: file.byteLength,
            chunk_size: chunkSize
            // other options
            // checksum if the device sent checksum in its options
            // compressed_size, if device sets 'compression'
            // compressed_checksum if compression and checksum
        };

        // configure OTA based on device options
        try{
            const options = await axiosInstance.get(resource + 'options', config);

            console.log('Got device OTA options:', options.data);

            // check OTA is enabled for the device
            if(!options.data.enabled){
                vscode.window.showInformationMessage('OTA Updates are disabled on this device!');
                return;
            }

            // adjust chunk size based on device settings
            if(options.data.block_size){
                console.log("setting chunk size from device to:", options.data.block_size);
                chunkSize = options.data.block_size;
                beginOptions.chunk_size = chunkSize;
            }

             // check if supports compressed firmware
             if(options.data.compression){
                try{
                    switch(options.data.compression){
                        case 'zlib': {
                            const zlib = require('zlib');
                            deflated = zlib.deflateSync(file);
                            console.log("device supports compressed OTA, compression ratio:", file.byteLength/deflated.byteLength);
                            beginOptions.compressed_size = deflated.byteLength;
                        }
                            break;
                        case 'gzip': {
                            const zlib = require('zlib');
                            deflated = zlib.gzipSync(file);
                            console.log("device supports compressed OTA, compression ratio:", file.byteLength/deflated.byteLength);
                            beginOptions.compressed_size = deflated.byteLength;
                        }
                            break;
                        case 'lzss': {
                            const lzjs = require('lzjs');
                            deflated = Buffer.from(lzjs.compress(file));
                            console.log("device supports compressed OTA, compression ratio:", file.byteLength/deflated.byteLength);
                            beginOptions.compressed_size = deflated.byteLength;
                        }
                            break;
                        default:
                            console.error(`Unsupported compresssion schema: ${options.data.compression}`);
                            break;
                    }
                }catch(error: any){
                    console.error(error);
                }
            }

            // generate checksumm from original file and compressed 
            if(options.data.checksum==='md5'){
                // generate checksum for original binary
                beginOptions.checksum = get_checksum('md5', file);

                // generate checksum for compressed version
                if(deflated.byteLength>0){
                    beginOptions.compressed_checksum = get_checksum('md5', deflated);
                }
            }

        }catch(error: any){
            if(!axios.isCancel(error)) {
                console.error(error);
                vscode.window.showErrorMessage('Cannot initialize OTA: ' + error);
            }
            return;
        }

        try{
            console.log("beginning OTA update with the following options:", beginOptions);

            // notify the device we are going to begin the OTA process
            const beginOK = await axiosInstance.post(resource + 'begin', beginOptions, config);

            // ensure the device OTA begin is OK! 
            if(beginOK.data.success!==true){
                if(beginOK.data.error){
                    vscode.window.showErrorMessage(`Error while initializing OTA: ${beginOK.data.error}`);
                }else{
                    vscode.window.showErrorMessage('Device cannot initialize OTA!');
                }
                return;
            }
        }catch(error: any){
            if(!axios.isCancel(error)) {
                console.error(error);
                vscode.window.showErrorMessage('Cannot begin OTA Upgrade: ' + error);
            }
            return;
        }

        // determine final binary size and number of chunks to send
        const otaFirmware = deflated.byteLength > 0 ? deflated : file;
        const otaSize = otaFirmware.byteLength;
        const otaChunks = Math.ceil(otaSize/chunkSize);

        console.log("Sending OTA Firmware:", otaSize, otaFirmware);

        // iterate over all firmware chunks
        const otaStart = new Date();
        for(let i=0; i<otaChunks && !cancelled; i++){
            // determine current chung size and its data
            const currentChunkSize = Math.min(chunkSize, otaSize-sent);
            const chunkData = otaFirmware.slice(sent, sent + currentChunkSize);

            // try to send chunk data to device
            try{
                const writeChunk = await axiosInstance.post(resource + 'write', chunkData, {
                    cancelToken: source.token,
                    headers : {
                        'Content-Type' : 'application/octet-stream'
                    }
                });

                // check ota chunk has been processed correctly
                if(!writeChunk.data.success){
                    console.error(writeChunk.data);
                    if(writeChunk.data.error){
                        vscode.window.showErrorMessage(`Error while writing to device: ${writeChunk.data.error}`);
                    }else{
                        vscode.window.showErrorMessage('Error while writing to device: invalid firmware part?');
                    }
                    return;
                }

            }catch(error){
                if(!axios.isCancel(error)) {
                    console.error(error);
                    vscode.window.showErrorMessage('Error while writing to device: ' + error);
                }
                return;
            }

            // increase window information with current progress
            sent += currentChunkSize;
            progress.report({ 
                message: `Uploading Firmware (${environment})...`,
                increment: (currentChunkSize/otaSize)*100 
            });
            console.log("Progress: ", (sent/otaSize)*100);
        }


        // if loop ended due to cancelled state.. do nothing
        if(cancelled) return;
        const otaEnd = new Date();
        console.log(`OTA Update with ${chunkSize}:`, (otaEnd.getTime()-otaStart.getTime())/1000);

        // try to end OTA update after all chunks are sent
        try{
            progress.report({ 
                message: 'Ending OTA Update ...' 
            });
            const endOK = await axiosInstance.post(resource + 'end', undefined, config);

            // check ota chunk has been processed correctly
            if(!endOK.data.success){
                if(endOK.data.error){
                    vscode.window.showErrorMessage(`Error while ending OTA update: ${endOK.data.error}`);
                }else{
                    vscode.window.showErrorMessage('Error while ending OTA update: bad image or checksum?');
                }
                return;
            }
        }catch(error){
            if(!axios.isCancel(error)) {
                console.error(error);
                vscode.window.showErrorMessage('Error while ending OTA update: ' + error);
            }
            return;
        }

        // reboot the device so the firmware applies
        try{
            progress.report({ message: 'Rebooting Device ...' });
            const restart = await axiosInstance.post(resource + 'reboot', undefined, config);
        }catch(error){
            console.error(error);
            vscode.window.showErrorMessage('Error while rebooting device: ' + error);
        }
    });
}

let selectDeviceBarItem : vscode.StatusBarItem;

async function selectDevice(context: vscode.ExtensionContext){
    // ensure we have a token
    const token = await getToken();
    if(!token) return;

    // show device picker
    const device = await pickDevice();
    if(!device) return;

    // update device in configuration 
    await context.workspaceState.update('device', device);

    selectDeviceBarItem.text = `$(rocket) ${device}`;
    initStateListener(context, selectDeviceBarItem);
    return device;
}

async function createSwitchDeviceBarItem(context: vscode.ExtensionContext)
{
    // create a new status bar item that we can now manage
    selectDeviceBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);

    // register command for device switch
    const switchDeviceCommand = 'thinger-io.switchDevice';
    context.subscriptions.push(vscode.commands.registerCommand(switchDeviceCommand, async () =>
    {
        await selectDevice(context);
    }));

    // register command for device clear
    const clearDeviceCommand = 'thinger-io.clearDevice';
    context.subscriptions.push(vscode.commands.registerCommand(clearDeviceCommand, async () =>
    {
         await context.workspaceState.update('device', undefined);
         selectDeviceBarItem.text = `$(rocket)`;
         initStateListener(context, selectDeviceBarItem);
    }));

    // configure switch device button
    const device = context.workspaceState.get('device');
    selectDeviceBarItem.text = `$(rocket) ${device || ''}`;
    selectDeviceBarItem.tooltip = `Switch Thinger.io Device Target`;
    selectDeviceBarItem.command = switchDeviceCommand;
    context.subscriptions.push(selectDeviceBarItem);
    selectDeviceBarItem.show();

    // initiate device stat listener
    await initStateListener(context, selectDeviceBarItem);

    // re-init state listener if configuration changes
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('thinger-io')) {
            initStateListener(context, selectDeviceBarItem);
        }
    });
}

function createUploadFirmwareBarItem(context: vscode.ExtensionContext)
{
    const upload = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    const flashCommand = 'thinger-io.uploadFirmware';
    context.subscriptions.push(vscode.commands.registerCommand(flashCommand, async () =>
    {
        try{
            upload.text = `$(sync~spin) Uploading...`;
            upload.command = undefined;
            await uploadFirmware(context);
            upload.text = `$(debug-start)`;
            upload.command = flashCommand;
        }catch(e : any){
            console.error(e);
            vscode.window.showErrorMessage('Error while processing OTA update: ' + e); 
        }
    }));

    // create a new status bar item that we can now manage
    upload.text = `$(debug-start)`;
    upload.tooltip = `Thinger.io: Upload Firmware`;
    upload.command = flashCommand;
    context.subscriptions.push(upload);
    upload.show();
}

let evtSource : any;

async function initStateListener(context: vscode.ExtensionContext, item : vscode.StatusBarItem){
    const host = vscode.workspace.getConfiguration('thinger-io').get('host');
    const port = vscode.workspace.getConfiguration('thinger-io').get('port');
    const ssl = vscode.workspace.getConfiguration('thinger-io').get('ssl');
    const secure = vscode.workspace.getConfiguration('thinger-io').get('secure');
    const device = context.workspaceState.get<string>('device');
    const token = await getToken();
    const user = await getUser();

    // change color according to connection status
    function setConnected(connected : boolean): void{
        console.log("SSE - Connected:", connected);
        if(connected){
            item.backgroundColor = undefined;
        }else{
            item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
    }

    if(!host || !port || !user || !token || !device){
        if(evtSource) evtSource.close();
        evtSource = undefined;
        setConnected(false);
        return;
    }

    // initialize event source 
    if(evtSource) evtSource.close();
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
    evtSource = new EventSource(url, config);
    evtSource.reconnectInterval = 5000;

    evtSource.onerror = function (err:any) {
        if (err) {
            console.error("SSE - Error:", err);
            setConnected(false);
        }
    };

    evtSource.onmessage = function (event : any) {
        if(!event.data) return;
        let data = JSON.parse(event.data);
        console.log("SSE - Received message:", data);
        if(data.hasOwnProperty('connected')){
            setConnected(data.connected);
        }
    };

    evtSource.addEventListener("connect", function (e : any) {
        console.log("SSE - Connect", e.data);
    });

}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    // TODO, wor on Output channel for relevant logging?
    //let thingerLog = vscode.window.createOutputChannel("Thinger.io");

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.info('Thinger.io plugin activated');
    await createSwitchDeviceBarItem(context);
    createUploadFirmwareBarItem(context);
}

// this method is called when your extension is deactivated
export function deactivate() {}
