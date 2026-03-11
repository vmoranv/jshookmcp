import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeCache } from '@modules/collector/CodeCache';

const sampleResult = {
  files: [
    {
      url: 'https://example.com/app.js',
      content: 'console.log("hello")',
      size: 20,
      type: 'external' as const,
    },
  ],
  dependencies: { nodes: [], edges: [] },
  totalSize: 20,
  collectTime: 5,
  summaries: [
    {
      url: 'https://example.com/app.js',
      size: 20,
      type: 'external',
      hasEncryption: false,
      hasAPI: false,
      hasObfuscation: false,
      functions: ['main'],
      imports: [],
      preview: 'console.log("hello")',
    },
  ],
};

describe('CodeCache', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'jshook-cache-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('initializes cache directory', async () => {
    const cache = new CodeCache({ cacheDir });
    await expect(cache.init()).resolves.toBeUndefined();
  });

  it('stores and retrieves values from cache', async () => {
    const cache = new CodeCache({ cacheDir, maxAge: 60_000 });
    await cache.set('https://example.com', sampleResult);
    const result = await cache.get('https://example.com');

    expect(result).not.toBeNull();
    expect(result?.files[0]?.url).toBe('https://example.com/app.js');
    expect(result?.totalSize).toBe(20);
    expect(result?.dependencies).toEqual(sampleResult.dependencies);
    expect(result?.summaries).toEqual(sampleResult.summaries);
  });

  it('reads dependencies and summaries back from disk when memory cache is empty', async () => {
    const writer = new CodeCache({ cacheDir, maxAge: 60_000 });
    await writer.set('https://example.com', sampleResult);

    const reader = new CodeCache({ cacheDir, maxAge: 60_000 });
    const result = await reader.get('https://example.com');

    expect(result).not.toBeNull();
    expect(result?.files[0]?.url).toBe('https://example.com/app.js');
    expect(result?.totalSize).toBe(20);
    expect(result?.dependencies).toEqual(sampleResult.dependencies);
    expect(result?.summaries).toEqual(sampleResult.summaries);
  });

  it('returns null for expired entries', async () => {
    const cache = new CodeCache({ cacheDir, maxAge: 1 });
    await cache.set('https://expired.example', sampleResult);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const result = await cache.get('https://expired.example');
    expect(result).toBeNull();
  });

  it('cleanup removes oldest files when exceeding max size', async () => {
    const cache = new CodeCache({ cacheDir, maxSize: 200, maxAge: 60_000 });
    for (let i = 0; i < 6; i++) {
      await cache.set(`https://example.com/${i}`, {
        ...sampleResult,
        files: [
          {
            url: `https://example.com/${i}.js`,
            content: 'x'.repeat(300),
            size: 300,
            type: 'external',
          },
        ],
        totalSize: 300,
      });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const before = await cache.getStats();
    await cache.cleanup();
    const after = await cache.getStats();

    expect(before.diskEntries).toBeGreaterThan(0);
    expect(after.diskEntries).toBeLessThan(before.diskEntries);
  });

  it('clear removes both memory and disk cache entries', async () => {
    const cache = new CodeCache({ cacheDir, maxAge: 60_000 });
    await cache.set('https://a.example', sampleResult);
    await cache.set('https://b.example', sampleResult);
    expect((await cache.getStats()).diskEntries).toBeGreaterThan(0);

    await cache.clear();
    const stats = await cache.getStats();
    expect(stats.diskEntries).toBe(0);
    expect(stats.memoryEntries).toBe(0);
  });

  it('defaults dependencies for legacy memory cache entries missing new fields', async () => {
    const cache = new CodeCache({ cacheDir, maxAge: 60_000 });
    const key = (cache as any).generateKey('https://legacy-memory.example', undefined);

    (cache as any).memoryCache.set(key, {
      url: 'https://legacy-memory.example',
      files: sampleResult.files,
      totalSize: sampleResult.totalSize,
      collectTime: sampleResult.collectTime,
      timestamp: Date.now(),
      hash: 'legacy-memory',
    });

    const result = await cache.get('https://legacy-memory.example');

    expect(result?.dependencies).toEqual({ nodes: [], edges: [] });
    expect(result?.summaries).toBeUndefined();
  });

  it('defaults dependencies for legacy disk cache entries missing new fields', async () => {
    const cache = new CodeCache({ cacheDir, maxAge: 60_000 });
    const url = 'https://legacy-disk.example';
    const key = (cache as any).generateKey(url, undefined);

    await writeFile(
      join(cacheDir, `${key}.json`),
      JSON.stringify({
        url,
        files: sampleResult.files,
        totalSize: sampleResult.totalSize,
        collectTime: sampleResult.collectTime,
        timestamp: Date.now(),
        hash: 'legacy-disk',
      }),
      'utf-8'
    );

    const result = await cache.get(url);

    expect(result?.dependencies).toEqual({ nodes: [], edges: [] });
    expect(result?.summaries).toBeUndefined();
  });

  it('warmup calls get for each provided URL', async () => {
    const cache = new CodeCache({ cacheDir });
    const getSpy = vi.spyOn(cache, 'get').mockResolvedValue(null);
    await cache.warmup(['https://one.example', 'https://two.example']);
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});

