import type { CacheInstance, CacheStats } from '@utils/UnifiedCacheManager';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import type { CodeCache } from '@modules/collector/CodeCache';
import type { CodeCompressor } from '@modules/collector/CodeCompressor';

export class DetailedDataManagerAdapter implements CacheInstance {
  private manager: DetailedDataManager;
  name = 'DetailedDataManager';

  constructor(manager: DetailedDataManager) {
    this.manager = manager;
  }

  getStats(): CacheStats {
    const stats = this.manager.getStats();
    return {
      entries: stats.cacheSize,
      // Use the manager's real footprint (derived from per-entry sizes) so
      // UnifiedCacheManager's global-size thresholds and eviction ordering are
      // not driven by a fabricated per-entry estimate.
      size: stats.totalSizeKB * 1024,
      hits: 0,
      misses: 0,
      ttl: stats.defaultTTLSeconds * 1000,
      maxSize: stats.maxCacheSize,
    };
  }

  clear(): void {
    this.manager.clear();
  }
}

export class CodeCacheAdapter implements CacheInstance {
  private cache: CodeCache;
  name = 'CodeCache';

  constructor(cache: CodeCache) {
    this.cache = cache;
  }

  async getStats(): Promise<CacheStats> {
    const stats = await this.cache.getStats();
    return {
      entries: stats.memoryEntries + stats.diskEntries,
      size: stats.totalSize,
      hits: 0,
      misses: 0,
    };
  }

  async cleanup(): Promise<void> {
    await this.cache.cleanup();
  }

  async clear(): Promise<void> {
    await this.cache.clear();
  }
}

export class CodeCompressorAdapter implements CacheInstance {
  private compressor: CodeCompressor;
  name = 'CodeCompressor';

  constructor(compressor: CodeCompressor) {
    this.compressor = compressor;
  }

  getStats(): CacheStats {
    const stats = this.compressor.getStats();
    const cacheSize = this.compressor.getCacheSize();

    const total = stats.cacheHits + stats.cacheMisses;
    const hitRate = total > 0 ? stats.cacheHits / total : 0;

    return {
      entries: cacheSize,
      size: this.estimateSize(cacheSize, stats.totalCompressedSize),
      hits: stats.cacheHits,
      misses: stats.cacheMisses,
      hitRate,
    };
  }

  clear(): void {
    this.compressor.clearCache();
  }

  private estimateSize(entries: number, totalCompressed: number): number {
    if (entries === 0) return 0;
    const avgSize = totalCompressed / Math.max(1, entries);
    return entries * avgSize;
  }
}

/**
 * Build adapters for the caches that are actually present. Callers that
 * construct a collector lazily may not have a CodeCache/CodeCompressor yet;
 * registering an adapter around null would make getStats() throw on every
 * stats aggregation instead of simply being absent.
 */
export function createCacheAdapters(
  detailedDataManager: DetailedDataManager | null | undefined,
  codeCache: CodeCache | null | undefined,
  codeCompressor: CodeCompressor | null | undefined,
): CacheInstance[] {
  const adapters: CacheInstance[] = [];
  if (detailedDataManager) adapters.push(new DetailedDataManagerAdapter(detailedDataManager));
  if (codeCache) adapters.push(new CodeCacheAdapter(codeCache));
  if (codeCompressor) adapters.push(new CodeCompressorAdapter(codeCompressor));
  return adapters;
}
