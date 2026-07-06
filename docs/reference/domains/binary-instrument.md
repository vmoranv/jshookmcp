# 二进制插桩

域名：`binary-instrument`

二进制插桩域，提供二进制分析、运行时插桩、APK 加固识别与密钥候选扫描能力。

## Profile

- full

## 典型场景

- 二进制分析
- 运行时插桩
- APK 加固层识别
- 硬编码密钥候选检测

## 常见组合

- binary-instrument + memory
- binary-instrument + process

## 工具清单（40）

| 工具 | 说明 |
| --- | --- |
| `binary_instrument_capabilities` | 报告二进制插桩后端可用性。 |
| `frida_attach` | 附加 Frida 到本地进程、PID 或二进制路径，并创建二进制插桩会话。 |
| `frida_spawn` | 待补充中文：Spawn a target through Frida for early instrumentation before normal execution. |
| `frida_enumerate_modules` | 枚举已附加 Frida 会话中的模块。 |
| `ghidra_analyze` | 在 Ghidra headless 可用时运行二进制元数据分析，不可用时返回结构化降级输出。 |
| `generate_hooks` | 为一组符号生成 Frida interceptor 脚本。 |
| `unidbg_emulate` | 尝试用 unidbg 模拟原生函数，不可用时返回结构化模拟输出。 |
| `frida_run_script` | 在已附加的 Frida 会话中执行一段 JavaScript 代码。 |
| `frida_resume` | 待补充中文：Resume a target previously spawned for early Frida instrumentation. |
| `frida_detach` | 从 Frida 会话分离并清理资源。 |
| `frida_list_sessions` | 列出所有活跃的 Frida 会话。 |
| `frida_dex_dump` | 以包名/进程名或 PID 运行 frida-dexdump，作为高层 Android DEX dump 助手。 |
| `android_runtime_dump_session` | 创建或检查托管的 Android 运行时 dump 会话，基于 Frida/ADB dump 产物、DEX 文件与 /proc/PID/maps 快照。 |
| `frida_generate_script` | 从模板（trace、intercept、replace、log）生成 Frida 拦截脚本。 |
| `frida_attach_interceptor` | 待补充中文：Generate a real Frida Interceptor.attach block for a symbol and optionally install it in a session. |
| `get_available_plugins` | 列出所有可用的二进制分析插件（frida、ghidra、ida、jadx）。 |
| `ghidra_decompile` | 使用 Ghidra headless 分析反编译指定函数。 |
| `ida_decompile` | 通过插件桥接使用 IDA Pro 反编译指定函数。 |
| `jadx_decompile` | 优先使用 JADX CLI 反编译 APK 类或方法，并尽可能自动解析可能的类名匹配；CLI 不可用时回退到插件桥接。 |
| `jadx_decompile_apk` | 高层 JADX APK 反编译：将整个 APK 反编译到稳定的输出目录，并返回供 jadx_search_code 使用的 sourcesDir。 |
| `jadx_search_code` | 对已有的 jadx 反编译输出目录执行只读 ripgrep 搜索（带 Node 纯回退引擎）。内置 ReDoS 双重防护。 |
| `apktool_decode` | 使用 apktool 解包 APK，便于检查资源、Manifest 和 smali 输出。 |
| `apk_manifest_dump` | 从 APK 中提取 AndroidManifest.xml；优先返回可读 XML，二进制 AXML 会尝试通过跨平台的 JADX CLI 解码，失败时再返回原始 Base64 载荷。 |
| `apk_manifest_query` | 返回紧凑的结构化 AndroidManifest 摘要：包名、启动 Activity、Application 类、SDK、权限、组件、Provider 以及 SDK/厂商线索。 |
| `apk_static_triage` | 一次性 APK 静态分诊：ZIP 元数据、清单摘要、native 库、资源线索、可能的加固/保护方案，以及推荐的后续步骤。 |
| `apk_dex_intake` | 构建一体化的 APK/DEX 取证证据包：ZIP 条目、清单摘要、DEX 头、native 库、表面提示与调用方提供的自定义提示匹配，以及后续操作建议。 |
| `dex_scan_file` | 扫描二进制/内存 dump 文件中的 DEX 或 CompactDex 魔数，并可选择性地提取命中结果。 |
| `binary_strings_extract` | 从二进制文件中提取可打印的 ASCII/UTF-16LE 字符串，支持正则过滤。 |
| `binary_entropy_profile` | 跨定长 chunk 计算二进制文件的香农熵以定位加密/加壳/压缩段。高熵区（≥7.0 bits/byte）疑似加密或压缩；低熵（&lt;4.0）通常是代码或文本。纯计算，无外部工具依赖。 |
| `apk_native_libs_list` | 列出 APK 内打包的原生共享库（.so）及其 ABI 目录。 |
| `unidbg_launch` | 在 Unidbg 模拟器中启动 ARM/ARM64 .so 库，首次调用约 3-5 秒预热。 |
| `unidbg_call` | 在运行中的 Unidbg 模拟器会话中调用 JNI 函数。 |
| `unidbg_trace` | 获取 Unidbg 会话的执行追踪（full/basic/instruction 模式）。 |
| `export_hook_script` | 将生成的 hook 模板导出为完整可运行的 Frida 脚本。 |
| `frida_enumerate_functions` | 枚举 Frida 会话中指定模块的导出函数。 |
| `frida_find_symbols` | 使用 ApiResolver 在 Frida 会话中搜索匹配模式的符号。 |
| `apk_packer_detect` | 通过匹配 `lib/&lt;abi&gt;/lib*.so` 文件名识别 Android APK 加固层；框架不内置签名表，调用方通过 customSignatures 提供（ReDoS 防护正则编译）。**不脱壳、不动态执行、不与加固载荷交互。** |
| `apk_packer_list_signatures` | 返回框架当前的签名表（默认为空）。可按 vendor 子串过滤。纯声明式数据查询，无需 APK 输入。 |
| `apk_signing_block_parse` | 只读解析 APK Signing Block（v2/v3/v3.1/v4 签名方案），检测密钥轮换谱系及残留块/dex 前缀/魔数偏移异常标记。不修改 APK。 |
| `binary_key_extract` | 扫描二进制文件中的硬编码密钥候选（高熵原始字节、Base64、十六进制）。只读分析，不执行解密。 |
