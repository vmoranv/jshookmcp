import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CodeCompressor } from '@modules/collector/CodeCompressor';

describe('CodeCompressor', () => {
  it('compresses and decompresses roundtrip content', async () => {
    const compressor = new CodeCompressor();
    const source = 'const x = 1;'.repeat(200);

    const compressed = await compressor.compress(source);
    const restored = await compressor.decompress(compressed.compressed);

    expect(restored).toBe(source);
    expect(compressed.originalSize).toBe(source.length);
  });

  it('uses cache on repeated compression with same input', async () => {
    const compressor = new CodeCompressor();
    const source = 'cache-me'.repeat(100);

    await compressor.compress(source, { useCache: true });
    await compressor.compress(source, { useCache: true });
    const stats = compressor.getStats();

    expect(stats.cacheMisses).toBeGreaterThanOrEqual(1);
    expect(stats.cacheHits).toBeGreaterThanOrEqual(1);
  });

  it('falls back to base64 passthrough when batch item compression fails', async () => {
    const compressor = new CodeCompressor();
    const originalCompress = compressor.compress.bind(compressor);
    vi.spyOn(compressor, 'compress').mockImplementation(async (code, options) => {
      if (code.includes('bad-item')) {
        throw new Error('forced failure');
      }
      return originalCompress(code, options);
    });

    const result = await compressor.compressBatch([
      { url: 'good.js', content: 'good-content'.repeat(50) },
      { url: 'bad.js', content: 'bad-item' },
    ]);

    const bad = result.find((item) => item.url === 'bad.js');
    expect(bad).toBeDefined();
    expect(bad?.compressionRatio).toBe(0);
    expect(bad?.compressed).toBe(Buffer.from('bad-item').toString('base64'));
  });

  it('evaluates compression thresholds correctly', () => {
    const compressor = new CodeCompressor();

    expect(compressor.shouldCompress('x'.repeat(1025))).toBe(true);
    expect(compressor.shouldCompress('x'.repeat(1000), 2000)).toBe(false);
  });

  it('selects compression levels by input size', () => {
    const compressor = new CodeCompressor();

    expect(compressor.selectCompressionLevel(5 * 1024)).toBe(1);
    expect(compressor.selectCompressionLevel(50 * 1024)).toBe(6);
    expect(compressor.selectCompressionLevel(300 * 1024)).toBe(9);
    expect(compressor.selectCompressionLevel(2 * 1024 * 1024)).toBe(6);
  });

  it('stream-compresses large payload into multiple chunks', async () => {
    const compressor = new CodeCompressor();
    const onProgress = vi.fn();
    const source = 'stream-payload-'.repeat(500);

    const result = await compressor.compressStream(source, { chunkSize: 512, onProgress });

    expect(result.chunks).toBeGreaterThan(1);
    expect(result.originalSize).toBe(source.length);
    expect(onProgress).toHaveBeenCalled();
  });

  it('delegates to plain compress when input fits within one chunk', async () => {
    const compressor = new CodeCompressor();
    // chunkSize defaults to 100KB; this string is far below that
    const result = await compressor.compressStream('x = 1;', { chunkSize: 1024 * 100 });

    expect(result.compressed).toBeDefined();
    expect(result.chunks).toBeUndefined();
  });

  it('increments cacheMisses counter on cache bypass', async () => {
    const compressor = new CodeCompressor();
    await compressor.compress('hello world'.repeat(50), { useCache: false });
    const stats = compressor.getStats();

    expect(stats.cacheMisses).toBeGreaterThanOrEqual(1);
  });

  it('evicts oldest cache entry when cache reaches maximum size', async () => {
    const compressor = new CodeCompressor();
    // cache max size is 100; add 101 distinct entries
    for (let i = 0; i < 101; i++) {
      await compressor.compress(`distinct-source-${i}`.repeat(50), { useCache: true });
    }

    // oldest entry (index 0) should have been evicted; cache size stays at max
    expect(compressor.getCacheSize()).toBe(100);
  });

  it('resets stats to zero on resetStats', async () => {
    const compressor = new CodeCompressor();
    await compressor.compress('stats-test'.repeat(100));
    compressor.resetStats();
    const stats = compressor.getStats();

    expect(stats.totalCompressed).toBe(0);
    expect(stats.cacheHits).toBe(0);
    expect(stats.cacheMisses).toBe(0);
    expect(stats.totalOriginalSize).toBe(0);
  });

  it('reports correct cache size and clears it on clearCache', async () => {
    const compressor = new CodeCompressor();
    await compressor.compress('cache-clear'.repeat(50));
    expect(compressor.getCacheSize()).toBeGreaterThan(0);

    compressor.clearCache();
    expect(compressor.getCacheSize()).toBe(0);
  });

  it('decompress throws on invalid base64 input after exhausting retries', async () => {
    const compressor = new CodeCompressor();
    await expect(compressor.decompress('not-valid-base64!!!', 3)).rejects.toThrow();
  });

  it('calls onFileProgress callback after each file in batch', async () => {
    const compressor = new CodeCompressor();
    const onFileProgress = vi.fn();

    await compressor.compressBatch(
      [
        { url: 'a.js', content: 'content-a'.repeat(50) },
        { url: 'b.js', content: 'content-b'.repeat(50) },
      ],
      { onFileProgress },
    );

    expect(onFileProgress).toHaveBeenCalledTimes(2);
  });

  it('calls onProgress callback during batch compression', async () => {
    const compressor = new CodeCompressor();
    const onProgress = vi.fn();

    await compressor.compressBatch(
      [
        { url: 'p1.js', content: 'payload-1'.repeat(50) },
        { url: 'p2.js', content: 'payload-2'.repeat(50) },
      ],
      { onProgress },
    );

    expect(onProgress).toHaveBeenCalled();
  });

  it('reports correct average ratio after multiple compressions', async () => {
    const compressor = new CodeCompressor();
    compressor.resetStats();

    await compressor.compress('ratio-source'.repeat(100));
    await compressor.compress('another-ratio'.repeat(100));

    const stats = compressor.getStats();
    expect(stats.totalCompressed).toBeGreaterThanOrEqual(2);
    expect(typeof stats.averageRatio).toBe('number');
  });

  it('covers cache eviction path for expired TTL entry', async () => {
    const compressor = new CodeCompressor();
    // Directly manipulate the private cache to simulate expired TTL
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (compressor as any).cache.set(
      (compressor as any).generateCacheKey('expired-source'.repeat(50), 6),
      {
        compressed: 'dummy',
        originalSize: 100,
        compressedSize: 50,
        compressionRatio: 50,
        timestamp: Date.now() - 4000 * 1000, // 4000 seconds ago (well past 3600 TTL)
      },
    );

    // Call compress with same source — should hit expired cache branch (else block)
    await compressor.compress('expired-source'.repeat(50), { useCache: true });
    const stats = compressor.getStats();

    // The expired entry was deleted and a fresh compression was done
    expect(stats.cacheMisses).toBeGreaterThanOrEqual(1);
    expect(compressor.getCacheSize()).toBeLessThanOrEqual(1);
  });
});
