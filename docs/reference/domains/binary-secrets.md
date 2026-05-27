# Binary Secrets

域名：`binary-secrets`

扫描二进制文件中硬编码的密钥候选（高熵原始数据、Base64、hex），纯只读信息输出。

## Profile

- full

## 典型场景

- 密钥候选偏移定位
- 高熵区域检测
- Base64/hex 编码密钥提取

## 常见组合

- binary-secrets + apk-packer
- binary-secrets + binary-instrument

## 工具清单（1）

| 工具 | 说明 |
| --- | --- |
| `binary_key_extract` | 待补充中文：Scan a binary for hardcoded key candidates (raw high-entropy, Base64, hex). Read-only — no decryption. |
