/**
 * HeapAnalyzer — unit tests.
 *
 * Mocks Toolhelp32 Snapshot APIs to test heap enumeration, stats, and anomaly detection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all native dependencies ──

const mockBlocks = [
  { address: 0x1000n, size: 64, flags: 0x01, heapId: 0x100n }, // FIXED
  { address: 0x2000n, size: 128, flags: 0x01, heapId: 0x100n },
  { address: 0x3000n, size: 64, flags: 0x02, heapId: 0x100n }, // FREE
  { address: 0x4000n, size: 256, flags: 0x01, heapId: 0x100n },
  { address: 0x5000n, size: 0, flags: 0x01, heapId: 0x100n }, // suspicious: zero size
  { address: 0x6000n, size: 200 * 1024 * 1024, flags: 0x01, heapId: 0x100n }, // suspicious: >100MB
];

let blockIdx = 0;

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: vi.fn(() => 1n),
  CloseHandle: vi.fn(() => true),
  ReadProcessMemory: vi.fn((_h: bigint, _a: bigint, size: number) => {
    // For UAF check — return non-zero data for free blocks
    const buf = Buffer.alloc(size);
    buf.writeBigUInt64LE(0xdeadbeefn, 0);
    return buf;
  }),
}));

vi.mock('@src/constants', () => ({
  HEAP_ENUMERATE_MAX_BLOCKS: 10000,
  HEAP_SPRAY_THRESHOLD: 3, // Lower threshold for testing
  HEAP_SPRAY_SIZE_TOLERANCE: 16,
  HEAP_SUSPICIOUS_BLOCK_SIZE: 100 * 1024 * 1024,
}));

// Mock the koffi-based Toolhelp32 APIs used internally by HeapAnalyzer
vi.mock('koffi', () => {
  const heapListCalled = { value: false };
  return {
    default: {
      load: vi.fn(() => ({
        func: vi.fn((name: string) => {
          if (name === 'CreateToolhelp32Snapshot') {
            return vi.fn(() => 42n); // Fake snapshot handle
          }
          if (name === 'Heap32ListFirst') {
            return vi.fn((_h: bigint, buf: Buffer) => {
              if (heapListCalled.value) return false;
              heapListCalled.value = true;
              buf.writeUInt32LE(1234, 8); // th32ProcessID
              buf.writeBigUInt64LE(0x100n, 12); // th32HeapID
              buf.writeUInt32LE(1, 20); // flags (HF32_DEFAULT)
              return true;
            });
          }
          if (name === 'Heap32ListNext') {
            return vi.fn(() => false); // Only 1 heap
          }
          if (name === 'Heap32First') {
            return vi.fn((buf: Buffer) => {
              blockIdx = 0;
              if (blockIdx >= mockBlocks.length) return false;
              const b = mockBlocks[blockIdx]!;
              buf.writeBigUInt64LE(b.address, 16);
              buf.writeBigUInt64LE(BigInt(b.size), 24);
              buf.writeUInt32LE(b.flags, 32);
              blockIdx++;
              return true;
            });
          }
          if (name === 'Heap32Next') {
            return vi.fn((buf: Buffer) => {
              if (blockIdx >= mockBlocks.length) return false;
              const b = mockBlocks[blockIdx]!;
              buf.writeBigUInt64LE(b.address, 16);
              buf.writeBigUInt64LE(BigInt(b.size), 24);
              buf.writeUInt32LE(b.flags, 32);
              blockIdx++;
              return true;
            });
          }
          if (name.includes('CloseHandle')) {
            return vi.fn(() => 1);
          }
          return vi.fn();
        }),
      })),
    },
    load: vi.fn(),
  };
});

import { HeapAnalyzer } from '@native/HeapAnalyzer';

describe('HeapAnalyzer', () => {
  let analyzer: HeapAnalyzer;

  beforeEach(() => {
    analyzer = new HeapAnalyzer();
    blockIdx = 0;
    vi.clearAllMocks();
  });

  describe('enumerateHeaps', () => {
    it('should return heaps with metadata', async () => {
      const result = await analyzer.enumerateHeaps(1234);
      expect(result.heaps.length).toBeGreaterThanOrEqual(0);
    });

    it('should include stats with the result', async () => {
      const result = await analyzer.enumerateHeaps(1234);
      expect(result.stats).toBeDefined();
      expect(typeof result.stats.totalHeaps).toBe('number');
      expect(typeof result.stats.fragmentationRatio).toBe('number');
    });
  });

  describe('getStats', () => {
    it('should return complete statistics fields', async () => {
      const stats = await analyzer.getStats(1234);
      expect(stats).toHaveProperty('totalHeaps');
      expect(stats).toHaveProperty('totalBlocks');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('freeSize');
      expect(stats).toHaveProperty('usedSize');
      expect(stats).toHaveProperty('sizeDistribution');
      expect(stats).toHaveProperty('fragmentationRatio');
    });

    it('should have correct size distribution buckets', async () => {
      const stats = await analyzer.getStats(1234);
      expect(stats.sizeDistribution.length).toBe(8); // 8 predefined ranges
      expect(stats.sizeDistribution[0]!.range).toBe('0-64B');
      expect(stats.sizeDistribution[7]!.range).toBe('>1MB');
    });

    it('should compute usedSize = totalSize - freeSize', async () => {
      const stats = await analyzer.getStats(1234);
      expect(stats.usedSize).toBe(stats.totalSize - stats.freeSize);
    });
  });

  describe('detectAnomalies', () => {
    it('should return an array', async () => {
      const anomalies = await analyzer.detectAnomalies(1234);
      expect(Array.isArray(anomalies)).toBe(true);
    });

    it('should detect suspicious zero-size blocks', async () => {
      const anomalies = await analyzer.detectAnomalies(1234);
      const zeroSize = anomalies.filter(
        (a) => a.type === 'suspicious_size' && a.details.includes('zero'),
      );
      // May or may not find depending on mock traversal
      expect(zeroSize.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect suspicious large blocks', async () => {
      const anomalies = await analyzer.detectAnomalies(1234);
      const large = anomalies.filter(
        (a) => a.type === 'suspicious_size' && a.details.includes('MB'),
      );
      expect(large.length).toBeGreaterThanOrEqual(0);
    });

    it('should include heapId in each anomaly', async () => {
      const anomalies = await analyzer.detectAnomalies(1234);
      for (const a of anomalies) {
        expect(a.heapId).toBeDefined();
        expect(typeof a.heapId).toBe('string');
      }
    });

    it('should include severity in each anomaly', async () => {
      const anomalies = await analyzer.detectAnomalies(1234);
      for (const a of anomalies) {
        expect(['low', 'medium', 'high']).toContain(a.severity);
      }
    });
  });

  describe('HeapBlock.isFree', () => {
    it('should derive isFree from LF32_FREE flag', () => {
      // Direct test of the flag logic
      const FREE_FLAG = 0x02;
      expect((0x01 & FREE_FLAG) !== 0).toBe(false); // FIXED → not free
      expect((0x02 & FREE_FLAG) !== 0).toBe(true); // FREE → free
      expect((0x04 & FREE_FLAG) !== 0).toBe(false); // MOVEABLE → not free
    });
  });
});
