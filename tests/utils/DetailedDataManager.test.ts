import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailedDataManager } from '@utils/DetailedDataManager';

describe('DetailedDataManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    DetailedDataManager.getInstance().shutdown();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns singleton instance and recreates after shutdown', () => {
    const first = DetailedDataManager.getInstance();
    const second = DetailedDataManager.getInstance();

    expect(first).toBe(second);

    first.shutdown();
    const third = DetailedDataManager.getInstance();
    expect(third).not.toBe(first);
  });

  it('stores and retrieves data with path and updates access stats', () => {
    const manager = DetailedDataManager.getInstance();
    const detailId = manager.store({ nested: { value: 42 } });

    expect(manager.retrieve(detailId)).toEqual({ nested: { value: 42 } });
    expect(manager.retrieve(detailId, 'nested.value')).toBe(42);

    const detailed = manager.getDetailedStats().find((entry) => entry.detailId === detailId);
    expect(detailed?.accessCount).toBe(2);
  });

  it('throws for missing and expired detail ids', () => {
    const manager = DetailedDataManager.getInstance();
    expect(() => manager.retrieve('detail_missing')).toThrow('not found or expired');

    const detailId = manager.store({ hello: 'world' }, 10);
    vi.advanceTimersByTime(11);
    expect(() => manager.retrieve(detailId)).toThrow('expired');
  });

  it('cleans up expired entries via cleanup routine', () => {
    const manager = DetailedDataManager.getInstance();
    manager.store({ a: 1 }, 5);
    manager.store({ b: 2 }, 30_000);

    vi.advanceTimersByTime(6);
    (manager as any).cleanup();

    expect(manager.getStats().cacheSize).toBe(1);
  });

  it('evicts least-recently-used entry when cache reaches limit', () => {
    const manager = DetailedDataManager.getInstance();
    const ids: string[] = [];

    for (let index = 0; index < 100; index++) {
      ids.push(manager.store({ index }));
      vi.advanceTimersByTime(1);
    }

    manager.retrieve(ids[99]!);
    vi.advanceTimersByTime(1);
    const overflowId = manager.store({ overflow: true });

    expect(manager.getStats().cacheSize).toBe(100);
    expect(() => manager.retrieve(ids[0]!)).toThrow('not found or expired');
    expect(manager.retrieve(overflowId)).toEqual({ overflow: true });
  });

  it('returns detailed response for oversized payload in smartHandle', () => {
    const manager = DetailedDataManager.getInstance();
    const large = { payload: 'x'.repeat(5000) };

    const result = manager.smartHandle(large, 100) as {
      detailId: string;
      summary: { size: number; type: string };
    };
    expect(result.detailId).toMatch(/^detail_/);
    expect(result.summary.type).toBe('object');
    expect(result.summary.size).toBeGreaterThan(100);
    expect(manager.retrieve(result.detailId)).toEqual(large);
  });

  it('cleanup interval is unref()d so it does not prevent process exit', () => {
    const manager = new DetailedDataManager();
    const interval = (manager as any).cleanupInterval;
    expect(interval).toBeDefined();
    // Node.js Timeout objects have a _idleTimeout after unref; check hasRef()
    if (typeof interval === 'object' && typeof interval.hasRef === 'function') {
      expect(interval.hasRef()).toBe(false);
    }
    manager.shutdown();
  });

  it('returns primitives directly from smartHandle', () => {
    const manager = DetailedDataManager.getInstance();
    expect(manager.smartHandle(null)).toBe(null);
    expect(manager.smartHandle('string')).toBe('string');
    expect(manager.smartHandle({ small: true })).toEqual({ small: true });
  });

  it('uses serialization memoization for identical object references', () => {
    const manager = DetailedDataManager.getInstance();
    const obj = { shared: true };
    const id1 = manager.store(obj);
    const id2 = manager.store(obj); // hits memo cache
    expect(id1).not.toBe(id2);
  });

  it('throws when getByPath hits undefined traversal', () => {
    const manager = DetailedDataManager.getInstance();
    const id = manager.store({ nested: {} });
    expect(() => manager.retrieve(id, 'nested.missing.deep')).toThrow('Path not found');
  });

  it('extends TTL and throws on missing/expired extension', () => {
    const manager = DetailedDataManager.getInstance();
    const id = manager.store({ a: 1 }, 1000);

    expect(() => manager.extend('missing')).toThrow('not found');

    manager.extend(id, 5000);
    const stats = manager.getDetailedStats().find((s) => s.detailId === id);
    expect(stats?.remainingSeconds).toBeGreaterThan(5);

    vi.advanceTimersByTime(9000);
    expect(() => manager.extend(id)).toThrow('already expired');
  });

  it('clears all cached data', () => {
    const manager = DetailedDataManager.getInstance();
    manager.store({ a: 1 });
    manager.clear();
    expect(manager.getStats().cacheSize).toBe(0);
  });

  it('auto-extends TTL when retrieved within 5 minutes of expiration', () => {
    const manager = DetailedDataManager.getInstance();
    const id = manager.store({ a: 1 }, 360000); // 6 mins TTL
    vi.advanceTimersByTime(120000); // advance 2 mins -> 4 mins remaining (< 5 mins)
    manager.retrieve(id); // triggers AUTO_EXTEND_ON_ACCESS
    const stats = manager.getDetailedStats().find((s) => s.detailId === id);
    expect(stats?.remainingSeconds).toBeGreaterThan(300); // verify extended
  });

  it('generates summary array length correctly for oversized arrays', () => {
    const manager = DetailedDataManager.getInstance();
    const largeArray = Array.from({ length: 5000 }).fill('x');
    const result = manager.smartHandle(largeArray, 100) as any;
    expect(result.summary.type).toBe('array');
    expect(result.summary.structure.length).toBe(5000);
  });

  it('sorts detailed stats by lastAccessedAt descending', () => {
    const manager = DetailedDataManager.getInstance();
    manager.clear();
    const id1 = manager.store({ first: true });
    vi.advanceTimersByTime(1000);
    const id2 = manager.store({ second: true });
    vi.advanceTimersByTime(1000);

    // Access id1 so its lastAccessedAt becomes newest
    manager.retrieve(id1);

    const stats = manager.getDetailedStats();
    expect(stats.length).toBe(2);
    expect(stats[0]!.detailId).toBe(id1);
    expect(stats[1]!.detailId).toBe(id2);
  });
});
