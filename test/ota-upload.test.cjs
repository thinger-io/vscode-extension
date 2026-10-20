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
        showWarningMessage: async (message, options, ...items) => {
            warnings.push({message, detail: options.detail, items: items.map(item => item.title)});
            if (onWarning) { await onWarning(); }
            return answer === undefined ? undefined : items.find(item => item.title === answer);
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

const fields = {PCB_MODEL: 'SENSOR_CURRENT', PCB_VERSION: 'V2', COMMUNICATION_MODE: 'WIFI'};
const metadata = validateOTACheck(fields);
const mismatching = validateOTACheck({...fields, PCB_VERSION: 'V3'});

function setup(opts = {}) {
    const {candidate = metadata, version = 'new', compression, enabled = true, batch = false, rejection} = opts;
    // an explicit undefined means a device that does not report the field
    const check = 'check' in opts ? opts.check : fields;
    const events = [];
    const sent = [];
    const data = Buffer.from('the exact inspected firmware bytes');
    let beginOptions;
    const api = {
        getDeviceOTAOptions: async device => {
            events.push(`options:${device}`);
            return {data: {enabled, check, version: 'old', block_size: 8, checksum: 'md5', compression}};
        },
        beginDeviceOTA: async (device, options) => {
            events.push(`begin:${device}`); beginOptions = options;
            return {data: rejection ?? {success: true}};
        },
        writeDeviceOTA: async (_, chunk) => { events.push('write'); sent.push(Buffer.from(chunk)); return {data: {success: true}}; },
        endDeviceOTA: async () => { events.push('end'); return {data: {success: true}}; },
        rebootDeviceOTA: async () => { events.push('reboot'); return {data: {success: true}}; }
    };
    const firmware = {path: {fsPath: 'unused.bin'}, environment: 'esp32', version, data, check: candidate};
    return {instance: new ThingerOTAInstance(api, firmware, 'esp32', batch), api, events, sent, data, options: () => beginOptions};
}

test('devices without OTA check update as before, with or without a manifest in the firmware', async () => {
    for (const candidate of [metadata, null]) {
        const run = setup({check: undefined, candidate});
        assert.equal((await run.instance.upload('legacy')).result, OTAUpdateResult.SUCCESS);
        assert.equal(warnings.length, 0);
        assert.deepEqual(Buffer.concat(run.sent), run.data);
    }
});

test('devices without OTA check and the same version are already updated', async () => {
    for (const candidate of [metadata, null]) {
        const run = setup({check: undefined, candidate, version: 'old'});
        assert.equal((await run.instance.upload('legacy')).result, OTAUpdateResult.ALREADY_UPDATED);
        assert.deepEqual(run.events, ['options:legacy']);
        assert.equal(warnings.length, 0);
    }
});

test('matching OTA check uploads the inspected bytes without asking', async () => {
    const run = setup();
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.SUCCESS);
    assert.equal(warnings.length, 0);
    assert.deepEqual(Buffer.concat(run.sent), run.data);
    assert.equal(run.options().version, 'new');
    assert.deepEqual(run.options().check, fields);
    assert.equal(run.options().force, undefined);
    assert.equal(activeToken.size, 0);
});

test('the firmware fields are sent in begin when present, and never force for legacy devices', async () => {
    let run = setup({check: undefined});
    await run.instance.upload('legacy');
    assert.deepEqual(run.options().check, fields);
    assert.equal(run.options().force, undefined);
    run = setup({check: undefined, candidate: null});
    await run.instance.upload('legacy');
    assert.equal('check' in run.options(), false);
    assert.equal(run.options().force, undefined);
});

test('a confirmed mismatch or missing manifest forces begin, only for that device', async () => {
    answer = 'Continue';
    let run = setup({candidate: mismatching});
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.SUCCESS);
    assert.equal(run.options().force, true);
    assert.deepEqual(run.options().check, {...fields, PCB_VERSION: 'V3'});
    run = setup({candidate: null});
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.SUCCESS);
    assert.equal(run.options().force, true);
    assert.equal('check' in run.options(), false);
    // Continue for All also forces every device it applies to
    answer = 'Continue for All';
    run = setup({candidate: mismatching, batch: true});
    await run.instance.upload('a');
    assert.equal(run.options().force, true);
});

test('a begin rejected by the device OTA check is reported as a compatibility failure', async () => {
    const rejection = {success: false, error: 'Firmware not compatible with this device (THINGER_OTA_CHECK)', check: {PCB_MODEL: 'OTHER'}};
    const run = setup({rejection});
    const result = await run.instance.upload('a');
    assert.equal(result.description, 'Firmware rejected by the device OTA check');
    assert.match(errors[0], /OTA check\). Device fields: \{"PCB_MODEL":"OTHER"\}/);
    assert.equal(run.sent.length, 0);
});

