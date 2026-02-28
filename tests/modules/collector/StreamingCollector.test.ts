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

import { StreamingCollector } from '../../../src/modules/collector/StreamingCollector.js';

async function collectAsync<T>(iterable: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('StreamingCollector', () => {
  it('splits a file into chunks with metadata', async () => {
    const collector = new StreamingCollector();
    const chunks = await collectAsync(
      collector.streamFile(
        { url: 'a.js', content: '1234567890', size: 10, type: 'external' } as any,
        { chunkSize: 4 }
      )
    );

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.metadata?.offset).toBe(0);
    expect(chunks[2]?.isLast).toBe(true);
  });

  it('collectStream reconstructs content per URL', async () => {
    const collector = new StreamingCollector();
    const stream = collector.streamFiles([
      { url: 'a.js', content: 'AAAA', size: 4, type: 'external' },
      { url: 'b.js', content: 'BBBB', size: 4, type: 'external' },
    ] as any, { chunkSize: 2 });

    const rebuilt = await collector.collectStream(stream);
    expect(rebuilt.get('a.js')).toBe('AAAA');
    expect(rebuilt.get('b.js')).toBe('BBBB');
  });

  it('streamByPriority yields higher-scored files first', async () => {
    const collector = new StreamingCollector();
    const chunks = await collectAsync(
      collector.streamByPriority(
        [
          { url: 'vendor.js', content: 'noop', size: 4, type: 'external' },
          { url: 'crypto-main.js', content: 'encrypt + fetch', size: 20, type: 'external' },
        ] as any,
        ['crypto']
      )
    );

    expect(chunks[0]?.url).toBe('crypto-main.js');
  });

  it('streamFiltered only emits chunks from matched files', async () => {
    const collector = new StreamingCollector();
    const chunks = await collectAsync(
      collector.streamFiltered(
        [
          { url: 'a.js', content: 'aa', size: 2, type: 'external' },
          { url: 'b.js', content: 'bb', size: 2, type: 'external' },
        ] as any,
        (f) => f.url.startsWith('b')
      )
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.url).toBe('b.js');
  });

  it('getStreamStats reports chunk count, bytes and unique files', async () => {
    const collector = new StreamingCollector();
    const stream = collector.streamFiles([
      { url: 'a.js', content: '1234', size: 4, type: 'external' },
      { url: 'b.js', content: '12', size: 2, type: 'external' },
    ] as any, { chunkSize: 2 });

    const stats = await collector.getStreamStats(stream);
    expect(stats.totalChunks).toBe(3);
    expect(stats.totalSize).toBe(6);
    expect(stats.files).toBe(2);
  });
});

