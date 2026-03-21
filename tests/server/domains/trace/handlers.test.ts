/**
 * Trace domain handler unit tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { TraceToolHandlers } from '@server/domains/trace/handlers';
import { TraceRecorder } from '@modules/trace/TraceRecorder';
import { TraceDB } from '@modules/trace/TraceDB';
import type { MCPServerContext } from '@server/MCPServer.context';

function createTmpDbPath(): string {
  return `/tmp/test-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;
}

function createMockContext(): Partial<MCPServerContext> {
  return {
    eventBus: {
      onAny: vi.fn().mockReturnValue(() => {}),
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      once: vi.fn().mockReturnValue(() => {}),
    } as unknown as MCPServerContext['eventBus'],
    collector: undefined,
  };
}

describe('TraceToolHandlers', () => {
  let dbPath: string;
  let db: TraceDB;
  let cleanupPaths: string[];

  beforeEach(() => {
    dbPath = createTmpDbPath();
    db = new TraceDB({ dbPath });
    cleanupPaths = [dbPath];
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    for (const p of cleanupPaths) {
      try { if (existsSync(p)) unlinkSync(p); } catch { /* ok */ }
      try { if (existsSync(p + '-wal')) unlinkSync(p + '-wal'); } catch { /* ok */ }
      try { if (existsSync(p + '-shm')) unlinkSync(p + '-shm'); } catch { /* ok */ }
    }
  });

  describe('handleQueryTraceSql', () => {
    it('executes SQL query and returns results', async () => {
      // Seed the DB with test data
      db.insertEvent({
        timestamp: 1000,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{"reason": "breakpoint"}',
        scriptId: '42',
        lineNumber: 10,
      });
      db.flush();

      // Create handler with a mock recorder that returns our DB
      const recorder = new TraceRecorder();
      vi.spyOn(recorder, 'getDB').mockReturnValue(db);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = await handler.handleQueryTraceSql({
        sql: "SELECT * FROM events WHERE category = 'debugger'",
      }) as { rowCount: number; columns: string[] };

      expect(result.rowCount).toBe(1);
      expect(result.columns).toContain('timestamp');
    });

    it('rejects when no DB available', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(
        handler.handleQueryTraceSql({ sql: 'SELECT * FROM events' })
      ).rejects.toThrow(/No active recording/);
    });

    it('opens temporary DB when dbPath is provided', async () => {
      // Seed the DB
      db.insertEvent({
        timestamp: 2000,
        category: 'network',
        eventType: 'Network.requestWillBeSent',
        data: '{}',
        scriptId: null,
        lineNumber: null,
      });
      db.flush();
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = await handler.handleQueryTraceSql({
        sql: 'SELECT COUNT(*) as cnt FROM events',
        dbPath,
      }) as { rows: unknown[][] };

      expect(result.rows[0]![0]).toBe(1);
    });
  });

  describe('handleSeekToTimestamp', () => {
    it('assembles state snapshot at a given timestamp', async () => {
      // Seed with various event types
      db.insertEvent({
        timestamp: 900,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{"reason": "breakpoint"}',
        scriptId: '10',
        lineNumber: 5,
      });
      db.insertEvent({
        timestamp: 1000,
        category: 'network',
        eventType: 'Network.loadingFinished',
        data: '{"requestId": "1"}',
        scriptId: null,
        lineNumber: null,
      });
      db.insertEvent({
        timestamp: 1050,
        category: 'runtime',
        eventType: 'Runtime.consoleAPICalled',
        data: '{"type": "log"}',
        scriptId: null,
        lineNumber: null,
      });
      db.insertMemoryDelta({
        timestamp: 950,
        address: '0x1000',
        oldValue: '0x00',
        newValue: '0xFF',
        size: 4,
        valueType: 'int32',
      });
      db.flush();
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = await handler.handleSeekToTimestamp({
        timestamp: 1000,
        dbPath,
        windowMs: 100,
      }) as {
        seekTimestamp: number;
        events: unknown[];
        debuggerState: { recentEvents: unknown[] };
        memoryState: { addressValues: unknown[] };
        networkState: { completedRequests: unknown[] };
      };

      expect(result.seekTimestamp).toBe(1000);
      expect(result.events.length).toBeGreaterThanOrEqual(1);
      expect(result.debuggerState.recentEvents.length).toBeGreaterThanOrEqual(1);
      expect(result.memoryState.addressValues.length).toBeGreaterThanOrEqual(1);
      expect(result.networkState.completedRequests.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('handleDiffHeapSnapshots', () => {
    it('computes differences between two snapshots', async () => {
      // Insert two snapshots with different summaries
      db.insertHeapSnapshot({
        timestamp: 1000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({
          totalSize: 1000,
          nodeCount: 10,
          objectCounts: { String: 5, Array: 3, Object: 2 },
        }),
      });
      db.insertHeapSnapshot({
        timestamp: 2000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({
          totalSize: 1500,
          nodeCount: 15,
          objectCounts: { String: 8, Array: 3, Map: 2, Object: 2 },
        }),
      });
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = await handler.handleDiffHeapSnapshots({
        snapshotId1: 1,
        snapshotId2: 2,
        dbPath,
      }) as {
        diff: {
          added: Array<{ name: string }>;
          removed: unknown[];
          changed: Array<{ name: string; delta: number }>;
          totalSizeDelta: number;
        };
      };

      expect(result.diff.totalSizeDelta).toBe(500);
      // Map was added
      expect(result.diff.added.some(a => a.name === 'Map')).toBe(true);
      // String count changed from 5 to 8
      expect(result.diff.changed.some(c => c.name === 'String' && c.delta === 3)).toBe(true);
    });
  });

  describe('handleExportTrace', () => {
    it('exports to Chrome Trace Event JSON format', async () => {
      db.insertEvent({
        timestamp: 1000,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{"reason": "breakpoint"}',
        scriptId: '42',
        lineNumber: 10,
      });
      db.insertEvent({
        timestamp: 2000,
        category: 'debugger',
        eventType: 'Debugger.resumed',
        data: '{}',
        scriptId: null,
        lineNumber: null,
      });
      db.flush();
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const outputPath = `/tmp/test-export-${Date.now()}.json`;
      cleanupPaths.push(outputPath);

      const result = await handler.handleExportTrace({
        dbPath,
        outputPath,
      }) as { eventCount: number; format: string; exportedPath: string };

      expect(result.eventCount).toBe(2);
      expect(result.format).toBe('Chrome Trace Event JSON');
      expect(existsSync(outputPath)).toBe(true);

      // Verify the exported JSON structure
      const { readFileSync } = await import('node:fs');
      const exported = JSON.parse(readFileSync(outputPath, 'utf-8')) as Array<{
        name: string; cat: string; ph: string; ts: number; pid: number; tid: number;
      }>;
      expect(exported).toHaveLength(2);

      // Debugger.paused should be 'B' (begin)
      expect(exported[0]!.ph).toBe('B');
      expect(exported[0]!.name).toBe('Debugger.paused');
      expect(exported[0]!.cat).toBe('debugger');
      expect(exported[0]!.pid).toBe(1);
      expect(exported[0]!.tid).toBe(1);
      // Timestamp should be in microseconds (1000ms * 1000 = 1000000µs)
      expect(exported[0]!.ts).toBe(1000000);

      // Debugger.resumed should be 'E' (end)
      expect(exported[1]!.ph).toBe('E');
    });
  });
});
