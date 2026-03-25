# Platform

Domain: `platform`

Platform and package analysis domain covering miniapps, ASAR archives, and Electron apps.

## Profiles

- full

## Typical scenarios

- Inspect miniapp packages
- Analyze Electron application structure

## Common combinations

- platform + process
- platform + core

## Representative tools

- `miniapp_pkg_scan` — 扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。
- `miniapp_pkg_unpack` — 解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。
- `miniapp_pkg_analyze` — 分析解包后的小程序结构，提取 pages/subPackages/components/jsFiles/totalSize/appId。
- `asar_extract` — 提取 Electron app.asar（纯 Node.js 实现，不依赖 @electron/asar）。支持仅列文件模式。
- `electron_inspect_app` — 分析 Electron 应用结构（.exe 或 app 目录）：package.json、main、preload、dependencies、devToolsEnabled。
- `electron_scan_userdata` — 扫描指定目录中的所有 JSON 文件，返回 raw 内容。适用于 Electron 应用的用户数据目录（Windows: %APPDATA%, macOS: ~/Library/Application Support, Linux: ~/.config）。Agent 自行解读数据。
- `asar_search` — 在 ASAR 归档内执行正则搜索。Agent 提供 pattern，工具返回匹配文件路径和行内容。
- `electron_check_fuses` — 检测 Electron 可执行文件中的 fuse 配置状态（ASAR 完整性校验、RunAsNode 等）。
- `electron_patch_fuses` — Patch Electron binary fuses to enable/disable debug capabilities. Creates backup before patching. Use profile="debug" to enable RunAsNode, NodeOptions, InspectArguments and disable OnlyLoadAppFromAsar.
- `v8_bytecode_decompile` — Decompile V8 bytecode (.jsc / bytenode) files. Uses view8 Python package for full decompilation (preferred), falls back to built-in constant pool extraction. Returns pseudocode or extracted strings for LLM analysis.

## Full tool list (15)

| Tool | Description |
| --- | --- |
| `miniapp_pkg_scan` | 扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。 |
| `miniapp_pkg_unpack` | 解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。 |
| `miniapp_pkg_analyze` | 分析解包后的小程序结构，提取 pages/subPackages/components/jsFiles/totalSize/appId。 |
| `asar_extract` | 提取 Electron app.asar（纯 Node.js 实现，不依赖 @electron/asar）。支持仅列文件模式。 |
| `electron_inspect_app` | 分析 Electron 应用结构（.exe 或 app 目录）：package.json、main、preload、dependencies、devToolsEnabled。 |
| `electron_scan_userdata` | 扫描指定目录中的所有 JSON 文件，返回 raw 内容。适用于 Electron 应用的用户数据目录（Windows: %APPDATA%, macOS: ~/Library/Application Support, Linux: ~/.config）。Agent 自行解读数据。 |
| `asar_search` | 在 ASAR 归档内执行正则搜索。Agent 提供 pattern，工具返回匹配文件路径和行内容。 |
| `electron_check_fuses` | 检测 Electron 可执行文件中的 fuse 配置状态（ASAR 完整性校验、RunAsNode 等）。 |
| `electron_patch_fuses` | Patch Electron binary fuses to enable/disable debug capabilities. Creates backup before patching. Use profile="debug" to enable RunAsNode, NodeOptions, InspectArguments and disable OnlyLoadAppFromAsar. |
| `v8_bytecode_decompile` | Decompile V8 bytecode (.jsc / bytenode) files. Uses view8 Python package for full decompilation (preferred), falls back to built-in constant pool extraction. Returns pseudocode or extracted strings for LLM analysis. |
| `electron_launch_debug` | Launch Electron app with dual CDP debugging: --inspect for main process (Node.js) and --remote-debugging-port for renderer (Chromium). Auto-checks fuse status. |
| `electron_debug_status` | Check status of dual-CDP debug sessions launched by electron_launch_debug. |
| `frida_bridge` | Dynamic instrumentation bridge via Frida. Actions: check_env (verify frida installed), generate_script (hook template), attach (live-attach to process), run_script (inject script), detach (disconnect), list_sessions, guide (usage help). |
| `electron_ipc_sniff` | Sniff Electron IPC messages by injecting hooks into ipcRenderer via CDP. Captures invoke/send/sendSync with channel names and arguments. Actions: start (inject hooks), dump (retrieve captured messages), stop (end session), list (show sessions), guide. |
| `jadx_bridge` | JADX decompiler bridge for Android APK/DEX/AAR files. Actions: check_env (verify jadx installed), decompile (run jadx on input), guide (usage help). |
