import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TRACE_TOOLS: Tool[] = [
  {
    name: 'start_trace_recording',
    description: `Start recording CDP events, debugger state, and memory writes into a SQLite trace database.

Recording captures events from:
- Debugger: breakpoints, pauses, script parsing
- Runtime: console calls, exceptions
- Network: requests, responses
- Page: navigation events
- EventBus: tool calls, memory scans, browser events

Call stop_trace_recording to end the recording session.

Examples:
start_trace_recording()
start_trace_recording(cdpDomains=["Debugger", "Network"])`,
    inputSchema: {
      type: 'object',
      properties: {
        cdpDomains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'CDP domains to record (default: Debugger, Runtime, Network, Page)',
        },
        recordMemoryDeltas: {
          type: 'boolean',
          description: 'Record memory write deltas (default: true)',
        },
      },
    },
  },

  {
    name: 'stop_trace_recording',
    description: `Stop the active trace recording and finalize the SQLite database.

Returns session summary including:
- Database file path
- Total event count
- Memory delta count
- Heap snapshot count
- Recording duration

Examples:
stop_trace_recording()`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'query_trace_sql',
    description: `Execute a read-only SQL query against a trace database.

Available tables:
- events(id, timestamp, category, event_type, data, script_id, line_number)
- memory_deltas(id, timestamp, address, old_value, new_value, size, value_type)
- heap_snapshots(id, timestamp, snapshot_data, summary)
- metadata(key, value)

Returns columns, rows, and row count.

Examples:
query_trace_sql(sql="SELECT * FROM events WHERE category='debugger' ORDER BY timestamp")
query_trace_sql(sql="SELECT address, COUNT(*) as writes FROM memory_deltas GROUP BY address ORDER BY writes DESC LIMIT 10")
query_trace_sql(sql="SELECT * FROM events WHERE timestamp BETWEEN 1000 AND 2000", dbPath="artifacts/traces/my-trace.db")`,
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'SQL query to execute (SELECT only — write operations are rejected)',
        },
        dbPath: {
          type: 'string',
          description:
            'Path to trace DB file. Uses the active recording if omitted.',
        },
      },
      required: ['sql'],
    },
  },

  {
    name: 'seek_to_timestamp',
    description: `Reconstruct application state at a specific timestamp from a recorded trace.

Returns a structured snapshot including:
- Events near the timestamp
- Debugger state (last pause, call stack)
- Memory state (latest values per address)
- Network state (completed requests)
- Nearest heap snapshot

Examples:
seek_to_timestamp(timestamp=1711000000000)
seek_to_timestamp(timestamp=1711000000000, windowMs=500)
seek_to_timestamp(timestamp=1711000000000, dbPath="artifacts/traces/my-trace.db")`,
    inputSchema: {
      type: 'object',
      properties: {
        timestamp: {
          type: 'number',
          description: 'Target timestamp in milliseconds since epoch',
        },
        dbPath: {
          type: 'string',
          description:
            'Path to trace DB file. Uses the active recording if omitted.',
        },
        windowMs: {
          type: 'number',
          description:
            'Time window around timestamp to include in ms (default: 100)',
        },
      },
      required: ['timestamp'],
    },
  },

  {
    name: 'diff_heap_snapshots',
    description: `Compare two heap snapshots from a trace and return the differences.

Shows:
- New object types (in snapshot 2 but not 1)
- Deleted object types (in snapshot 1 but not 2)
- Changed objects (count or size differs)
- Total size delta

Useful for identifying state changes in obfuscated code.

Examples:
diff_heap_snapshots(snapshotId1=1, snapshotId2=2)
diff_heap_snapshots(snapshotId1=1, snapshotId2=3, dbPath="artifacts/traces/my-trace.db")`,
    inputSchema: {
      type: 'object',
      properties: {
        snapshotId1: {
          type: 'number',
          description: 'First snapshot ID (earlier)',
        },
        snapshotId2: {
          type: 'number',
          description: 'Second snapshot ID (later)',
        },
        dbPath: {
          type: 'string',
          description:
            'Path to trace DB file. Uses the active recording if omitted.',
        },
      },
      required: ['snapshotId1', 'snapshotId2'],
    },
  },

  {
    name: 'export_trace',
    description: `Export a trace database to Chrome Trace Event JSON format.

The resulting file can be loaded in:
- chrome://tracing
- Perfetto UI (ui.perfetto.dev)

Maps events to the standard trace event format with name, category, phase, timestamp.

Examples:
export_trace()
export_trace(dbPath="artifacts/traces/my-trace.db")
export_trace(outputPath="my-export.json")`,
    inputSchema: {
      type: 'object',
      properties: {
        dbPath: {
          type: 'string',
          description:
            'Path to trace DB file. Uses the active recording if omitted.',
        },
        outputPath: {
          type: 'string',
          description:
            'Output JSON file path. Auto-generated if omitted.',
        },
      },
    },
  },
];
