# Coordination

Domain: `coordination`

Coordination domain for session insights and MCP Task Handoff, bridging the planning and execution boundaries of LLMs.

## Profiles

- workflow
- full

## Typical scenarios

- MCP Task Handoff
- Recording deep session insights

## Common combinations

- coordination + workflow
- coordination + browser

## Representative tools

- `create_task_handoff` — Create a sub-task handoff for specialist agent delegation.
- `complete_task_handoff` — Complete a previously created task handoff with results.
- `get_task_context` — Read the context of a task handoff.
- `append_session_insight` — Append a discovery to the session-level knowledge accumulator.
- `save_page_snapshot` — Save a snapshot of the current page state (URL, cookies, localStorage, sessionStorage).
- `restore_page_snapshot` — Restore a previously saved page snapshot.
- `list_page_snapshots` — List all saved page snapshots in the current session.

## Full tool list (7)

| Tool                     | Description                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `create_task_handoff`    | Create a sub-task handoff for specialist agent delegation.                              |
| `complete_task_handoff`  | Complete a previously created task handoff with results.                                |
| `get_task_context`       | Read the context of a task handoff.                                                     |
| `append_session_insight` | Append a discovery to the session-level knowledge accumulator.                          |
| `save_page_snapshot`     | Save a snapshot of the current page state (URL, cookies, localStorage, sessionStorage). |
| `restore_page_snapshot`  | Restore a previously saved page snapshot.                                               |
| `list_page_snapshots`    | List all saved page snapshots in the current session.                                   |
