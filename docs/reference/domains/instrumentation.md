# Instrumentation

域名：`instrumentation`

统一仪器化会话域，将 Hook、拦截、Trace 与产物记录收束到可查询的 session 中。

## Profile

- full

## 典型场景

- 创建/销毁 instrumentation 会话
- 登记 Hook / 拦截 / Trace 操作
- 记录并查询运行时产物

## 常见组合

- instrumentation + hooks + network
- instrumentation + evidence

## 代表工具

- `instrumentation_session` — 待补充中文：Manage instrumentation sessions that group hooks, intercepts, and traces.
- `instrumentation_operation` — 待补充中文：Manage operations within an instrumentation session.
- `instrumentation_artifact` — 待补充中文：Manage captured artifacts for instrumentation operations.
- `instrumentation_hook_preset` — 在 instrumentation 会话内应用 hooks 域预设 Hook，并将注入摘要持久化为会话产物。
- `instrumentation_network_replay` — 在 instrumentation 会话内重放先前捕获的网络请求，并将重放结果或 dry-run 预览持久化为会话产物。

## 工具清单（5）

| 工具 | 说明 |
| --- | --- |
| `instrumentation_session` | 待补充中文：Manage instrumentation sessions that group hooks, intercepts, and traces. |
| `instrumentation_operation` | 待补充中文：Manage operations within an instrumentation session. |
| `instrumentation_artifact` | 待补充中文：Manage captured artifacts for instrumentation operations. |
| `instrumentation_hook_preset` | 在 instrumentation 会话内应用 hooks 域预设 Hook，并将注入摘要持久化为会话产物。 |
| `instrumentation_network_replay` | 在 instrumentation 会话内重放先前捕获的网络请求，并将重放结果或 dry-run 预览持久化为会话产物。 |
