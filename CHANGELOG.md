# Release Notes

## Version 1.1.0 (2024-05-31)

### Bulk Updates

- **Initial Support for Bulk OTA Updates**: Added support for performing Over-The-Air (OTA) updates in bulk across multiple devices. This enhancement streamlines the update process, saving time and ensuring all devices receive the latest firmware simultaneously.

### Firmware Detection

    Requires Arduino Library 2.30.0 or newer.

- **Enhanced Firmware Version Detection**: Implemented firmware version detection based on the `THINGER_OTA_VERSION` definition. This prevents re-flashing the same firmware version to a device that is already updated. The `THINGER_OTA_VERSION` can be defined in code or build flags with a dynamic value, such as using Git tags. It can be set to empty to bypass the version validation if needed. 

### Input/Output States

- **Real-Time Input/Output State Monitoring**: Added support for monitoring the states of data sent and received by devices in real-time. This allows for better tracking and diagnostics of device communication.

### Log Results

- **OTA Update Success Information**: Improved logging to include information when an OTA device update is successful. Fixes [Issue #2](https://github.com/thinger-io/vscode-extension/issues/2).
- **Comprehensive OTA Update Log**: Added a log summarizing all devices that have been updated through OTA. Fixes [Issue #2](https://github.com/thinger-io/vscode-extension/issues/2).

### Compression

- **Fixed LZSS Compression**: Resolved issues with LZSS compression for Arduino Opta and Portenta devices, ensuring better performance and reliability.

### Maintenance

- **Dependency Updates**: Updated dependencies to the latest versions for improved security and performance.
- **Code Refactoring**: Completed a full code refactor for better maintainability and readability.

## 1.0.6 (2023-02-24)

- Added compatibility with Platformio IDE > 3.0.0
- Allow connection to Thinger.io Server without TLS/SSL

## 1.0.5 (2021-08-24)

- Add configuration to disable SSL verification for local deployments
- Add command to palette for clearing selected device
- Device search box now also query by device name
- Improved OTA cancellation mechanism in any step
- Preliminar support for LZSS compression for Arduno devices
- OTA Speedup (~15%) with HTTP Keep-Alive (see recommendations on Readme)

## 1.0.4 (2021-08-09)

- Added Espressif ESP8266 OTA Support!
- Added MD5 checksum verification for updates
- Improved error handling with messages thrown by devices
- Compression support on ESP32 (zlib) and ESP8266 (gzip)

## 1.0.2 (2021-08-08)

- Fix reset device on plugin activation

## 1.0.1 (2021-08-08)

- Updated README.md

## 1.0.0 (2021-08-08)

- Initial Plugin Version
