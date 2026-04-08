# ADB Bridge

Domain: `adb-bridge`

Android Debug Bridge integration domain for device management, application analysis, and remote debugging.

## Profiles

- workflow
- full

## Typical scenarios

- Android device management
- APK analysis
- Remote debugging

## Common combinations

- adb-bridge + process
- adb-bridge + network

## Representative tools

- `adb_device_list` — List Android devices that are currently reachable through ADB.
- `adb_shell` — Run an ADB shell command on a specific Android device.
- `adb_apk_pull` — Pull an APK file from an Android device to a local path.
- `adb_apk_analyze` — Analyze an installed APK — package name, version, permissions, activities, services, receivers.
- `adb_webview_list` — List debuggable WebView targets via ADB port forwarding to Chrome DevTools. Requires android:debuggable="true".
- `adb_webview_attach` — Attach to a WebView via ADB port forwarding; returns WebSocket debugger URL for CDP.

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `adb_device_list` | List Android devices that are currently reachable through ADB. |
| `adb_shell` | Run an ADB shell command on a specific Android device. |
| `adb_apk_pull` | Pull an APK file from an Android device to a local path. |
| `adb_apk_analyze` | Analyze an installed APK — package name, version, permissions, activities, services, receivers. |
| `adb_webview_list` | List debuggable WebView targets via ADB port forwarding to Chrome DevTools. Requires android:debuggable="true". |
| `adb_webview_attach` | Attach to a WebView via ADB port forwarding; returns WebSocket debugger URL for CDP. |
