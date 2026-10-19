const {test, beforeEach, mock} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const zlib = require('node:zlib');
const {validateOTACheck} = require('../out/util/ota-check');

function token() {
    const listeners = new Set();
    return {
        isCancellationRequested: false,
        onCancellationRequested(callback) { listeners.add(callback); return {dispose: () => listeners.delete(callback)}; },
        cancel() { this.isCancellationRequested = true; for (const callback of listeners) { callback(); } },
        get size() { return listeners.size; }
    };
}

let warnings, errors, answer, onWarning, activeToken;
const vscode = {
    ProgressLocation: {Notification: 1},
    workspace: {
        getConfiguration: () => ({get: () => 0}),
        fs: {readFile: async () => { throw Error('Upload must use the inspected snapshot'); }}
    },
    window: {
        showWarningMessage: async (message, options) => {
            warnings.push({message, detail: options.detail});
            if (onWarning) { await onWarning(); }
            return answer;
        },
        showErrorMessage: message => { errors.push(message); },
        showInformationMessage: () => undefined,
        withProgress: async (_, callback) => {
            activeToken = token();
            return callback({report() {}}, activeToken);
        }
    }
};
const originalLoad = Module._load;
Module._load = function(id, parent, isMain) {
    return id === 'vscode' ? vscode : originalLoad.call(this, id, parent, isMain);
};
const {ThingerOTAInstance, OTAUpdateResult} = require('../out/thinger-ota-instance');
Module._load = originalLoad;

beforeEach(() => {
    warnings = []; errors = []; answer = undefined; onWarning = undefined;
    mock.method(console, 'log', () => {});
});

const metadata = validateOTACheck({PCB_MODEL: 'SENSOR_CURRENT', PCB_VERSION: 'V2', COMMUNICATION_MODE: 'WIFI'});

function setup({current = metadata, candidate = metadata, version = 'new', compression, checkError, advertised = true} = {}) {
    const events = [];
    const sent = [];
    const data = Buffer.from('the exact inspected firmware bytes');
    let beginOptions;
    const api = {
        getDeviceOTAOptions: async device => {
            events.push(`options:${device}`);
            return {data: {enabled: true, check: advertised, version: 'old', block_size: 8, checksum: 'md5', compression}};
        },
        getDeviceOTACheck: async (device, cancelToken) => {
            events.push(`check:${device}`);
            cancelToken.throwIfRequested();
            if (checkError) { throw checkError; }
            return {data: current};
        },
        beginDeviceOTA: async (device, options) => {
            events.push(`begin:${device}`); beginOptions = options;
            return {data: {success: true}};
        },
        writeDeviceOTA: async (_, chunk) => { events.push('write'); sent.push(Buffer.from(chunk)); return {data: {success: true}}; },
        endDeviceOTA: async () => { events.push('end'); return {data: {success: true}}; },
        rebootDeviceOTA: async () => { events.push('reboot'); return {data: {success: true}}; }
    };
    const firmware = {path: {fsPath: 'unused.bin'}, environment: 'esp32', version, data, check: candidate};
    return {instance: new ThingerOTAInstance(api, firmware, 'esp32'), api, events, sent, data, options: () => beginOptions};
}

test('matching metadata uploads the inspected bytes without a mismatch dialog', async () => {
    const run = setup();
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.SUCCESS);
    assert.equal(warnings.length, 0);
    assert.deepEqual(Buffer.concat(run.sent), run.data);
    assert(run.events.indexOf('check:a') < run.events.indexOf('begin:a'));
    assert.equal(run.options().version, 'new');
    assert.equal(activeToken.size, 0);
});

test('No or closing the mismatch dialog sends no begin, chunks, end or reboot', async () => {
    for (const response of [undefined, {title: 'No'}]) {
        answer = response;
        const run = setup({candidate: validateOTACheck({...metadata, PCB_VERSION: 'V3'})});
        assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.FAILURE);
        assert.deepEqual(run.events, ['options:a', 'check:a']);
        assert.equal(run.sent.length, 0);
    }
});

