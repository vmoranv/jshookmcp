# 仪器化

域名：`instrumentation`

统一仪器化会话域，将 Hook、拦截、Trace、证据图与产物记录收束到可查询的 session 中。

## Profile

- full

## 典型场景

- 创建/销毁 instrumentation 会话
- 登记 Hook / 拦截 / Trace 操作
- 记录并查询运行时产物
- AI Hook 生成与 preset 管理
- 逆向证据图溯源

## 常见组合

- instrumentation + network
- instrumentation + browser

## 工具清单（11）

| 工具 | 说明 |
| --- | --- |
| `instrumentation_session` | 管理 instrumentation 会话，将 Hook、拦截和 Trace 收拢为统一的可查询容器。 |
| `instrumentation_session_export` | 待补充中文：Export an instrumentation session snapshot to an artifacts JSON file. |
| `instrumentation_operation` | 管理 instrumentation 会话内的操作（Hook、拦截、Trace）。 |
| `instrumentation_artifact` | 管理 instrumentation 操作捕获的产物（参数、返回值、拦截数据等）。 |
| `instrumentation_hook_preset` | 在会话内应用预设的 Hook 模板，自动记录捕获到的数据。 |
| `instrumentation_network_replay` | 在会话内重放之前捕获的网络请求，并记录结果。 |
| `ai_hook` | 管理 AI 钩子（注入/获取数据/列表/清除/切换/导出）。 |
| `hook_preset` | 安装内置或自定义的 JavaScript Hook 预设模板。 |
| `evidence_query` | 按 URL、函数名或脚本 ID 查询逆向证据图中的关联节点。 |
| `evidence_export` | 将逆向证据图导出为 JSON 快照或 Markdown 报告。 |
| `evidence_chain` | 从指定节点 ID 出发，按给定方向（forward/backward）遍历并返回完整溯源链。 |
