# Background Tasks

Domain: `tasks`

MCP 2.0 Tasks protocol domain for querying, polling and cancelling background tasks created by long-running tools.

## Profiles

- workflow
- full

## Typical scenarios

- Task status polling
- Background task results
- Task cancellation

## Common combinations

- tasks + binary-instrument
- tasks + protocol-analysis

## Full tool list (4)

| Tool | Description |
| --- | --- |
| `tasks_get` | Get the current state of a background task (MCP 2.0 Tasks protocol). Returns status (working/completed/failed/cancelled), progress and message. |
| `tasks_result` | Fetch the payload/result of a background task (MCP 2.0 Tasks protocol). Optionally waits (polls) up to waitMs for the task to reach a terminal state. |
| `tasks_cancel` | Request cancellation of a background task (MCP 2.0 Tasks protocol). Only tasks in the working state can be cancelled; the tool-defined cancel handler runs if present. |
| `tasks_list` | List recent background tasks tracked by the server (MCP 2.0 Tasks protocol). Expired tasks are pruned automatically based on their TTL. |
