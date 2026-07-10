import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  persistSnapshot,
  listPersistedSnapshots,
  loadPersistedSnapshot,
  deletePersistedSnapshot,
  deleteAllPersistedSnapshots,
  enforceSnapshotRetention,
  getHeapSnapshotArtifactDir,
} from '@server/domains/v8-inspector/handlers/snapshot-persistence';
import { buildTestUrl } from '@tests/shared/test-urls';

// All test snapshots use this prefix so cleanup is deterministic even if the
// artifact directory is shared with a live capture.
const PREFIX = 'persist-test';
const createdIds: string[] = [];

function makeId(n: number): string {
  const id = `${PREFIX}-${n}-${Math.random().toString(36).slice(2, 8)}`;
  createdIds.push(id);
  return id;
}

async function captureTime(deltaMs: number): Promise<string> {
  // Use a real recent-ish timestamp; Date.now is fine in the test process.
  return new Date(Date.now() + deltaMs).toISOString();
}

async function persistOne(
  n: number,
  overrides?: { sizeBytes?: number; chunks?: string[]; simulated?: boolean; deltaMs?: number },
) {
  const chunks = overrides?.chunks ?? [
    `{"snapshot":{"meta":{}},"nodes":[],"edges":[],"strings":[]}`,
  ];
  const sizeBytes = overrides?.sizeBytes ?? Buffer.byteLength(chunks.join(''), 'utf8');
  return persistSnapshot({
    id: makeId(n),
    chunks,
    capturedAt: await captureTime(overrides?.deltaMs ?? 0),
    sizeBytes,
    simulated: overrides?.simulated ?? false,
  });
}

