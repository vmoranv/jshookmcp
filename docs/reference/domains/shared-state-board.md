# Shared State Board

域名：`shared-state-board`

跨 Agent 状态同步域，提供全局共享的状态板用于多 Agent 协作。

## Profile

- full

## 典型场景

- 跨 Agent 数据共享
- 多 Agent 工作流协调
- 实时状态广播

## 常见组合

- shared-state-board + coordination
- shared-state-board + workflow

## 代表工具

- `state_board_set` — 在共享状态板中写入一个值，支持字符串、数字、布尔值、对象和数组。
- `state_board_get` — 按 key 读取共享状态板中的值。
- `state_board_delete` — 按 key 删除共享状态板中的值。
- `state_board_list` — 列出共享状态板中的全部 key，并可按命名空间过滤。
- `state_board_watch` — 监听某个 key 或模式的变化，返回可用于轮询更新的 watch ID。
- `state_board_unwatch` — 停止监听某个 key 或模式。
- `state_board_history` — 获取某个 key 的变更历史。
- `state_board_export` — 将全部或过滤后的状态板条目导出为 JSON。
- `state_board_import` — 从 JSON 导入状态板条目，并与现有状态合并。
- `state_board_clear` — 清空全部或过滤后的状态板条目。

## 工具清单（10）

| 工具 | 说明 |
| --- | --- |
| `state_board_set` | 在共享状态板中写入一个值，支持字符串、数字、布尔值、对象和数组。 |
| `state_board_get` | 按 key 读取共享状态板中的值。 |
| `state_board_delete` | 按 key 删除共享状态板中的值。 |
| `state_board_list` | 列出共享状态板中的全部 key，并可按命名空间过滤。 |
| `state_board_watch` | 监听某个 key 或模式的变化，返回可用于轮询更新的 watch ID。 |
| `state_board_unwatch` | 停止监听某个 key 或模式。 |
| `state_board_history` | 获取某个 key 的变更历史。 |
| `state_board_export` | 将全部或过滤后的状态板条目导出为 JSON。 |
| `state_board_import` | 从 JSON 导入状态板条目，并与现有状态合并。 |
| `state_board_clear` | 清空全部或过滤后的状态板条目。 |
