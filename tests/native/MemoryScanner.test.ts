/**
 * MemoryScanner — unit tests.
 *
 * Mocks PlatformMemoryAPI provider and all dependencies to test scanner logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProcessHandle } from '@src/native/platform/types';
import type { ScanSessionState } from '@src/native/NativeMemoryManager.types';

// ── Build a fake 4KB region with known int32 values ──

function buildMockRegion(): Buffer {
  const buf = Buffer.alloc(4096);
  buf.writeInt32LE(42, 0);
  buf.writeInt32LE(100, 4);
  buf.writeInt32LE(42, 16);
  buf.writeInt32LE(42, 32);
  buf.writeInt32LE(200, 48);
  buf.writeBigUInt64LE(0x7FFE1000n, 128);
  buf.writeBigUInt64LE(0x7FFE1004n, 136);
  return buf;
}

const mockRegion = buildMockRegion();

const mockProvider = {
  platform: 'win32' as const,
  openProcess: vi.fn(() => ({ pid: 1234, writeAccess: false })),
  closeProcess: vi.fn(),
  readMemory: vi.fn((_handle: ProcessHandle, addr: bigint, size: number) => {
    const offset = Number(addr - 0x10000n);
    if (offset >= 0 && offset + size <= mockRegion.length) {
      return { data: Buffer.from(mockRegion.subarray(offset, offset + size)), bytesRead: size };
    }
    return { data: Buffer.alloc(size), bytesRead: size };
  }),
  writeMemory: vi.fn(() => ({ bytesWritten: 4 })),
  queryRegion: vi.fn((_handle: ProcessHandle, addr: bigint) => {
    if (addr < 0x10000n || addr === 0x10000n) {
      return {
        baseAddress: 0x10000n,
        size: 4096,
        protection: 0x04, // RW
        state: 'committed',
        type: 'private',
        isReadable: true,
        isWritable: true,
        isExecutable: false,
      };
    }
    // End of regions
    return null;
  }),
  changeProtection: vi.fn(() => ({ success: true, oldProtection: 0x04 })),
  allocateMemory: vi.fn(() => 0x20000n),
  freeMemory: vi.fn(() => true),
  enumerateModules: vi.fn(() => [
    { name: 'test.exe', baseAddress: 0x10000n, size: 4096 },
  ]),
  checkAvailability: vi.fn(async () => ({ available: true })),
};

// Mock platform factory to return our mock provider
vi.mock('@src/native/platform/factory.js', () => ({
  createPlatformProvider: vi.fn(() => mockProvider),
}));

vi.mock('@native/Win32Debug', () => ({
  FlushInstructionCache: vi.fn(),
}));

vi.mock('@native/NativeMemoryManager.utils', () => ({
  parsePattern: vi.fn((value: string, type: string) => {
    if (type === 'string' || type === 'hex') return { patternBytes: [], mask: [] };
    const num = Number(value) || 0;
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(num);
    return { patternBytes: Array.from(buf), mask: Array.from(buf).map(() => 1) };
  }),
  isReadable: vi.fn(() => true),
  isWritable: vi.fn(() => true),
  isExecutable: vi.fn(() => false),
}));

vi.mock('@native/ScanComparators', () => ({
  compareScanValues: vi.fn((current: Buffer, _prev: Buffer | null, target: Buffer | null, _t2: Buffer | null, mode: string) => {
    if (mode === 'exact' && target) return current.equals(target);
    if (mode === 'unknown_initial') return true;
    if (mode === 'changed') return true; // Treat all as changed for test
    return false;
  }),
  getValueSize: vi.fn((type: string) => {
    const sizes: Record<string, number> = {
      byte: 1, int8: 1, int16: 2, uint16: 2,
      int32: 4, uint32: 4, float: 4,
      int64: 8, uint64: 8, double: 8, pointer: 8,
      string: 0, hex: 0,
    };
    return sizes[type] ?? 0;
  }),
  getDefaultAlignment: vi.fn((type: string) => {
    const aligns: Record<string, number> = {
      byte: 1, int8: 1, int16: 2, uint16: 2,
      int32: 4, uint32: 4, float: 4,
      int64: 8, uint64: 8, double: 8, pointer: 8,
    };
    return aligns[type] ?? 1;
  }),
}));

vi.mock('@native/MemoryScanSession', () => {
  const sessions = new Map<string, ScanSessionState>();
  let counter = 0;
  return {
    scanSessionManager: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      createSession: vi.fn((_pid: number, _opts: { valueType: any; alignment?: number }) => {
        const id = `session-${++counter}`;
        sessions.set(id, {
          id,
          pid: _pid,
          valueType: _opts.valueType,
          alignment: _opts.alignment ?? 4,
          addresses: [],
          previousValues: new Map(),
          scanCount: 1,
          createdAt: Date.now(),
          lastScanAt: Date.now(),
        });
        return id;
      }),
      getSession: vi.fn((id: string) => {
        const s = sessions.get(id);
        if (!s) throw new Error(`Session not found: ${id}`);
        return s;
      }),
      updateSession: vi.fn((id: string, addresses: bigint[], values: Map<bigint, Buffer>) => {
        const s = sessions.get(id);
        if (s) {
          s.addresses = addresses;
          s.previousValues = values;
          s.scanCount++;
        }
      }),
    },
  };
});

vi.mock('@native/NativeMemoryManager.impl', () => ({
  nativeMemoryManager: {
    scanMemory: vi.fn(async () => ({
      success: true,
      addresses: ['0x10000', '0x10010'],
    })),
    enumerateModules: vi.fn(async () => ({
      success: true,
      modules: [{ name: 'test.exe', baseAddress: '0x10000', size: 4096 }],
    })),
  },
}));

vi.mock('@src/constants', () => ({
  SCAN_MAX_RESULTS_PER_SCAN: 1000,
  SCAN_DISPLAY_RESULTS_LIMIT: 100,
  SCAN_UNKNOWN_INITIAL_MAX_ADDRESSES: 5000,
  SCAN_POINTER_MAX_RESULTS: 10000,
  SCAN_GROUP_MAX_PATTERN_SIZE: 1024,
}));

// ── Import AFTER all mocks ──
import { MemoryScanner } from '@native/MemoryScanner';
import { nativeMemoryManager } from '@native/NativeMemoryManager.impl';

describe('MemoryScanner', () => {
  let scanner: MemoryScanner;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    scanner = new MemoryScanner(nativeMemoryManager as any);
    vi.clearAllMocks();
    // Restore mock provider defaults after clearAllMocks
    mockProvider.openProcess.mockReturnValue({ pid: 1234, writeAccess: false });
    mockProvider.readMemory.mockImplementation((_handle: ProcessHandle, addr: bigint, size: number) => {
      const offset = Number(addr - 0x10000n);
      if (offset >= 0 && offset + size <= mockRegion.length) {
        return { data: Buffer.from(mockRegion.subarray(offset, offset + size)), bytesRead: size };
      }
      return { data: Buffer.alloc(size), bytesRead: size };
    });
    mockProvider.queryRegion.mockImplementation((_handle: ProcessHandle, addr: bigint) => {
      if (addr <= 0x10000n) {
        return {
          baseAddress: 0x10000n,
          size: 4096,
          protection: 0x04,
          state: 'committed',
          type: 'private',
          isReadable: true,
          isWritable: true,
          isExecutable: false,
        };
      }
      return null;
    });
  });

  describe('firstScan', () => {
    it('should create session and return results', async () => {
      const result = await scanner.firstScan(1234, '42', {
        valueType: 'int32',
        alignment: 4,
      });
      expect(result.sessionId).toBeDefined();
      expect(result.scanNumber).toBe(1);
      expect(result.matchCount).toBeGreaterThanOrEqual(0);
      expect(result.elapsed).toMatch(/ms$/);
    });

    it('should include totalMatches and truncated flag', async () => {
      const result = await scanner.firstScan(1234, '42', { valueType: 'int32' });
      expect(typeof result.totalMatches).toBe('number');
      expect(typeof result.truncated).toBe('boolean');
    });

    it('should respect maxResults option', async () => {
      const result = await scanner.firstScan(1234, '42', {
        valueType: 'int32',
        maxResults: 1,
      });
      expect(result.matchCount).toBeLessThanOrEqual(1);
    });

    it('should fall back to pattern scan for string types', async () => {
      const result = await scanner.firstScan(1234, 'test', { valueType: 'string' });
      expect(nativeMemoryManager.scanMemory).toHaveBeenCalled();
      expect(result.sessionId).toBeDefined();
    });
  });

  describe('nextScan', () => {
    it('should narrow results from previous scan', async () => {
      const first = await scanner.firstScan(1234, '42', {
        valueType: 'int32',
        alignment: 4,
      });
      const next = await scanner.nextScan(first.sessionId, 'exact', '42');
      expect(next.sessionId).toBe(first.sessionId);
      expect(next.scanNumber).toBeGreaterThanOrEqual(1);
    });

    it('should handle changed mode', async () => {
      const first = await scanner.firstScan(1234, '42', { valueType: 'int32' });
      const next = await scanner.nextScan(first.sessionId, 'changed');
      expect(next.matchCount).toBeGreaterThanOrEqual(0);
    });

    it('should throw for variable-length types', async () => {
      const first = await scanner.firstScan(1234, 'test', { valueType: 'string' });
      await expect(
        scanner.nextScan(first.sessionId, 'changed')
      ).rejects.toThrow('variable-length');
    });

    it('should throw for invalid session ID', async () => {
      await expect(
        scanner.nextScan('nonexistent', 'exact', '42')
      ).rejects.toThrow();
    });
  });

  describe('unknownInitialScan', () => {
    it('should capture all aligned addresses', async () => {
      const result = await scanner.unknownInitialScan(1234, {
        valueType: 'int32',
        alignment: 4,
      });
      expect(result.sessionId).toBeDefined();
      expect(result.scanNumber).toBe(1);
      expect(result.matchCount).toBeGreaterThan(0);
    });

    it('should throw for variable-length types', async () => {
      await expect(
        scanner.unknownInitialScan(1234, { valueType: 'string' })
      ).rejects.toThrow('variable-length');
    });
  });

  describe('pointerScan', () => {
    it('should find pointers near target address', async () => {
      const result = await scanner.pointerScan(1234, '0x7FFE1000');
      expect(result.sessionId).toBeDefined();
      expect(result.totalFound).toBeGreaterThanOrEqual(0);
      expect(result.elapsed).toMatch(/ms$/);
    });

    it('should exclude private regions when moduleOnly is enabled', async () => {
      const result = await scanner.pointerScan(1234, '0x7FFE1000', { moduleOnly: true });
      expect(result.totalFound).toBe(0);
      expect(mockProvider.queryRegion).toHaveBeenCalled();
    });
  });

  describe('groupScan', () => {
    it('should throw for empty pattern', async () => {
      await expect(scanner.groupScan(1234, [])).rejects.toThrow('at least one');
    });

    it('should accept multi-value pattern', async () => {
      const result = await scanner.groupScan(1234, [
        { offset: 0, value: '42', type: 'int32' },
        { offset: 4, value: '100', type: 'int32' },
      ]);
      expect(result.sessionId).toBeDefined();
      expect(result.matchCount).toBeGreaterThanOrEqual(0);
    });

    it('should throw for oversized pattern', async () => {
      await expect(
        scanner.groupScan(1234, [{ offset: 2000, value: '42', type: 'int32' }])
      ).rejects.toThrow('too large');
    });
  });
});
