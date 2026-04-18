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

- `instrumentation_session_create` — 创建新的 instrumentation 会话，将 Hook、拦截与 Trace 收拢到一个可查询容器中统一管理。
- `instrumentation_session_list` — 列出所有活动中的 instrumentation 会话及其操作数和产物数。
- `instrumentation_session_destroy` — 销毁一个 instrumentation 会话，并将其所有操作标记为已完成；会话数据仍可查询，但不能再新增操作。
- `instrumentation_session_status` — 获取 instrumentation 会话的详细状态，包括操作数、产物数以及 active/destroyed 状态。
- `instrumentation_operation_register` — 在会话内注册新的 instrumentation 操作，使 Hook、拦截与 Trace 成为可查询、可产出证据的工作项。
- `instrumentation_operation_list` — 列出某个会话中已注册的全部 instrumentation 操作（Hook、拦截、Trace），并可按类型过滤。
- `instrumentation_artifact_record` — 为某个 instrumentation 操作记录捕获到的产物，使会话与证据图反映实际观测到的运行时数据。
- `instrumentation_artifact_query` — 查询会话中已捕获的产物（参数、返回值、拦截请求、Trace 数据等），支持按类型过滤和数量限制。
- `instrumentation_hook_preset` — 在 instrumentation 会话内应用 hooks 域预设 Hook，并将注入摘要持久化为会话产物。
- `instrumentation_network_replay` — 在 instrumentation 会话内重放先前捕获的网络请求，并将重放结果或 dry-run 预览持久化为会话产物。

## 工具清单（10）

| 工具 | 说明 |
| --- | --- |
| `instrumentation_session_create` | 创建新的 instrumentation 会话，将 Hook、拦截与 Trace 收拢到一个可查询容器中统一管理。 |
| `instrumentation_session_list` | 列出所有活动中的 instrumentation 会话及其操作数和产物数。 |
| `instrumentation_session_destroy` | 销毁一个 instrumentation 会话，并将其所有操作标记为已完成；会话数据仍可查询，但不能再新增操作。 |
| `instrumentation_session_status` | 获取 instrumentation 会话的详细状态，包括操作数、产物数以及 active/destroyed 状态。 |
| `instrumentation_operation_register` | 在会话内注册新的 instrumentation 操作，使 Hook、拦截与 Trace 成为可查询、可产出证据的工作项。 |
| `instrumentation_operation_list` | 列出某个会话中已注册的全部 instrumentation 操作（Hook、拦截、Trace），并可按类型过滤。 |
| `instrumentation_artifact_record` | 为某个 instrumentation 操作记录捕获到的产物，使会话与证据图反映实际观测到的运行时数据。 |
| `instrumentation_artifact_query` | 查询会话中已捕获的产物（参数、返回值、拦截请求、Trace 数据等），支持按类型过滤和数量限制。 |
| `instrumentation_hook_preset` | 在 instrumentation 会话内应用 hooks 域预设 Hook，并将注入摘要持久化为会话产物。 |
| `instrumentation_network_replay` | 在 instrumentation 会话内重放先前捕获的网络请求，并将重放结果或 dry-run 预览持久化为会话产物。 |
