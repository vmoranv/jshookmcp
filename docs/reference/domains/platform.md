# 平台

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

## 工具清单（18）

| 工具 | 说明 |
| --- | --- |
| `platform_capabilities` | 报告平台工具后端可用性。 |
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
| `electron_verify_integrity` | 验证 Electron ASAR 完整性：解析嵌入主二进制的 ElectronAsarIntegrity JSON，定位每个引用的 ASAR，对比磁盘 SHA256 与嵌入哈希。不匹配意味着 ASAR 在构建后被篡改。 |
| `asar_deobfuscate` | 扫描 ASAR 归档内每个 .js 文件的混淆指标（字符串数组、webpack bundle、控制流平坦化、动态代码、压缩）并分类。标记的文件可提取到目录供后续反混淆。 |
| `asar_repack` | 将目录树打包成 Electron ASAR 归档（asar_extract 的逆操作）。遍历输入目录并写入合法 .asar（4×UInt32LE pickle 前缀 + JSON 头 + 数据段），parseAsarBuffer 与 Electron 运行时均可读取。闭合「解包 → 改补丁 → 重打包 → 重测」循环，无需离开 jshookmcp。 |
| `electron_verify_signature` | 对打包后的 Electron 二进制做结构化代码签名解析：Windows PE Authenticode 与 macOS Mach-O 内嵌代码签名。纯 TS 二进制 + ASN.1 解析——定位 WIN_CERTIFICATE / SuperBlob，解码 PKCS#7 SignedData，输出证书链、签名者、摘要算法，以及（macOS）CodeDirectory ident 与尽力而为的 cdhash。无 codesign/signtool 依赖，CI 任意环境可运行。签名密码学有效性、Authenticode 时间戳反签名与 notarization ticket 为诚实边界（verified:false，遵循教训 #51）。 |
