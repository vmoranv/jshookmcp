# Dart Inspector

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

## 工具清单（7）

| 工具 | 说明 |
| --- | --- |
| `dart_strings_extract` | 从 Flutter libapp.so 抽取并分类可见字符串，识别 URL、路径、类名、包引用与加密关键字。 |
| `dart_smi_scan` | 从 libapp.so 中还原 Dart Small Integer（Smi）整数常量。Dart VM 用最低位区分 Smi（0）与堆指针（1），整数字面量按 value &lt;&lt; 1 存储，普通字符串扫描看不到。本工具按对齐的小端字（4 或 8 字节）扫描并还原 Smi 值，支持范围过滤、起止偏移、步长、限量截断等参数。 |
| `dart_symbolize` | 使用开发者提供的 Flutter --save-obfuscation-map JSON（flat、pairs 或 object 格式）还原混淆后的 Dart 标识符。 |
| `flutter_packages_detect` | 检测 Flutter libapp.so 中的第三方 Dart `package:` 引用，聚合后过滤 SDK 标准库。 |
| `dart_snapshot_header_parse` | 解析 libapp.so 中 Dart isolate 快照头：魔数、类型、32 字节哈希、特性标志、目标架构。只读。 |
| `dart_version_fingerprint` | 通过解析头信息并结合内置（及可选用户提供的）哈希表，从 libapp.so 识别 Flutter/Dart SDK 版本。 |
| `dart_object_pool_dump` | 只读静态转储 libapp.so 中 Dart isolate ObjectPool：按 smi/mint/double/string/classRef/functionRef/pool/null/unknown 分类每个槽位。 |
