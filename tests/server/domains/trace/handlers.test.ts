import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TraceToolHandlers } from '@server/domains/trace/handlers';
import { TraceRecorder } from '@modules/trace/TraceRecorder';
import { TraceDB } from '@modules/trace/TraceDB';
import type { MCPServerContext } from '@server/MCPServer.context';

vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: async () => ({ absolutePath: '/tmp/auto.json' }),
}));

function createTmpDbPath(): string {
  return join(tmpdir(), `test-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
}

function cleanupDbArtifacts(path?: string | null): void {
  if (!path) return;

  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* cleanup best-effort */
  }
  try {
    if (existsSync(path + '-wal')) unlinkSync(path + '-wal');
  } catch {
    /* cleanup best-effort */
  }
  try {
    if (existsSync(path + '-shm')) unlinkSync(path + '-shm');
  } catch {
    /* cleanup best-effort */
  }
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
  let dbPath = '';
  let db: TraceDB | null = null;
  let cleanupPaths: string[] = [];

  beforeEach(() => {
    dbPath = createTmpDbPath();
    db = new TraceDB({ dbPath });
    cleanupPaths = [dbPath];
  });

  afterEach(() => {
    try {
      // @ts-expect-error — auto-suppressed [TS18047]
      db.close();
    } catch {
      /* already closed */
    }
    for (const p of cleanupPaths) {
      cleanupDbArtifacts(p);
    }
  });

  describe('handleQueryTraceSql', () => {
    it('executes SQL query and returns results', async () => {
      // Seed the DB with test data
      // @ts-expect-error — auto-suppressed [TS18047]
      db.insertEvent({
        timestamp: 1000,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{"reason": "breakpoint"}',
        scriptId: '42',
        lineNumber: 10,
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.flush();

      // Create handler with a mock recorder that returns our DB
      const recorder = new TraceRecorder();
      vi.spyOn(recorder, 'getDB').mockReturnValue(db);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleQueryTraceSql({
        sql: "SELECT * FROM events WHERE category = 'debugger'",
      })) as { rowCount: number; columns: string[] };

      expect(result.rowCount).toBe(1);
      expect(result.columns).toContain('timestamp');
    });

    it('rejects when no DB available', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(handler.handleQueryTraceSql({ sql: 'SELECT * FROM events' })).rejects.toThrow(
        /No active recording/,
      );
    });

    it('rejects when sql parameter is missing', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(handler.handleQueryTraceSql({})).rejects.toThrow(/sql parameter is required/);
    });

    it('opens temporary DB when dbPath is provided', async () => {
      // Seed the DB
      // @ts-expect-error — auto-suppressed [TS18047]
      db.insertEvent({
        timestamp: 2000,
        category: 'network',
        eventType: 'Network.requestWillBeSent',
        data: '{}',
        scriptId: null,
        lineNumber: null,
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.flush();
      // @ts-expect-error — auto-suppressed [TS18047]
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleQueryTraceSql({
        sql: 'SELECT COUNT(*) as cnt FROM events',
        dbPath,
      })) as { rows: any[][] };

      expect(result.rows[0]![0]).toBe(1);
    });
  });

  describe('handleSeekToTimestamp', () => {
    it('assembles state snapshot at a given timestamp', async () => {
      // Seed with various event types
      // @ts-expect-error — auto-suppressed [TS18047]
      db.insertEvent({
        timestamp: 900,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{"reason": "breakpoint"}',
        scriptId: '10',
        lineNumber: 5,
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.insertEvent({
        timestamp: 1000,
        category: 'network',
        eventType: 'Network.loadingFinished',
        data: '{"requestId": "1"}',
        scriptId: null,
        lineNumber: null,
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.insertEvent({
        timestamp: 1050,
        category: 'runtime',
        eventType: 'Runtime.consoleAPICalled',
        data: '{"type": "log"}',
        scriptId: null,
        lineNumber: null,
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.insertMemoryDelta({
        timestamp: 950,
        address: '0x1000',
        oldValue: '0x00',
        newValue: '0xFF',
        size: 4,
        valueType: 'int32',
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.flush();
      // @ts-expect-error — auto-suppressed [TS18047]
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleSeekToTimestamp({
        timestamp: 1000,
        dbPath,
        windowMs: 100,
      })) as {
        seekTimestamp: number;
        events: any[];
        debuggerState: { recentEvents: any[] };
        memoryState: { addressValues: any[] };
        networkState: { completedRequests: any[] };
      };

      expect(result.seekTimestamp).toBe(1000);
      expect(result.events.length).toBeGreaterThanOrEqual(1);
      expect(result.debuggerState.recentEvents.length).toBeGreaterThanOrEqual(1);
      expect(result.memoryState.addressValues.length).toBeGreaterThanOrEqual(1);
      expect(result.networkState.completedRequests.length).toBeGreaterThanOrEqual(1);
    });

    it('handles invalid JSON in event data safely', async () => {
      // @ts-expect-error
      db.insertEvent({
        timestamp: 900,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{invalid:json',
        scriptId: '10',
        lineNumber: 5,
      });
      // @ts-expect-error
      db.flush();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleSeekToTimestamp({
        timestamp: 1000,
        dbPath,
        windowMs: 100,
      })) as { events: any[] };

      expect(result.events[0].data).toBe('{invalid:json');
    });

    it('returns null nearest heap snapshot when none exist', async () => {
      // Seed at least one event so the handler can build a timeline
      // @ts-expect-error
      db.insertEvent({
        timestamp: 900,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{}',
        scriptId: '10',
        lineNumber: 5,
      });
      // @ts-expect-error
      db.flush();
      // @ts-expect-error — auto-suppressed [TS18047]
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleSeekToTimestamp({
        timestamp: 1000,
        dbPath,
        windowMs: 50,
      })) as { nearestHeapSnapshot: null | Record<string, unknown> };

      expect(result.nearestHeapSnapshot).toBeNull();
    });

    it('rejects when timestamp parameter is missing', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(handler.handleSeekToTimestamp({})).rejects.toThrow(
        /timestamp parameter is required/,
      );
    });

    it('uses active recording DB when dbPath is not provided', async () => {
      const recorder = new TraceRecorder();
      // @ts-expect-error
      db.insertEvent({
        timestamp: 1000,
        category: 'network',
        eventType: 'Network.requestWillBeSent',
        data: '{}',
      });
      // @ts-expect-error
      db.flush();
      vi.spyOn(recorder, 'getDB').mockReturnValue(db);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleSeekToTimestamp({ timestamp: 1000 })) as any;
      expect(result.events.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('handleDiffHeapSnapshots', () => {
    it('computes differences between two snapshots', async () => {
      // Insert two snapshots with different summaries
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 1000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({
          totalSize: 1000,
          nodeCount: 10,
        }),
      });
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 2000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({
          totalSize: 1500,
          nodeCount: 15,
          objectCounts: { String: 8, Array: 3, Map: 2, Object: 2 },
        }),
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleDiffHeapSnapshots({
        snapshotId1: 1,
        snapshotId2: 2,
        dbPath,
      })) as {
        diff: {
          added: Array<{ name: string }>;
          removed: any[];
          changed: Array<{ name: string; delta: number }>;
          totalSizeDelta: number;
        };
      };

      expect(result.diff.totalSizeDelta).toBe(500);
      expect(result.diff.added.some((a) => a.name === 'String')).toBe(true);
    });

    it('uses active recording DB when dbPath is not provided', async () => {
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 1000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({ objectCounts: { ObjectToKeep: 5 } }),
      });
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 2000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({ objectCounts: { ObjectToKeep: 5 } }),
      });
      // @ts-expect-error
      db.flush();

      const recorder = new TraceRecorder();
      vi.spyOn(recorder, 'getDB').mockReturnValue(db);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleDiffHeapSnapshots({
        snapshotId1: 1,
        snapshotId2: 2,
      })) as any;

      expect(result.diff.changedCount).toBe(0);
    });

    it('handles removed keys from snapshot1 to snapshot2', async () => {
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 1000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({ objectCounts: { ObjectToRemove: 5 } }),
      });
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 2000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({ objectCounts: {} }),
      });
      // @ts-expect-error
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleDiffHeapSnapshots({
        snapshotId1: 1,
        snapshotId2: 2,
        dbPath,
      })) as any;

      expect(result.diff.removed.some((r: any) => r.name === 'ObjectToRemove')).toBe(true);
    });

    it('reports changed counts when snapshot object counts differ', async () => {
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 1000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({
          totalSize: 100,
          nodeCount: 2,
          objectCounts: { ChangedObject: 2, StableObject: 4 },
        }),
      });
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 2000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({
          totalSize: 200,
          nodeCount: 3,
          objectCounts: { ChangedObject: 5, StableObject: 4 },
        }),
      });
      // @ts-expect-error
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleDiffHeapSnapshots({
        snapshotId1: 1,
        snapshotId2: 2,
        dbPath,
      })) as { diff: { changed: Array<{ name: string; delta: number }> } };

      expect(result.diff.changed.some((c) => c.name === 'ChangedObject')).toBe(true);
      expect(result.diff.changed.find((c) => c.name === 'ChangedObject')?.delta).toBe(3);
      expect(result.diff.totalSizeDelta).toBe(100);
    });

    it('rejects when snapshotIds are missing', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(handler.handleDiffHeapSnapshots({})).rejects.toThrow(
        /snapshotId1 and snapshotId2 are required/,
      );
    });

    it('throws if snapshot1 not found', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(
        handler.handleDiffHeapSnapshots({
          snapshotId1: 999,
          snapshotId2: 2,
          dbPath,
        }),
      ).rejects.toThrow(/not found/);
    });

    it('throws if snapshot2 not found', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 1000,
        snapshotData: Buffer.from('{}'),
        summary: '{}',
      });
      // @ts-expect-error
      db.flush();

      await expect(
        handler.handleDiffHeapSnapshots({
          snapshotId1: 1,
          snapshotId2: 999,
          dbPath,
        }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('handleExportTrace', () => {
    it('exports to Chrome Trace Event JSON format', async () => {
      // @ts-expect-error — auto-suppressed [TS18047]
      db.insertEvent({
        timestamp: 1000,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{"reason": "breakpoint"}',
        scriptId: '42',
        lineNumber: 10,
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.insertEvent({
        timestamp: 2000,
        category: 'debugger',
        eventType: 'Debugger.resumed',
        data: '{}',
        scriptId: null,
        lineNumber: null,
      });
      // @ts-expect-error
      db.insertEvent({
        timestamp: 3000,
        category: 'network',
        eventType: 'Network.requestWillBeSent',
        data: '{}',
        scriptId: null,
        lineNumber: null,
      });
      // @ts-expect-error — auto-suppressed [TS18047]
      db.flush();
      // @ts-expect-error — auto-suppressed [TS18047]
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const outputPath = join(tmpdir(), `test-export-${Date.now()}.json`);
      cleanupPaths.push(outputPath);

      const result = (await handler.handleExportTrace({
        dbPath,
        outputPath,
      })) as { eventCount: number; format: string; exportedPath: string };

      expect(result.eventCount).toBe(3);
      expect(result.format).toBe('Chrome Trace Event JSON');
      expect(existsSync(outputPath)).toBe(true);

      // Verify the exported JSON structure
      const { readFileSync } = await import('node:fs');
      const exported = JSON.parse(readFileSync(outputPath, 'utf-8')) as Array<{
        name: string;
        cat: string;
        ph: string;
        ts: number;
        pid: number;
        tid: number;
        s?: string;
      }>;
      expect(exported).toHaveLength(3);

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

      // Instant event
      expect(exported[2]!.ph).toBe('i');
      expect(exported[2]!.s).toBe('g');
    });

    it('exports using automatically resolved artifact path when outputPath is omitted', async () => {
      // @ts-expect-error
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleExportTrace({
        dbPath,
      })) as { exportedPath: string };

      expect(result.exportedPath).toBe('/tmp/auto.json');
    });

    it('throws if no dbPath and no active recording in getDbForReading', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(handler.handleExportTrace({})).rejects.toThrow(/No active recording/);
    });
  });

  describe('handleStartTraceRecording', () => {
    it('starts a recording with or without CDP session', async () => {
      const recorder = new TraceRecorder();
      const mockSession = { sessionId: 'sess-1', dbPath: 'path.db' } as any;
      vi.spyOn(recorder, 'start').mockResolvedValue(mockSession);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleStartTraceRecording({})) as any;
      expect(result.status).toBe('recording');
      expect(result.sessionId).toBe('sess-1');
    });

    it('throws if EventBus is not available on ctx', async () => {
      const recorder = new TraceRecorder();
      const ctx = {} as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(handler.handleStartTraceRecording({})).rejects.toThrow(/EventBus not available/);
    });

    it('attempts to create CDP session from active page', async () => {
      const recorder = new TraceRecorder();
      const mockSession = { sessionId: 'sess-1', dbPath: 'path.db' } as any;
      vi.spyOn(recorder, 'start').mockResolvedValue(mockSession);
      const ctx = createMockContext() as MCPServerContext;
      ctx.collector = {
        getActivePage: vi.fn().mockResolvedValue({
          createCDPSession: vi.fn().mockResolvedValue({}),
        }),
      } as any;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleStartTraceRecording({})) as any;
      expect(result.message).toContain('active');
    });

    it('handles failure to attach CDP session gracefully', async () => {
      const recorder = new TraceRecorder();
      const mockSession = { sessionId: 'sess-1', dbPath: 'path.db' } as any;
      vi.spyOn(recorder, 'start').mockResolvedValue(mockSession);
      const ctx = createMockContext() as MCPServerContext;
      ctx.collector = {
        getActivePage: vi.fn().mockResolvedValue({
          createCDPSession: vi.fn().mockRejectedValue(new Error('no CDP')),
        }),
      } as any;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleStartTraceRecording({})) as any;
      expect(result.status).toBe('recording');
      expect(result.message).toContain('not available');
    });
  });

  describe('handleStopTraceRecording', () => {
    it('stops a recording and returns summary', async () => {
      const recorder = new TraceRecorder();
      const mockStopStats = {
        sessionId: 'sess-1',
        dbPath: 'path.db',
        startedAt: 1000,
        stoppedAt: 2000,
        eventCount: 5,
        memoryDeltaCount: 2,
        heapSnapshotCount: 1,
      } as any;
      vi.spyOn(recorder, 'stop').mockReturnValue(mockStopStats);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleStopTraceRecording()) as any;
      expect(result.status).toBe('stopped');
      expect(result.durationMs).toBe(1000);
      expect(result.eventCount).toBe(5);
    });
  });

  describe('handleSummarizeTrace', () => {
    it('summarizes an active recording with non-string data', async () => {
      const recorder = new TraceRecorder();
      vi.spyOn(recorder, 'getState').mockReturnValue('recording');
      const eventsResult = {
        columns: ['timestamp', 'category', 'event_type', 'data', 'script_id', 'line_number'],
        rows: [[1000, 'network', 'Network.requestWillBeSent', { rawObject: true }, '61', 1]],
        rowCount: 1,
      };
      const memoryResult = {
        columns: ['timestamp', 'address', 'old_value', 'new_value', 'size', 'value_type'],
        rows: [],
        rowCount: 0,
      };
      const fakeDb = {
        query: vi.fn((sql: string) => {
          if (sql.includes('memory_deltas')) {
            return memoryResult;
          }
          return eventsResult;
        }),
      } as unknown as TraceDB;
      vi.spyOn(recorder, 'getDB').mockReturnValue(fakeDb);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleSummarizeTrace({ detail: 'summary' })) as any;
      expect(result.events).toBeDefined();
      expect(result.memory).toBeDefined();
      expect(result.metadata.dbPath).toContain('active recording');
    });

    it('summarizes an existing db path', async () => {
      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      // @ts-expect-error
      db.close();

      const result = (await handler.handleSummarizeTrace({ dbPath })) as any;
      expect(result.metadata.dbPath).toBe(dbPath);
    });

    it('throws if no dbPath and no active recording', async () => {
      const recorder = new TraceRecorder();
      vi.spyOn(recorder, 'getState').mockReturnValue('stopped');
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(handler.handleSummarizeTrace({})).rejects.toThrow(/No trace database specified/);
    });

    it('throws if active recording has no database', async () => {
      const recorder = new TraceRecorder();
      vi.spyOn(recorder, 'getState').mockReturnValue('recording');
      vi.spyOn(recorder, 'getDB').mockReturnValue(null);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      await expect(handler.handleSummarizeTrace({})).rejects.toThrow(
        /Active recording has no database/,
      );
    });

    it('handles string data in events via safeParseJSON (line 450)', async () => {
      const recorder = new TraceRecorder();
      vi.spyOn(recorder, 'getState').mockReturnValue('recording');
      const eventsResult = {
        columns: ['timestamp', 'category', 'event_type', 'data', 'script_id', 'line_number'],
        rows: [[1000, 'network', 'Network.requestWillBeSent', '{"requestId":"1"}', '61', 1]],
        rowCount: 1,
      };
      const memoryResult = {
        columns: ['timestamp', 'address', 'old_value', 'new_value', 'size', 'value_type'],
        rows: [],
        rowCount: 0,
      };
      const fakeDb = {
        query: vi.fn((sql: string) => {
          if (sql.includes('memory_deltas')) return memoryResult;
          return eventsResult;
        }),
      } as unknown as TraceDB;
      vi.spyOn(recorder, 'getDB').mockReturnValue(fakeDb);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleSummarizeTrace({})) as any;
      // safeParseJSON converts the string '{"requestId":"1"}' to an object internally;
      // the summary aggregates by category so we verify the network category appears
      expect(result.events.categories.find((c: any) => c.category === 'network')).toBeDefined();
      expect(result.events.totalEvents).toBe(1);
    });
  });

  describe('handleStartTraceRecording — createCDPSession branch', () => {
    it('skips CDP session when page lacks createCDPSession (line 47)', async () => {
      const recorder = new TraceRecorder();
      const mockSession = { sessionId: 'sess-1', dbPath: 'path.db' } as any;
      vi.spyOn(recorder, 'start').mockResolvedValue(mockSession);
      const ctx = createMockContext() as MCPServerContext;
      ctx.collector = {
        getActivePage: vi.fn().mockResolvedValue({
          // page exists but createCDPSession is NOT a function
          evaluate: vi.fn(),
        }),
      } as any;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleStartTraceRecording({})) as any;
      expect(result.status).toBe('recording');
      expect(result.message).toContain('not available');
    });
  });

  describe('handleStopTraceRecording — stoppedAt branch', () => {
    it('uses 0 duration when stoppedAt is undefined (line 73)', async () => {
      const recorder = new TraceRecorder();
      vi.spyOn(recorder, 'stop').mockReturnValue({
        sessionId: 'sess-1',
        dbPath: 'path.db',
        startedAt: 1000,
        stoppedAt: undefined,
        eventCount: 5,
        memoryDeltaCount: 2,
        heapSnapshotCount: 1,
      } as any);
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleStopTraceRecording()) as any;
      expect(result.status).toBe('stopped');
      expect(result.durationMs).toBe(0);
    });
  });

  describe('handleSeekToTimestamp — nearestHeapSnapshot present branch', () => {
    it('returns nearest heap snapshot when one exists before timestamp (line 198)', async () => {
      // @ts-expect-error
      db.insertEvent({
        timestamp: 900,
        category: 'debugger',
        eventType: 'Debugger.paused',
        data: '{}',
        scriptId: '10',
        lineNumber: 5,
      });
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 500,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({ nodeCount: 2 }),
      });
      // @ts-expect-error
      db.flush();
      // @ts-expect-error
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleSeekToTimestamp({
        timestamp: 1000,
        dbPath,
        windowMs: 100,
      })) as { nearestHeapSnapshot: Record<string, unknown> | null };

      expect(result.nearestHeapSnapshot).not.toBeNull();
      expect(result.nearestHeapSnapshot).toBeDefined();
    });
  });

  describe('handleDiffHeapSnapshots — missing objectCounts branch', () => {
    it('uses empty objectCounts when summary2 has none (line 246)', async () => {
      // snapshot1 has objectCounts, snapshot2 does NOT
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 1000,
        snapshotData: Buffer.from('{}'),
        summary: JSON.stringify({ totalSize: 100, nodeCount: 2, objectCounts: { ObjectX: 5 } }),
      });
      // @ts-expect-error
      db.insertHeapSnapshot({
        timestamp: 2000,
        snapshotData: Buffer.from('{}'),
        // No objectCounts field — summary2['objectCounts'] is undefined
        summary: JSON.stringify({ totalSize: 200, nodeCount: 3 }),
      });
      // @ts-expect-error
      db.close();

      const recorder = new TraceRecorder();
      const ctx = createMockContext() as MCPServerContext;
      const handler = new TraceToolHandlers(recorder, ctx);

      const result = (await handler.handleDiffHeapSnapshots({
        snapshotId1: 1,
        snapshotId2: 2,
        dbPath,
      })) as any;

      // ObjectX went from 5 to 0 — should appear in removed
      expect(result.diff.removed.some((r: any) => r.name === 'ObjectX')).toBe(true);
    });
  });
});
