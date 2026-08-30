# 后台任务

域名：`tasks`

MCP 2.0 Tasks 协议域：查询、轮询、取消由长耗时工具创建的后台任务。

## Profile

- workflow
- full

## 典型场景

- 长任务状态查询
- 后台任务结果获取
- 任务取消

## 常见组合

- tasks + binary-instrument
- tasks + protocol-analysis

## 工具清单（4）

| 工具 | 说明 |
| --- | --- |
| `tasks_get` | 查询后台任务的当前状态（MCP 2.0 Tasks 协议）。返回状态（working/completed/failed/cancelled）、进度与消息。 |
| `tasks_result` | 获取后台任务的结果载荷（MCP 2.0 Tasks 协议）。可选择等待最多 waitMs 毫秒直至任务进入终态。 |
| `tasks_cancel` | 请求取消一个后台任务（MCP 2.0 Tasks 协议）。仅 working 状态的任务可被取消；若工具定义了取消处理器则会执行。 |
| `tasks_list` | 列出服务器追踪的近期后台任务（MCP 2.0 Tasks 协议）。过期任务会按 TTL 自动清理。 |
