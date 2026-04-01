/**
 * TraceRecorder unit tests — event capture engine lifecycle.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, mkdtemp } from 'node:fs/promises';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '@server/EventBus';
import type { ServerEventMap } from '@server/EventBus';
import { TraceDB } from '@modules/trace/TraceDB';

let currentTestDir = '';

// Mock resolveArtifactPath BEFORE importing TraceRecorder
vi.mock('@utils/artifacts', () => {
  return {
    resolveArtifactPath: async () => {
      const path = join(
        currentTestDir || tmpdir(),
        `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
      );
      return { absolutePath: path, displayPath: path };
    },
    getArtifactDir: () => currentTestDir || tmpdir(),
    getArtifactsRoot: () => currentTestDir || tmpdir(),
  };
});

const { TraceRecorder } = await import('@modules/trace/TraceRecorder');
type TraceRecorderInstance = InstanceType<typeof TraceRecorder>;
type CDPSessionLike = import('@modules/trace/TraceRecorder').CDPSessionLike;

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

  beforeEach(async () => {
    currentTestDir = await mkdtemp(join(tmpdir(), 'trace-recorder-test-'));
    recorder = new TraceRecorder();
    eventBus = new EventBus<ServerEventMap>();
  });

  afterEach(async () => {
    if (recorder.getState() === 'recording') {
      try {
        recorder.stop();
      } catch {
        /* ok */
      }
    }

    // Attempt rm after slight delay to ensure DB handles closed
    await new Promise((r) => setTimeout(r, 10));
    await rm(currentTestDir, { recursive: true, force: true });
    currentTestDir = '';
  });

  it('starts recording and returns session', async () => {
    const session = await recorder.start(eventBus, null);

    expect(recorder.getState()).toBe('recording');
    expect(session.sessionId).toBeTruthy();
    expect(session.dbPath).toContain('.db');
    expect(session.startedAt).toBeGreaterThan(0);
  });

  it('rejects double start', async () => {
    await recorder.start(eventBus, null);

    await expect(recorder.start(eventBus, null)).rejects.toThrow(/Recording already in progress/);
  });

  it('records EventBus events', async () => {
    const _session = await recorder.start(eventBus, null);

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
    await recorder.start(eventBus, null);

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
    await recorder.start(eventBus, null);

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
    await recorder.start(eventBus, null);

    recorder.stop();

    // Events after stop should not be recorded — DB is closed
    expect(recorder.getState()).toBe('stopped');
    expect(recorder.getDB()).toBeNull();
  });

  it('stop returns final session with counts', async () => {
    await recorder.start(eventBus, null);

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
    expect(recorder.getSession()).toBeNull();

    await recorder.start(eventBus, null);
    expect(recorder.getState()).toBe('recording');

    // Check getSession mapping
    const sessionSnap = recorder.getSession();
    expect(sessionSnap).not.toBeNull();
    expect(sessionSnap!.sessionId).toBeDefined();

    recorder.stop();
    expect(recorder.getState()).toBe('stopped');
  });

  it('subscribes to CDP events and records them when emitted', async () => {
    const mockCdp = createMockCDPSession();
    await recorder.start(eventBus, mockCdp);

    // Verify CDP event listeners were registered
    expect(mockCdp._listeners.has('Debugger.paused')).toBe(true);
    expect(mockCdp._listeners.has('Network.requestWillBeSent')).toBe(true);

    // Simulate emitting a network request event
    const networkHandler = Array.from(mockCdp._listeners.get('Network.requestWillBeSent') || [])[0];
    if (networkHandler) {
      networkHandler({ requestId: '12345', timestamp: 1000.5 });
    }

    // Simulate emitting a Debugger.paused event with script info
    const pausedHandler = Array.from(mockCdp._listeners.get('Debugger.paused') || [])[0];
    if (pausedHandler) {
      pausedHandler({
        callFrames: [
          {
            location: { scriptId: '22', lineNumber: 42 },
          },
        ],
      });
    }

    // Simulate emitting an event with empty params
    if (networkHandler) {
      networkHandler(null);
    }

    recorder.stop();

    // Verify listeners were cleaned up
    for (const [, handlers] of mockCdp._listeners) {
      expect(handlers.size).toBe(0);
    }

    // Reopen DB to check if events were recorded
    const sessionSnap = recorder.getSession();
    const db = new TraceDB({ dbPath: sessionSnap!.dbPath });

    try {
      // 3 events should have been created (network, paused, network with null params)
      const result = db.query(
        "SELECT script_id, line_number FROM events WHERE category != 'other'",
      );
      expect(result.rowCount).toBe(3);

      // Verify Debugger.paused parsing
      const pausedRow = result.rows.find((r: unknown[]) => r[0] === '22');
      expect(pausedRow).toBeDefined();
      expect(pausedRow![1]).toBe(42);
    } finally {
      db.close();
    }
  });

  it('captures a heap snapshot via CDP', async () => {
    const mockCdp = createMockCDPSession();
    await recorder.start(eventBus, mockCdp);

    // Provide mocked chunk handling
    const snapshotContent = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: [
            'type',
            'name',
            'id',
            'self_size',
            'edge_count',
            'trace_node_id',
            'detachedness',
          ],
          node_types: [
            [
              'hidden',
              'array',
              'string',
              'object',
              'code',
              'closure',
              'regexp',
              'number',
              'native',
              'synthetic',
              'concatenated string',
              'sliced string',
              'symbol',
              'bigint',
            ],
          ],
        },
        node_count: 2,
      },
      nodes: [
        0,
        0,
        1,
        10,
        0,
        0,
        0, // mock node 1
        1,
        1,
        2,
        20,
        0,
        0,
        0, // mock node 2
      ],
      strings: ['testRoot1', 'testArray1'],
    });

    // Instead of actually emitting during `captureHeapSnapshot`, we can hook
    // the mocked send to manually trigger the event handler when takeHeapSnapshot is called
    let chunkHandlerCalled = false;
    mockCdp.send = vi.fn().mockImplementation(async (method) => {
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        // Emit chunks to simulate CDP
        const handler = Array.from(
          mockCdp._listeners.get('HeapProfiler.addHeapSnapshotChunk') || [],
        )[0];
        if (handler) {
          handler({ chunk: snapshotContent.substring(0, 50) });
          handler({ chunk: snapshotContent.substring(50) });
          chunkHandlerCalled = true;
        }
      }
      return {};
    });

    await recorder.captureHeapSnapshot(mockCdp);
    expect(chunkHandlerCalled).toBe(true);

    const db = recorder.getDB()!;
    const snapshots = db.getHeapSnapshots();
    expect(snapshots).toHaveLength(1);
    const summary = JSON.parse(snapshots[0]!.summary);
    expect(summary.totalSize).toBe(30); // 10 + 20
    expect(summary.nodeCount).toBe(2);
  });

  it('handles captureHeapSnapshot with invalid JSON chunks safely', async () => {
    const mockCdp = createMockCDPSession();
    await recorder.start(eventBus, mockCdp);

    mockCdp.send = vi.fn().mockImplementation(async (method) => {
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        const handler = Array.from(
          mockCdp._listeners.get('HeapProfiler.addHeapSnapshotChunk') || [],
        )[0];
        if (handler) {
          // Send malformed JSON
          handler({ chunk: '{ invalid: json' });
        }
      }
      return {};
    });

    await recorder.captureHeapSnapshot(mockCdp);

    const db = recorder.getDB()!;
    const snapshots = db.getHeapSnapshots();
    expect(snapshots).toHaveLength(1);
    const summary = JSON.parse(snapshots[0]!.summary);
    expect(summary.totalSize).toBe(0);
    expect(summary.nodeCount).toBe(0);
  });

  it('handles captureHeapSnapshot with valid JSON but missing snapshot info', async () => {
    const mockCdp = createMockCDPSession();
    await recorder.start(eventBus, mockCdp);

    mockCdp.send = vi.fn().mockImplementation(async (method) => {
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        const handler = Array.from(
          mockCdp._listeners.get('HeapProfiler.addHeapSnapshotChunk') || [],
        )[0];
        if (handler) {
          // Send valid JSON missing the 'snapshot' key
          handler({ chunk: '{"otherData": true}' });
        }
      }
      return {};
    });

    await recorder.captureHeapSnapshot(mockCdp);

    const db = recorder.getDB()!;
    const snapshots = db.getHeapSnapshots();
    expect(snapshots).toHaveLength(1);
    const summary = JSON.parse(snapshots[0]!.summary);
    expect(summary.totalSize).toBe(0);
    expect(summary.nodeCount).toBe(0);
  });

  it('throws capturing heap snapshot when not recording', async () => {
    const mockCdp = createMockCDPSession();
    await expect(recorder.captureHeapSnapshot(mockCdp)).rejects.toThrow(
      /Cannot capture heap snapshot: not recording/,
    );
  });
});
