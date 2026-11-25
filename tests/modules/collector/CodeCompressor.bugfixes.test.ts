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

describe('CodeCompressor bug fixes', () => {
  it('decompress restores stream-compressed payloads (format compatibility)', async () => {
    const compressor = new CodeCompressor();
    const source = 'stream-payload-'.repeat(500);

    const compressed = await compressor.compressStream(source, { chunkSize: 512 });
    expect(compressed.chunks).toBeGreaterThan(1);

    const restored = await compressor.decompress(compressed.compressed);
    expect(restored).toBe(source);
  });

  it('roundtrips stream-compressed payloads with tiny chunks', async () => {
    const compressor = new CodeCompressor();
    const source = 'tiny-chunk-data-'.repeat(50);

    const compressed = await compressor.compressStream(source, { chunkSize: 16 });
    const restored = await compressor.decompress(compressed.compressed);

    expect(restored).toBe(source);
  });

  it('keeps single-chunk decompress path working after format change', async () => {
    const compressor = new CodeCompressor();
    const source = 'single-chunk-'.repeat(30);

    const compressed = await compressor.compress(source);
    const restored = await compressor.decompress(compressed.compressed);

    expect(restored).toBe(source);
  });

  it('does not hang when concurrency is zero or invalid', async () => {
    const compressor = new CodeCompressor();
    const results = await compressor.compressBatch([{ url: 'a.js', content: 'let a = 1;' }], {
      concurrency: 0,
    });
    expect(results).toHaveLength(1);
  });
});
