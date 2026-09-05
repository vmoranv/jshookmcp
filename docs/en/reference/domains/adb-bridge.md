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

## Full tool list (26)

| Tool | Description |
| --- | --- |
| `adb_device_list` | List all connected Android devices and emulators. |
| `adb_apk_pull` | Pull an APK from a device to the local filesystem. |
| `adb_shell` | Execute an ADB shell command on a specific device. |
| `adb_install` | Install one APK or a split-APK set onto a device with parsed success output. |
| `adb_uninstall` | Uninstall a package from a device, optionally keeping app data. |
| `adb_input_tap` | Send a touchscreen tap event through adb shell input. |
| `adb_input_swipe` | Send a touchscreen swipe event through adb shell input. |
| `adb_input_keyevent` | Send an Android keyevent name or numeric key code through adb shell input. |
| `adb_input_text` | Send text through adb shell input text with Android-safe whitespace encoding. |
| `adb_proc_maps` | Read and parse /proc/PID/maps from a device, resolving PID from packageName when needed. |
| `adb_root_check` | Probe root indicators such as su, Magisk, test-keys, SELinux, and shell uid. |
| `adb_getprop` | Dump and parse Android system properties (getprop) into a structured map with a curated device fingerprint (model, SDK, ABI, build fingerprint, security patch, bootloader lock). |
| `adb_screenshot` | Capture a PNG screenshot through adb exec-out screencap -p. |
| `adb_screenrecord` | Record a short MP4 screen capture through adb shell screenrecord and pull it locally. |
| `adb_port_forward` | Manage ADB forward/reverse port mappings for device-host bridge workflows. |
| `adb_apk_analyze` | Analyze an installed APK: package, permissions, activities, and security info. |
| `adb_package_summary` | Return structured Android package metadata: launcher, uid, versions, permissions, components, and native library dirs. |
| `adb_logcat_query` | Capture and filter Android logcat output in-process without shell grep pipelines. |
| `adb_app_cold_start_trace` | High-level Android startup trace: force-stop, clear logcat, start activity with -W, wait, collect PID-filtered logs, and parse launch/Looper timing. |
| `adb_file_pull` | Pull a file from an Android device using normal ADB permissions. |
| `adb_file_push` | Push a local file to an Android device using normal ADB permissions. |
| `adb_pull_native_libs` | Pull native shared libraries (.so) for an installed app from a device. |
| `adb_webview_list` | List debuggable WebView targets connected via ADB. |
| `adb_webview_attach` | Attach to a WebView via ADB; returns WebSocket debugger URL for CDP. |
| `adb_dumpsys` | Run adb shell dumpsys for a service and return parsed structured output. Supports key-value extraction, array parsing, and section detection. Common services: package, activity, window, battery, meminfo, alarm, cpuinfo, diskstats, netstats, usagestats. |
| `adb_ui_dump` | Capture Android UI hierarchy via uiautomator dump. Runs uiautomator dump on-device, pulls the XML, and returns parsed UI tree. Useful for UI automation verification, layout inspection, and accessibility tree analysis. |
