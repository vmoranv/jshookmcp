# Coordination

域名：`coordination`

用于会话洞察记录与 MCP Task Handoff 的协调域，衔接大语言模型的规划与执行。

## Profile

- full

## 典型场景

- Task Handoff 任务交接
- 记录会话深度分析结论

## 常见组合

- coordination + workflow
- coordination + browser

## 代表工具

- `create_task_handoff` — 创建一个 MCP Task Handoff 任务以移交复杂工作。
- `complete_task_handoff` — 以成功或失败的状态完结一个 MCP Task Handoff 任务。
- `get_task_context` — 获取 MCP 任务的具体上下文详情。
- `append_session_insight` — 向当前持续会话记录一条重要洞察结论。
- `save_page_snapshot` — 保存当前页面状态快照（URL、Cookie、localStorage、sessionStorage），便于后续恢复。
- `restore_page_snapshot` — 恢复之前保存的页面快照，还原 URL、Cookie 和存储数据。
- `list_page_snapshots` — 列出当前会话中所有已保存的页面快照。

## 工具清单（7）

| 工具 | 说明 |
| --- | --- |
| `create_task_handoff` | 创建一个 MCP Task Handoff 任务以移交复杂工作。 |
| `complete_task_handoff` | 以成功或失败的状态完结一个 MCP Task Handoff 任务。 |
| `get_task_context` | 获取 MCP 任务的具体上下文详情。 |
| `append_session_insight` | 向当前持续会话记录一条重要洞察结论。 |
| `save_page_snapshot` | 保存当前页面状态快照（URL、Cookie、localStorage、sessionStorage），便于后续恢复。 |
| `restore_page_snapshot` | 恢复之前保存的页面快照，还原 URL、Cookie 和存储数据。 |
| `list_page_snapshots` | 列出当前会话中所有已保存的页面快照。 |
