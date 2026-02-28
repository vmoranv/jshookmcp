import { describe, expect, it, vi } from 'vitest';
import {
  CodeCacheAdapter,
  CodeCompressorAdapter,
  DetailedDataManagerAdapter,
  createCacheAdapters,
} from './CacheAdapters.js';

describe('CacheAdapters', () => {
  it('maps DetailedDataManager stats into cache stats format', () => {
    const manager = {
      getStats: vi.fn(() => ({
        cacheSize: 3,
        defaultTTLSeconds: 60,
        maxCacheSize: 100,
      })),
      clear: vi.fn(),
    };

    const adapter = new DetailedDataManagerAdapter(manager as any);
    expect(adapter.name).toBe('DetailedDataManager');
    expect(adapter.getStats()).toEqual({
      entries: 3,
      size: 3 * 50 * 1024,
      hits: 0,
      misses: 0,
      ttl: 60_000,
      maxSize: 100,
    });
  });

  it('delegates clear to DetailedDataManager', () => {
    const manager = {
      getStats: vi.fn(() => ({
        cacheSize: 0,
        defaultTTLSeconds: 30,
        maxCacheSize: 10,
      })),
      clear: vi.fn(),
    };

    const adapter = new DetailedDataManagerAdapter(manager as any);
    adapter.clear();
    expect(manager.clear).toHaveBeenCalledOnce();
  });

  it('maps CodeCache stats and delegates clear/cleanup', async () => {
    const cache = {
      getStats: vi.fn(async () => ({ memoryEntries: 2, diskEntries: 3, totalSize: 999 })),
      cleanup: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    };
    const adapter = new CodeCacheAdapter(cache as any);

    await expect(adapter.getStats()).resolves.toEqual({
      entries: 5,
      size: 999,
      hits: 0,
      misses: 0,
    });

    await adapter.cleanup();
    await adapter.clear();
    expect(cache.cleanup).toHaveBeenCalledOnce();
    expect(cache.clear).toHaveBeenCalledOnce();
  });

  it('calculates CodeCompressor hit rate and size estimate', () => {
    const compressor = {
      getStats: vi.fn(() => ({ cacheHits: 8, cacheMisses: 2, totalCompressedSize: 1000 })),
      getCacheSize: vi.fn(() => 5),
      clearCache: vi.fn(),
    };
    const adapter = new CodeCompressorAdapter(compressor as any);

    expect(adapter.getStats()).toEqual({
      entries: 5,
      size: 1000,
      hits: 8,
      misses: 2,
      hitRate: 0.8,
    });
  });

  it('handles zero-entry compressor cache size gracefully', () => {
    const compressor = {
      getStats: vi.fn(() => ({ cacheHits: 0, cacheMisses: 0, totalCompressedSize: 1000 })),
      getCacheSize: vi.fn(() => 0),
      clearCache: vi.fn(),
    };
    const adapter = new CodeCompressorAdapter(compressor as any);
    expect(adapter.getStats().size).toBe(0);
  });

  it('creates the three expected adapters', () => {
    const manager = { getStats: vi.fn(), clear: vi.fn() };
    const cache = { getStats: vi.fn(), cleanup: vi.fn(), clear: vi.fn() };
    const compressor = { getStats: vi.fn(), getCacheSize: vi.fn(), clearCache: vi.fn() };
    const adapters = createCacheAdapters(manager as any, cache as any, compressor as any);

    expect(adapters).toHaveLength(3);
    expect(adapters.map((a) => a.name)).toEqual([
      'DetailedDataManager',
      'CodeCache',
      'CodeCompressor',
    ]);
  });
});