test('matching OTA check and version skips an already updated device', async () => {
    const run = setup({version: 'old'});
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.ALREADY_UPDATED);
    assert.deepEqual(run.events, ['options:a']);
});

test('a mismatch asks first, and Cancel or closing the dialog sends nothing', async () => {
    for (const response of [undefined, 'Cancel']) {
        answer = response;
        const run = setup({candidate: mismatching});
        const result = await run.instance.upload('a');
        assert.equal(result.result, OTAUpdateResult.FAILURE);
        assert.equal(result.description, 'Skipped: OTA check mismatch');
        assert.deepEqual(run.events, ['options:a']);
        assert.equal(run.sent.length, 0);
    }
    assert.deepEqual(warnings[0].items, ['Continue', 'Cancel']);
    assert.match(warnings[0].detail, /"PCB_VERSION": "V2" -> "V3"/);
});

test('begin waits for Continue, and an equal version cannot hide a mismatch', async () => {
    const run = setup({candidate: mismatching, version: 'old'});
    let release;
    onWarning = () => new Promise(resolve => { release = resolve; });
    const upload = run.instance.upload('a');
    while (!release) { await new Promise(resolve => setImmediate(resolve)); }
    assert.deepEqual(run.events, ['options:a']);
    answer = 'Continue'; release();
    assert.equal((await upload).result, OTAUpdateResult.SUCCESS);
    assert(run.events.includes('begin:a'));
});

test('a firmware without manifest for a device with OTA check asks first', async () => {
    const run = setup({candidate: null});
    const result = await run.instance.upload('a');
    assert.equal(result.description, 'Skipped: Firmware without OTA check');
    assert.match(warnings[0].message, /cannot be verified/);
    assert.equal(run.events.includes('begin:a'), false);
});

test('a malformed OTA check reported by the device aborts without asking', async () => {
    for (const check of [true, {}, [], {PCB_MODEL: 2}]) {
        warnings = []; errors = [];
        const run = setup({check});
        assert.equal((await run.instance.upload('bad')).result, OTAUpdateResult.FAILURE);
        assert.deepEqual(run.events, ['options:bad']);
        assert.equal(warnings.length, 0);
        assert.match(errors[0], /Invalid OTA check/);
    }
});

test('a device with OTA disabled fails before asking', async () => {
    const run = setup({candidate: mismatching, enabled: false});
    assert.equal((await run.instance.upload('a')).description, 'OTA Disabled');
    assert.equal(warnings.length, 0);
});

test('products: Continue for All and Skip All are asked once', async () => {
    for (const [response, expected] of [['Continue for All', OTAUpdateResult.SUCCESS], ['Skip All', OTAUpdateResult.FAILURE]]) {
        warnings = [];
        answer = response;
        const run = setup({candidate: mismatching, batch: true});
        for (const device of ['a', 'b', 'c']) {
            assert.equal((await run.instance.upload(device)).result, expected);
        }
        assert.equal(warnings.length, 1);
        assert.deepEqual(warnings[0].items, ['Continue', 'Continue for All', 'Skip All', 'Skip']);
    }
});

test('products: Continue and Skip apply to one device only', async () => {
    const run = setup({candidate: mismatching, batch: true});
    answer = 'Continue';
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.SUCCESS);
    answer = 'Skip';
    assert.equal((await run.instance.upload('b')).result, OTAUpdateResult.FAILURE);
    answer = undefined;
    assert.equal((await run.instance.upload('c')).result, OTAUpdateResult.FAILURE);
    assert.equal(warnings.length, 3);
    assert.deepEqual(run.events.filter(event => event.startsWith('begin:')), ['begin:a']);
});

test('cancellation while confirming prevents begin even after Continue', async () => {
    for (const useParent of [false, true]) {
        const parent = token();
        const run = setup({candidate: mismatching});
        answer = 'Continue';
        onWarning = async () => { (useParent ? parent : activeToken).cancel(); };
        assert.equal((await run.instance.upload('a', useParent ? parent : undefined)).result, OTAUpdateResult.FAILURE);
        assert.deepEqual(run.events, ['options:a']);
        assert.equal(parent.size, 0);
        assert.equal(activeToken.size, 0);
    }
});

test('compression uses the inspected image and is reset between devices', async () => {
    const run = setup({compression: 'zlib'});
    assert.equal((await run.instance.upload('a')).result, OTAUpdateResult.SUCCESS);
    assert.deepEqual(zlib.inflateSync(Buffer.concat(run.sent)), run.data);
    assert.equal(run.options().compression, 'zlib');
});
