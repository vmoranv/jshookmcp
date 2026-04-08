/**
 * HeapAnalyzer coverage tests — exercise uncovered branches.
 *
 * Gaps in the main test suite (HeapAnalyzer.test.ts):
 *  - _computeStats: totalSize=0 with heaps (L245-248 fallback)
 *  - _computeStats: totalBlocks=0 with heaps (L252)
 *  - _computeStats: averageBlockSize = 0 when blocks=[]
 *  - _computeStats: fragmentationRatio = 0 when totalSize=0
 *  - classifyBlock: boundary cases (exactly at range limits)
 *  - _detectSuspiciousSizes: zero-size block edge
 *  - _detectPossibleUAF: non-zero data in free block
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  snapshotHandle: 42n,
  heapListCalled: false,
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: vi.fn(() => 1n),
  CloseHandle: vi.fn(() => true),
  ReadProcessMemory: vi.fn((_h: bigint, _a: bigint, size: number) => {
    const buf = Buffer.alloc(size);
    buf.writeBigUInt64LE(0xdeadbeefn, 0);
    return buf;
  }),
}));

vi.mock('@utils/logger', () => ({ logger: state.logger }));

vi.mock('@src/constants', () => ({
  HEAP_ENUMERATE_MAX_BLOCKS: 10000,
  HEAP_SPRAY_SIZE_TOLERANCE: 16,
  HEAP_SPRAY_THRESHOLD: 3,
  HEAP_SUSPICIOUS_BLOCK_SIZE: 100 * 1024 * 1024,
}));

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => ({
      func: vi.fn((_name: string) => vi.fn()),
    })),
  },
  load: vi.fn(),
}));

import { HeapAnalyzer } from '@native/HeapAnalyzer';

// ── _computeStats: boundary branches ─────────────────────────────────────────

describe('HeapAnalyzer coverage: _computeStats()', () => {
  let analyzer: HeapAnalyzer;

  beforeEach(() => {
    analyzer = new HeapAnalyzer();
    vi.clearAllMocks();
  });

  it('uses heap-level totalSize when blocks array is empty', () => {
    const stats = (analyzer as any)._computeStats(
      [
        {
          heapId: '0x100',
          processId: 1234,
          flags: 1,
          isDefault: true,
          blockCount: 0,
          totalSize: 4096, // heap reports size even without blocks
        },
      ],
      [], // empty blocks
    );
    expect(stats.totalSize).toBe(4096);
    expect(stats.totalBlocks).toBe(0);
    expect(stats.averageBlockSize).toBe(0);
  });

  it('computes usedSize = totalSize - freeSize correctly', () => {
    const blocks = [
      { address: '0x1000', size: 64, flags: 0x01, heapId: '0x100', isFree: false },
      { address: '0x2000', size: 32, flags: 0x02, heapId: '0x100', isFree: true },
    ];
    const stats = (analyzer as any)._computeStats(
      [
        {
          heapId: '0x100',
          processId: 1234,
          flags: 1,
          isDefault: true,
          blockCount: 2,
          totalSize: 96,
        },
      ],
      blocks as any,
    );
    expect(stats.usedSize).toBe(64);
    expect(stats.freeSize).toBe(32);
  });

  it('computes fragmentationRatio = freeSize / totalSize', () => {
    const blocks = [
      { address: '0x1000', size: 50, flags: 0x01, heapId: '0x100', isFree: false },
      { address: '0x2000', size: 50, flags: 0x02, heapId: '0x100', isFree: true },
    ];
    const stats = (analyzer as any)._computeStats(
      [
        {
          heapId: '0x100',
          processId: 1234,
          flags: 1,
          isDefault: true,
          blockCount: 2,
          totalSize: 100,
        },
      ],
      blocks as any,
    );
    expect(stats.fragmentationRatio).toBeCloseTo(0.5);
  });

  it('fragmentationRatio is 0 when totalSize is 0', () => {
    const stats = (analyzer as any)._computeStats([], []);
    expect(stats.fragmentationRatio).toBe(0);
  });

  it('averageBlockSize = 0 when blocks array is empty', () => {
    const stats = (analyzer as any)._computeStats([], []);
    expect(stats.averageBlockSize).toBe(0);
  });

  it('computes size distribution buckets correctly', () => {
    const blocks = [
      // 0-64B range
      { address: '0x1000', size: 32, flags: 0x01, heapId: '0x100', isFree: false },
      // 64-256B range
      { address: '0x2000', size: 128, flags: 0x01, heapId: '0x100', isFree: false },
      // 256B-1KB range
      { address: '0x3000', size: 512, flags: 0x01, heapId: '0x100', isFree: false },
      // 1-4KB range
      { address: '0x4000', size: 2048, flags: 0x01, heapId: '0x100', isFree: false },
    ];
    const stats = (analyzer as any)._computeStats([], blocks as any);
    expect(stats.sizeDistribution.length).toBe(8);
    expect(stats.sizeDistribution[0]!.count).toBe(1); // 32B in 0-64B
    expect(stats.sizeDistribution[1]!.count).toBe(1); // 128B in 64-256B
    expect(stats.sizeDistribution[2]!.count).toBe(1); // 512B in 256B-1KB
    expect(stats.sizeDistribution[3]!.count).toBe(1); // 2048B in 1-4KB
  });

  it('smallestBlock is 0 when all blocks are free', () => {
    const blocks = [{ address: '0x1000', size: 64, flags: 0x02, heapId: '0x100', isFree: true }];
    const stats = (analyzer as any)._computeStats([], blocks as any);
    expect(stats.smallestBlock).toBe(0); // no non-free blocks
    expect(stats.largestBlock).toBe(64);
  });

  it('largestBlock tracks the maximum block size', () => {
    const blocks = [
      { address: '0x1000', size: 10, flags: 0x01, heapId: '0x100', isFree: false },
      { address: '0x2000', size: 1024, flags: 0x01, heapId: '0x100', isFree: false },
    ];
    const stats = (analyzer as any)._computeStats([], blocks as any);
    expect(stats.largestBlock).toBe(1024);
  });
});

// ── classifyBlock: boundary cases ─────────────────────────────────────────────

describe('HeapAnalyzer coverage: classifyBlock() boundary cases', () => {
  let analyzer: HeapAnalyzer;

  beforeEach(() => {
    analyzer = new HeapAnalyzer();
  });

  // SIZE_RANGES:
  // ['0-64B', 0, 64]
  // ['64-256B', 64, 256]
  // ['256B-1KB', 256, 1024]
  // ['1-4KB', 1024, 4096]
  // ['4-16KB', 4096, 16384]
  // ['16-64KB', 16384, 65536]
  // ['64KB-1MB', 65536, 1048576]
  // ['>1MB', 1048576, Number.MAX_SAFE_INTEGER]

  // classifyBlock is a module-level function (not exported), so we test it
  // indirectly through _computeStats which uses it to populate sizeDistribution buckets.

  it('classifies size exactly at lower boundary (64) → bucket 1 (64-256B)', () => {
    // 64 >= 64 && 64 < 256 → index 1
    const stats = (analyzer as any)._computeStats(
      [],
      [{ address: '0x1000', size: 64, flags: 0x01, heapId: '0x100', isFree: false }],
    );
    expect(stats.sizeDistribution[1]!.count).toBe(1);
  });

  it('classifies size exactly at upper boundary (256) → bucket 2 (256B-1KB)', () => {
    // 256 >= 256 && 256 < 1024 → index 2
    const stats = (analyzer as any)._computeStats(
      [],
      [{ address: '0x1000', size: 256, flags: 0x01, heapId: '0x100', isFree: false }],
    );
    expect(stats.sizeDistribution[2]!.count).toBe(1);
  });

  it('classifies size exactly at 1KB boundary (1024) → bucket 3 (1-4KB)', () => {
    const stats = (analyzer as any)._computeStats(
      [],
      [{ address: '0x1000', size: 1024, flags: 0x01, heapId: '0x100', isFree: false }],
    );
    expect(stats.sizeDistribution[3]!.count).toBe(1);
  });

  it('classifies size exactly at 1MB boundary (1048576) → bucket 7 (>1MB)', () => {
    const stats = (analyzer as any)._computeStats(
      [],
      [{ address: '0x1000', size: 1048576, flags: 0x01, heapId: '0x100', isFree: false }],
    );
    expect(stats.sizeDistribution[7]!.count).toBe(1);
  });

  it('classifies 0-size block → bucket 0 (0-64B)', () => {
    const stats = (analyzer as any)._computeStats(
      [],
      [{ address: '0x1000', size: 0, flags: 0x01, heapId: '0x100', isFree: false }],
    );
    expect(stats.sizeDistribution[0]!.count).toBe(1);
  });

  it('classifies very large block → bucket 7 (>1MB)', () => {
    const stats = (analyzer as any)._computeStats(
      [],
      [{ address: '0x1000', size: 10 * 1024 * 1024, flags: 0x01, heapId: '0x100', isFree: false }],
    );
    expect(stats.sizeDistribution[7]!.count).toBe(1);
  });
});

// ── _detectSuspiciousSizes: zero-size edge ─────────────────────────────────────

describe('HeapAnalyzer coverage: _detectSuspiciousSizes()', () => {
  let analyzer: HeapAnalyzer;

  beforeEach(() => {
    analyzer = new HeapAnalyzer();
  });

  it('detects zero-size block as suspicious', () => {
    const anomalies: any[] = [];
    const blocks = [{ address: '0x1000', size: 0, flags: 0x01, heapId: '0x100', isFree: false }];
    (analyzer as any)._detectSuspiciousSizes(blocks as any, '0x100', anomalies);
    expect(anomalies.some((a) => a.type === 'suspicious_size' && a.details.includes('zero'))).toBe(
      true,
    );
  });

  it('detects block exceeding HEAP_SUSPICIOUS_BLOCK_SIZE', () => {
    const anomalies: any[] = [];
    const blocks = [
      { address: '0x1000', size: 200 * 1024 * 1024, flags: 0x01, heapId: '0x100', isFree: false },
    ];
    (analyzer as any)._detectSuspiciousSizes(blocks as any, '0x100', anomalies);
    expect(anomalies.some((a) => a.type === 'suspicious_size' && a.details.includes('MB'))).toBe(
      true,
    );
  });

  it('adds no anomalies for normal block sizes', () => {
    const anomalies: any[] = [];
    const blocks = [
      { address: '0x1000', size: 64, flags: 0x01, heapId: '0x100', isFree: false },
      { address: '0x2000', size: 256, flags: 0x01, heapId: '0x100', isFree: false },
    ];
    (analyzer as any)._detectSuspiciousSizes(blocks as any, '0x100', anomalies);
    expect(anomalies.filter((a) => a.type === 'suspicious_size')).toHaveLength(0);
  });
});

// ── _detectPossibleUAF: non-zero data in free block ───────────────────────────

describe('HeapAnalyzer coverage: _detectPossibleUAF()', () => {
  it('detects non-zero data in free block as potential UAF', async () => {
    const analyzer = new HeapAnalyzer();
    // ReadProcessMemory returns non-zero data for free block → UAF heuristic triggered
    const anomalies: any[] = [];
    await (analyzer as any)._detectPossibleUAF(
      1234,
      [{ address: '0x1000', size: 64, flags: 0x02, heapId: '0x100', isFree: true }],
      '0x100',
      anomalies,
    );
    expect(anomalies.some((a) => a.type === 'possible_uaf')).toBe(true);
  });

  it('skips non-free blocks in UAF check', async () => {
    const analyzer = new HeapAnalyzer();
    const anomalies: any[] = [];
    await (analyzer as any)._detectPossibleUAF(
      1234,
      [{ address: '0x1000', size: 64, flags: 0x01, heapId: '0x100', isFree: false }],
      '0x100',
      anomalies,
    );
    // Non-free blocks don't trigger UAF check
    expect(anomalies.some((a) => a.type === 'possible_uaf')).toBe(false);
  });
});

// ── _detectSpray: size tolerance boundary ─────────────────────────────────────

describe('HeapAnalyzer coverage: _detectSpray()', () => {
  let analyzer: HeapAnalyzer;

  beforeEach(() => {
    analyzer = new HeapAnalyzer();
  });

  it('detects spray pattern with HEAP_SPRAY_SIZE_TOLERANCE grouping', () => {
    const anomalies: any[] = [];
    // 4 blocks of size 64 (within tolerance of 16 from 64)
    const blocks = [
      { address: '0x1000', size: 64, flags: 0x01, heapId: '0x100', isFree: false },
      { address: '0x2000', size: 68, flags: 0x01, heapId: '0x100', isFree: false },
      { address: '0x3000', size: 72, flags: 0x01, heapId: '0x100', isFree: false },
      { address: '0x4000', size: 63, flags: 0x01, heapId: '0x100', isFree: false },
    ];
    (analyzer as any)._detectSpray(blocks as any, '0x100', anomalies);
    expect(anomalies.some((a) => a.type === 'heap_spray_pattern')).toBe(true);
  });

  it('skips spray detection for free blocks', () => {
    const anomalies: any[] = [];
    const blocks = [
      { address: '0x1000', size: 64, flags: 0x02, heapId: '0x100', isFree: true },
      { address: '0x2000', size: 64, flags: 0x02, heapId: '0x100', isFree: true },
      { address: '0x3000', size: 64, flags: 0x02, heapId: '0x100', isFree: true },
    ];
    (analyzer as any)._detectSpray(blocks as any, '0x100', anomalies);
    expect(anomalies.some((a) => a.type === 'heap_spray_pattern')).toBe(false);
  });
});
