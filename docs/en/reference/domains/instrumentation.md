# Instrumentation

Domain: `instrumentation`

Unified instrumentation-session domain that groups hooks, intercepts, traces, and artifacts into a queryable session.

## Profiles

- full

## Typical scenarios

- Create and destroy instrumentation sessions
- Register hook, intercept, and trace operations
- Record and query runtime artifacts

## Common combinations

- instrumentation + hooks + network
- instrumentation + evidence

## Representative tools

- `instrumentation_session_create` — Create a new instrumentation session that groups hooks, intercepts, and traces into a single queryable container.
- `instrumentation_session_list` — List all active instrumentation sessions with their operation and artifact counts.
- `instrumentation_session_destroy` — Destroy an instrumentation session, marking all its operations as completed. Session data is retained for querying but no new operations can be added.
- `instrumentation_session_status` — Get detailed status for an instrumentation session including operation count, artifact count, and active/destroyed state.
- `instrumentation_operation_register` — Register a new instrumentation operation within a session so hooks, intercepts, and traces become queryable evidence-producing work items.
- `instrumentation_operation_list` — List all operations (hooks, intercepts, traces) registered within a session, optionally filtered by type.
- `instrumentation_artifact_record` — Record a captured artifact for an instrumentation operation so the session and evidence graph reflect observed runtime data.
- `instrumentation_artifact_query` — Query captured artifacts (args, return values, intercepted requests, trace data) from a session, optionally filtered by type and limited.
- `instrumentation_hook_preset` — Apply hooks domain preset hooks within an instrumentation session and persist the injected preset summary as session artifacts.
- `instrumentation_network_replay` — Replay a previously captured network request inside an instrumentation session and persist the replay result or dry-run preview as session artifacts.

## Full tool list (10)

| Tool | Description |
| --- | --- |
| `instrumentation_session_create` | Create a new instrumentation session that groups hooks, intercepts, and traces into a single queryable container. |
| `instrumentation_session_list` | List all active instrumentation sessions with their operation and artifact counts. |
| `instrumentation_session_destroy` | Destroy an instrumentation session, marking all its operations as completed. Session data is retained for querying but no new operations can be added. |
| `instrumentation_session_status` | Get detailed status for an instrumentation session including operation count, artifact count, and active/destroyed state. |
| `instrumentation_operation_register` | Register a new instrumentation operation within a session so hooks, intercepts, and traces become queryable evidence-producing work items. |
| `instrumentation_operation_list` | List all operations (hooks, intercepts, traces) registered within a session, optionally filtered by type. |
| `instrumentation_artifact_record` | Record a captured artifact for an instrumentation operation so the session and evidence graph reflect observed runtime data. |
| `instrumentation_artifact_query` | Query captured artifacts (args, return values, intercepted requests, trace data) from a session, optionally filtered by type and limited. |
| `instrumentation_hook_preset` | Apply hooks domain preset hooks within an instrumentation session and persist the injected preset summary as session artifacts. |
| `instrumentation_network_replay` | Replay a previously captured network request inside an instrumentation session and persist the replay result or dry-run preview as session artifacts. |
