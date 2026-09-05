# 协调

域名：`coordination`

用于会话洞察记录、MCP Task Handoff 与跨 Agent 共享状态板的协调域，衔接大语言模型的规划与执行。

## Profile

- workflow
- full

## 典型场景

- Task Handoff 任务交接
- 记录会话深度分析结论
- 跨 Agent 数据共享与状态广播

## 常见组合

- coordination + workflow
- coordination + browser

## 工具清单（12）

| 工具 | 说明 |
| --- | --- |
| `create_task_handoff` | 创建一个 MCP Task Handoff 任务以移交复杂工作。 |
| `complete_task_handoff` | 以成功或失败的状态完结一个 MCP Task Handoff 任务。 |
| `update_task_handoff` | 更新 Task Handoff 的状态或元数据，但不把任务标记为完成。 |
| `get_task_context` | 获取 MCP 任务的具体上下文详情。 |
| `append_session_insight` | 向当前持续会话记录一条重要洞察结论。 |
| `save_page_snapshot` | 保存当前页面状态快照（URL、Cookie、localStorage、sessionStorage），便于后续恢复。 |
| `restore_page_snapshot` | 恢复之前保存的页面快照，还原 URL、Cookie 和存储数据。 |
| `list_page_snapshots` | 列出当前会话中所有已保存的页面快照。 |
| `coordination_restore_snapshot` | 恢复已保存的页面快照（含 IndexedDB 数据）。导航到捕获时的 URL，从快照重新注入 cookies、localStorage、sessionStorage 与 IndexedDB 记录。 |
| `state_board` | 统一的共享状态板，用于跨 Agent 的键值协调。 |
| `state_board_watch` | 监听某个 key 或模式的变化，返回可用于轮询更新的 watch ID。 |
| `state_board_io` | 导出或导入共享状态板条目。 |
