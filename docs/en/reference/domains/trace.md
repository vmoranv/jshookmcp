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

- `trace_recording` — Start or stop time-travel trace recording into a SQLite database.
- `query_trace_sql` — Execute a read-only SQL query against a trace database.
- `seek_to_timestamp` — Reconstruct application state at a specific timestamp from a recorded trace.
- `diff_heap_snapshots` — Compare two heap snapshots from a trace and return the differences.
- `export_trace` — Export a trace database to Chrome Trace Event JSON format.
- `summarize_trace` — Generate a compact, LLM-friendly summary of a trace database.

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `trace_recording` | Start or stop time-travel trace recording into a SQLite database. |
| `query_trace_sql` | Execute a read-only SQL query against a trace database. |
| `seek_to_timestamp` | Reconstruct application state at a specific timestamp from a recorded trace. |
| `diff_heap_snapshots` | Compare two heap snapshots from a trace and return the differences. |
| `export_trace` | Export a trace database to Chrome Trace Event JSON format. |
| `summarize_trace` | Generate a compact, LLM-friendly summary of a trace database. |
