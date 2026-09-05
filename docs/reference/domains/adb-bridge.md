# ADB 桥接

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

## 工具清单（26）

| 工具 | 说明 |
| --- | --- |
| `adb_device_list` | 列出当前通过 ADB 连接的 Android 设备和模拟器。 |
| `adb_apk_pull` | 将设备上的已安装 APK 拉取到本地文件系统。 |
| `adb_shell` | 在指定 Android 设备上执行一条 ADB shell 命令。 |
| `adb_install` | 通过 adb 安装单个 APK 或拆分 APK 组到设备，返回解析后的安装结果 |
| `adb_uninstall` | 从设备卸载指定包名的应用，可选保留应用数据 |
| `adb_input_tap` | 通过 adb shell input 发送触摸点击事件到设备屏幕 |
| `adb_input_swipe` | 通过 adb shell input 发送触摸滑动事件到设备屏幕 |
| `adb_input_keyevent` | 通过 adb shell input 发送 Android 按键名或数字键码 |
| `adb_input_text` | 通过 adb shell input text 发送文本到设备，自动处理空格编码 |
| `adb_proc_maps` | 读取并解析设备的 /proc/PID/maps，支持通过包名自动解析 PID |
| `adb_root_check` | 检测设备 root 状态：su 二进制文件、Magisk、test-keys 签名、SELinux 状态、shell UID |
| `adb_getprop` | 导出并解析 Android 系统属性（getprop）为结构化键值映射，并汇总设备指纹（型号、SDK 版本、ABI、构建指纹、安全补丁级别、bootloader 锁定状态）。 |
| `adb_screenshot` | 通过 adb exec-out screencap -p 截取设备 PNG 截图 |
| `adb_screenrecord` | 通过 adb shell screenrecord 录制短 MP4 屏幕视频并拉取到本地。 |
| `adb_port_forward` | 管理 ADB forward/reverse 端口映射，用于设备与主机之间的调试桥接流程。 |
| `adb_apk_analyze` | 分析已安装的 APK——包名、版本、权限、Activity、Service、Receiver。 |
| `adb_package_summary` | 返回结构化的 Android 包元数据：启动器、uid、版本号、权限、组件以及 native 库目录。 |
| `adb_logcat_query` | 在进程内抓取并过滤 Android logcat 输出，无需 shell grep 管道。 |
| `adb_app_cold_start_trace` | 高层 Android 冷启动追踪：强制停止、清空 logcat、用 -W 启动 Activity、等待、收集按 PID 过滤的日志，并解析启动/Looper 耗时。 |
| `adb_file_pull` | 用普通 ADB 权限从 Android 设备拉取文件。 |
| `adb_file_push` | 用普通 ADB 权限向 Android 设备推送本地文件。 |
| `adb_pull_native_libs` | 从 Android 设备中拉取指定应用打包或安装后的原生共享库（.so）。 |
| `adb_webview_list` | 通过 ADB 端口转发列出可调试的 WebView 目标（需 android:debuggable=\\"true\\"）。 |
| `adb_webview_attach` | 通过 ADB 端口转发附加到 WebView，返回 CDP 用的 WebSocket 调试器 URL。 |
| `adb_dumpsys` | 运行 `adb shell dumpsys` 获取指定服务并返回解析后的结构化输出。支持键值提取、数组解析与 section 检测。常用服务：package、activity、window、battery、meminfo、alarm、cpuinfo、diskstats、netstats、usagestats。 |
| `adb_ui_dump` | 通过 `uiautomator dump` 捕获 Android UI 层次结构：在设备上运行 uiautomator dump，拉取 XML，返回解析后的 UI 树。适用于 UI 自动化验证、布局检查与无障碍树分析。 |
