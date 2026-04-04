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

- `state_board_set` — 待补充中文：Set a value in the shared state board. Supports string, number, boolean, object, and array values.
- `state_board_get` — 待补充中文：Get a value from the shared state board by key.
- `state_board_delete` — 待补充中文：Delete a value from the shared state board by key.
- `state_board_list` — 待补充中文：List all keys in the shared state board, optionally filtered by namespace.
- `state_board_watch` — 待补充中文：Watch a key or pattern for changes. Returns a watch ID that can be used to poll for updates.
- `state_board_unwatch` — 待补充中文：Stop watching a key or pattern.
- `state_board_history` — 待补充中文：Get the change history for a key.
- `state_board_export` — 待补充中文：Export all or filtered state board entries as JSON.
- `state_board_import` — 待补充中文：Import state board entries from JSON. Merges with existing state.
- `state_board_clear` — 待补充中文：Clear all or filtered state board entries.

## 工具清单（10）

| 工具 | 说明 |
| --- | --- |
| `state_board_set` | 待补充中文：Set a value in the shared state board. Supports string, number, boolean, object, and array values. |
| `state_board_get` | 待补充中文：Get a value from the shared state board by key. |
| `state_board_delete` | 待补充中文：Delete a value from the shared state board by key. |
| `state_board_list` | 待补充中文：List all keys in the shared state board, optionally filtered by namespace. |
| `state_board_watch` | 待补充中文：Watch a key or pattern for changes. Returns a watch ID that can be used to poll for updates. |
| `state_board_unwatch` | 待补充中文：Stop watching a key or pattern. |
| `state_board_history` | 待补充中文：Get the change history for a key. |
| `state_board_export` | 待补充中文：Export all or filtered state board entries as JSON. |
| `state_board_import` | 待补充中文：Import state board entries from JSON. Merges with existing state. |
| `state_board_clear` | 待补充中文：Clear all or filtered state board entries. |
