# APK Packer

域名：`apk-packer`

通过匹配 `lib/<abi>/lib*.so` 文件名识别 Android APK 加固层；框架不内置签名表，调用方通过 customSignatures 提供（ReDoS 防护正则编译）。不脱壳、不动态执行、不与加固载荷交互。

## Profile

- full

## 典型场景

- Android 加固层识别
- 多层加固层级分析
- 自定义指纹匹配

## 常见组合

- apk-packer + binary-instrument
- apk-packer + adb-bridge

## 工具清单（2）

| 工具 | 说明 |
| --- | --- |
| `apk_packer_detect` | 通过匹配 `lib/&lt;abi&gt;/lib*.so` 文件名识别 Android APK 加固层；框架不内置签名表，调用方通过 customSignatures 提供（ReDoS 防护正则编译）。**不脱壳、不动态执行、不与加固载荷交互。** |
| `apk_packer_list_signatures` | 返回框架当前的签名表（默认为空）。可按 vendor 子串过滤。纯声明式数据查询，无需 APK 输入。 |
