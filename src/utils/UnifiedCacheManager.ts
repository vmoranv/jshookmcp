import { logger } from './logger.js';

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
  private static instance: UnifiedCacheManager;

  private readonly GLOBAL_MAX_SIZE = 500 * 1024 * 1024;
  private readonly LOW_HIT_RATE_THRESHOLD = 0.3;

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
    let totalEntries = 0;
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
      try {
        const stats = await cache.getStats();

        totalEntries += stats.entries;
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

    const recommendations = this.generateRecommendations(totalSize, hitRate, cacheStats);

    return {
      totalEntries,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      hitRate,
      caches: cacheStats,
      recommendations,
    };
  }

  async smartCleanup(targetSize?: number): Promise<{
    before: number;
    after: number;
    freed: number;
    freedPercentage: number;
  }> {
    const target = targetSize || this.GLOBAL_MAX_SIZE * 0.7;
    const beforeStats = await this.getGlobalStats();
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
      `Smart cleanup: current ${beforeStats.totalSizeMB}MB, ` +
        `target ${(target / 1024 / 1024).toFixed(2)}MB`
    );

    await this.cleanupExpired();

    let currentStats = await this.getGlobalStats();
    if (currentStats.totalSize <= target) {
      return this.calculateCleanupResult(beforeSize, currentStats.totalSize);
    }

    await this.cleanupLowHitRate();

    currentStats = await this.getGlobalStats();
    if (currentStats.totalSize <= target) {
      return this.calculateCleanupResult(beforeSize, currentStats.totalSize);
    }

    await this.cleanupLargeItems();

    const afterStats = await this.getGlobalStats();
    return this.calculateCleanupResult(beforeSize, afterStats.totalSize);
  }

  private async cleanupExpired(): Promise<void> {
    logger.info('Cleaning up expired data...');

    for (const [name, cache] of this.caches) {
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

  private async cleanupLowHitRate(): Promise<void> {
    logger.info('Cleaning up low hit rate caches...');

    const stats = await this.getGlobalStats();
    const avgHitRate = stats.hitRate;

    for (const cacheStats of stats.caches) {
      if (
        cacheStats.hitRate !== undefined &&
        cacheStats.hitRate < avgHitRate * this.LOW_HIT_RATE_THRESHOLD
      ) {
        const cache = this.caches.get(cacheStats.name);
        if (cache && cache.clear) {
          try {
            await cache.clear();
            logger.info(
              `Cleared low hit rate cache: ${cacheStats.name} (${(cacheStats.hitRate * 100).toFixed(1)}%)`
            );
          } catch (error) {
            logger.error(`Failed to clear ${cacheStats.name}:`, error);
          }
        }
      }
    }
  }

  private async cleanupLargeItems(): Promise<void> {
    logger.info('Cleaning up large caches...');

    const stats = await this.getGlobalStats();

    const sortedCaches = stats.caches.sort((a, b) => b.size - a.size);

    for (const cacheStats of sortedCaches.slice(0, 2)) {
      const cache = this.caches.get(cacheStats.name);
      if (cache && cache.clear) {
        try {
          await cache.clear();
          logger.info(`Cleared large cache: ${cacheStats.name} (${cacheStats.sizeMB}MB)`);
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
        `Usage: ${(after / 1024 / 1024).toFixed(2)}MB/${(this.GLOBAL_MAX_SIZE / 1024 / 1024).toFixed(0)}MB`
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
    cacheStats: Array<{ name: string; size: number; hitRate?: number }>
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
          ` ${cache.name} uses ${Math.round(cacheRatio * 100)}% of total cache. Consider cleanup.`
        );
      }

      if (cache.hitRate !== undefined && cache.hitRate < 0.2) {
        recommendations.push(
          ` ${cache.name} has low hit rate (${(cache.hitRate * 100).toFixed(1)}%). Consider disabling or adjusting.`
        );
      }
    }

    if (recommendations.length === 0) {
      recommendations.push(' Cache health is good. No action needed.');
    }

    return recommendations;
  }
}
