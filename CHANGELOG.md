# Release Notes

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
