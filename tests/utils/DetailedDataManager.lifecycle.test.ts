/**
 * Lifecycle tests for DetailedDataManager disk hygiene and async retrieval:
 * - a2-03/a3-05: periodic cleanup + LRU eviction must unlink persisted files
 *   and compact .metadata.jsonl (previously memory-only removal).
 * - a2-04: retrieveAsync lazy-loads gzip-persisted entries without blocking
 *   the event loop; sync retrieve() stays as a compatibility layer.
 * - a3-06: the persist path is bounded — a saturated write queue degrades the
 *   entry to memory-only and counts it in persistDeferredCount.
 *
 * Uses real timers + a tmp artifact dir (pattern from
 * tests/modules/detailed-data-manager.test.ts) because these paths exercise
 * real fs promises.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `detailed-data-lifecycle-${Date.now()}`);

vi.mock('@utils/artifacts', () => ({
  getArtifactDir: (sub: string) => join(TEST_DIR, sub),
}));

const PERSIST_DIR = join(TEST_DIR, 'tmp', 'detailed-data');
const METADATA_PATH = join(PERSIST_DIR, '.metadata.jsonl');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `cond` until it returns true, failing after `timeoutMs`.
 * A throwing cond (e.g. ENOENT while the manager's fire-and-forget init()
 * is still creating the metadata file — the Linux CI timing) counts as
 * "not yet" and keeps polling instead of failing the test.
 */
async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  for (;;) {
    let satisfied = false;
    try {
      satisfied = cond();
    } catch {
      satisfied = false;
    }
    if (satisfied) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await sleep(25);
  }
}

