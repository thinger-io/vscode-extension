// Usage: node test/verify-esp32.cjs <analog firmware.bin> <i2c firmware.bin>
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {extractOTACheck, compareOTACheck} = require('../out/util/ota-check');
if (process.argv.length !== 4) { throw Error('Supply the analog and i2c ESP32 example images'); }
const [analogImage, i2cImage] = process.argv.slice(2).map(file => fs.readFileSync(file));
const analog = extractOTACheck(analogImage);
const i2c = extractOTACheck(i2cImage);
assert.deepEqual({...analog}, {PCB_MODEL: 'SENSOR_CURRENT_GPIO_ANALOG', PCB_VERSION: 'V2', COMMUNICATION_MODE: 'WIFI'});
assert.deepEqual({...i2c}, {PCB_MODEL: 'SENSOR_CURRENT_I2C', PCB_VERSION: 'V4', COMMUNICATION_MODE: 'WIFI'});
assert.deepEqual(compareOTACheck(analog, i2c).map(row => row.field), ['PCB_MODEL', 'PCB_VERSION']);
for (const image of [analogImage, i2cImage]) {
    assert(image.includes(Buffer.from('@(#)ota_check_example')));
}
console.log('PASS: the extension reads both ESP32 manifests and detects the incompatible model and PCB version.');
console.table(compareOTACheck(analog, i2c));
