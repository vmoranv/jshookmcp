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

- `instrumentation_session` — 管理 instrumentation 会话，将 Hook、拦截和 Trace 收拢为统一的可查询容器。
- `instrumentation_operation` — 管理 instrumentation 会话内的操作（Hook、拦截、Trace）。
- `instrumentation_artifact` — 管理 instrumentation 操作捕获的产物（参数、返回值、拦截数据等）。
- `instrumentation_hook_preset` — 在会话内应用预设的 Hook 模板，自动记录捕获到的数据。
- `instrumentation_network_replay` — 在会话内重放之前捕获的网络请求，并记录结果。

## 工具清单（5）

| 工具 | 说明 |
| --- | --- |
| `instrumentation_session` | 管理 instrumentation 会话，将 Hook、拦截和 Trace 收拢为统一的可查询容器。 |
| `instrumentation_operation` | 管理 instrumentation 会话内的操作（Hook、拦截、Trace）。 |
| `instrumentation_artifact` | 管理 instrumentation 操作捕获的产物（参数、返回值、拦截数据等）。 |
| `instrumentation_hook_preset` | 在会话内应用预设的 Hook 模板，自动记录捕获到的数据。 |
| `instrumentation_network_replay` | 在会话内重放之前捕获的网络请求，并记录结果。 |
