/**
 * Trace domain suite — execution recording, SQLite trace querying, and trace summarization (offline with temporary TraceDB).
 *
 * Ground truth:
 *  - query_trace_sql: SQLite query over seeded trace database returns exact rows and columns
 *  - summarize_trace: summary groups events by category and computes time ranges
 */
import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TraceToolHandlers } from '@server/domains/trace/handlers';
import { TraceRecorder } from '@modules/trace/TraceRecorder';
import { TraceDB } from '@modules/trace/TraceDB';
import { EventBus } from '@server/EventBus';
import type { MCPServerContext } from '@server/MCPServer.context';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';
import { expectSuccess, type BenchSuite } from '../harness';

function createTempTraceDb(): { db: TraceDB; dbPath: string; cleanup: () => void } {
  const dbPath = join(
    tmpdir(),
    `bench-trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  const db = new TraceDB({ dbPath });
  const cleanup = () => {
    try {
      db.close();
    } catch {}
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {}
    }
  };
  return { db, dbPath, cleanup };
}

export const traceSuite: BenchSuite = {
  name: 'trace-query',
  domain: 'trace',
  description: 'Trace SQL queries and event stream summarization over recorded trace databases',
  cases: [
    {
      name: 'query_trace_sql/select-events-exact',
      tool: 'query_trace_sql',
      origin: 'homemade',
      reference:
        'query_trace_sql against seeded SQLite trace DB returns matching rows and column names',
      run: async () => {
        const { db, dbPath, cleanup } = createTempTraceDb();
        try {
          db.insertEvent({
            timestamp: 1000,
            category: 'debugger',
            eventType: 'Debugger.paused',
            data: '{"reason":"breakpoint"}',
            scriptId: '42',
            lineNumber: 10,
          });
          db.insertEvent({
            timestamp: 1050,
            category: 'network',
            eventType: 'Network.requestWillBeSent',
            data: JSON.stringify({ url: withPath(TEST_URLS.api, 'data') }),
            scriptId: null,
            lineNumber: null,
          });
          db.flush();

          const recorder = new TraceRecorder();
          const ctx = {} as unknown as MCPServerContext;
          const handler = new TraceToolHandlers(recorder, ctx);

          return await handler.handleQueryTraceSqlTool({
            dbPath,
            sql: "SELECT category, event_type FROM events WHERE category = 'debugger'",
          });
        } finally {
          cleanup();
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.rowCount) !== 1) return `expected rowCount === 1, got ${b.rowCount}`;
        const rows = (b.rows as Array<Array<unknown>>) ?? [];
        if (!rows.length || rows[0]?.[0] !== 'debugger' || rows[0]?.[1] !== 'Debugger.paused') {
          return `unexpected row content: ${JSON.stringify(rows)}`;
        }
        return true;
      },
    },
    {
      name: 'summarize_trace/category-aggregation',
      tool: 'summarize_trace',
      origin: 'homemade',
      reference: 'summarize_trace aggregates event counts and time span across categories',
      run: async () => {
        const { db, dbPath, cleanup } = createTempTraceDb();
        try {
          db.insertEvent({
            timestamp: 1000,
            category: 'debugger',
            eventType: 'Debugger.paused',
            data: '{}',
            scriptId: null,
            lineNumber: null,
          });
          db.insertEvent({
            timestamp: 2000,
            category: 'debugger',
            eventType: 'Debugger.resumed',
            data: '{}',
            scriptId: null,
            lineNumber: null,
          });
          db.insertEvent({
            timestamp: 1500,
            category: 'network',
            eventType: 'Network.loadingFinished',
            data: '{}',
            scriptId: null,
            lineNumber: null,
          });
          db.flush();

          const recorder = new TraceRecorder();
          const ctx = {} as unknown as MCPServerContext;
          const handler = new TraceToolHandlers(recorder, ctx);

          return await handler.handleSummarizeTraceTool({
            dbPath,
            detail: 'compact',
          });
        } finally {
          cleanup();
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const eventsSummary = (b.events ?? b) as Record<string, unknown>;
        if (Number(eventsSummary.totalEvents) !== 3)
          return `expected totalEvents === 3, got ${eventsSummary.totalEvents}`;
        const categories = (eventsSummary.categories as Array<Record<string, unknown>>) ?? [];
        const dbg = categories.find((c) => c.category === 'debugger');
        if (!dbg || Number(dbg.count) !== 2)
          return `debugger category expected count 2: ${JSON.stringify(categories)}`;
        return true;
      },
    },

    // ── Coverage batch 2026-11-10 (autoresearch): trace recording & inspection tools ──
    {
      name: 'seek_to_timestamp/window-reconstruction',
      tool: 'seek_to_timestamp',
      origin: 'homemade',
      reference: 'reconstructs trace state around target timestamp with specified window',
      run: async () => {
        const { db, dbPath, cleanup } = createTempTraceDb();
        try {
          db.insertEvent({
            timestamp: 1000,
            category: 'debugger',
            eventType: 'Debugger.paused',
            data: '{"reason":"breakpoint"}',
            scriptId: '42',
            lineNumber: 10,
          });
          db.flush();
          const recorder = new TraceRecorder();
          const ctx = {} as unknown as MCPServerContext;
          const handler = new TraceToolHandlers(recorder, ctx);
          return await handler.handleSeekToTimestampTool({
            dbPath,
            timestamp: 1000,
            windowMs: 100,
          });
        } finally {
          cleanup();
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.seekTimestamp) !== 1000)
          return `expected seekTimestamp === 1000, got ${b.seekTimestamp}`;
        if (!Array.isArray(b.events) || b.events.length < 1)
          return `expected >= 1 event reconstructed, got ${JSON.stringify(b.events)}`;
        return true;
      },
    },
    {
      name: 'export_trace/chrome-trace-format',
      tool: 'export_trace',
      origin: 'homemade',
      reference: 'exports trace database into Chrome Trace Event JSON format',
      run: async () => {
        const { db, dbPath, cleanup } = createTempTraceDb();
        try {
          db.insertEvent({
            timestamp: 1000,
            category: 'debugger',
            eventType: 'Debugger.paused',
            data: '{"reason":"breakpoint"}',
            scriptId: null,
            lineNumber: null,
          });
          db.flush();
          const recorder = new TraceRecorder();
          const ctx = {} as unknown as MCPServerContext;
          const handler = new TraceToolHandlers(recorder, ctx);
          return await handler.handleExportTraceTool({
            dbPath,
            format: 'chrome-trace',
          });
        } finally {
          cleanup();
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.exportedPath !== 'string' || !b.exportedPath.length)
          return 'missing exportedPath in export result';
        if (Number(b.eventCount) < 1) return `expected eventCount >= 1, got ${b.eventCount}`;
        return true;
      },
    },
    {
      name: 'trace_get_samples/function-filter',
      tool: 'trace_get_samples',
      origin: 'homemade',
      reference: 'queries recorded CPU profile samples filtered by function name',
      run: async () => {
        const { db, dbPath, cleanup } = createTempTraceDb();
        try {
          db.insertSample({
            timestamp: 1000,
            selfTime: 50,
            aggregateTime: 100,
            functionName: 'benchHotFunction',
            scriptId: '1',
            url: 'https://example.com/app.js',
            lineNumber: 10,
            columnNumber: 5,
          });
          db.flush();
          const recorder = new TraceRecorder();
          const ctx = {} as unknown as MCPServerContext;
          const handler = new TraceToolHandlers(recorder, ctx);
          return await handler.handleGetTraceSamplesTool({
            dbPath,
            mode: 'function',
            functionName: 'benchHotFunction',
          });
        } finally {
          cleanup();
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.sampleCount) !== 1) return `expected sampleCount === 1, got ${b.sampleCount}`;
        return true;
      },
    },
    {
      name: 'diff_heap_snapshots/summary-delta',
      tool: 'diff_heap_snapshots',
      origin: 'homemade',
      reference: 'computes size and count deltas between two recorded heap snapshots',
      run: async () => {
        const { db, dbPath, cleanup } = createTempTraceDb();
        try {
          db.insertHeapSnapshot({
            timestamp: 1000,
            snapshotData: Buffer.from('snap1'),
            summary: JSON.stringify({
              totalSize: 1000,
              nodeCount: 10,
              objectCounts: { Object: 5 },
              objectSizes: { Object: 500 },
            }),
          });
          db.insertHeapSnapshot({
            timestamp: 2000,
            snapshotData: Buffer.from('snap2'),
            summary: JSON.stringify({
              totalSize: 1500,
              nodeCount: 15,
              objectCounts: { Object: 8 },
              objectSizes: { Object: 800 },
            }),
          });
          db.flush();
          const recorder = new TraceRecorder();
          const ctx = {} as unknown as MCPServerContext;
          const handler = new TraceToolHandlers(recorder, ctx);
          return await handler.handleDiffHeapSnapshotsTool({
            dbPath,
            snapshotId1: 1,
            snapshotId2: 2,
          });
        } finally {
          cleanup();
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const diff = b.diff as Record<string, unknown> | undefined;
        if (!diff) return 'missing diff in heap diff';
        if (Number(diff.totalSizeDelta) !== 500)
          return `expected totalSizeDelta === 500, got ${diff.totalSizeDelta}`;
        return true;
      },
    },
    {
      name: 'trace_get_network_flow/by-request-id',
      tool: 'trace_get_network_flow',
      origin: 'homemade',
      reference: 'retrieves recorded request-scoped network metadata by requestId',
      run: async () => {
        const { db, dbPath, cleanup } = createTempTraceDb();
        try {
          db.upsertNetworkResource({
            requestId: 'req-bench-trace-1',
            url: 'https://example.com/api',
            method: 'GET',
            resourceType: 'fetch',
            requestHeaders: '{}',
            requestPostData: null,
            status: 200,
            statusText: 'OK',
            responseHeaders: '{}',
            mimeType: 'application/json',
            protocol: 'h2',
            remoteAddress: '127.0.0.1',
            fromDiskCache: false,
            fromServiceWorker: false,
            startedWallTime: 1000,
            responseWallTime: 1050,
            finishedWallTime: 1100,
            startedMonotonicTime: 1000,
            responseMonotonicTime: 1050,
            finishedMonotonicTime: 1100,
            encodedDataLength: 42,
            receivedDataLength: 42,
            receivedEncodedDataLength: 42,
            chunkCount: 0,
            streamingEnabled: false,
            streamingSupported: null,
            streamingError: null,
            bodyCaptureState: 'inline',
            responseBodyPath: null,
            responseBodyInline: '{"ok":true}',
            responseBodySize: 11,
            responseBodyIsBase64: false,
            bodyTruncated: false,
            bodyError: null,
            failed: false,
            failureReason: null,
            errorText: null,
            canceled: false,
            canceling: false,
          });
          db.flush();
          const recorder = new TraceRecorder();
          const ctx = {} as unknown as MCPServerContext;
          const handler = new TraceToolHandlers(recorder, ctx);
          return await handler.handleGetTraceNetworkFlowTool({
            dbPath,
            requestId: 'req-bench-trace-1',
          });
        } finally {
          cleanup();
        }
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.requestId !== 'req-bench-trace-1')
          return `expected requestId req-bench-trace-1, got ${b.requestId}`;
        const req = b.request as Record<string, unknown> | undefined;
        if (Number(req?.status ?? b.status) !== 200)
          return `expected status 200, got ${req?.status ?? b.status}`;
        return true;
      },
    },
    {
      name: 'start_trace_recording/offline-session',
      tool: 'start_trace_recording',
      origin: 'homemade',
      reference: 'starts a trace recording session without browser attachment',
      run: async () => {
        const eventBus = new EventBus();
        const recorder = new TraceRecorder();
        const ctx = { eventBus } as unknown as MCPServerContext;
        const handler = new TraceToolHandlers(recorder, ctx);
        const res = await handler.handleStartTraceRecordingTool({});
        try {
          await recorder.stop();
        } catch {}
        return res;
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.status !== 'recording') return `expected status recording, got ${b.status}`;
        return true;
      },
    },
    {
      name: 'stop_trace_recording/lifecycle',
      tool: 'stop_trace_recording',
      origin: 'homemade',
      reference: 'stops an active trace recording session and reports summary',
      run: async () => {
        const eventBus = new EventBus();
        const recorder = new TraceRecorder();
        const ctx = { eventBus } as unknown as MCPServerContext;
        const handler = new TraceToolHandlers(recorder, ctx);
        await handler.handleStartTraceRecordingTool({});
        return await handler.handleStopTraceRecordingTool();
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.status !== 'stopped' && b.status !== 'stopped_with_errors')
          return `expected stopped status, got ${b.status}`;
        return true;
      },
    },
    {
      name: 'trace_recording/action-dispatch',
      tool: 'trace_recording',
      origin: 'homemade',
      reference: 'dispatches start and stop actions via single tool facade',
      run: async () => {
        const eventBus = new EventBus();
        const recorder = new TraceRecorder();
        const ctx = { eventBus } as unknown as MCPServerContext;
        const handler = new TraceToolHandlers(recorder, ctx);
        const started = await handler.handleTraceRecordingTool({ action: 'start' });
        const stopped = await handler.handleTraceRecordingTool({ action: 'stop' });
        return { started, stopped };
      },
      validate: (v) => {
        const { started, stopped } = v as { started?: unknown; stopped?: unknown };
        const bStart = expectSuccess(started);
        const bStop = expectSuccess(stopped);
        if (bStart.status !== 'recording')
          return `expected start status recording, got ${bStart.status}`;
        if (bStop.status !== 'stopped' && bStop.status !== 'stopped_with_errors')
          return `expected stop status stopped, got ${bStop.status}`;
        return true;
      },
    },
  ],
};
