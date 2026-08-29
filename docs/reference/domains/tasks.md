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
| `tasks_get` | 待补充中文：Get the current state of a background task (MCP 2.0 Tasks protocol). Returns status (working/completed/failed/cancelled), progress and message. |
| `tasks_result` | 待补充中文：Fetch the payload/result of a background task (MCP 2.0 Tasks protocol). Optionally waits (polls) up to waitMs for the task to reach a terminal state. |
| `tasks_cancel` | 待补充中文：Request cancellation of a background task (MCP 2.0 Tasks protocol). Only tasks in the working state can be cancelled; the tool-defined cancel handler runs if present. |
| `tasks_list` | 待补充中文：List recent background tasks tracked by the server (MCP 2.0 Tasks protocol). Expired tasks are pruned automatically based on their TTL. |
