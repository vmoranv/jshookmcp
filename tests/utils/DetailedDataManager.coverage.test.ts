import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { logger } from '@utils/logger';

/**
 * Coverage tests for DetailedDataManager the v8 ignore branches and
 * other hard-to-reach paths.
 */
describe('DetailedDataManager – v8 ignore branch coverage', () => {
  let manager: DetailedDataManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager = new DetailedDataManager();
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── serializeWithMemo ────────────────────────────────────────────────────

  it('serializeWithMemo caches identical object references', () => {
    const obj = { shared: true };
    const { json: json1, size: size1 } = (manager as any).serializeWithMemo(obj);
    const { json: json2, size: size2 } = (manager as any).serializeWithMemo(obj);
    expect(json1).toBe(json2); // Same reference returns same cached result
    expect(size1).toBe(size2);
  });

  it('serializeWithMemo does not cache primitives', () => {
    const { json: json1, size: size1 } = (manager as any).serializeWithMemo(null);
    const { json: json2, size: size2 } = (manager as any).serializeWithMemo(null);
    // null is not an object, so no memoization happens — new result each time
    expect(json1).toBe('null');
    expect(json2).toBe('null');
    expect(size1).toBe(size2);
  });

  // ── isRecord ──────────────────────────────────────────────────────────────

  it('isRecord correctly identifies records', () => {
    const isRecord = (v: unknown) => (manager as any).isRecord(v);
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord([1, 2])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord('string')).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(() => {})).toBe(false);
  });

  // ── readPathSegment ──────────────────────────────────────────────────────

  it('readPathSegment reads nested keys via Object() coercion', () => {
    const read = (v: unknown, k: string) => (manager as any).readPathSegment(v, k);
    expect(read({ a: 1 }, 'a')).toBe(1);
    expect(read({ a: { b: 2 } }, 'a')).toEqual({ b: 2 });
    expect(read([1, 2, 3], '1')).toBe(2);
    expect(read(42, 'toString')).toBe(42); // Object(42) coerces to Number wrapper
  });

  // ── getByPath ─────────────────────────────────────────────────────────────

  it('getByPath throws when path leads to null', () => {
    const id = manager.store({ a: null });
    expect(() => manager.retrieve(id, 'a.toString')).toThrow('Path not found');
  });

  it('getByPath throws when path leads to undefined', () => {
    const id = manager.store({ a: undefined });
    expect(() => manager.retrieve(id, 'a.b')).toThrow('Path not found');
  });

  it('getByPath handles dot-separated path segments', () => {
    const id = manager.store({ a: { b: { c: { d: 42 } } } });
    expect(manager.retrieve(id, 'a.b.c.d')).toBe(42);
  });

  it('getByPath handles path with numeric-looking keys on objects', () => {
    const id = manager.store({ '0': 'zero', '1': 'one' });
    expect(manager.retrieve(id, '0')).toBe('zero');
    expect(manager.retrieve(id, '1')).toBe('one');
  });

  it('getByPath handles empty path (returns root)', () => {
    const id = manager.store({ value: 123 });
    expect(manager.retrieve(id, '')).toEqual({ value: 123 });
  });

  // ── generateSummaryFromJson ──────────────────────────────────────────────

  it('generateSummaryFromJson handles arrays with structure info', () => {
    const arr = [1, 2, 3, 4, 5];
    const { json: jsonStr, size } = (manager as any).serializeWithMemo(arr);
    const summary = (manager as any).generateSummaryFromJson(arr, jsonStr, size);
    expect(summary.type).toBe('array');
    expect(summary.structure?.length).toBe(5);
  });

  it('generateSummaryFromJson handles primitives', () => {
    const { json: jsonStr, size } = (manager as any).serializeWithMemo(42);
    const summary = (manager as any).generateSummaryFromJson(42, jsonStr, size);
    expect(summary.type).toBe('number');
    expect(summary.structure).toBeUndefined();
  });

  it('generateSummaryFromJson handles objects with many keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      const key = 'key' + i;
      obj[key] = i;
      if (i < 5) {
        const methodKey = 'method' + i;
        (obj as any)[methodKey] = () => {};
      }
    }
    const { json: jsonStr, size } = (manager as any).serializeWithMemo(obj);
    const summary = (manager as any).generateSummaryFromJson(obj, jsonStr, size);
    expect(summary.structure?.keys?.length).toBe(50); // sliced to 50
    expect(summary.structure?.methods?.length).toBe(5); // sliced to 30
    expect(summary.structure?.properties?.length).toBe(50); // sliced to 30
  });

  // ── cleanup ──────────────────────────────────────────────────────────────

  it('cleanup logs nothing when cache is empty', () => {
    const debugSpy = vi.spyOn(logger, 'debug');
    (manager as any).cleanup();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('cleanup removes only expired entries', () => {
    const id1 = manager.store({ a: 1 }, 1000); // expires at t=1000
    const id2 = manager.store({ b: 2 }, 2000); // expires at t=2000

    vi.advanceTimersByTime(1500); // t=1500
    (manager as any).cleanup();

    // id1 should be gone, id2 should remain
    expect(() => manager.retrieve(id1)).toThrow();
    expect(manager.retrieve(id2)).toEqual({ b: 2 });
  });

  // ── evictLRU ─────────────────────────────────────────────────────────────

  it('evictLRU removes least recently accessed entry', () => {
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(manager.store({ i }));
      vi.advanceTimersByTime(1);
    }

    // Access the oldest entry to make it most recently used
    manager.retrieve(ids[0]!);

    // Add one more to trigger eviction
    const overflow = manager.store({ overflow: true });

    // ids[1] should have been evicted (it was the LRU after ids[0] was accessed)
    expect(() => manager.retrieve(ids[1]!)).toThrow();
    expect(manager.retrieve(ids[0]!)).toEqual({ 0: 0 });
    expect(manager.retrieve(overflow)).toEqual({ overflow: true });
  });

  it('evictLRU logs eviction info', () => {
    const infoSpy = vi.spyOn(logger, 'info');

    // Fill to 100 and access all to set lastAccessedAt
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(manager.store({ i }));
    }

    // Access oldest
    manager.retrieve(ids[0]!);
    vi.advanceTimersByTime(1);

    // Trigger eviction
    manager.store({ overflow: true });

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Evicted LRU entry'));
  });

  // ── extend ───────────────────────────────────────────────────────────────

  it('extend adds EXTEND_DURATION when no additionalTime provided', () => {
    const id = manager.store({ a: 1 }, 60_000); // 1 min TTL
    const before = manager.getDetailedStats().find((s) => s.detailId === id)!;
    const beforeTime = new Date(before.expiresAt).getTime();

    vi.advanceTimersByTime(59_000); // near expiry
    manager.extend(id);

    const after = manager.getDetailedStats().find((s) => s.detailId === id)!;
    const afterTime = new Date(after.expiresAt).getTime();

    // Should have been extended by 15 minutes (EXTEND_DURATION)
    expect(afterTime).toBeGreaterThan(beforeTime + 60_000);
  });

  it('extend uses MAX_TTL as upper bound', () => {
    const id = manager.store({ a: 1 }, 1000);
    // Try to extend by 1 year
    manager.extend(id, 365 * 24 * 60 * 60 * 1000);
    const stats = manager.getDetailedStats().find((s) => s.detailId === id)!;
    // expiresAt should be bounded by MAX_TTL (24h from now = t=86400000)
    const maxExpires = new Date('2025-01-02T00:00:00.000Z').getTime();
    expect(new Date(stats.expiresAt).getTime()).toBeLessThanOrEqual(maxExpires);
  });

  it('extend throws for missing detailId', () => {
    expect(() => manager.extend('nonexistent')).toThrow('not found');
  });

  it('extend throws for expired detailId', () => {
    const id = manager.store({ a: 1 }, 10);
    vi.advanceTimersByTime(11);
    expect(() => manager.extend(id)).toThrow('already expired');
  });

  // ── getStats ─────────────────────────────────────────────────────────────

  it('getStats computes average access count correctly', () => {
    const id1 = manager.store({ a: 1 });
    const id2 = manager.store({ b: 2 });
    manager.retrieve(id1);
    manager.retrieve(id1);
    manager.retrieve(id2);

    const stats = manager.getStats();
    expect(stats.cacheSize).toBe(2);
    expect(Number(stats.avgAccessCount)).toBeCloseTo(1.5, 1);
  });

  it('getStats returns correct cache size limits', () => {
    const stats = manager.getStats();
    expect(stats.maxCacheSize).toBe(100);
    expect(stats.defaultTTLSeconds).toBe(30 * 60); // 30 minutes
    expect(stats.maxTTLSeconds).toBe(24 * 60 * 60); // 24 hours
    expect(stats.autoExtendEnabled).toBe(true);
    expect(stats.extendDurationSeconds).toBe(15 * 60); // 15 minutes
  });

  // ── getDetailedStats ────────────────────────────────────────────────────

  it('getDetailedStats returns empty array for empty cache', () => {
    expect(manager.getDetailedStats()).toEqual([]);
  });

  it('getDetailedStats marks expired entries correctly', () => {
    const id = manager.store({ a: 1 }, 10);
    vi.advanceTimersByTime(20);
    const stats = manager.getDetailedStats();
    expect(stats[0]?.isExpired).toBe(true);
    expect(stats[0]?.remainingSeconds).toBe(0);
  });

  it('getDetailedStats computes remaining seconds correctly', () => {
    const id = manager.store({ a: 1 }, 60_000); // 1 min TTL
    vi.advanceTimersByTime(30_000); // 30 seconds in
    const stats = manager.getDetailedStats();
    expect(stats[0]?.remainingSeconds).toBeGreaterThan(25);
    expect(stats[0]?.remainingSeconds).toBeLessThanOrEqual(30);
  });

  it('getDetailedStats returns entries sorted by lastAccessedAt descending', () => {
    const id1 = manager.store({ first: true });
    vi.advanceTimersByTime(1000);
    const id2 = manager.store({ second: true });
    vi.advanceTimersByTime(1000);

    // Access id1 to make it most recently used
    manager.retrieve(id1);

    const stats = manager.getDetailedStats();
    expect(stats[0]!.detailId).toBe(id1);
    expect(stats[1]!.detailId).toBe(id2);
  });

  // ── smartHandle ──────────────────────────────────────────────────────────

  it('smartHandle returns data directly when under threshold', () => {
    const small = { value: 123 };
    const result = manager.smartHandle(small, 1000);
    expect(result).toBe(small);
  });

  it('smartHandle returns DetailedDataResponse when over threshold', () => {
    const large = { text: 'x'.repeat(5000) };
    const result = manager.smartHandle(large, 100) as {
      detailId: string;
      summary: { size: number };
      hint: string;
      expiresAt: number;
    };
    expect(result.detailId).toMatch(/^detail_/);
    expect(result.summary.size).toBeGreaterThan(100);
    expect(result.hint).toContain(result.detailId);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('smartHandle handles null and undefined directly', () => {
    expect(manager.smartHandle(null)).toBeNull();
    expect(manager.smartHandle(undefined)).toBeUndefined();
  });

  it('smartHandle handles arrays correctly', () => {
    const arr = [1, 2, 3];
    const under = manager.smartHandle(arr, 1000) as unknown[];
    expect(under).toBe(arr);

    const largeArr = Array.from({ length: 1000 }, (_, i) => ({ i }));
    const over = manager.smartHandle(largeArr, 50) as { detailId: string };
    expect(over.detailId).toMatch(/^detail_/);
  });

  // ── store / retrieve lifecycle ───────────────────────────────────────────

  it('store uses customTTL when provided', () => {
    const id = manager.store({ a: 1 }, 5000);
    const stats = manager.getDetailedStats().find((s) => s.detailId === id)!;
    expect(stats.remainingSeconds).toBeLessThanOrEqual(6);
    expect(stats.remainingSeconds).toBeGreaterThan(4);
  });

  it('store logs storage info', () => {
    const debugSpy = vi.spyOn(logger, 'debug');
    manager.store({ test: true });
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('Stored detailed data'));
  });

  it('retrieve updates accessCount and lastAccessedAt', () => {
    const id = manager.store({ a: 1 });
    vi.advanceTimersByTime(5000);

    const before = manager.getDetailedStats().find((s) => s.detailId === id)!;
    const accessCountBefore = before.accessCount;
    const lastAccessedBefore = new Date(before.lastAccessedAt).getTime();

    manager.retrieve(id);

    const after = manager.getDetailedStats().find((s) => s.detailId === id)!;
    expect(after.accessCount).toBe(accessCountBefore + 1);
    expect(new Date(after.lastAccessedAt).getTime()).toBeGreaterThan(lastAccessedBefore);
  });

  it('retrieve auto-extends TTL when near expiration', () => {
    const id = manager.store({ a: 1 }, 4 * 60 * 1000); // 4 min TTL
    vi.advanceTimersByTime(3 * 60 * 1000); // 3 mins in — 1 min remaining (< 5 min threshold)

    const before = manager.getDetailedStats().find((s) => s.detailId === id)!;
    manager.retrieve(id);
    const after = manager.getDetailedStats().find((s) => s.detailId === id)!;

    // Should be extended to now + 15 min
    expect(new Date(after.expiresAt).getTime()).toBeGreaterThan(
      new Date(before.expiresAt).getTime(),
    );
  });

  it('retrieve throws for missing detailId', () => {
    expect(() => manager.retrieve('detail_missing')).toThrow('not found or expired');
  });

  it('retrieve throws for expired detailId', () => {
    const id = manager.store({ a: 1 }, 10);
    vi.advanceTimersByTime(11);
    expect(() => manager.retrieve(id)).toThrow('expired');
  });

  // ── clear ───────────────────────────────────────────────────────────────

  it('clear logs clearing info', () => {
    const infoSpy = vi.spyOn(logger, 'info');
    manager.store({ a: 1 });
    manager.clear();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Cleared all'));
  });

  it('clear resets stats', () => {
    manager.store({ a: 1 });
    manager.store({ b: 2 });
    manager.clear();
    expect(manager.getStats().cacheSize).toBe(0);
    expect(manager.getStats().totalSizeKB).toBe('0.0');
  });

  // ── shutdown ─────────────────────────────────────────────────────────────

  it('shutdown clears cleanup interval', () => {
    const interval = (manager as any).cleanupInterval;
    expect(interval).not.toBeNull();
    manager.shutdown();
    expect((manager as any).cleanupInterval).toBeNull();
  });

  it('shutdown can be called multiple times safely', () => {
    manager.shutdown();
    expect(() => manager.shutdown()).not.toThrow();
  });
});
