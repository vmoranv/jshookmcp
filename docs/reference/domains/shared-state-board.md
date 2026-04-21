# Shared State Board

域名：`shared-state-board`

跨 Agent 状态同步域，提供全局共享的状态板用于多 Agent 协作。

## Profile

- workflow
- full

## 典型场景

- 跨 Agent 数据共享
- 多 Agent 工作流协调
- 实时状态广播

## 常见组合

- shared-state-board + coordination
- shared-state-board + workflow

## 代表工具

- `state_board` — 统一的共享状态板，用于跨 Agent 的键值协调。
- `state_board_watch` — 监听某个 key 或模式的变化，返回可用于轮询更新的 watch ID。
- `state_board_io` — 导出或导入共享状态板条目。

## 工具清单（3）

| 工具 | 说明 |
| --- | --- |
| `state_board` | 统一的共享状态板，用于跨 Agent 的键值协调。 |
| `state_board_watch` | 监听某个 key 或模式的变化，返回可用于轮询更新的 watch ID。 |
| `state_board_io` | 导出或导入共享状态板条目。 |
