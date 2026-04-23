# Platform

域名：`platform`

宿主平台与包格式分析域，覆盖 miniapp、asar、Electron。

## Profile

- full

## 典型场景

- 小程序包分析
- Electron 结构检查

## 常见组合

- platform + process
- platform + core

## 代表工具

- `miniapp_pkg_scan` — 扫描本地小程序缓存目录并列出所有包文件。
- `miniapp_pkg_unpack` — 解包小程序包文件，优先使用外部工具，失败时自动降级为 Node.js 解析。
- `miniapp_pkg_analyze` — 分析解包后的小程序结构，提取页面、分包、组件和体积等信息。
- `asar_extract` — 提取 Electron 的 app.asar 内容，支持仅列出文件模式。
- `electron_inspect_app` — 分析 Electron 应用结构，包括 package.json、入口、preload 和依赖信息。
- `electron_scan_userdata` — 扫描 Electron 应用的用户数据目录，查找 JSON 配置文件并提取关键设置与令牌信息。
- `asar_search` — 在 Electron ASAR 归档中搜索指定关键词或正则模式，返回匹配的文件和行。
- `electron_check_fuses` — 检测 Electron 应用二进制的 Fuse 配置，识别哪些安全保护（如 ASAR 完整性、Node.js 开关）已启用或禁用。
- `electron_patch_fuses` — 修补 Electron 二进制 Fuse 开关，启用或禁用调试相关保险丝（如 RunAsNode、InspectArguments）。修补前自动创建备份。
- `v8_bytecode_decompile` — 反编译 V8 字节码（.jsc / bytenode）文件。优先使用 view8 Python 库进行完整反编译，备选内置常量池提取器提取字符串和标识符。

## 工具清单（13）

| 工具 | 说明 |
| --- | --- |
| `miniapp_pkg_scan` | 扫描本地小程序缓存目录并列出所有包文件。 |
| `miniapp_pkg_unpack` | 解包小程序包文件，优先使用外部工具，失败时自动降级为 Node.js 解析。 |
| `miniapp_pkg_analyze` | 分析解包后的小程序结构，提取页面、分包、组件和体积等信息。 |
| `asar_extract` | 提取 Electron 的 app.asar 内容，支持仅列出文件模式。 |
| `electron_inspect_app` | 分析 Electron 应用结构，包括 package.json、入口、preload 和依赖信息。 |
| `electron_scan_userdata` | 扫描 Electron 应用的用户数据目录，查找 JSON 配置文件并提取关键设置与令牌信息。 |
| `asar_search` | 在 Electron ASAR 归档中搜索指定关键词或正则模式，返回匹配的文件和行。 |
| `electron_check_fuses` | 检测 Electron 应用二进制的 Fuse 配置，识别哪些安全保护（如 ASAR 完整性、Node.js 开关）已启用或禁用。 |
| `electron_patch_fuses` | 修补 Electron 二进制 Fuse 开关，启用或禁用调试相关保险丝（如 RunAsNode、InspectArguments）。修补前自动创建备份。 |
| `v8_bytecode_decompile` | 反编译 V8 字节码（.jsc / bytenode）文件。优先使用 view8 Python 库进行完整反编译，备选内置常量池提取器提取字符串和标识符。 |
| `electron_launch_debug` | 以调试模式启动 Electron 应用，同时支持主进程和渲染进程的调试。 |
| `electron_debug_status` | 检查由 electron_launch_debug 启动的双轨 CDP 调试会话状态。 |
| `electron_ipc_sniff` | 嗅探 Electron 应用的 IPC 通信，捕获 channel 名称和参数。 |
