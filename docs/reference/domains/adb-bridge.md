# ADB Bridge

域名：`adb-bridge`

Android Debug Bridge 集成域，用于设备管理、应用分析和远程调试。

## Profile

- full

## 典型场景

- Android 设备管理
- APK 分析
- 远程调试

## 常见组合

- adb-bridge + process
- adb-bridge + network

## 代表工具

- `adb_device_list` — 列出当前通过 ADB 可达的 Android 设备。
- `adb_shell` — 在指定 Android 设备上执行 ADB shell 命令。
- `adb_apk_pull` — 将 APK 文件从 Android 设备拉取到本地路径。
- `adb_apk_analyze` — 分析已安装的 APK——包名、版本、权限、Activity、Service、Receiver。
- `adb_webview_list` — 通过 ADB 端口转发列出可调试的 WebView 目标（需 android:debuggable=\"true\"）。
- `adb_webview_attach` — 通过 ADB 端口转发附加到 WebView，返回 CDP 用的 WebSocket 调试器 URL。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `adb_device_list` | 列出当前通过 ADB 可达的 Android 设备。 |
| `adb_shell` | 在指定 Android 设备上执行 ADB shell 命令。 |
| `adb_apk_pull` | 将 APK 文件从 Android 设备拉取到本地路径。 |
| `adb_apk_analyze` | 分析已安装的 APK——包名、版本、权限、Activity、Service、Receiver。 |
| `adb_webview_list` | 通过 ADB 端口转发列出可调试的 WebView 目标（需 android:debuggable=\\"true\\"）。 |
| `adb_webview_attach` | 通过 ADB 端口转发附加到 WebView，返回 CDP 用的 WebSocket 调试器 URL。 |
