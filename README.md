# Thinger.io

A Visual Studio Code extension that provides remote OTA updates over [Thinger.io](https://thinger.io) for devices based on Arduino Framework. Supported boards (any board with an OTA header in the [Thinger.io Arduino Library](https://github.com/thinger-io/Arduino-Library)):

| Boards | Compression |
|---|---|
| Espressif ESP32, ESP32-S2, S3, C3, C5, C6, P4, Arduino Nano ESP32, Seeed XIAO ESP32 | zlib |
| Espressif ESP8266 | gzip (with `ATOMIC_FS_UPDATE`) |
| Raspberry Pi Pico W, Pico 2 W ([Arduino-Pico](https://github.com/earlephilhower/arduino-pico) core) | gzip (with `THINGER_OTA_COMPRESSION 1`) |
| Arduino Portenta H7, Opta | lzss |
| Arduino Nano 33 IoT, MKR WiFi 1010 | |
| Arduino Nano RP2040 Connect | |
| Arduino MKR NB 1500 | |
| Arduino UNO R4 WiFi (experimental) | |
| Thinger NB-IoT Core (BC660) | zlib |

This extension integrates with PlatformIO to automatically build and upload the firmware to your devices over the Internet.

![](https://s3.eu-west-1.amazonaws.com/thinger.io.files/vscode/iot-ota.gif)

## Features

* OTA updates directly from the Internet over Thinger.io
* Device switcher to search & select the target device for the update
* Real-time device connection status
* Compatible with multiple PlatformIO configuration environments inside a Project
* Automatic build and upload over the Internet in a single click
* OTA with compression (zlib, gzip or lzss, as requested by the device)
* Per-device OTA timeout and block size, with optional overrides for slow connections

## ESP32 OTA compatibility check

With an Arduino Library checkout containing `ThingerOTACheck.h`, declare the
compatibility fields once, before including the ESP32 OTA header:

```cpp
#define THINGER_OTA_CHECK(FIELD) \
    FIELD("PCB_MODEL", "SENSOR_CURRENT_GPIO_ANALOG") \
    FIELD("PCB_VERSION", "V2") \
    FIELD("COMMUNICATION_MODE", "WIFI")
#include <ThingerESP32.h>
#include <ThingerESP32OTA.h>
```

The OTA constructor automatically publishes `THINGER_OTA_CHECK` and retains the same
fields in the compiled application. Do not register a separate callback with
duplicated values. Fields are case-sensitive strings with user-defined names. The
limits are 32 fields, 64 UTF-8 bytes per key, 256 per value, and a 4096-byte packed
payload. Keep credentials out of this resource, and allow the extension's token to
read it.

Before `$ota/begin`, the extension compares the device resource with the candidate
image and shows **device value -> candidate firmware value** for each changed,
added or removed field. Only **Yes, continue** approves a mismatch; **No**, closing
the dialog or cancelling sends no firmware. Approval applies only to that device,
including when uploading to a product. Equal firmware versions skip the update
only when compatibility metadata also matches.

If the candidate or an older device has no metadata, a separate warning requires
explicit approval to proceed without verification. An advertised resource returning
404, permission errors, timeouts, invalid metadata, unsupported manifest versions
or duplicate manifests stop the update. This checks declared compatibility; it does
not detect the physical PCB or authenticate the firmware. Other OTA clients do not
enforce this confirmation.

The candidate is read once after the build: its version, compatibility metadata,
compression, checksums and transmitted chunks all use the same in-memory snapshot.
Rebuilding the file during a confirmation cannot change the approved upload.

### Development checks

Run `npm ci`, then `npm run test:ota` and `npm run package`. The tests exercise binary
parsing, schema validation and the upload flow with a mocked VS Code host. They
verify that no OTA begin/write/end/reboot occurs before approval, including legacy
devices, failures, cancellation, equal versions and multi-device uploads.

For interoperability, build the Arduino Library's `tests/esp32-ota-check` example,
then run `node test/verify-esp32.cjs <analog firmware.bin> <i2c firmware.bin>` against
its two generated images. Hardware and an authenticated server are still needed
to validate the real device resource and VS Code dialog end to end.

## Recommendations

* To improve performance in the OTA update, set `Application` > `Proxy` > `Proxy Support` to `fallback` instead of default `override`.

## Requirements

* VSCode PlatformIO extension for building firmware.
* Thinger.io Arduino Library (2.41.0 or newer for per-device timeouts, 2.42.0 or newer for Raspberry Pi Pico).

## Extension Settings

This extension contributes the following settings:

* `thinger-io.host`: Thinger.io instance host. Defaults to community instances.
* `thinger-io.port`: Thinger.io instance port. Defaults to 443.
* `thinger-io.ssl` : Use SSL/TLS encryption. Default to true.
* `thinger-io.secure`: Verify SSL/TLS connection. Defaults to true.
* `thinger-io.token`: Thinger.io instance token for access devices.
* `thinger-io.otaTimeout`: Override the OTA timeout in seconds. Defaults to 0 (use the device timeout, or 30 seconds if the device does not report one).
* `thinger-io.otaBlockSize`: Override the OTA block size in bytes. Defaults to 0 (use the device default). Useful to reduce the packet size on slow connections.
