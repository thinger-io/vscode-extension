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
