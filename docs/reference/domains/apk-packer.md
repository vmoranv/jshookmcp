# APK Packer

域名：`apk-packer`

用调用方提供的指纹库匹配 APK 中 `lib/<abi>/lib*.so` 文件名，识别可能的保护壳。框架不内置任何具名指纹，所有条目通过 customSignatures 传入。

## Profile

- full

## 典型场景

- 自定义指纹匹配
- 多层壳层级分析
- APK lib 文件清单审计

## 常见组合

- apk-packer + binary-instrument
- apk-packer + adb-bridge

## 工具清单（2）

| 工具 | 说明 |
| --- | --- |
| `apk_packer_detect` | 用用户提供的指纹库识别 Android APK 中 `lib/&lt;abi&gt;/lib*.so` 文件名匹配。ReDoS 安全的正则编译，纯文件名匹配 —— 不脱壳、不动态执行、不调用外部工具。 |
| `apk_packer_list_signatures` | 列出当前 apk-packer 域可见的指纹条目（内置为空，全部由用户的 customSignatures 提供）。 |
