const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {extractOTACheck, validateOTACheck, compareOTACheck, evaluateOTACheck, OTACheckStatus} = require('../out/util/ota-check');

function manifest(pairs, version = '1') {
    return Buffer.from(`@THINGER_OTA_CHECK:${version}@\0${pairs.map(([key, value]) => `${key}\0${value}\0`).join('')}\0@END_THINGER_OTA_CHECK@\0`);
}

const fields = [['PCB_MODEL', 'SENSOR_CURRENT_GPIO_ANALOG'], ['PCB_VERSION', 'V2'], ['COMMUNICATION_MODE', 'WIFI']];
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name));

test('reads the manifest of real UNO R4 WiFi images built with the Arduino Library', () => {
    assert.deepEqual({...extractOTACheck(fixture('uno-r4-with-check.bin'))}, {PCB_MODEL: 'UNO_R4_WIFI', DISPLAY: 'LED_MATRIX_12x8'});
    assert.equal(extractOTACheck(fixture('uno-r4-without-check.bin')), null);
});

test('reads a bounded manifest anywhere in a binary and preserves UTF-8 and empty values', () => {
    const pairs = [...fields, ['Descrição', 'placa ç'], ['empty', ''], ['BOM', '﻿value']];
    const image = Buffer.concat([Buffer.from([0, 255, 1]), manifest(pairs), Buffer.from([255, 0])]);
    assert.deepEqual({...extractOTACheck(image)}, Object.fromEntries(pairs));
    assert(Object.isFrozen(extractOTACheck(image)));
    assert.equal(extractOTACheck(Buffer.from('legacy image')), null);
    const padded = Buffer.concat([Buffer.from('ignored'), image, Buffer.from('ignored')]);
    assert.deepEqual(extractOTACheck(padded.subarray(7, 7 + image.length)), extractOTACheck(image));
});

test('accepts the library limits: 16 fields, 32 byte keys, 128 byte values and 1024 bytes of payload', () => {
    // sum(key + value + 2) + 1 = 1024
    const pairs = Array.from({length: 8}, (_, i) => [`k${String(i).padStart(30, '0')}`, 'v'.repeat(i < 7 ? 94 : 101)]);
    assert.equal(manifest(pairs).length - Buffer.byteLength('@THINGER_OTA_CHECK:1@\0') - Buffer.byteLength('@END_THINGER_OTA_CHECK@\0'), 1024);
    assert.equal(Object.keys(extractOTACheck(manifest(pairs))).length, 8);
    assert.equal(Object.keys(extractOTACheck(manifest(Array.from({length: 16}, (_, i) => [`k${i}`, 'v'])))).length, 16);
    assert.equal(extractOTACheck(manifest([['k'.repeat(32), 'v'.repeat(128)]]))['k'.repeat(32)].length, 128);
});

test('rejects duplicate, unsupported, truncated, oversized and malformed manifests', () => {
    assert.throws(() => extractOTACheck(Buffer.concat([manifest(fields), manifest(fields)])), /Multiple/);
    assert.throws(() => extractOTACheck(manifest(fields, '2')), /version/);
    const corruptVersion = manifest(fields);
    corruptVersion[Buffer.byteLength('@THINGER_OTA_CHECK:')] = 0xb1;
    assert.throws(() => extractOTACheck(corruptVersion), /version/);
    assert.throws(() => extractOTACheck(manifest(fields).subarray(0, -5)), /footer/);
    assert.throws(() => extractOTACheck(Buffer.from('@THINGER_OTA_CHECK:1@\0unterminated')), /Truncated/);
    assert.throws(() => extractOTACheck(manifest([['a', '1'], ['a', '2']])), /Duplicate/);
    assert.throws(() => extractOTACheck(manifest([])), /1 to 16/);
    assert.throws(() => extractOTACheck(manifest([['a'.repeat(33), 'value']])), /oversized/);
    assert.throws(() => extractOTACheck(manifest([['key', 'a'.repeat(129)]])), /oversized/);
    assert.throws(() => extractOTACheck(manifest(Array.from({length: 17}, (_, i) => [`k${i}`, 'v']))), /Too many/);
    assert.throws(() => extractOTACheck(manifest(Array.from({length: 9}, (_, i) => [`k${i}`, 'v'.repeat(128)]))), /oversized/);
    const invalidUtf8 = manifest([['key', 'value']]);
    invalidUtf8[invalidUtf8.indexOf('value')] = 255;
    assert.throws(() => extractOTACheck(invalidUtf8), /encoded data/);
});

test('validates the device fields with the same schema and handles special object keys safely', () => {
    for (const value of [true, 'x', null, [], {}, {key: 1}, {key: null}, {'': 'v'}, {'nul\0key': 'v'}, {key: 'nul\0value'}]) {
        assert.throws(() => validateOTACheck(value));
    }
    const metadata = validateOTACheck(JSON.parse('{"__proto__":"pcb","constructor":"v2"}'));
    assert.equal(Object.getPrototypeOf(metadata), null);
    assert.equal(metadata.__proto__, 'pcb');
    assert.equal(compareOTACheck(metadata, {}).length, 2);
    assert.throws(() => validateOTACheck({key: 'ç'.repeat(65)}), /Invalid/);
    assert.throws(() => validateOTACheck(Object.fromEntries(Array.from({length: 9}, (_, i) => [`k${i}`, 'a'.repeat(128)]))), /1024/);
});

test('compares fields regardless of order and reports added, removed and changed fields', () => {
    const current = validateOTACheck(Object.fromEntries(fields));
    assert.deepEqual(compareOTACheck(current, Object.fromEntries([...fields].reverse())), []);
    const candidate = validateOTACheck({PCB_MODEL: current.PCB_MODEL, PCB_VERSION: 'V3', EXTRA: 'x'});
    assert.deepEqual(compareOTACheck(current, candidate).map(row => row.field), ['COMMUNICATION_MODE', 'EXTRA', 'PCB_VERSION']);
    assert.equal(compareOTACheck(current, candidate)[0].candidate, undefined);
});

test('evaluates the device check against the candidate manifest', () => {
    const reported = Object.fromEntries(fields);
    const candidate = validateOTACheck(reported);
    // devices without THINGER_OTA_CHECK are updated as usual, with or without a manifest in the firmware
    for (const value of [undefined, null]) {
        assert.deepEqual(evaluateOTACheck('legacy', value, candidate), {status: OTACheckStatus.LEGACY});
        assert.deepEqual(evaluateOTACheck('legacy', value, null), {status: OTACheckStatus.LEGACY});
    }
    assert.deepEqual(evaluateOTACheck('a', reported, candidate), {status: OTACheckStatus.MATCH});

    const mismatch = evaluateOTACheck('sensor-42', reported, validateOTACheck({...reported, PCB_VERSION: 'V3'}));
    assert.equal(mismatch.status, OTACheckStatus.MISMATCH);
    assert.match(mismatch.detail, /sensor-42/);
    assert.match(mismatch.detail, /"PCB_VERSION": "V2" -> "V3"/);

    const missing = evaluateOTACheck('sensor-42', reported, null);
    assert.equal(missing.status, OTACheckStatus.MISSING);
    assert.match(missing.detail, /"PCB_MODEL" = "SENSOR_CURRENT_GPIO_ANALOG"/);

    for (const value of [true, {}, [], {key: 1}]) {
        assert.throws(() => evaluateOTACheck('bad', value, candidate));
    }
});

module.exports = {manifest};
