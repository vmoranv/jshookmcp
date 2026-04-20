import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const TRACE_TOOLS: Tool[] = [
  tool('trace_recording', (t) =>
    t
      .desc(
        'Start or stop time-travel trace recording into a SQLite database.\n\nRecording captures events from Debugger, Runtime, Network, Page, and EventBus.\nUse action="stop" to finalize and get a session summary.',
      )
      .enum('action', ['start', 'stop'], 'Recording action')
      .array(
        'cdpDomains',
        { type: 'string' },
        'CDP domains to record (action=start, default: Debugger, Runtime, Network, Page)',
      )
      .boolean('recordMemoryDeltas', 'Record memory write deltas (action=start)', { default: true })
      .required('action')
      .idempotent(),
  ),
  tool('query_trace_sql', (t) =>
    t
      .desc(
        'Execute a read-only SQL query against a trace database.\n\nAvailable tables:\n- events(id, timestamp, category, event_type, data, script_id, line_number)\n- memory_deltas(id, timestamp, address, old_value, new_value, size, value_type)\n- heap_snapshots(id, timestamp, snapshot_data, summary)\n- metadata(key, value)\n\nReturns columns, rows, and row count.\n\nExamples:\nquery_trace_sql(sql="SELECT * FROM events WHERE category=\'debugger\' ORDER BY timestamp")\nquery_trace_sql(sql="SELECT address, COUNT(*) as writes FROM memory_deltas GROUP BY address ORDER BY writes DESC LIMIT 10")\nquery_trace_sql(sql="SELECT * FROM events WHERE timestamp BETWEEN 1000 AND 2000", dbPath="artifacts/traces/my-trace.db")',
      )
      .string('sql', 'SQL query to execute (SELECT only — write operations are rejected)')
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .required('sql')
      .query(),
  ),
  tool('seek_to_timestamp', (t) =>
    t
      .desc(
        'Reconstruct application state at a specific timestamp from a recorded trace.\n\nReturns a structured snapshot including:\n- Events near the timestamp\n- Debugger state (last pause, call stack)\n- Memory state (latest values per address)\n- Network state (completed requests)\n- Nearest heap snapshot\n\nExamples:\nseek_to_timestamp(timestamp=1711000000000)\nseek_to_timestamp(timestamp=1711000000000, windowMs=500)\nseek_to_timestamp(timestamp=1711000000000, dbPath="artifacts/traces/my-trace.db")',
      )
      .number('timestamp', 'Target timestamp in milliseconds since epoch')
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .number('windowMs', 'Time window around timestamp to include in ms', { default: 100 })
      .required('timestamp')
      .query(),
  ),
  tool('diff_heap_snapshots', (t) =>
    t
      .desc(
        'Compare two heap snapshots from a trace and return the differences.\n\nShows:\n- New object types (in snapshot 2 but not 1)\n- Deleted object types (in snapshot 1 but not 2)\n- Changed objects (count or size differs)\n- Total size delta\n\nUseful for identifying state changes in obfuscated code.\n\nExamples:\ndiff_heap_snapshots(snapshotId1=1, snapshotId2=2)\ndiff_heap_snapshots(snapshotId1=1, snapshotId2=3, dbPath="artifacts/traces/my-trace.db")',
      )
      .number('snapshotId1', 'First snapshot ID (earlier)')
      .number('snapshotId2', 'Second snapshot ID (later)')
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .required('snapshotId1', 'snapshotId2')
      .query(),
  ),
  tool('export_trace', (t) =>
    t
      .desc(
        'Export a trace database to Chrome Trace Event JSON format.\n\nThe resulting file can be loaded in:\n- chrome://tracing\n- Perfetto UI (ui.perfetto.dev)\n\nMaps events to the standard trace event format with name, category, phase, timestamp.\n\nExamples:\nexport_trace()\nexport_trace(dbPath="artifacts/traces/my-trace.db")\nexport_trace(outputPath="my-export.json")',
      )
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .string('outputPath', 'Output JSON file path. Auto-generated if omitted.')
      .idempotent(),
  ),
  tool('summarize_trace', (t) =>
    t
      .desc(
        'Generate a compact, LLM-friendly summary of a trace database.\n\nAvoids sending raw trace data that may exceed context windows. Three detail levels:\n- compact: category aggregation + timeline overview (~10% of raw size)\n- balanced: compact + key moments (breakpoints, exceptions, network completions) [DEFAULT]\n- full: passthrough — returns all events without compression\n\nAlso detects memory anomalies: addresses with significantly more writes than average.\n\nExamples:\nsummarize_trace()\nsummarize_trace(detail="compact")\nsummarize_trace(detail="balanced", dbPath="artifacts/traces/my-trace.db")',
      )
      .enum('detail', ['compact', 'balanced', 'full'], 'Summary detail level', {
        default: 'balanced',
      })
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .query(),
  ),
];
