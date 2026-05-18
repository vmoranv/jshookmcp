# ADB Bridge

Domain: `adb-bridge`

Android Debug Bridge integration domain for device management, application analysis, and remote debugging.

## Profiles

- full

## Typical scenarios

- Android device management
- APK analysis
- Remote debugging

## Common combinations

- adb-bridge + process
- adb-bridge + network

## Full tool list (7)

| Tool | Description |
| --- | --- |
| `adb_device_list` | List all connected Android devices and emulators. |
| `adb_apk_pull` | Pull an APK from a device to the local filesystem. |
| `adb_shell` | Execute an ADB shell command on a specific device. |
| `adb_apk_analyze` | Analyze an installed APK: package, permissions, activities, and security info. |
| `adb_pull_native_libs` | Pull native shared libraries (.so) for an installed app from a device. |
| `adb_webview_list` | List debuggable WebView targets connected via ADB. |
| `adb_webview_attach` | Attach to a WebView via ADB; returns WebSocket debugger URL for CDP. |
