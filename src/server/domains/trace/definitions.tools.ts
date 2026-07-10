import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const TRACE_TOOLS: Tool[] = [
  tool('trace_recording', (t) =>
    t
      .desc('Start or stop trace recording into a SQLite database.')
      .enum('action', ['start', 'stop'], 'Recording action')
      .array(
        'cdpDomains',
        { type: 'string' },
        'CDP domains to record (default: Debugger, Runtime, Network, Page)',
      )
      .boolean('recordMemoryDeltas', 'Record memory write deltas', { default: true })
      .boolean('recordResponseBodies', 'Persist response bodies when available.', {
        default: true,
      })
      .boolean('streamResponseChunks', 'Capture response chunks when the browser supports it.', {
        default: true,
      })
      .number('networkBodyMaxBytes', 'Maximum response body bytes to persist per request', {
        default: 10485760,
        minimum: 1024,
        maximum: 104857600,
      })
      .number(
        'networkInlineBodyBytes',
        'Bodies up to this size are stored inline in SQLite; larger ones go to artifacts',
        {
          default: 262144,
          minimum: 1024,
          maximum: 10485760,
        },
      )
      .required('action')
      .idempotent(),
  ),
  tool('start_trace_recording', (t) =>
    t
      .desc('Start recording debugger traces into a SQLite database for time-travel.')
      .array(
        'cdpDomains',
        { type: 'string' },
        'CDP domains to record (default: Debugger, Runtime, Network, Page)',
      )
      .boolean('recordMemoryDeltas', 'Record memory write deltas', { default: true })
      .boolean('recordResponseBodies', 'Persist response bodies when available.', {
        default: true,
      })
      .boolean('streamResponseChunks', 'Capture response chunks when the browser supports it.', {
        default: true,
      })
      .number('networkBodyMaxBytes', 'Maximum response body bytes to persist per request', {
        default: 10485760,
        minimum: 1024,
        maximum: 104857600,
      })
      .number(
        'networkInlineBodyBytes',
        'Bodies up to this size are stored inline in SQLite; larger ones go to artifacts',
        {
          default: 262144,
          minimum: 1024,
          maximum: 10485760,
        },
      )
      .idempotent(),
  ),
  tool('stop_trace_recording', (t) =>
    t.desc('Stop trace recording and return the final session summary.').idempotent(),
  ),
  tool('query_trace_sql', (t) =>
    t
      .desc('Execute a read-only SQL query against a trace database.')
      .string('sql', 'SQL query to execute (SELECT only — write operations are rejected)')
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .required('sql')
      .query(),
  ),
  tool('seek_to_timestamp', (t) =>
    t
      .desc('Reconstruct trace state at a specific timestamp.')
      .number('timestamp', 'Target timestamp in milliseconds')
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .number('windowMs', 'Time window around timestamp to include in ms', { default: 100 })
      .enum(
        'timeDomain',
        ['wall', 'monotonic'],
        'Interpret timestamp using wall or monotonic time',
        {
          default: 'wall',
        },
      )
      .required('timestamp')
      .query(),
  ),
  tool('trace_get_network_flow', (t) =>
    t
      .desc('Get a recorded request-scoped network flow from a trace.')
      .string('requestId', 'Network requestId to retrieve from the trace')
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .boolean('includeBody', 'Include persisted response body metadata/content when available', {
        default: true,
      })
      .boolean('includeChunks', 'Include recorded response chunk timing data', {
        default: true,
      })
      .boolean('includeEvents', 'Include related network events from the trace', {
        default: true,
      })
      .number('chunkLimit', 'Maximum number of chunks to return', {
        default: 200,
        minimum: 1,
        maximum: 5000,
      })
      .number('maxBodyBytes', 'Maximum response body bytes to inline before summarizing', {
        default: 100000,
        minimum: 1024,
        maximum: 52428800,
      })
      .boolean('returnSummary', 'Return body summary even when body is within maxBodyBytes', {
        default: false,
      })
      .required('requestId')
      .query(),
  ),
  tool('trace_get_samples', (t) =>
    t
      .desc(
        'Query recorded CPU profile samples. mode="top" returns the hottest functions by self time (per-function rollup); mode="function" returns samples for one function; mode="window" returns samples near a timestamp. Ships NO hardcoded hot-function library — ordering is pure data projection, the caller decides what counts as hot.',
      )
      .enum(
        'mode',
        ['top', 'function', 'window'],
        'Query mode: top (hottest functions by self time), function (samples for one function), window (samples near a timestamp)',
        { default: 'top' },
      )
      .string('functionName', 'Function name to query (required for mode="function")')
      .number('timestamp', 'Target timestamp in ms (required for mode="window")')
      .number('windowMs', 'Half-window around timestamp in ms (mode="window")', {
        default: 100,
        minimum: 1,
        maximum: 60000,
      })
      .number('startTimestamp', 'Optional window start in ms (mode="top" aggregation filter)')
      .number('endTimestamp', 'Optional window end in ms (mode="top" aggregation filter)')
      .number('limit', 'Maximum results to return', {
        default: 20,
        minimum: 1,
        maximum: 1000,
      })
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .query(),
  ),
  tool('diff_heap_snapshots', (t) =>
    t
      .desc('Compare two heap snapshots from a trace.')
      .number('snapshotId1', 'First snapshot ID (earlier)')
      .number('snapshotId2', 'Second snapshot ID (later)')
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .required('snapshotId1', 'snapshotId2')
      .query(),
  ),
  tool('export_trace', (t) =>
    t
      .desc(
        'Export a trace database to Chrome Trace Event JSON with per-category thread tracks and thread_name metadata.',
      )
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .string('outputPath', 'Output JSON file path. Auto-generated if omitted.')
      .idempotent(),
  ),
  tool('summarize_trace', (t) =>
    t
      .desc('Generate a compact summary of a trace database.')
      .enum('detail', ['compact', 'balanced', 'full'], 'Summary detail level', {
        default: 'balanced',
      })
      .string('dbPath', 'Path to trace DB file. Uses the active recording if omitted.')
      .query(),
  ),
];
