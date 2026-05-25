# APK Packer

域名：`apk-packer`

通过匹配 `lib/<abi>/lib*.so` 文件名识别 Android 商业加固（360 加固、腾讯乐固、爱加密、百度、阿里聚安全、网易易盾、DexGuard、DexProtector、AppSealing、Virbox 等）。纯声明式指纹库，不脱壳、不动态执行。

## Profile

- full

## 典型场景

- Android 加固识别
- 多层加固层级分析
- 自定义指纹匹配

## 常见组合

- apk-packer + binary-instrument
- apk-packer + adb-bridge

## 工具清单（2）

| 工具 | 说明 |
| --- | --- |
| `apk_packer_detect` | 识别 Android APK 商业加固：扫描 `lib/&lt;abi&gt;/lib*.so` 文件名并匹配内置指纹库（360 加固、腾讯乐固、爱加密、百度、阿里聚安全、网易易盾、DexGuard、DexProtector、AppSealing、Virbox 等）。支持自定义指纹（ReDoS 安全的正则编译）。**不脱壳、不动态执行、不调用外部工具。** |
| `apk_packer_list_signatures` | 列出内置 APK 加固指纹库的所有条目，可按 vendor 子串过滤。纯声明式数据查询。 |
