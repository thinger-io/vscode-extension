# Thinger.io

A Visual Studio Code extension that provides OTA updates for ESP8266 and ESP32 over Thinger.io. This extension integrages with PlatformIO to automatically build and upload the firmware to your devices.

![](https://s3.eu-west-1.amazonaws.com/thinger.io.files/vscode/ota-feature.gif)

## Features

* Device switcher to select the target device for the update
* Device connection status
* Compatible with multiple PlatformIO configuration environments inside a project
* Automatic build and upload in one click
* OTA with compressed images on compatible devices (ESP32)

## Requirements

* VSCode PlatformIO extension is required to use OTA features.
* A device connected to Thinger.io with OTA enabled.

## Extension Settings

This extension contributes the following settings:

* `thinger-io.host`: Thinger.io instance host. Defaults to community instances.
* `thinger-io.port`: Thinger.io instance port. Defaults to 443.
* `thinger-io.token`: Thinger.io instance token for access devices.

## Known Issues

Only works with ESP32 library