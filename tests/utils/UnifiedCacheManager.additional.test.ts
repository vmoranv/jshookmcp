import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheInstance } from '@utils/UnifiedCacheManager';
import { UnifiedCacheManager } from '@utils/UnifiedCacheManager';

function mb(value: number): number {
  return value * 1024 * 1024;
}

describe('UnifiedCacheManager – additional coverage', () => {
  afterEach(() => {
    (UnifiedCacheManager as any).instance = undefined;
    vi.restoreAllMocks();
  });

  describe('preheat (lines 258-262)', () => {
    it('completes without error for a list of URLs', async () => {
      const manager = new UnifiedCacheManager();
      await expect(manager.preheat(['https://a.com', 'https://b.com'])).resolves.toBeUndefined();
    });

    it('completes for an empty URL list', async () => {
      const manager = new UnifiedCacheManager();
      await expect(manager.preheat([])).resolves.toBeUndefined();
    });
  });

  describe('generateRecommendations – 50% size threshold (line 277)', () => {
    it('generates INFO recommendation when cache is at 50% size', async () => {
      const manager = new UnifiedCacheManager();
      // CACHE_GLOBAL_MAX_SIZE_BYTES default = 500 * 1024 * 1024 = 524288000
      // 50% = 262144000
      manager.registerCache({
        name: 'half-cache',
        getStats: vi.fn(async () => ({
          entries: 10,
          size: mb(260),
          hits: 50,
          misses: 50,
          hitRate: 0.5,
        })),
      });

      const stats = await manager.getGlobalStats();
      expect(stats.recommendations.some((r) => r.includes('INFO'))).toBe(true);
    });
  });

  describe('generateRecommendations – no issues (line 302)', () => {
    it('returns "Cache health is good" recommendation when no issues are detected', async () => {
      const manager = new UnifiedCacheManager();
      // Size well under 50%, hitRate between 0.3 and 0.7, no single cache dominates, no low per-cache hitRate
      manager.registerCache({
        name: 'cache-a',
        getStats: vi.fn(async () => ({
          entries: 5,
          size: mb(10),
          hits: 50,
          misses: 50,
          hitRate: 0.5,
        })),
      });
      manager.registerCache({
        name: 'cache-b',
        getStats: vi.fn(async () => ({
          entries: 5,
          size: mb(10),
          hits: 50,
          misses: 50,
          hitRate: 0.5,
        })),
      });

      const stats = await manager.getGlobalStats();
      expect(stats.recommendations.some((r) => r.includes('Cache health is good'))).toBe(true);
    });

    it('returns "Good cache hit rate" recommendation when hitRate > 0.7', async () => {
      const manager = new UnifiedCacheManager();
      manager.registerCache({
        name: 'healthy-cache',
        getStats: vi.fn(async () => ({
          entries: 5,
          size: mb(10),
          hits: 80,
          misses: 20,
          hitRate: 0.8,
        })),
      });

      const stats = await manager.getGlobalStats();
      expect(stats.recommendations.some((r) => r.includes('Good cache hit rate'))).toBe(true);
    });
  });

  describe('generateRecommendations – per-cache size dominance', () => {
    it('warns when a single cache uses >50% of total size', async () => {
      const manager = new UnifiedCacheManager();
      manager.registerCache({
        name: 'dominant-cache',
        getStats: vi.fn(async () => ({
          entries: 100,
          size: mb(300),
          hits: 80,
          misses: 20,
          hitRate: 0.8,
        })),
      });
      manager.registerCache({
        name: 'small-cache',
        getStats: vi.fn(async () => ({
          entries: 5,
          size: mb(10),
          hits: 80,
          misses: 20,
          hitRate: 0.8,
        })),
      });

      const stats = await manager.getGlobalStats();
      expect(
        stats.recommendations.some((r) => r.includes('dominant-cache') && r.includes('%'))
      ).toBe(true);
    });

    it('warns about low per-cache hit rate (<20%)', async () => {
      const manager = new UnifiedCacheManager();
      manager.registerCache({
        name: 'low-rate-cache',
        getStats: vi.fn(async () => ({
          entries: 50,
          size: mb(50),
          hits: 2,
          misses: 98,
          hitRate: 0.02,
        })),
      });

      const stats = await manager.getGlobalStats();
      expect(
        stats.recommendations.some(
          (r) => r.includes('low-rate-cache') && r.includes('low hit rate')
        )
      ).toBe(true);
    });
  });

  describe('smartCleanup – cleanupExpired path', () => {
    it('calls cleanup on caches with cleanup method', async () => {
      const manager = new UnifiedCacheManager();
      const cacheState = { size: mb(400), entries: 100 };
      const cleanupFn = vi.fn(async () => {
        cacheState.size = mb(100);
        cacheState.entries = 10;
      });

      manager.registerCache({
        name: 'expirable-cache',
        getStats: vi.fn(async () => ({
          entries: cacheState.entries,
          size: cacheState.size,
          hits: 50,
          misses: 50,
          hitRate: 0.5,
        })),
        cleanup: cleanupFn,
      });

      const result = await manager.smartCleanup(mb(200));
      expect(cleanupFn).toHaveBeenCalled();
      expect(result.after).toBeLessThanOrEqual(mb(200));
    });

    it('tolerates cleanup errors gracefully', async () => {
      const manager = new UnifiedCacheManager();

      manager.registerCache({
        name: 'err-cleanup-cache',
        getStats: vi.fn(async () => ({
          entries: 100,
          size: mb(400),
          hits: 50,
          misses: 50,
          hitRate: 0.5,
        })),
        cleanup: vi.fn(async () => {
          throw new Error('cleanup boom');
        }),
        clear: vi.fn(async () => undefined),
      });

      // Should not throw
      await expect(manager.smartCleanup(mb(200))).resolves.toBeDefined();
    });
  });

  describe('smartCleanup – cleanupLargeItems path', () => {
    it('clears the largest caches when other strategies are insufficient', async () => {
      const manager = new UnifiedCacheManager();
      const largeCacheState = { size: mb(300), entries: 50 };
      const smallCacheState = { size: mb(200), entries: 20 };

      const largeClear = vi.fn(async () => {
        largeCacheState.size = 0;
        largeCacheState.entries = 0;
      });

      manager.registerCache({
        name: 'large-cache',
        getStats: vi.fn(async () => ({
          ...largeCacheState,
          hits: 70,
          misses: 30,
          hitRate: 0.7,
        })),
        clear: largeClear,
        cleanup: vi.fn(async () => undefined),
      });
      manager.registerCache({
        name: 'small-cache',
        getStats: vi.fn(async () => ({
          ...smallCacheState,
          hits: 70,
          misses: 30,
          hitRate: 0.7,
        })),
        cleanup: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
      });

      await manager.smartCleanup(mb(100));
      expect(largeClear).toHaveBeenCalled();
    });

    it('tolerates clear errors in large cache cleanup', async () => {
      const manager = new UnifiedCacheManager();

      manager.registerCache({
        name: 'fail-clear-cache',
        getStats: vi.fn(async () => ({
          entries: 50,
          size: mb(400),
          hits: 70,
          misses: 30,
          hitRate: 0.7,
        })),
        cleanup: vi.fn(async () => undefined),
        clear: vi.fn(async () => {
          throw new Error('clear failed');
        }),
      });

      await expect(manager.smartCleanup(mb(100))).resolves.toBeDefined();
    });
  });

  describe('cleanupLowHitRate – clear error tolerance', () => {
    it('tolerates errors when clearing low hit rate caches', async () => {
      const manager = new UnifiedCacheManager();

      const highState = { size: mb(200), entries: 10, hits: 90, misses: 10, hitRate: 0.9 };
      const lowState = { size: mb(200), entries: 10, hits: 1, misses: 99, hitRate: 0.01 };

      manager.registerCache({
        name: 'high-rate',
        getStats: vi.fn(async () => ({ ...highState })),
      });
      manager.registerCache({
        name: 'low-rate',
        getStats: vi.fn(async () => ({ ...lowState })),
        clear: vi.fn(async () => {
          throw new Error('nope');
        }),
      });

      // Should not throw
      await expect(manager.smartCleanup(mb(100))).resolves.toBeDefined();
    });
  });

  describe('unregisterCache', () => {
    it('removes a registered cache', async () => {
      const manager = new UnifiedCacheManager();
      const cache: CacheInstance = {
        name: 'removable',
        getStats: vi.fn(async () => ({ entries: 5, size: 500 })),
      };

      manager.registerCache(cache);
      let stats = await manager.getGlobalStats();
      expect(stats.caches).toHaveLength(1);

      manager.unregisterCache('removable');
      stats = await manager.getGlobalStats();
      expect(stats.caches).toHaveLength(0);
    });
  });

  describe('getGlobalStats with zero total', () => {
    it('returns 0 hitRate when no hits or misses', async () => {
      const manager = new UnifiedCacheManager();
      manager.registerCache({
        name: 'empty-cache',
        getStats: vi.fn(async () => ({ entries: 0, size: 0, hits: 0, misses: 0 })),
      });

      const stats = await manager.getGlobalStats();
      expect(stats.hitRate).toBe(0);
    });
  });
});
