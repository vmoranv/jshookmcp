# JADX Search

域名：`jadx-search`

通过 JADX 对 APK 进行反编译后的代码搜索域，支持类名、方法名、字符串的全文检索。

## Profile

- full

## 典型场景

- 反编译代码全文搜索
- 类名/方法名定位
- 字符串常量检索

## 常见组合

- jadx-search + apk-packer
- jadx-search + binary-secrets

## 工具清单（1）

| 工具 | 说明 |
| --- | --- |
| `jadx_search_code` | 对已有的 jadx 反编译输出目录执行只读 ripgrep 搜索（带 Node 纯回退引擎）。内置 ReDoS 双重防护。 |
