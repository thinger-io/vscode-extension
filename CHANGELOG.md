# Release Notes

## Version 1.1.5 (2025-10-09)

### Configuration Enhancements

    Requires Arduino Library 2.41.0 or newer for timeout configuration support.

- **Per-Device Timeout Support**: Added support for device-specific OTA timeouts. Devices can now report their preferred timeout value, which will be used automatically unless overridden in settings.
- **Timeout Configuration Priority**: Timeout selection follows this priority: 1) User-configured override (`thinger-io.otaTimeout`), 2) Device-reported timeout, 3) Default 30s fallback.
- **Timeout sent to Device**: The selected timeout is now communicated to the device during OTA initialization, allowing device-side operations to align with the configured timeout.

## Version 1.1.4 (2025-10-09)

### Configuration Enhancements

- **Configurable OTA Timeout**: Added `thinger-io.otaTimeout` configuration to set timeout for OTA operations in seconds (default: 120 seconds). This is especially useful for slow GSM/GPRS connections that may experience socket hang up errors with the previous 60-second timeout.
- **OTA Block Size Override**: Added `thinger-io.otaBlockSize` configuration to override the device's default OTA block size in bytes (default: 0 = use device default). Useful for reducing packet size on slow or unreliable connections.

### Bug Fixes

- **Fixed Buffer to Uint8Array Conversion**: Fixed TypeScript type error in compression methods (zlib, gzip, lzss) that could cause runtime crashes during firmware compression.

## Version 1.1.3 (2025-10-09)

- Internal release (unpublished)

## Version 1.1.2 (2024-09-10)

- Fix issue when batch updating devices with different settings on compressions (it may send compressed files to devices not supporting it).

## Version 1.1.1 (2024-07-09)

- Fix exeption when uploading firmware under some circumstances. 

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
