import { logger } from '@utils/logger';
import { CACHE_GLOBAL_MAX_SIZE_BYTES, CACHE_LOW_HIT_RATE_THRESHOLD } from '@src/constants';

export interface CacheInstance {
  name: string;
  getStats(): CacheStats | Promise<CacheStats>;
  cleanup?(): Promise<void> | void;
  clear?(): Promise<void> | void;
}

export interface CacheStats {
  entries: number;
  size: number;
  hits?: number;
  misses?: number;
  hitRate?: number;
  ttl?: number;
  maxSize?: number;
}

export interface GlobalCacheStats {
  totalEntries: number;
  totalSize: number;
  totalSizeMB: string;
  hitRate: number;
  caches: Array<{
    name: string;
    entries: number;
    size: number;
    sizeMB: string;
    hitRate?: number;
    ttl?: number;
  }>;
  recommendations: string[];
}

export class UnifiedCacheManager {
  protected static instance: UnifiedCacheManager;

  private readonly GLOBAL_MAX_SIZE = CACHE_GLOBAL_MAX_SIZE_BYTES;
  private readonly LOW_HIT_RATE_THRESHOLD = CACHE_LOW_HIT_RATE_THRESHOLD;

  private caches = new Map<string, CacheInstance>();

  constructor() {
    logger.info('UnifiedCacheManager initialized');
  }

  /** @deprecated Use constructor injection. Kept for backward compatibility. */
  static getInstance(): UnifiedCacheManager {
    if (!this.instance) {
      this.instance = new UnifiedCacheManager();
    }
    return this.instance;
  }

  registerCache(cache: CacheInstance): void {
    this.caches.set(cache.name, cache);
    logger.info(`Registered cache: ${cache.name}`);
  }

  unregisterCache(name: string): void {
    this.caches.delete(name);
    logger.info(`Unregistered cache: ${name}`);
  }

  async getGlobalStats(): Promise<GlobalCacheStats> {
    const { caches, totalSize, hitRate } = await this.getFilteredStats(() => true);
    const totalEntries = caches.reduce((sum, cache) => sum + cache.entries, 0);
    const recommendations = this.generateRecommendations(totalSize, hitRate, caches);

    return {
      totalEntries,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      hitRate,
      caches,
      recommendations,
    };
  }

  /**
   * Internal: aggregate stats for caches passing `filter`. Used by both
   * `getGlobalStats` (passthrough filter) and `smartCleanup` (namespace filter)
   * so the two paths can never drift apart.
   */
  private async getFilteredStats(filter: (name: string) => boolean): Promise<{
    caches: Array<{
      name: string;
      entries: number;
      size: number;
      sizeMB: string;
      hitRate?: number;
      ttl?: number;
    }>;
    totalSize: number;
    hitRate: number;
  }> {
    let totalSize = 0;
    let totalHits = 0;
    let totalMisses = 0;

    const cacheStats: Array<{
      name: string;
      entries: number;
      size: number;
      sizeMB: string;
      hitRate?: number;
      ttl?: number;
    }> = [];

    for (const [name, cache] of this.caches) {
      if (!filter(name)) continue;
      try {
        const stats = await cache.getStats();
        totalSize += stats.size;
        totalHits += stats.hits || 0;
        totalMisses += stats.misses || 0;
        cacheStats.push({
          name,
          entries: stats.entries,
          size: stats.size,
          sizeMB: (stats.size / 1024 / 1024).toFixed(2),
          hitRate: stats.hitRate,
          ttl: stats.ttl,
        });
      } catch (error) {
        logger.error(`Failed to get stats for cache ${name}:`, error);
      }
    }

    const hitRate = totalHits + totalMisses > 0 ? totalHits / (totalHits + totalMisses) : 0;
    return { caches: cacheStats, totalSize, hitRate };
  }