describe('DetailedDataManager disk lifecycle', () => {
  let manager: DetailedDataManager;

  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(PERSIST_DIR, { recursive: true });
    manager = new DetailedDataManager();
    // Allow the fire-and-forget init() (mkdir + load + cleanupExpired) to settle.
    await sleep(150);
  });

  afterEach(async () => {
    manager.shutdown();
    vi.restoreAllMocks();
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('cleanup unlinks persisted files and removes them from metadata (a2-03/a3-05)', async () => {
    const id = await manager.store({ expired: true }, 100);
    const persistPath = join(PERSIST_DIR, `${id}.json`);

    // Persist + metadata append both complete before the entry expires.
    await waitFor(() => existsSync(persistPath));
    await waitFor(() => readFileSync(METADATA_PATH, 'utf-8').includes(id));

    await sleep(120); // TTL passes
    (manager as any).cleanup();

    // Cache removal stays synchronous; disk cleanup follows fire-and-forget.
    expect(manager.getStats().cacheSize).toBe(0);
    await waitFor(() => !existsSync(persistPath));
    await waitFor(() => !readFileSync(METADATA_PATH, 'utf-8').includes(id));
  });

  it('cleanup keeps live entries and their files untouched', async () => {
    const keep = await manager.store({ keep: true }, 60_000);
    const drop = await manager.store({ drop: true }, 100);
    await waitFor(() => existsSync(join(PERSIST_DIR, `${keep}.json`)));
    await waitFor(() => existsSync(join(PERSIST_DIR, `${drop}.json`)));

    await sleep(120);
    (manager as any).cleanup();
    await waitFor(() => !existsSync(join(PERSIST_DIR, `${drop}.json`)));

    expect(manager.retrieve(keep)).toEqual({ keep: true });
    expect(() => manager.retrieve(drop)).toThrow('expired');
    await waitFor(() => {
      const meta = readFileSync(METADATA_PATH, 'utf-8');
      return meta.includes(keep) && !meta.includes(drop);
    });
  });

  it('evictLRU unlinks the evicted entry persisted file (a2-03)', async () => {
    const first = await manager.store({ first: true });
    await waitFor(() => existsSync(join(PERSIST_DIR, `${first}.json`)));
    await waitFor(() => readFileSync(METADATA_PATH, 'utf-8').includes(first));

    for (let i = 0; i < 100; i++) {
      await manager.store({ i });
      await sleep(1);
    }

    // The 101st store evicted `first` (oldest lastAccessedAt).
    await waitFor(() => !existsSync(join(PERSIST_DIR, `${first}.json`)));
    expect(() => manager.retrieve(first)).toThrow('not found or expired');
    // Metadata must be compacted so the id never resurfaces on restart.
    await waitFor(() => !readFileSync(METADATA_PATH, 'utf-8').includes(first));
  });

  it('retrieveAsync lazily loads a gzip-persisted entry after restart (a2-04)', async () => {
    const large = { payload: 'x'.repeat(5000) };
    const id = await manager.store(large, 60_000);
    await waitFor(() => existsSync(join(PERSIST_DIR, `${id}.gz`)));
    await waitFor(() => readFileSync(METADATA_PATH, 'utf-8').includes(id));
    manager.shutdown();

    // "Restart": a fresh manager hydrates the entry lazily (data: null).
    const revived = new DetailedDataManager();
    await sleep(150);

    const data = await revived.retrieveAsync(id);
    expect(data).toEqual(large);
    expect(revived.getStats().metrics.diskReadLazyCount).toBe(1);
    expect(revived.getStats().metrics.gzipDecompressCount).toBe(1);

    // The sync compatibility path still works for lazy entries too.
    const syncData = revived.retrieve(id);
    expect(syncData).toEqual(large);

    revived.shutdown();
  });

  it('retrieveAsync behaves like retrieve for in-memory entries', async () => {
    const id = await manager.store({ nested: { value: 42 } });

    expect(await manager.retrieveAsync(id)).toEqual({ nested: { value: 42 } });
    expect(await manager.retrieveAsync(id, 'nested.value')).toBe(42);
    await expect(manager.retrieveAsync('missing')).rejects.toThrow('not found or expired');
  });

  it('defers persistence to memory-only when the write queue is saturated (a3-06)', async () => {
    // Simulate a saturated queue: MAX_PENDING_PERSISTS writes in flight.
    (manager as any).pendingPersistCount = 8;

    const id = await manager.store({ big: 'x'.repeat(500) }, 60_000);

    // Degradation is synchronous: counted, memory-only, still retrievable.
    expect(manager.getStats().metrics.persistDeferredCount).toBe(1);
    expect(manager.retrieve(id)).toEqual({ big: 'x'.repeat(500) });
    expect(manager.getStats().persistence.persistedCount).toBe(0);
  });

  it('pendingPersistCount drains back to zero after writes complete', async () => {
    const id = await manager.store({ drain: true });
    await waitFor(() => existsSync(join(PERSIST_DIR, `${id}.json`)));
    await waitFor(() => (manager as any).pendingPersistCount === 0);
    expect(manager.getStats().metrics.diskWriteCount).toBe(1);
    expect(manager.getStats().metrics.persistDeferredCount).toBe(0);
  });

  it('retrieveAsync expired path fire-and-forgets disk cleanup (maintenance never blocks access)', async () => {
    const id = await manager.store({ short: true }, 100);
    const persistPath = join(PERSIST_DIR, `${id}.json`);
    await waitFor(() => existsSync(persistPath));
    await waitFor(() => readFileSync(METADATA_PATH, 'utf-8').includes(id));

    await sleep(120);
    await expect(manager.retrieveAsync(id)).rejects.toThrow('expired');

    // The throw happened without waiting for maintenance; unlink + metadata
    // compaction still complete asynchronously.
    await waitFor(() => !existsSync(persistPath));
    await waitFor(() => !readFileSync(METADATA_PATH, 'utf-8').includes(id));
  });

  it('discardPersistedEntries is a no-op after shutdown', async () => {
    const id = await manager.store({ a: 1 });
    await waitFor(() => existsSync(join(PERSIST_DIR, `${id}.json`)));
    manager.shutdown();
    await (manager as any).discardPersistedEntries([
      { persistPath: join(PERSIST_DIR, `${id}.json`) },
    ]);
    // The file survives: the disposed guard must skip the unlink.
    expect(existsSync(join(PERSIST_DIR, `${id}.json`))).toBe(true);
  });

  it('skips the metadata append when the entry is evicted mid-persist (NIT-5 ghost row)', async () => {
    // Gate the disk write so the persist completes only after we evict the
    // entry, reproducing the "persist in flight while cleanup evicts" interleave.
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    const realPersistToDisk = (manager as any).persistToDisk.bind(manager);
    vi.spyOn(manager as any, 'persistToDisk').mockImplementation(
      async (filePath: unknown, json: unknown, compress: unknown) => {
        await writeGate;
        return realPersistToDisk(filePath as string, json as string, compress as boolean);
      },
    );

    const id = await manager.store({ ghost: true });
    // Entry is cached and the write is in flight (gated).
    expect(manager.getStats().cacheSize).toBe(1);

    // Evict the entry while the write is still pending.
    (manager as any).cache.delete(id);

    // Release the write; the persist .then() must observe the entry is gone
    // and skip appendMetadata instead of appending a ghost metadata line.
    releaseWrite();
    await waitFor(() => (manager as any).pendingPersistCount === 0);
    await sleep(100); // let the persist .then() (append or skip) settle

    const meta = existsSync(METADATA_PATH) ? readFileSync(METADATA_PATH, 'utf-8') : '';
    expect(meta.includes(id)).toBe(false);
  });
});
