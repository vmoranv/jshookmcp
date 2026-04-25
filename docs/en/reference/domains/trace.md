# Trace

Domain: `trace`

Time-travel debugging domain that records CDP events into SQLite for SQL-based querying and heap snapshot comparison.

## Profiles

- full

## Typical scenarios

- Record browser events
- Query trace data with SQL
- Diff heap snapshots

## Common combinations

- trace + debugger + browser

## Representative tools

- `trace_recording` — Start or stop trace recording into a SQLite database.
- `start_trace_recording` — Start trace recording into a SQLite database.
- `stop_trace_recording` — Stop trace recording and return the final session summary.
- `query_trace_sql` — Execute a read-only SQL query against a trace database.
- `seek_to_timestamp` — Reconstruct trace state at a specific timestamp.
- `trace_get_network_flow` — Get a recorded request-scoped network flow from a trace.
- `diff_heap_snapshots` — Compare two heap snapshots from a trace.
- `export_trace` — Export a trace database to Chrome Trace Event JSON.
- `summarize_trace` — Generate a compact summary of a trace database.

## Full tool list (9)

| Tool | Description |
| --- | --- |
| `trace_recording` | Start or stop trace recording into a SQLite database. |
| `start_trace_recording` | Start trace recording into a SQLite database. |
| `stop_trace_recording` | Stop trace recording and return the final session summary. |
| `query_trace_sql` | Execute a read-only SQL query against a trace database. |
| `seek_to_timestamp` | Reconstruct trace state at a specific timestamp. |
| `trace_get_network_flow` | Get a recorded request-scoped network flow from a trace. |
| `diff_heap_snapshots` | Compare two heap snapshots from a trace. |
| `export_trace` | Export a trace database to Chrome Trace Event JSON. |
| `summarize_trace` | Generate a compact summary of a trace database. |
