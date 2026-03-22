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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const interval = (manager as any).cleanupInterval;
    expect(interval).toBeDefined();
    // Node.js Timeout objects have a _idleTimeout after unref; check hasRef()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    if (typeof interval === 'object' && typeof interval.hasRef === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(interval.hasRef()).toBe(false);
    }
    manager.shutdown();
  });
});
