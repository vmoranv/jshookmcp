# Evidence

域名：`evidence`

逆向证据图域，用图结构串联 URL、脚本、函数、Hook 与捕获产物之间的溯源关系。

## Profile

- full

## 典型场景

- 按 URL / 函数 / scriptId 反查关联节点
- 查看前向或反向 provenance chain
- 导出 JSON / Markdown 证据报告

## 常见组合

- instrumentation + evidence
- network + hooks + evidence

## 代表工具

- `evidence_query` — 待补充中文：Query reverse evidence graph by URL, function name, or script ID to find associated nodes.
- `evidence_export` — 待补充中文：Export the reverse evidence graph as JSON snapshot or Markdown report.
- `evidence_chain` — 从指定节点 ID 出发，按给定方向（forward/backward）遍历并返回完整溯源链。

## 工具清单（3）

| 工具 | 说明 |
| --- | --- |
| `evidence_query` | 待补充中文：Query reverse evidence graph by URL, function name, or script ID to find associated nodes. |
| `evidence_export` | 待补充中文：Export the reverse evidence graph as JSON snapshot or Markdown report. |
| `evidence_chain` | 从指定节点 ID 出发，按给定方向（forward/backward）遍历并返回完整溯源链。 |
