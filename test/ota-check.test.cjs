const {test} = require('node:test');
const assert = require('node:assert/strict');
const {extractOTACheck, validateOTACheck, compareOTACheck, confirmOTACheck} = require('../out/util/ota-check');

function manifest(pairs, version = '1') {
    return Buffer.from(`@THINGER_OTA_CHECK:${version}@\0${pairs.map(([key, value]) => `${key}\0${value}\0`).join('')}\0@END_THINGER_OTA_CHECK@\0`);
}

const fields = [['PCB_MODEL', 'SENSOR_CURRENT_GPIO_ANALOG'], ['PCB_VERSION', 'V2'], ['COMMUNICATION_MODE', 'WIFI']];

test('reads a bounded manifest anywhere in a binary and preserves UTF-8 and empty values', () => {
    const pairs = [...fields, ['Descrição', 'placa ç'], ['empty', ''], ['BOM', '\ufeffvalue']];
    const image = Buffer.concat([Buffer.from([0, 255, 1]), manifest(pairs), Buffer.from([255, 0])]);
    assert.deepEqual({...extractOTACheck(image)}, Object.fromEntries(pairs));
    assert(Object.isFrozen(extractOTACheck(image)));
    assert.equal(extractOTACheck(Buffer.from('legacy image')), null);
    const padded = Buffer.concat([Buffer.from('ignored'), image, Buffer.from('ignored')]);
    assert.deepEqual(extractOTACheck(padded.subarray(7, 7 + image.length)), extractOTACheck(image));
});

test('rejects duplicate, unsupported, truncated and malformed manifests', () => {
    assert.throws(() => extractOTACheck(Buffer.concat([manifest(fields), manifest(fields)])), /Multiple/);
    assert.throws(() => extractOTACheck(manifest(fields, '2')), /version/);
    const corruptVersion = manifest(fields);
    corruptVersion[Buffer.byteLength('@THINGER_OTA_CHECK:')] = 0xb1;
    assert.throws(() => extractOTACheck(corruptVersion), /version/);
    assert.throws(() => extractOTACheck(manifest(fields).subarray(0, -5)), /footer/);
    assert.throws(() => extractOTACheck(Buffer.from('@THINGER_OTA_CHECK:1@\0unterminated')), /Truncated/);
    assert.throws(() => extractOTACheck(manifest([['a', '1'], ['a', '2']])), /Duplicate/);
    assert.throws(() => extractOTACheck(manifest([])), /1 to 32/);
    assert.throws(() => extractOTACheck(manifest([['a'.repeat(65), 'value']])), /oversized/);
    assert.throws(() => extractOTACheck(manifest([['key', 'a'.repeat(257)]])), /oversized/);
    assert.throws(() => extractOTACheck(manifest(Array.from({length: 33}, (_, i) => [`k${i}`, 'v']))), /Too many/);
    assert.throws(() => extractOTACheck(manifest(Array.from({length: 20}, (_, i) => [`k${i}`, 'v'.repeat(256)]))), /oversized/);
    const invalidUtf8 = manifest([['key', 'value']]);
    invalidUtf8[invalidUtf8.indexOf('value')] = 255;
    assert.throws(() => extractOTACheck(invalidUtf8), /encoded data/);
});

test('validates remote resources with the same schema and handles special object keys safely', () => {
    for (const value of [null, [], {}, {key: 1}, {key: null}, {'': 'v'}, {'nul\0key': 'v'}, {key: 'nul\0value'}]) {
        assert.throws(() => validateOTACheck(value));
    }
    const metadata = validateOTACheck(JSON.parse('{"__proto__":"pcb","constructor":"v2"}'));
    assert.equal(Object.getPrototypeOf(metadata), null);
    assert.equal(metadata.__proto__, 'pcb');
    assert.equal(compareOTACheck(metadata, {}).length, 2);
    assert.throws(() => validateOTACheck({key: 'ç'.repeat(129)}), /Invalid/);
    assert.throws(() => validateOTACheck(Object.fromEntries(Array.from({length: 20}, (_, i) => [`k${i}`, 'a'.repeat(256)]))), /4096/);
});

test('compares fields regardless of order and reports added, removed and changed fields', () => {
    const current = validateOTACheck(Object.fromEntries(fields));
    assert.deepEqual(compareOTACheck(current, Object.fromEntries([...fields].reverse())), []);
    const candidate = validateOTACheck({PCB_MODEL: current.PCB_MODEL, PCB_VERSION: 'V3', EXTRA: 'x'});
    assert.deepEqual(compareOTACheck(current, candidate).map(row => row.field), ['COMMUNICATION_MODE', 'EXTRA', 'PCB_VERSION']);
    assert.equal(compareOTACheck(current, candidate)[0].candidate, undefined);
});

test('waits for explicit confirmation and includes device identity and both values', async () => {
    const current = validateOTACheck(Object.fromEntries(fields));
    const candidate = validateOTACheck({...current, PCB_VERSION: 'V3'});
    let resolve;
    let settled = false;
    const decision = confirmOTACheck('sensor-42', current, candidate, async (message, detail) => {
        assert.match(message, /do not match/);
        assert.match(detail, /sensor-42/);
        assert.match(detail, /"PCB_VERSION": "V2" -> "V3"/);
        return new Promise(done => { resolve = done; });
    }).then(value => { settled = true; return value; });
    await Promise.resolve();
    assert.equal(settled, false);
    resolve(false);
    assert.deepEqual(await decision, {proceed: false, matches: false});
    assert.deepEqual(await confirmOTACheck('sensor-42', current, candidate, async () => true), {proceed: true, matches: false});
    assert.deepEqual(await confirmOTACheck('sensor-42', current, current, async () => { throw Error('Unexpected dialog'); }), {proceed: true, matches: true});
});

test('missing metadata always requires an explicit decision', async () => {
    const current = validateOTACheck(Object.fromEntries(fields));
    for (const [installed, candidate] of [[null, current], [current, null], [null, null]]) {
        let prompts = 0;
        assert.deepEqual(await confirmOTACheck('legacy', installed, candidate, async (message, detail) => {
            prompts++;
            assert.match(message, /cannot be verified/);
            assert.match(detail, /missing/);
            return false;
        }), {proceed: false, matches: false});
        assert.equal(prompts, 1);
    }
});

module.exports = {manifest};