test('begin waits for Yes, and equal version cannot hide a metadata mismatch', async () => {
    const run = setup({candidate: validateOTACheck({...metadata, COMMUNICATION_MODE: 'MODEM_GSM_3G_4G_5G'}), version: 'old'});
    let release;
    onWarning = () => new Promise(resolve => { release = resolve; });
    const upload = run.instance.upload('modem');
    while (!release) { await new Promise(resolve => setImmediate(resolve)); }
    assert.deepEqual(run.events, ['options:modem', 'check:modem']);
    assert.match(warnings[0].detail, /WIFI/);
    assert.match(warnings[0].detail, /MODEM_GSM_3G_4G_5G/);
    answer = {title: 'Yes, continue'}; release();
    assert.equal((await upload).result, OTAUpdateResult.SUCCESS);
    assert(run.events.includes('begin:modem'));
});

test('matching metadata and version skips an already updated device', async () => {
    const run = setup({version: 'old'});
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.ALREADY_UPDATED);
    assert.deepEqual(run.events, ['options:a', 'check:a']);
});

test('legacy missing metadata needs Yes; advertised missing resources, permissions and malformed data abort', async () => {
    const missing = {message: 'not found', response: {status: 404}};
    const legacy = setup({checkError: missing, advertised: false});
    assert.equal((await legacy.instance.upload('old')).result, OTAUpdateResult.FAILURE);
    assert.match(warnings[0].message, /cannot be verified/);
    answer = {title: 'Yes, continue'};
    assert.equal((await legacy.instance.upload('old')).result, OTAUpdateResult.SUCCESS);
    for (const opts of [{checkError: missing}, {checkError: {message: 'forbidden', response: {status: 403}}},
        {checkError: Error('timeout')}, {current: {PCB_VERSION: 2}}]) {
        warnings = [];
        const run = setup(opts);
        assert.equal((await run.instance.upload('bad')).result, OTAUpdateResult.FAILURE);
        assert.deepEqual(run.events, ['options:bad', 'check:bad']);
        assert.equal(warnings.length, 0);
    }
});

test('missing candidate metadata also needs explicit confirmation', async () => {
    const run = setup({candidate: null});
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.FAILURE);
    assert.match(warnings[0].detail, /Candidate firmware:\nTHINGER_OTA_CHECK metadata is missing/);
    assert.equal(run.events.includes('begin:a'), false);
});

test('cancellation while confirming prevents begin even after Yes', async () => {
    for (const useParent of [false, true]) {
        const parent = token();
        const run = setup({candidate: validateOTACheck({...metadata, PCB_VERSION: 'V3'})});
        answer = {title: 'Yes, continue'};
        onWarning = async () => { (useParent ? parent : activeToken).cancel(); };
        assert.equal((await run.instance.upload('a', useParent ? parent : undefined)).result, OTAUpdateResult.FAILURE);
        assert.deepEqual(run.events, ['options:a', 'check:a']);
        assert.equal(parent.size, 0);
        assert.equal(activeToken.size, 0);
    }
});

test('each device needs its own approval and receives fresh cancellation state', async () => {
    const run = setup({candidate: validateOTACheck({...metadata, PCB_VERSION: 'V3'})});
    onWarning = async () => { activeToken.cancel(); };
    assert.equal((await run.instance.upload('first')).result, OTAUpdateResult.FAILURE);
    onWarning = undefined;
    answer = {title: 'Yes, continue'};
    assert.equal((await run.instance.upload('second')).result, OTAUpdateResult.SUCCESS);
    answer = {title: 'No'};
    assert.equal((await run.instance.upload('third')).result, OTAUpdateResult.FAILURE);
    assert.equal(warnings.length, 3);
    assert.deepEqual(run.events.filter(event => event.startsWith('begin:')), ['begin:second']);
});

test('compression preserves the inspected image and compatibility is checked before begin', async () => {
    const run = setup({compression: 'zlib'});
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.SUCCESS);
    assert.deepEqual(zlib.inflateSync(Buffer.concat(run.sent)), run.data);
    assert.equal(run.options().compression, 'zlib');
});
