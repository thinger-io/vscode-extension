# Thinger.io

A Visual Studio Code extension that provides remote OTA updates over [Thinger.io](https://thinger.io) for devices based on Arduino Framework. Supported boards:

* Espressif ESP8266
* Espressif ESP32
* Arduino Nano 33 IOT
* Arduino MKR WiFi 1010
* Arduino RPI2040 Connect
* Arduino Portenta H7
* Arduino MKR NB 1500

This extension integrates with PlatformIO to automatically build and upload the firmware to your devices over the Internet.

![](https://s3.eu-west-1.amazonaws.com/thinger.io.files/vscode/iot-ota.gif)

## Features

* OTA updates directly from the Internet over Thinger.io
* Device switcher to search & select the target device for the update
* Real-time device connection status
* Compatible with multiple PlatformIO configuration environments inside a Project
* Automatic build and upload over the Internet in a single click
* OTA with compression support both on ESP8266 and ESP32

## Recommendations

* To improve performance in the OTA update, set `Application` > `Proxy` > `Proxy Support` to `fallback` instead of default `override`.

## Requirements

* VSCode PlatformIO extension for building firmware.
* Thinger.io Arduino Library.

## Extension Settings

This extension contributes the following settings:

* `thinger-io.host`: Thinger.io instance host. Defaults to community instances.
* `thinger-io.port`: Thinger.io instance port. Defaults to 443.
* `thinger-io.ssl` : Use SSL/TLS encryption. Default to true.
* `thinger-io.secure`: Verify SSL/TLS connection. Defaults to true.
* `thinger-io.token`: Thinger.io instance token for access devices.
