# Jadx Search

域名：`jadx-search`

在已存在的 jadx 反编译输出目录里做只读关键字/正则搜索，优先 ripgrep，缺失时降级到 Node 内置扫描。不触发新的反编译。

## Profile

- full

## 典型场景

- 反编译产物全文检索
- 调用点定位
- Java 源码模式匹配

## 常见组合

- jadx-search + apk-packer
- jadx-search + binary-instrument

## 工具清单（1）

| 工具 | 说明 |
| --- | --- |
| `jadx_search_code` | 待补充中文：Read-only ripgrep-backed search over an existing jadx decompile directory. ReDoS-guarded; Node fallback. |
