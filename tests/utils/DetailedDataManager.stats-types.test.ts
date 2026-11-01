import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailedDataManager } from '@utils/DetailedDataManager';

/**
 * Regression tests for getStats() return type consistency:
 * numeric metrics used to be returned as pre-formatted strings
 * ("12.34", "12.3%", "0") while others were numbers, forcing consumers to
 * Number() them. All numeric metrics are now numbers.
 */
describe('utils/DetailedDataManager getStats types', () => {
  let manager: DetailedDataManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager = DetailedDataManager.getInstance();
  });

  afterEach(async () => {
    await DetailedDataManager.getInstance().shutdownAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns numeric metrics as numbers, not formatted strings', async () => {
    await manager.store({ a: 1 });
    await manager.store({ b: 2 });
    try {
      manager.retrieve('does-not-exist');
    } catch {
      // retrieve throws synchronously for missing ids — exercise the path
    }

    const stats = manager.getStats();

    expect(typeof stats.cacheSize).toBe('number');
    expect(typeof stats.maxCacheSize).toBe('number');
    expect(typeof stats.totalMemoryMB).toBe('number');
    expect(typeof stats.maxMemoryMB).toBe('number');
    expect(typeof stats.memoryUtilization).toBe('number');
    expect(typeof stats.totalSizeKB).toBe('number');
    expect(typeof stats.avgAccessCount).toBe('number');
    expect(typeof stats.defaultTTLSeconds).toBe('number');
    expect(typeof stats.maxTTLSeconds).toBe('number');
    expect(typeof stats.extendDurationSeconds).toBe('number');
    expect(typeof stats.persistence.gzipThresholdKB).toBe('number');
  });

  it('computes memory utilization as a percentage number', () => {
    const stats = manager.getStats();
    expect(stats.memoryUtilization).toBeGreaterThanOrEqual(0);
    expect(stats.memoryUtilization).toBeLessThanOrEqual(100);
    expect(Number.isFinite(stats.memoryUtilization)).toBe(true);
  });

  it('avgAccessCount is a finite number even with no entries', () => {
    const stats = manager.getStats();
    expect(typeof stats.avgAccessCount).toBe('number');
    expect(Number.isFinite(stats.avgAccessCount)).toBe(true);
    expect(stats.avgAccessCount).toBe(0);
  });

  it('persistence metrics expose counters as numbers', () => {
    const stats = manager.getStats();
    for (const value of Object.values(stats.metrics)) {
      expect(typeof value).toBe('number');
    }
  });

  it('getDetailedStats entries carry numeric fields', async () => {
    await manager.store({ x: 1 }, 60_000);
    const entry = manager.getDetailedStats()[0]!;
    expect(typeof entry.sizeKB).toBe('string'); // human-readable label
    expect(typeof entry.accessCount).toBe('number');
    expect(typeof entry.remainingSeconds).toBe('number');
    expect(typeof entry.isExpired).toBe('boolean');
    expect(typeof entry.detailId).toBe('string');
  });
});
