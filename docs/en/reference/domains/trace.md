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

## Full tool list (10)

| Tool | Description |
| --- | --- |
| `trace_recording` | Start or stop trace recording into a SQLite database. |
| `start_trace_recording` | Start recording debugger traces into a SQLite database for time-travel. |
| `stop_trace_recording` | Stop trace recording and return the final session summary. |
| `query_trace_sql` | Execute a read-only SQL query against a trace database. |
| `seek_to_timestamp` | Reconstruct trace state at a specific timestamp. |
| `trace_get_samples` | Query recorded CPU profile samples. mode="top" returns the hottest functions by self time (per-function rollup); mode="function" returns samples for one function; mode="window" returns samples near a timestamp. Ships NO hardcoded hot-function library — ordering is pure data projection, the caller decides what counts as hot. |
| `trace_get_network_flow` | Get a recorded request-scoped network flow from a trace. |
| `diff_heap_snapshots` | Compare two heap snapshots from a trace. |
| `export_trace` | Export a trace database. format="chrome-trace" (default) emits Chrome Trace Event JSON with per-category thread tracks, thread_name metadata, and CPU-profile flame-graph X events. format="har" emits HTTP Archive 1.4 joining network_resources + response bodies — interchange format for Burp/ZAP/Postman. |
| `summarize_trace` | Generate a compact summary of a trace database. |