  /**
   * Smart eviction: expired → low-hit-rate → largest, until the filtered subset
   * fits within `targetSize`.
   *
   * `options.namespaces` restricts every step to the listed cache names. An
   * empty list matches nothing (cleans nothing); only `undefined` means "all
   * caches". Treating an empty list as "all" would make a caller that built
   * the list from user selection wipe every cache on an empty selection —
   * cleanup is destructive, so the default must be the safe no-op.
   */
  async smartCleanup(
    targetSize?: number,
    options?: { namespaces?: readonly string[] },
  ): Promise<{
    before: number;
    after: number;
    freed: number;
    freedPercentage: number;
  }> {
    const namespaces = options?.namespaces;
    // undefined = all caches; an empty (or any non-empty) array restricts to
    // exactly the listed names, so an empty selection cleans nothing.
    const namespaceFilter = (name: string): boolean =>
      namespaces === undefined || namespaces.includes(name);

    const target = targetSize || this.GLOBAL_MAX_SIZE * 0.7;
    const beforeStats = await this.getFilteredStats(namespaceFilter);
    const beforeSize = beforeStats.totalSize;

    if (beforeSize <= target) {
      logger.info('No cleanup needed');
      return {
        before: beforeSize,
        after: beforeSize,
        freed: 0,
        freedPercentage: 0,
      };
    }

    logger.info(
      `Smart cleanup: current ${(beforeSize / 1024 / 1024).toFixed(2)}MB, ` +
        `target ${(target / 1024 / 1024).toFixed(2)}MB` +
        (namespaces && namespaces.length > 0 ? ` (namespaces: ${namespaces.join(', ')})` : ''),
    );

    await this.cleanupExpired(namespaceFilter);

    let currentStats = await this.getFilteredStats(namespaceFilter);
    if (currentStats.totalSize <= target) {
      return this.calculateCleanupResult(beforeSize, currentStats.totalSize);
    }

    await this.cleanupLowHitRate(namespaceFilter, target);

    currentStats = await this.getFilteredStats(namespaceFilter);
    if (currentStats.totalSize <= target) {
      return this.calculateCleanupResult(beforeSize, currentStats.totalSize);
    }

    await this.cleanupLargeItems(namespaceFilter, target);

    const afterStats = await this.getFilteredStats(namespaceFilter);
    return this.calculateCleanupResult(beforeSize, afterStats.totalSize);
  }

  private async cleanupExpired(filter: (name: string) => boolean): Promise<void> {
    logger.info('Cleaning up expired data...');

    for (const [name, cache] of this.caches) {
      if (!filter(name)) continue;
      if (cache.cleanup) {
        try {
          await cache.cleanup();
          logger.debug(`Cleaned up expired data in ${name}`);
        } catch (error) {
          logger.error(`Failed to cleanup ${name}:`, error);
        }
      }
    }
  }

  private async cleanupLowHitRate(
    filter: (name: string) => boolean,
    target: number,
  ): Promise<void> {
    logger.info('Cleaning up low hit rate caches...');

    const stats = await this.getFilteredStats(filter);
    const avgHitRate = stats.hitRate;
    let remainingSize = stats.totalSize;

    for (const cacheStats of stats.caches) {
      // Stop as soon as the filtered subset fits: clearing every low-hit-rate
      // cache when one was enough evicts far more than the budget requires.
      if (remainingSize <= target) {
        break;
      }
      if (
        cacheStats.hitRate !== undefined &&
        cacheStats.hitRate < avgHitRate * this.LOW_HIT_RATE_THRESHOLD
      ) {
        const cache = this.caches.get(cacheStats.name);
        /* v8 ignore next */
        if (cache?.clear) {
          try {
            await cache.clear();
            logger.info(
              `Cleared low hit rate cache: ${cacheStats.name} (${(cacheStats.hitRate * 100).toFixed(1)}%)`,
            );
            remainingSize = (await this.getFilteredStats(filter)).totalSize;
          } catch (error) {
            logger.error(`Failed to clear ${cacheStats.name}:`, error);
          }
        }
      }
    }
  }

