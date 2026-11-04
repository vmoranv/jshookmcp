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
  ],
};
