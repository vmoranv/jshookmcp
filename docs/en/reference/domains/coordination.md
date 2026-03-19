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

## Full tool list (4)

| Tool                     | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `create_task_handoff`    | Create a sub-task handoff for specialist agent delegation.     |
| `complete_task_handoff`  | Complete a previously created task handoff with results.       |
| `get_task_context`       | Read the context of a task handoff.                            |
| `append_session_insight` | Append a discovery to the session-level knowledge accumulator. |
