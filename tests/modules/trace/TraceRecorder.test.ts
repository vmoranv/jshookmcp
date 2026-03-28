/**
 * TraceRecorder unit tests — event capture engine lifecycle.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '@server/EventBus';
import type { ServerEventMap } from '@server/EventBus';

// Mock resolveArtifactPath BEFORE importing TraceRecorder
vi.mock('@utils/artifacts', () => {
  return {
    resolveArtifactPath: async () => {
      const path = join(
        tmpdir(),
        `test-trace-recorder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
      );
      return { absolutePath: path, displayPath: path };
    },
    getArtifactDir: () => tmpdir(),
    getArtifactsRoot: () => tmpdir(),
  };
});

const { TraceRecorder } = await import('@modules/trace/TraceRecorder');
type TraceRecorderInstance = InstanceType<typeof TraceRecorder>;
type CDPSessionLike = import('@modules/trace/TraceRecorder').CDPSessionLike;

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

function createMockCDPSession(): CDPSessionLike & {
  _listeners: Map<string, Set<(params: any) => void>>;
} {
  const listeners = new Map<string, Set<(params: any) => void>>();
  return {
    _listeners: listeners,
    on(event: string, handler: (params: any) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off(event: string, handler: (params: any) => void) {
      listeners.get(event)?.delete(handler);
    },
    send: vi.fn().mockResolvedValue({}),
  };
}

describe('TraceRecorder', () => {
  let recorder: TraceRecorderInstance;
  let eventBus: EventBus<ServerEventMap>;
  let cleanupPaths: string[] = [];

  beforeEach(() => {
    recorder = new TraceRecorder();
    eventBus = new EventBus<ServerEventMap>();
    cleanupPaths = [];
  });

  afterEach(() => {
    if (recorder.getState() === 'recording') {
      try {
        const session = recorder.stop();
        cleanupPaths.push(session.dbPath);
      } catch {
        /* ok */
      }
    }
    for (const p of cleanupPaths) {
      cleanupDbArtifacts(p);
    }
  });

  it('starts recording and returns session', async () => {
    const session = await recorder.start(eventBus, null);
    cleanupPaths.push(session.dbPath);

    expect(recorder.getState()).toBe('recording');
    expect(session.sessionId).toBeTruthy();
    expect(session.dbPath).toContain('.db');
    expect(session.startedAt).toBeGreaterThan(0);
  });

  it('rejects double start', async () => {
    const session = await recorder.start(eventBus, null);
    cleanupPaths.push(session.dbPath);

    await expect(recorder.start(eventBus, null)).rejects.toThrow(/Recording already in progress/);
  });

  it('records EventBus events', async () => {
    const session = await recorder.start(eventBus, null);
    cleanupPaths.push(session.dbPath);

    // Emit a test event
    eventBus.emit('tool:called', { name: 'test_tool', args: {} } as never);
    // Small delay for async event handling
    await new Promise((r) => setTimeout(r, 50));

    const db = recorder.getDB();
    expect(db).not.toBeNull();
    db!.flush();

    const result = db!.query("SELECT * FROM events WHERE event_type = 'tool:called'");
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('maps event categories correctly', async () => {
    const session = await recorder.start(eventBus, null);
    cleanupPaths.push(session.dbPath);

    // Emit events with different namespaces
    eventBus.emit('tool:called', { name: 'test', args: {} } as never);
    await new Promise((r) => setTimeout(r, 50));

    const db = recorder.getDB()!;
    db.flush();

    const result = db.query("SELECT category FROM events WHERE event_type = 'tool:called'");
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
    // Category should be 'tool' (extracted from 'tool:called')
    expect(result.rows[0]![0]).toBe('tool');
  });

  it('records memory deltas', async () => {
    const session = await recorder.start(eventBus, null);
    cleanupPaths.push(session.dbPath);

    recorder.recordMemoryDelta({
      timestamp: Date.now(),
      address: '0x1000',
      oldValue: '0x00',
      newValue: '0xFF',
      size: 4,
      valueType: 'int32',
    });

    const db = recorder.getDB()!;
    db.flush();

    const result = db.query('SELECT * FROM memory_deltas');
    expect(result.rowCount).toBe(1);
  });

  it('silently ignores memory deltas when not recording', () => {
    // Should not throw
    expect(() => {
      recorder.recordMemoryDelta({
        timestamp: Date.now(),
        address: '0x1000',
        oldValue: '0x00',
        newValue: '0xFF',
        size: 4,
        valueType: 'int32',
      });
    }).not.toThrow();
  });

  it('stop unsubscribes from EventBus', async () => {
    const session = await recorder.start(eventBus, null);
    cleanupPaths.push(session.dbPath);

    recorder.stop();

    // Events after stop should not be recorded — DB is closed
    expect(recorder.getState()).toBe('stopped');
    expect(recorder.getDB()).toBeNull();
  });

  it('stop returns final session with counts', async () => {
    const session = await recorder.start(eventBus, null);
    cleanupPaths.push(session.dbPath);

    // Record some data
    recorder.recordMemoryDelta({
      timestamp: Date.now(),
      address: '0x1000',
      oldValue: '0x00',
      newValue: '0xFF',
      size: 4,
      valueType: 'int32',
    });

    const finalSession = recorder.stop();
    expect(finalSession.stoppedAt).toBeGreaterThan(0);
    expect(finalSession.memoryDeltaCount).toBe(1);
  });

  it('rejects stop when not recording', () => {
    expect(() => recorder.stop()).toThrow(/Cannot stop: not currently recording/);
  });

  it('getState returns correct state transitions', async () => {
    expect(recorder.getState()).toBe('idle');

    const session = await recorder.start(eventBus, null);
    cleanupPaths.push(session.dbPath);
    expect(recorder.getState()).toBe('recording');

    recorder.stop();
    expect(recorder.getState()).toBe('stopped');
  });

  it('subscribes to CDP events when session provided', async () => {
    const mockCdp = createMockCDPSession();
    const session = await recorder.start(eventBus, mockCdp);
    cleanupPaths.push(session.dbPath);

    // Verify CDP event listeners were registered
    expect(mockCdp._listeners.has('Debugger.paused')).toBe(true);
    expect(mockCdp._listeners.has('Network.requestWillBeSent')).toBe(true);

    recorder.stop();

    // Verify listeners were cleaned up
    for (const [, handlers] of mockCdp._listeners) {
      expect(handlers.size).toBe(0);
    }
  });
});
