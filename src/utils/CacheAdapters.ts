import type { CacheInstance, CacheStats } from '@utils/UnifiedCacheManager';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import type { CodeCache } from '@modules/collector/CodeCache';
import type { CodeCompressor } from '@modules/collector/CodeCompressor';

export class DetailedDataManagerAdapter implements CacheInstance {
  name = 'DetailedDataManager';

  constructor(private manager: DetailedDataManager) {}

  getStats(): CacheStats {
    const stats = this.manager.getStats();
    return {
      entries: stats.cacheSize,
      size: this.estimateSize(stats.cacheSize),
      hits: 0,
      misses: 0,
      ttl: stats.defaultTTLSeconds * 1000,
      maxSize: stats.maxCacheSize,
    };
  }

  clear(): void {
    this.manager.clear();
  }

  private estimateSize(entries: number): number {
    return entries * 50 * 1024;
  }
}

export class CodeCacheAdapter implements CacheInstance {
  name = 'CodeCache';

  constructor(private cache: CodeCache) {}

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
  name = 'CodeCompressor';

  constructor(private compressor: CodeCompressor) {}

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

export function createCacheAdapters(
  detailedDataManager: DetailedDataManager,
  codeCache: CodeCache,
  codeCompressor: CodeCompressor,
): CacheInstance[] {
  return [
    new DetailedDataManagerAdapter(detailedDataManager),
    new CodeCacheAdapter(codeCache),
    new CodeCompressorAdapter(codeCompressor),
  ];
}
