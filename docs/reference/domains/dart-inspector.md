# Dart 检查

域名：`dart-inspector`

从 Flutter AOT libapp.so 中抽取并分类字符串、还原 Smi 整数常量，并使用开发者提供的混淆映射反查原始符号。

## Profile

- full

## 典型场景

- Flutter 应用逆向
- libapp.so 字符串审计
- Smi 整数常量恢复
- 混淆符号反查（obfuscation-map.json）

## 常见组合

- dart-inspector + binary-instrument
- dart-inspector + adb-bridge

## 工具清单（16）

| 工具 | 说明 |
| --- | --- |
| `dart_strings_extract` | 从 Dart AOT libapp.so 流式提取 ASCII/UTF-16LE 字符串并分类（URL、路径、类名、package 引用、加密关键词，支持自定义规则），带 ReDoS 防护。 |
| `dart_smi_scan` | 从 libapp.so 读取对齐的小端序字读取并剥离堆指针标记位，恢复 Dart 小整数（Smi）常量。 |
| `dart_symbolize` | 使用开发者提供的 Flutter --save-obfuscation-map JSON（支持 flat/pairs/object 格式）解析混淆的 Dart 标识符。 |
| `flutter_packages_detect` | 检测 Flutter libapp.so 中引用的第三方 Dart `package:`，已过滤 SDK 标准库并聚合。 |
| `dart_snapshot_header_parse` | 只读解析 libapp.so 中的 Dart isolate snapshot 头：魔数、类型、32 字节哈希、特性标志、目标架构。 |
| `dart_version_fingerprint` | 通过解析 snapshot 头并结合内置（及可选的用户提供）哈希表，识别 libapp.so 的 Flutter/Dart SDK 版本。 |
| `dart_object_pool_dump` | 只读静态转储 libapp.so 中的 Dart isolate ObjectPool：分类每个槽位为 smi/mint/double/string/classRef/functionRef/pool/null/unknown。 |
| `dart_load_snapshot` | 从 libapp.so 加载并解析 Dart AOT snapshot，提取元数据和统计信息（Code 对象、ObjectPool 条目、clusters）。 |
| `dart_list_functions` | 列出已加载 snapshot 中的所有 Dart Code 对象（编译后的函数），包含入口地址、大小和函数名（如果可用）。 |
| `dart_call_function` | 在 ARM64 仿真器中按地址或名称执行 Dart 函数，带简化运行时（模拟 built-ins、标记指针）。 |
| `dart_inspect_object_pool` | 转储指定地址的 ObjectPool，显示所有条目的类型和值。 |
| `dart_trace_execution` | 逐步跟踪 Dart 函数执行，输出每条指令及寄存器状态（PC、x0-x30、PP、THR）。 |
| `dart_call_graph` | 从 Dart AOT 快照构建尽力而为的静态调用图：节点为 Code 对象，边为其值匹配另一个 Code 入口点（caller→callee）的 ObjectPool 表项。诚实边界：没有 pool 表项的间接/动态调用，以及 PcDescriptors 级别的映射，需要指令解码（暂缓——属跨 Dart SDK 版本工作）。 |
| `dart_pc_descriptors` | 解析已加载快照中一个或全部 Dart 函数的 PcDescriptors，并在每个调用点 PC 偏移处解码 ARM64 BL 指令以解析调用目标。返回结构化调用点条目，含 pcOffset、kind（1=icCall，2=unoptStaticCall，3=runtimeCall），并在 code section 字节可用时附带解析出的目标地址。传入 sessionId 或文件路径以加载快照。 |
| `dart_create_session` | 一次性解析 Dart AOT 快照并缓存至会话 ID，后续 dart_load_snapshot / dart_list_functions / dart_call_graph / dart_inspect_object_pool / dart_call_function / dart_trace_execution 等工具可通过 sessionId 复用已解析快照，跳过重复解析 libapp.so（对 10-40 MB Flutter 快照而言是主要耗时）。使用完毕请通过 dart_destroy_session 销毁；空闲会话自动过期（TTL + 定时清扫，参见 DART_SESSION_* 常量）。 |
| `dart_destroy_session` | 销毁由 dart_create_session 创建的 Dart 快照会话，释放缓存的已解析快照。若会话存在返回 destroyed=true，若未知或已被空闲 TTL 自动清扫返回 false。 |
