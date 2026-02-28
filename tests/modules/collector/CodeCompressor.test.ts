import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CodeCompressor } from '../../../src/modules/collector/CodeCompressor.js';

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
});