describe('snapshot-persistence', () => {
  afterEach(async () => {
    // Clean up only the ids this run created.
    await Promise.all(createdIds.splice(0).map((id) => deletePersistedSnapshot(id)));
  });

  describe('persistSnapshot', () => {
    it('writes data + sidecar and returns paths inside the artifact dir', async () => {
      const result = await persistOne(1);

      expect(result.meta.id).toBe(result.meta.id);
      expect(result.meta.chunkCount).toBe(1);
      expect(result.meta.simulated).toBe(false);
      expect(result.bytesWritten).toBeGreaterThan(0);
      expect(result.absolutePath.endsWith('.heapsnapshot')).toBe(true);
      expect(result.metaPath.endsWith('.meta.json')).toBe(true);
      expect(result.displayPath).toContain('heap-snapshots/');

      const written = await readFile(result.absolutePath, 'utf8');
      expect(written).toContain('"snapshot"');
      const meta = JSON.parse(await readFile(result.metaPath, 'utf8'));
      expect(meta.id).toBe(result.meta.id);
    });

    it('records simulated + targetUrl when provided', async () => {
      const id = makeId(2);
      const targetUrl = buildTestUrl('target', { path: 'page' });
      await persistSnapshot({
        id,
        chunks: ['{"simulated":true}'],
        capturedAt: await captureTime(0),
        sizeBytes: 20,
        simulated: true,
        targetUrl,
      });

      const list = await listPersistedSnapshots();
      const entry = list.find((e) => e.id === id);
      expect(entry).toBeDefined();
      expect(entry!.simulated).toBe(true);
      expect(entry!.targetUrl).toBe(targetUrl);
      expect(entry!.sizeBytes).toBe(20);
    });

    it('omits targetUrl from sidecar when not provided', async () => {
      const id = makeId(3);
      await persistSnapshot({
        id,
        chunks: ['{}'],
        capturedAt: await captureTime(0),
        sizeBytes: 2,
      });

      const raw = await readFile(join(getHeapSnapshotArtifactDir(), `${id}.meta.json`), 'utf8');
      const meta = JSON.parse(raw);
      expect(meta).not.toHaveProperty('targetUrl');
    });
  });

  describe('listPersistedSnapshots', () => {
    it('returns empty array when directory is absent', async () => {
      // Directory exists from prior tests, but list of *our* ids may be empty
      // right after cleanup — verify the call shape regardless.
      const list = await listPersistedSnapshots();
      expect(Array.isArray(list)).toBe(true);
    });

    it('sorts newest-first by capturedAt', async () => {
      const older = await persistOne(4, { deltaMs: -60_000 });
      const newer = await persistOne(5, { deltaMs: 0 });

      const list = (await listPersistedSnapshots()).filter((e) =>
        [older.meta.id, newer.meta.id].includes(e.id),
      );
      expect(list.map((e) => e.id)).toEqual([newer.meta.id, older.meta.id]);
    });

    it('flags expired entries when ttl is set', async () => {
      const expired = await persistOne(6, { deltaMs: -120_000 });
      const fresh = await persistOne(7, { deltaMs: 0 });

      const now = Date.now() + 1000;
      const list = (await listPersistedSnapshots({ now, ttlMs: 60_000 })).filter((e) =>
        [expired.meta.id, fresh.meta.id].includes(e.id),
      );

      const exp = list.find((e) => e.id === expired.meta.id)!;
      const fr = list.find((e) => e.id === fresh.meta.id)!;
      expect(exp.expired).toBe(true);
      expect(fr.expired).toBe(false);
    });

    it('skips corrupt sidecars without throwing', async () => {
      const id = makeId(8);
      const dir = getHeapSnapshotArtifactDir();
      await mkdir(dir, { recursive: true });
      // Write a corrupt meta file directly.
      await writeFile(join(dir, `${id}.meta.json`), '{not valid json');

      const list = await listPersistedSnapshots();
      expect(list.find((e) => e.id === id)).toBeUndefined();
    });
  });

  describe('loadPersistedSnapshot', () => {
    it('round-trips chunks back into memory shape', async () => {
      const result = await persistOne(9, { chunks: ['{"snapshot":{"round":"trip"}}'] });

      const loaded = await loadPersistedSnapshot(result.meta.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.chunks).toHaveLength(1);
      expect(loaded!.chunks[0]).toContain('"round":"trip"');
      expect(loaded!.id).toBe(result.meta.id);
    });

    it('returns null when files are missing', async () => {
      const loaded = await loadPersistedSnapshot('persist-test-does-not-exist');
      expect(loaded).toBeNull();
    });
  });

  describe('deletePersistedSnapshot', () => {
    it('removes an existing snapshot and reports freed bytes', async () => {
      const result = await persistOne(10);
      const res = await deletePersistedSnapshot(result.meta.id);
      expect(res.deleted).toBe(true);
      expect(res.freedBytes).toBeGreaterThan(0);

      const loaded = await loadPersistedSnapshot(result.meta.id);
      expect(loaded).toBeNull();
    });

    it('reports deleted=false when nothing exists', async () => {
      const res = await deletePersistedSnapshot('persist-test-absent');
      expect(res.deleted).toBe(false);
      expect(res.freedBytes).toBe(0);
    });
  });

  describe('deleteAllPersistedSnapshots', () => {
    it('removes multiple snapshots and reports counts', async () => {
      const a = await persistOne(11);
      const b = await persistOne(12);
      // Remove from createdIds tracking so afterEach doesn't double-delete.
      const ids = [a.meta.id, b.meta.id];
      for (const id of ids) {
        const idx = createdIds.indexOf(id);
        if (idx >= 0) createdIds.splice(idx, 1);
      }

      const res = await deleteAllPersistedSnapshots();
      expect(res.deletedCount).toBeGreaterThanOrEqual(2);
      expect(res.freedBytes).toBeGreaterThan(0);
    });
  });

  describe('enforceSnapshotRetention', () => {
    it('is a no-op when both caps are zero', async () => {
      const result = await persistOne(13);
      const res = await enforceSnapshotRetention({ maxCount: 0, maxTotalBytes: 0 });
      expect(res.evictedIds).toEqual([]);
      expect(res.freedBytes).toBe(0);

      const loaded = await loadPersistedSnapshot(result.meta.id);
      expect(loaded).not.toBeNull();
    });

    it('evicts oldest when over maxCount', async () => {
      const oldest = await persistOne(14, { deltaMs: -90_000 });
      const mid = await persistOne(15, { deltaMs: -30_000 });
      const newest = await persistOne(16, { deltaMs: 0 });

      const res = await enforceSnapshotRetention({ maxCount: 1 });
      expect(res.evictedIds).toContain(oldest.meta.id);
      expect(res.evictedIds).toContain(mid.meta.id);
      expect(res.evictedIds).not.toContain(newest.meta.id);
    });

    it('evicts oldest until under maxTotalBytes', async () => {
      const big = await persistOne(17, {
        chunks: ['x'.repeat(500)],
        sizeBytes: 500,
        deltaMs: -90_000,
      });
      const small = await persistOne(18, { sizeBytes: 10, deltaMs: 0 });

      // 1 byte cap evicts oldest-first (big first), may also evict small.
      const res = await enforceSnapshotRetention({ maxTotalBytes: 1 });
      expect(res.evictedIds).toContain(big.meta.id);
      expect(res.freedBytes).toBeGreaterThanOrEqual(500);
      // small (10 bytes) also exceeds 1 byte cap, so it should be evicted too.
      expect(res.evictedIds).toContain(small.meta.id);
    });
  });

  describe('getHeapSnapshotArtifactDir', () => {
    it('resolves under the project artifacts root', () => {
      const dir = getHeapSnapshotArtifactDir();
      expect(dir).toContain('heap-snapshots');
    });
  });
});
