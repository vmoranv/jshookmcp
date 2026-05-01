import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { RuntimeSnapshotScheduler } from '@server/persistence/RuntimeSnapshotScheduler';
import { StateBoardStore } from '@server/domains/shared-state-board/handlers/shared';
import { SharedStateBoardHandlers } from '@server/domains/shared-state-board/index';
import { ReverseEvidenceGraph, resetIdCounter } from '@server/evidence/ReverseEvidenceGraph';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

async function makeTmpDir(): Promise<string> {
  const dir = resolve(
    tmpdir(),
    `snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error('condition not met before timeout');
}

describe('RuntimeSnapshotScheduler', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  it('writes dirty sources to disk on flushAll', async () => {
    const scheduler = new RuntimeSnapshotScheduler();
    const store = new StateBoardStore();
    const filePath = resolve(tmpDir, 'state-board', 'current.json');
    scheduler.register(filePath, store);

    // Mutate store to make it dirty
    store.state.set('test:key', {
      key: 'key',
      value: 'hello',
      namespace: 'test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    });
    // Bump mutationSeq by calling recordChange
    store.recordChange('test:key', {
      id: '1',
      key: 'key',
      namespace: 'test',
      action: 'set',
      newValue: 'hello',
      timestamp: Date.now(),
    });

    expect(store.isPersistDirty()).toBe(true);

    await scheduler.flushAll();

    // Read back the file
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(data.schemaVersion).toBe(1);
    expect(data.entries).toHaveLength(1);
    expect(store.isPersistDirty()).toBe(false);
    expect(store.getLastPersistedSeq()).toBe(store.getSnapshotSeq());
  });

  it('restores state from disk on start', async () => {
    const filePath = resolve(tmpDir, 'evidence-graph', 'current.json');

    // Write a snapshot manually
    const graph = new ReverseEvidenceGraph();
    resetIdCounter();
    graph.addNode('request', 'https://example.com', { url: 'https://example.com' });
    const snapshot = graph.exportSnapshot();
    await mkdir(resolve(tmpDir, 'evidence-graph'), { recursive: true });
    await writeFile(filePath, JSON.stringify(snapshot), 'utf-8');

    // Start a new scheduler with a fresh graph
    const freshGraph = new ReverseEvidenceGraph();
    resetIdCounter();
    expect(freshGraph.nodeCount).toBe(0);

    const scheduler = new RuntimeSnapshotScheduler();
    scheduler.register(filePath, freshGraph);
    await scheduler.start();

    // Graph should have been restored
    expect(freshGraph.nodeCount).toBe(1);
    scheduler.dispose();
  });

  it('restores state for sources registered after start', async () => {
    const filePath = resolve(tmpDir, 'late-register', 'current.json');

    const graph = new ReverseEvidenceGraph();
    resetIdCounter();
    graph.addNode('request', 'https://late.example', { url: 'https://late.example' });
    await mkdir(resolve(tmpDir, 'late-register'), { recursive: true });
    await writeFile(filePath, JSON.stringify(graph.exportSnapshot()), 'utf-8');

    const scheduler = new RuntimeSnapshotScheduler();
    await scheduler.start();

    const freshGraph = new ReverseEvidenceGraph();
    scheduler.register(filePath, freshGraph);

    await waitForCondition(() => freshGraph.nodeCount === 1);
    scheduler.dispose();
  });

  it('skips duplicate registrations for the same source and path', async () => {
    const filePath = resolve(tmpDir, 'duplicate', 'current.json');
    await mkdir(resolve(tmpDir, 'duplicate'), { recursive: true });
    await writeFile(filePath, JSON.stringify({ ok: true }), 'utf-8');

    const restoreSnapshot = vi.fn();
    const source = {
      isPersistDirty: () => false,
      exportSnapshot: () => ({}),
      restoreSnapshot,
      markPersisted: () => undefined,
    };

    const scheduler = new RuntimeSnapshotScheduler();
    await scheduler.start();
    scheduler.register(filePath, source);
    scheduler.register(filePath, source);

    await waitForCondition(() => restoreSnapshot.mock.calls.length === 1);
    expect(restoreSnapshot).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('skips clean sources during flush', async () => {
    const scheduler = new RuntimeSnapshotScheduler();
    const store = new StateBoardStore();
    const filePath = resolve(tmpDir, 'skip', 'current.json');
    scheduler.register(filePath, store);

    // Not dirty — flush should not write
    expect(store.isPersistDirty()).toBe(false);
    await scheduler.flushAll();

    await expect(readFile(filePath, 'utf-8')).rejects.toThrow();
  });

  it('dispose stops periodic timer', async () => {
    const scheduler = new RuntimeSnapshotScheduler({ periodicMs: 50 });
    await scheduler.start();
    scheduler.dispose();
    // Should not throw or hang
  });
});

describe('StateBoardStore snapshot', () => {
  it('export and restore roundtrip', () => {
    const store = new StateBoardStore();
    store.state.set('ns:key1', {
      key: 'key1',
      value: { data: 42 },
      namespace: 'ns',
      createdAt: 1000,
      updatedAt: 1000,
      version: 1,
    });
    store.state.set('ns:key2', {
      key: 'key2',
      value: 'hello',
      namespace: 'ns',
      createdAt: 2000,
      updatedAt: 2000,
      version: 1,
    });

    const snapshot = store.exportSnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.entries).toHaveLength(2);

    const restored = new StateBoardStore();
    restored.restoreSnapshot(snapshot);
    expect(restored.state.size).toBe(2);
    expect(restored.state.get('ns:key1')?.value).toEqual({ data: 42 });
  });

  it('skips expired entries on restore', () => {
    const store = new StateBoardStore();
    store.state.set('ns:expired', {
      key: 'expired',
      value: 'old',
      namespace: 'ns',
      createdAt: 1000,
      updatedAt: 1000,
      ttlSeconds: 1,
      expiresAt: Date.now() - 10000, // already expired
      version: 1,
    });

    const snapshot = store.exportSnapshot();
    const restored = new StateBoardStore();
    restored.restoreSnapshot(snapshot);
    expect(restored.state.size).toBe(0);
  });

  it('ignores invalid snapshot data', () => {
    const store = new StateBoardStore();
    store.restoreSnapshot(null);
    store.restoreSnapshot({ schemaVersion: 99 });
    store.restoreSnapshot('not an object');
    expect(store.state.size).toBe(0);
  });

  it('notifies persist listener for set/import/delete mutations', async () => {
    const notifyDirty = vi.fn();
    const handlers = new SharedStateBoardHandlers();
    handlers.setPersistNotifier(notifyDirty);

    await handlers.handleSet({ key: 'alpha', value: 1 });
    await handlers.handleIODispatch({ action: 'import', data: { beta: 2 } });
    await handlers.handleDelete({ key: 'alpha' });

    expect(handlers.getStore().isPersistDirty()).toBe(true);
    expect(notifyDirty).toHaveBeenCalledTimes(3);
  });
});

describe('ReverseEvidenceGraph snapshot', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it('export and restore roundtrip', () => {
    const graph = new ReverseEvidenceGraph();
    const node1 = graph.addNode('request', 'https://test.com', { url: 'https://test.com' });
    graph.addNode('function', 'onClick', { functionName: 'onClick' });
    graph.addEdge(node1.id, 'function-2', 'initiates');

    const snapshot = graph.exportSnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.graph.nodes).toHaveLength(2);
    expect(snapshot.graph.edges).toHaveLength(1);

    const restored = new ReverseEvidenceGraph();
    resetIdCounter();
    restored.restoreSnapshot(snapshot);
    expect(restored.nodeCount).toBe(2);
    expect(restored.edgeCount).toBe(1);
    expect(restored.isPersistDirty()).toBe(false);
  });

  it('ignores invalid snapshot data', () => {
    const graph = new ReverseEvidenceGraph();
    graph.restoreSnapshot(null);
    graph.restoreSnapshot({ schemaVersion: 2 });
    graph.restoreSnapshot('bad');
    expect(graph.nodeCount).toBe(0);
  });

  it('mutationSeq tracking works', () => {
    const graph = new ReverseEvidenceGraph();
    expect(graph.getSnapshotSeq()).toBe(0);
    expect(graph.isPersistDirty()).toBe(false);

    graph.addNode('request', 'test', {});
    expect(graph.getSnapshotSeq()).toBe(1);
    expect(graph.isPersistDirty()).toBe(true);

    graph.markPersisted();
    expect(graph.isPersistDirty()).toBe(false);
    expect(graph.getLastPersistedSeq()).toBe(1);
  });

  it('notifies persist listener on graph mutations', () => {
    const notifyDirty = vi.fn();
    const graph = new ReverseEvidenceGraph();
    graph.setPersistNotifier(notifyDirty);

    const request = graph.addNode('request', 'https://graph.example', {});
    const fn = graph.addNode('function', 'handler', {});
    graph.addEdge(request.id, fn.id, 'initiates');
    graph.removeNode(fn.id);

    expect(graph.isPersistDirty()).toBe(true);
    expect(notifyDirty).toHaveBeenCalledTimes(4);
  });
});
