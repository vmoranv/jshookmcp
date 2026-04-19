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

- `instrumentation_session` — Manage instrumentation sessions that group hooks, intercepts, and traces.
- `instrumentation_operation` — Manage operations within an instrumentation session.
- `instrumentation_artifact` — Manage captured artifacts for instrumentation operations.
- `instrumentation_hook_preset` — Apply hooks domain preset hooks within an instrumentation session and persist...
- `instrumentation_network_replay` — Replay a previously captured network request inside an instrumentation sessio...

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `instrumentation_session` | Manage instrumentation sessions that group hooks, intercepts, and traces. |
| `instrumentation_operation` | Manage operations within an instrumentation session. |
| `instrumentation_artifact` | Manage captured artifacts for instrumentation operations. |
| `instrumentation_hook_preset` | Apply hooks domain preset hooks within an instrumentation session and persist... |
| `instrumentation_network_replay` | Replay a previously captured network request inside an instrumentation sessio... |
