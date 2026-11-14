import { mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BinaryScanHandlers } from '@server/domains/binary-instrument/handlers/binary-scan';

function parseJson(res: unknown): Record<string, unknown> {
  const r = res as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

describe('BinaryScanHandlers — handleBinaryEntropyProfile', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs.length = 0;
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function writeTemp(data: Uint8Array): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'entropy-'));
    tempDirs.push(dir);
    const path = join(dir, 'blob.bin');
    await fsWriteFile(path, data);
    return path;
  }

  it('classifies a uniform-zero buffer as low entropy', async () => {
    const handlers = new BinaryScanHandlers();
    const path = await writeTemp(new Uint8Array(1024).fill(0));
    const result = parseJson(await handlers.handleBinaryEntropyProfile({ filePath: path }));

    expect(result.success).toBe(true);
    const stats = result.stats as { minEntropy: number; maxEntropy: number; avgEntropy: number };
    expect(stats.maxEntropy).toBe(0);
    expect(stats.avgEntropy).toBe(0);
    expect(result.highEntropyRegionCount).toBe(0);
  });

  it('flags a high-entropy (random-looking) region', async () => {
    const handlers = new BinaryScanHandlers();
    // Pseudo-random high-entropy bytes.
    const data = new Uint8Array(2048);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 1103515245 + 12345) & 0xff; // LCG, looks random byte-wise
    }
    const path = await writeTemp(data);
    const result = parseJson(await handlers.handleBinaryEntropyProfile({ filePath: path }));

    const stats = result.stats as { maxEntropy: number };
    expect(stats.maxEntropy).toBeGreaterThan(7.0);
    expect(result.highEntropyRegionCount as number).toBeGreaterThan(0);
    const regions = result.highEntropyRegions as Array<{ entropy: number }>;
    expect(regions[0]!.entropy).toBeGreaterThan(7.0);
  });

  it('respects chunkSize to control sampling resolution', async () => {
    const handlers = new BinaryScanHandlers();
    const data = new Uint8Array(1024).fill(0);
    const path = await writeTemp(data);
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 128 }),
    );

    expect(result.chunkSize).toBe(128);
    expect(result.totalChunks).toBe(8); // 1024 / 128
  });

  it('caps analysis at maxChunks for large files', async () => {
    const handlers = new BinaryScanHandlers();
    const data = new Uint8Array(10000).fill(0xaa);
    const path = await writeTemp(data);
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 64, maxChunks: 50 }),
    );

    expect(result.chunksAnalyzed).toBe(50);
    expect(result.totalChunks).toBe(Math.ceil(10000 / 64));
    expect(result.truncated).toBe(true);
  });

  it('returns offsets as hex for cross-referencing', async () => {
    const handlers = new BinaryScanHandlers();
    const data = new Uint8Array(512);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;
    const path = await writeTemp(data);
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 256 }),
    );

    const regions = result.highEntropyRegions as Array<{ offsetHex: string }>;
    if (regions.length > 0) {
      expect(regions[0]!.offsetHex).toMatch(/^0x[0-9a-f]+$/);
    }
  });

  it('returns a structured error when filePath is missing', async () => {
    const handlers = new BinaryScanHandlers();
    await expect(handlers.handleBinaryEntropyProfile({})).rejects.toThrow();
  });

  it('treats an empty file as zero chunks with neutral stats', async () => {
    const handlers = new BinaryScanHandlers();
    const path = await writeTemp(new Uint8Array(0));
    const result = parseJson(await handlers.handleBinaryEntropyProfile({ filePath: path }));

    expect(result.success).toBe(true);
    expect(result.chunksAnalyzed).toBe(0);
    expect(result.totalChunks).toBe(0);
    expect(result.truncated).toBe(false);
    const stats = result.stats as { minEntropy: number; maxEntropy: number; avgEntropy: number };
    expect(stats.minEntropy).toBe(8);
    expect(stats.maxEntropy).toBe(0);
    expect(stats.avgEntropy).toBe(0);
    expect(result.highEntropyRegionCount).toBe(0);
    expect(result.note).toContain('No high-entropy');
  });

  it('clamps chunkSize below the 64-byte floor to 64', async () => {
    const handlers = new BinaryScanHandlers();
    const path = await writeTemp(new Uint8Array(128).fill(0x11));
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 10 }),
    );

    expect(result.chunkSize).toBe(64);
    expect(result.totalChunks).toBe(2);
  });

  it('clamps maxChunks of 0 up to 1 so at least one chunk is analyzed', async () => {
    const handlers = new BinaryScanHandlers();
    const path = await writeTemp(new Uint8Array(128).fill(0x22));
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 64, maxChunks: 0 }),
    );

    expect(result.chunksAnalyzed).toBe(1);
    expect(result.totalChunks).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('classifies evenly-spread 32-symbol data in the medium band (>=4.0, <7.0)', async () => {
    const handlers = new BinaryScanHandlers();
    // Each 64-byte chunk holds each of 32 byte values exactly twice,
    // so chunk entropy is exactly log2(32) = 5.0 bits/byte — medium.
    const data = new Uint8Array(128);
    for (let i = 0; i < data.length; i++) data[i] = i % 32;
    const path = await writeTemp(data);
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 64 }),
    );

    const stats = result.stats as { minEntropy: number; maxEntropy: number; avgEntropy: number };
    expect(stats.minEntropy).toBe(5);
    expect(stats.maxEntropy).toBe(5);
    expect(stats.avgEntropy).toBe(5);
    expect(result.highEntropyRegionCount).toBe(0);
    expect(result.note).toContain('No high-entropy');
  });

  it('falls back to the default chunkSize when chunkSize is not a number', async () => {
    const handlers = new BinaryScanHandlers();
    const path = await writeTemp(new Uint8Array(1024).fill(0x33));
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 'abc' }),
    );

    expect(result.chunkSize).toBe(256);
    expect(result.totalChunks).toBe(4);
  });

  it('caps the highEntropyRegions list at 50 entries while reporting the full count', async () => {
    const handlers = new BinaryScanHandlers();
    // The LCG low byte has full period mod 256, so every 256-aligned window
    // contains each byte value exactly once → entropy exactly 8 → high band.
    const chunkCount = 51;
    const data = new Uint8Array(chunkCount * 256);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 1103515245 + 12345) & 0xff;
    }
    const path = await writeTemp(data);
    const result = parseJson(await handlers.handleBinaryEntropyProfile({ filePath: path }));

    expect(result.totalChunks).toBe(chunkCount);
    expect(result.highEntropyRegionCount).toBe(chunkCount);
    const regions = result.highEntropyRegions as unknown[];
    expect(regions).toHaveLength(50);
    expect(result.note).toContain(`${chunkCount} high-entropy regions`);
  });
});
