# Thinger.io

A Visual Studio Code extension that provides remote OTA updates for ESP8266 and ESP32 over Thinger.io. This extension integrates with PlatformIO to automatically build and upload the firmware to your devices.

![](https://s3.eu-west-1.amazonaws.com/thinger.io.files/vscode/ota-feature.gif)

## Features

* OTA updates directly from the Internet
* Device switcher to select the target device for the update
* Real-tme device connection status
* Compatible with multiple PlatformIO configuration environments inside a project
* Automatic build and upload in one click
* OTA with compression support both on ESP8266 and ESP32

## Requirements

* VSCode PlatformIO extension is required to use OTA features.
* Thinger.io Arduino Library flashed on the device.

## Extension Settings

This extension contributes the following settings:

* `thinger-io.host`: Thinger.io instance host. Defaults to community instances.
* `thinger-io.port`: Thinger.io instance port. Defaults to 443.
* `thinger-io.token`: Thinger.io instance token for access devices.