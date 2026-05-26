# Binary Secrets

域名：`binary-secrets`

在任意二进制文件中静态扫描高熵窗口、Base64 / Hex 候选串与硬编码密钥位点，输出 offset + 上下文（候选检测，由人工审计）。

## Profile

- full

## 典型场景

- 硬编码密钥候选定位
- 高熵区间审计
- Base64 / Hex 凭据线索

## 常见组合

- binary-secrets + dart-inspector
- binary-secrets + apk-packer

## 工具清单（1）

| 工具 | 说明 |
| --- | --- |
| `binary_key_extract` | 待补充中文：Scan a binary for hardcoded key candidates (raw high-entropy, Base64, hex). Read-only — no decryption. |
