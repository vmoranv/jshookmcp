# Cross-Domain

域名：`cross-domain`

跨域关联域，将多个域的分析结果进行交叉关联，支持自动化工作流编排与证据图桥接。

## Profile

- workflow
- full

## 典型场景

- 跨域证据关联
- 自动化逆向工作流
- 多信号源聚合分析

## 常见组合

- cross-domain + evidence
- cross-domain + v8-inspector + skia-capture

## 代表工具

- `cross_domain_capabilities` — 列出跨域能力、支持的 v5.0 域和可用的任务工作流。
- `cross_domain_suggest_workflow` — 为逆向工程目标推荐最佳跨域工作流。
- `cross_domain_health` — 报告跨域健康状态、已启用的 v5.0 域和证据图可用性。
- `cross_domain_correlate_all` — 将 V8、网络、canvas、syscall、mojo 和二进制域的产物摄入共享证据图并可选地添加交叉链接。
- `cross_domain_evidence_export` — 将共享跨域证据图导出为 JSON。
- `cross_domain_evidence_stats` — 获取共享跨域证据图的节点和边统计。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `cross_domain_capabilities` | 列出跨域能力、支持的 v5.0 域和可用的任务工作流。 |
| `cross_domain_suggest_workflow` | 为逆向工程目标推荐最佳跨域工作流。 |
| `cross_domain_health` | 报告跨域健康状态、已启用的 v5.0 域和证据图可用性。 |
| `cross_domain_correlate_all` | 将 V8、网络、canvas、syscall、mojo 和二进制域的产物摄入共享证据图并可选地添加交叉链接。 |
| `cross_domain_evidence_export` | 将共享跨域证据图导出为 JSON。 |
| `cross_domain_evidence_stats` | 获取共享跨域证据图的节点和边统计。 |
