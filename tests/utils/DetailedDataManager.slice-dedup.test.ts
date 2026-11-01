import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DetailedDataManager } from '@utils/DetailedDataManager';

describe('DetailedDataManager CAS Deduplication & DA Slice Sampling', () => {
  let manager: DetailedDataManager;

  beforeEach(() => {
    manager = DetailedDataManager.getInstance();
  });

  afterEach(async () => {
    await manager.shutdownAsync();
  });

  describe('CAS Deduplication', () => {
    it('reuses existing detailId when deduplicate=true for identical payloads', async () => {
      const payload = { test: 'cas_dedup', numbers: [1, 2, 3, 4, 5] };
      const id1 = await manager.storeDeduped(payload);
      const id2 = await manager.storeDeduped(payload);

      expect(id1).toBe(id2);
      const stats = manager.getStats();
      expect(stats.metrics.dedupHitCount).toBeGreaterThanOrEqual(1);
    });

    it('generates distinct detailIds when deduplicate=false', async () => {
      const payload = { test: 'no_dedup', val: Math.random() };
      const id1 = await manager.store(payload);
      const id2 = await manager.store(payload);

      expect(id1).not.toBe(id2);
    });
  });

  describe('DA Slice Sampling (retrieveSliceAsync)', () => {
    it('slices an array by offset and limit', async () => {
      const arr = Array.from({ length: 50 }, (_, i) => ({ index: i, text: `item_${i}` }));
      const detailId = await manager.store(arr);

      const slice = await manager.retrieveSliceAsync(detailId, { offset: 10, limit: 5 });
      expect(slice.total).toBe(50);
      expect(slice.offset).toBe(10);
      expect(slice.limit).toBe(5);
      expect(slice.hasMore).toBe(true);
      expect(Array.isArray(slice.data)).toBe(true);
      expect(slice.data).toHaveLength(5);
      expect((slice.data as any)[0]).toEqual({ index: 10, text: 'item_10' });
      expect((slice.data as any)[4]).toEqual({ index: 14, text: 'item_14' });
    });

    it('slices a string by character offset and limit', async () => {
      const text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const detailId = await manager.store(text);

      const slice = await manager.retrieveSliceAsync(detailId, { offset: 10, limit: 6 });
      expect(slice.total).toBe(text.length);
      expect(slice.offset).toBe(10);
      expect(slice.limit).toBe(6);
      expect(slice.hasMore).toBe(true);
      expect(slice.data).toBe('KLMNOP');
    });

    it('slices an object by property keys', async () => {
      const obj: Record<string, number> = {};
      for (let i = 0; i < 20; i++) obj[`key_${i}`] = i;
      const detailId = await manager.store(obj);

      const slice = await manager.retrieveSliceAsync(detailId, { offset: 5, limit: 3 });
      expect(slice.total).toBe(20);
      expect(slice.offset).toBe(5);
      expect(slice.limit).toBe(3);
      expect(slice.hasMore).toBe(true);
      expect(Object.keys(slice.data as object)).toEqual(['key_5', 'key_6', 'key_7']);
    });

    it('slices nested array via path option', async () => {
      const payload = {
        meta: { ok: true },
        results: Array.from({ length: 100 }, (_, i) => `hit_${i}`),
      };
      const detailId = await manager.store(payload);

      const slice = await manager.retrieveSliceAsync(detailId, {
        path: 'results',
        offset: 0,
        limit: 10,
      });

      expect(slice.total).toBe(100);
      expect(slice.limit).toBe(10);
      expect(slice.hasMore).toBe(true);
      expect(slice.data as string[]).toHaveLength(10);
      expect((slice.data as string[])[0]).toBe('hit_0');
      expect((slice.data as string[])[9]).toBe('hit_9');
    });
  });
});
