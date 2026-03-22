# Coordination

域名：`coordination`

用于会话洞察记录与 MCP Task Handoff 的协调域，衔接大语言模型的规划与执行。

## Profile

- workflow
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
- `save_page_snapshot` — 待补充中文：Save a snapshot of the current page state (URL, cookies, localStorage, sessionStorage).
- `restore_page_snapshot` — 待补充中文：Restore a previously saved page snapshot.
- `list_page_snapshots` — 待补充中文：List all saved page snapshots in the current session.

## 工具清单（7）

| 工具                     | 说明                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `create_task_handoff`    | 创建一个 MCP Task Handoff 任务以移交复杂工作。                                                      |
| `complete_task_handoff`  | 以成功或失败的状态完结一个 MCP Task Handoff 任务。                                                  |
| `get_task_context`       | 获取 MCP 任务的具体上下文详情。                                                                     |
| `append_session_insight` | 向当前持续会话记录一条重要洞察结论。                                                                |
| `save_page_snapshot`     | 待补充中文：Save a snapshot of the current page state (URL, cookies, localStorage, sessionStorage). |
| `restore_page_snapshot`  | 待补充中文：Restore a previously saved page snapshot.                                               |
| `list_page_snapshots`    | 待补充中文：List all saved page snapshots in the current session.                                   |
