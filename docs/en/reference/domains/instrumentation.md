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

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `instrumentation_session` | Start, stop, or query status of an instrumentation recording session. |
| `instrumentation_operation` | Manage operations inside an instrumentation session. |
| `instrumentation_artifact` | Manage artifacts captured by instrumentation operations. |
| `instrumentation_hook_preset` | Apply hook presets inside an instrumentation session. |
| `instrumentation_network_replay` | Replay a captured network request inside an instrumentation session. |
