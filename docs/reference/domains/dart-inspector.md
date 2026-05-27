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

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `dart_strings_extract` | 从 Flutter libapp.so 抽取并分类可见字符串，识别 URL、路径、类名、包引用与加密关键字。 |
| `dart_smi_scan` | 从 libapp.so 中还原 Dart Small Integer（Smi）整数常量。Dart VM 用最低位区分 Smi（0）与堆指针（1），整数字面量按 value &lt;&lt; 1 存储，普通字符串扫描看不到。本工具按对齐的小端字（4 或 8 字节）扫描并还原 Smi 值，支持范围过滤、起止偏移、步长、限量截断等参数。 |
| `dart_symbolize` | 待补充中文：Resolve obfuscated Dart identifiers using a developer-supplied Flutter --save-obfuscation-map JSON (flat, pairs, or object shape). |
| `flutter_packages_detect` | 待补充中文：Detect third-party Dart `package:` refs in a Flutter libapp.so, aggregated and SDK-stdlib-filtered. |
| `dart_snapshot_header_parse` | 待补充中文：Parse the Dart isolate snapshot header in a libapp.so: magic, kind, 32-byte hash, features, target arch. Read-only. |
| `dart_version_fingerprint` | 待补充中文：Identify Flutter/Dart SDK release from a libapp.so by combining header parse with a built-in (and optionally user-supplied) hash table. |
