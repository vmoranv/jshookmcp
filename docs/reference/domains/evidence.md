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

- `evidence_query_url` — 查询逆向证据图中与某个 URL 关联的全部节点，返回包含请求、发起栈、脚本、函数与捕获数据节点的连通子图。
- `evidence_query_function` — 查询逆向证据图中与某个函数名关联的全部节点，返回包含函数、断点 Hook 与捕获数据节点的连通子图。
- `evidence_query_script` — 查询逆向证据图中与某个 scriptId 关联的全部节点，返回包含脚本、函数及其下游节点的连通子图。
- `evidence_export_json` — 将整个逆向证据图导出为 JSON 快照，包含全部节点、边和元数据。
- `evidence_export_markdown` — 将逆向证据图导出为可读的 Markdown 报告，按节点类型分组并展示边连接关系。
- `evidence_chain` — 从指定节点 ID 出发，按给定方向（forward/backward）遍历并返回完整溯源链。

## 工具清单（6）

| 工具 | 说明 |
| --- | --- |
| `evidence_query_url` | 查询逆向证据图中与某个 URL 关联的全部节点，返回包含请求、发起栈、脚本、函数与捕获数据节点的连通子图。 |
| `evidence_query_function` | 查询逆向证据图中与某个函数名关联的全部节点，返回包含函数、断点 Hook 与捕获数据节点的连通子图。 |
| `evidence_query_script` | 查询逆向证据图中与某个 scriptId 关联的全部节点，返回包含脚本、函数及其下游节点的连通子图。 |
| `evidence_export_json` | 将整个逆向证据图导出为 JSON 快照，包含全部节点、边和元数据。 |
| `evidence_export_markdown` | 将逆向证据图导出为可读的 Markdown 报告，按节点类型分组并展示边连接关系。 |
| `evidence_chain` | 从指定节点 ID 出发，按给定方向（forward/backward）遍历并返回完整溯源链。 |
