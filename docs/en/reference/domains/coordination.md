# Coordination

Domain: `coordination`

Coordination domain for session insights and MCP Task Handoff, bridging the planning and execution boundaries of LLMs.

## Profiles

- full

## Typical scenarios

- MCP Task Handoff
- Recording deep session insights

## Common combinations

- coordination + workflow
- coordination + browser

## Representative tools

- `create_task_handoff` — Create a sub-task handoff for specialist agent delegation. Auto-captures active page URL.
- `complete_task_handoff` — Complete a task handoff with results. Transitions status to completed.
- `get_task_context` — Read task handoff context. Without taskId returns all active handoffs + session insights.
- `append_session_insight` — Append a discovery to the session-level knowledge accumulator shared across handoffs
- `save_page_snapshot` — Save current page state (URL, cookies, storage) for checkpoint/restore workflows
- `restore_page_snapshot` — Restore a saved page snapshot — navigates to URL and reinjects cookies and storage
- `list_page_snapshots` — List all saved page snapshots in the current session

## Full tool list (7)

| Tool | Description |
| --- | --- |
| `create_task_handoff` | Create a sub-task handoff for specialist agent delegation. Auto-captures active page URL. |
| `complete_task_handoff` | Complete a task handoff with results. Transitions status to completed. |
| `get_task_context` | Read task handoff context. Without taskId returns all active handoffs + session insights. |
| `append_session_insight` | Append a discovery to the session-level knowledge accumulator shared across handoffs |
| `save_page_snapshot` | Save current page state (URL, cookies, storage) for checkpoint/restore workflows |
| `restore_page_snapshot` | Restore a saved page snapshot — navigates to URL and reinjects cookies and storage |
| `list_page_snapshots` | List all saved page snapshots in the current session |