  private async cleanupLargeItems(
    filter: (name: string) => boolean,
    target: number,
  ): Promise<void> {
    logger.info('Cleaning up large caches...');

    const stats = await this.getFilteredStats(filter);
    let remainingSize = stats.totalSize;

    const sortedCaches = stats.caches.toSorted((a, b) => b.size - a.size);

    for (const cacheStats of sortedCaches) {
      // Clear largest-first, one cache at a time, re-measuring after each hit:
      // always clearing a fixed count can evict ~2x more data than needed.
      if (remainingSize <= target) {
        break;
      }
      const cache = this.caches.get(cacheStats.name);
      /* v8 ignore next */
      if (cache?.clear) {
        try {
          await cache.clear();
          logger.info(`Cleared large cache: ${cacheStats.name} (${cacheStats.sizeMB}MB)`);
          remainingSize = (await this.getFilteredStats(filter)).totalSize;
        } catch (error) {
          logger.error(`Failed to clear ${cacheStats.name}:`, error);
        }
      }
    }
  }

  private calculateCleanupResult(before: number, after: number) {
    const freed = before - after;
    const freedPercentage = Math.round((freed / this.GLOBAL_MAX_SIZE) * 100);

    logger.info(
      `Cleanup complete! Freed ${(freed / 1024 / 1024).toFixed(2)}MB (${freedPercentage}%). ` +
        `Usage: ${(after / 1024 / 1024).toFixed(2)}MB/${(this.GLOBAL_MAX_SIZE / 1024 / 1024).toFixed(0)}MB`,
    );

    return {
      before,
      after,
      freed,
      freedPercentage,
    };
  }

  async clearAll(): Promise<void> {
    logger.info('Clearing all caches...');

    for (const [name, cache] of this.caches) {
      /* v8 ignore next */
      if (cache.clear) {
        try {
          await cache.clear();
          logger.info(`Cleared cache: ${name}`);
        } catch (error) {
          logger.error(`Failed to clear ${name}:`, error);
        }
      }
    }

    logger.success('All caches cleared');
  }

  async preheat(urls: string[]): Promise<void> {
    logger.info(`Preheating cache for ${urls.length} URLs...`);

    logger.info('Cache preheat completed');
  }

  private generateRecommendations(
    totalSize: number,
    hitRate: number,
    cacheStats: Array<{ name: string; size: number; hitRate?: number }>,
  ): string[] {
    const recommendations: string[] = [];

    const sizeRatio = totalSize / this.GLOBAL_MAX_SIZE;
    if (sizeRatio >= 0.9) {
      recommendations.push(' CRITICAL: Cache size at 90%. Run smart_cache_cleanup immediately!');
    } else if (sizeRatio >= 0.7) {
      recommendations.push('WARNING: Cache size at 70%. Consider cleanup soon.');
    } else if (sizeRatio >= 0.5) {
      recommendations.push('INFO: Cache size at 50%. Monitor usage.');
    }

    if (hitRate < 0.3) {
      recommendations.push(' Low cache hit rate (<30%). Consider adjusting TTL or cache strategy.');
    } else if (hitRate > 0.7) {
      recommendations.push(' Good cache hit rate (>70%). Cache is working well.');
    }

    for (const cache of cacheStats) {
      const cacheRatio = cache.size / totalSize;
      if (cacheRatio > 0.5) {
        recommendations.push(
          ` ${cache.name} uses ${Math.round(cacheRatio * 100)}% of total cache. Consider cleanup.`,
        );
      }

      if (cache.hitRate !== undefined && cache.hitRate < 0.2) {
        recommendations.push(
          ` ${cache.name} has low hit rate (${(cache.hitRate * 100).toFixed(1)}%). Consider disabling or adjusting.`,
        );
      }
    }

    if (recommendations.length === 0) {
      recommendations.push(' Cache health is good. No action needed.');
    }

    return recommendations;
  }
}
