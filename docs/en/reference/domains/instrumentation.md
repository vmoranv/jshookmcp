# Instrumentation

Domain: `instrumentation`

Unified instrumentation-session domain that groups hooks, intercepts, traces, evidence graphs, and artifacts into a queryable session.

## Profiles

- full

## Typical scenarios

- Create and destroy instrumentation sessions
- Register hook, intercept, and trace operations
- Record and query runtime artifacts
- AI hook generation and preset management
- Evidence graph provenance traversal

## Common combinations

- instrumentation + network
- instrumentation + browser

## Full tool list (13)

| Tool | Description |
| --- | --- |
| `instrumentation_session` | Start, stop, or query status of an instrumentation recording session. Destroying a session archives it read-only (the last 8 destroyed sessions are retained, oldest evicted) so export/diff/merge/status can still inspect it. |
| `instrumentation_session_export` | Export an instrumentation session snapshot to an artifacts JSON file. |
| `instrumentation_session_diff` | Diff two instrumentation session snapshots: operations added/removed/common (by id) plus artifact fingerprints and per-type counts. Pure compare, mutates nothing. |
| `instrumentation_session_merge` | Merge two sessions into a new session: copies operations (with id remapping) and artifacts from both sources. Original sessions are untouched. |
| `instrumentation_operation` | Manage operations inside an instrumentation session. |
| `instrumentation_artifact` | Manage artifacts captured by instrumentation operations. |
| `instrumentation_hook_preset` | Apply hook presets inside an instrumentation session. |
| `instrumentation_network_replay` | Replay a captured network request inside an instrumentation session. |
| `ai_hook` | Manage AI hooks. Actions: inject (inject code into page), get_data (retrieve captured hook data), list (all active hooks), clear (remove hook data by id or all), toggle (enable/disable a hook), export (export data as JSON/CSV). |
| `hook_preset` | Install a pre-built JavaScript hook from 20+ built-in presets (eval, atob/btoa, Proxy, Reflect, Object.defineProperty, etc.), or provide customTemplate/customTemplates to install your own reusable hook bodies. Use listPresets=true to see all available preset descriptions. |
| `evidence_query` | Query reverse evidence graph by URL, function name, or script ID to find associated nodes. |
| `evidence_export` | Export the reverse evidence graph as JSON snapshot or Markdown report. |
| `evidence_chain` | Get full provenance chain from a node ID in specified direction. |
