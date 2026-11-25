/**
 * HeapAnalyzer — Linux /proc/pid/maps path.
 *
 * Forces the region-based (non-Windows) branch and mocks node:fs so the
 * grouping/statistics and fd-lifecycle fixes are covered without a real
 * Linux host.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
}));

vi.mock('node:fs', () => fsMocks);

import { HeapAnalyzer } from '@native/HeapAnalyzer';

const originalPlatform = process.platform;

const MAPS = [
  '1000-2000 rw-p 00000000 00:00 0 ',
  '3000-5000 r--p 00000000 00:00 0 /usr/lib/libfoo.so',
].join('\n');

describe('HeapAnalyzer (region-based /proc path)', () => {
  beforeAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
  });
  afterAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  });

  beforeEach(() => {
    fsMocks.readFileSync.mockReset();
    fsMocks.openSync.mockReset();
    fsMocks.readSync.mockReset();
    fsMocks.closeSync.mockReset();
    fsMocks.readFileSync.mockReturnValue(MAPS);
  });

  it('derives stats from the same regions it reports as heaps', async () => {
    const analyzer = new HeapAnalyzer();
    const { heaps, stats } = await analyzer.enumerateHeaps(1234);

    expect(heaps.map((h) => h.heapId).toSorted()).toEqual(['/usr/lib/libfoo.so', 'anon']);
    expect(stats.totalHeaps).toBe(2);
    expect(stats.totalBlocks).toBe(2);
    expect(stats.totalSize).toBe(0x1000 + 0x2000);
    expect(stats.largestBlock).toBe(0x2000);
    expect(stats.smallestBlock).toBe(0x1000);
    expect(stats.averageBlockSize).toBe(Math.round((0x1000 + 0x2000) / 2));
    expect(stats.sizeDistribution.find((b) => b.range === '4-16KB')?.count).toBe(2);
  });

  it('restricts the synthetic anon heap to path-less regions', async () => {
    const analyzer = new HeapAnalyzer();
    const anon = await analyzer.enumerateBlocks(1234, 'anon');
    expect(anon).toHaveLength(1);
    expect(anon[0]?.address).toBe('0x1000');

    const all = await analyzer.enumerateBlocks(1234, '*');
    expect(all).toHaveLength(2);
    expect(all.map((b) => b.address).toSorted()).toEqual(['0x1000', '0x3000']);
  });

  it('closes the /proc/pid/mem fd even when the sample read throws', async () => {
    fsMocks.openSync.mockReturnValue(7);
    fsMocks.readSync.mockImplementation(() => {
      throw new Error('EIO');
    });
    // Reads of /proc/pid/maps use readFileSync, so only the sample path runs.
    const analyzer = new HeapAnalyzer();
    await expect(analyzer.detectAnomalies(1234)).resolves.toBeDefined();
    expect(fsMocks.closeSync).toHaveBeenCalledWith(7);
  });
});
