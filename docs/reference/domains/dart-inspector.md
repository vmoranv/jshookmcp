# Dart Inspector

域名：`dart-inspector`

从 Flutter AOT libapp.so 中抽取并分类字符串（URL、路径、类名、包引用、加密关键字）。

## Profile

- full

## 典型场景

- Flutter 应用逆向
- libapp.so 字符串审计
- 加密关键字定位

## 常见组合

- dart-inspector + binary-instrument
- dart-inspector + adb-bridge

## 工具清单（1）

| 工具 | 说明 |
| --- | --- |
| `dart_strings_extract` | 从 Flutter libapp.so 抽取并分类可见字符串，识别 URL、路径、类名、包引用与加密关键字。 |
