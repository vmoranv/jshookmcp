/**
 * Tests for process hollowing detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock factories ──

const mockCompareMemoryWithDisk = vi.fn();
const mockParsePEFromBuffer = vi.fn();
const mockOpenProcessForMemory = vi.fn();
const mockCloseHandle = vi.fn();
const mockEnumProcessModules = vi.fn();
const mockGetModuleFileNameEx = vi.fn();
const mockGetModuleInformation = vi.fn();
const mockReadProcessMemory = vi.fn();
const mockReadFile = vi.fn();

vi.mock('node:fs', () => ({
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

vi.mock('@native/PEAnalyzer', () => {
  return {
    PEAnalyzer: class {
      compareMemoryWithDisk = mockCompareMemoryWithDisk;
      parsePEFromBuffer = mockParsePEFromBuffer;
    },
  };
});

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: (...args: any[]) => mockOpenProcessForMemory(...args),
  CloseHandle: (...args: any[]) => mockCloseHandle(...args),
  EnumProcessModules: (...args: any[]) => mockEnumProcessModules(...args),
  GetModuleFileNameEx: (...args: any[]) => mockGetModuleFileNameEx(...args),
  GetModuleInformation: (...args: any[]) => mockGetModuleInformation(...args),
  ReadProcessMemory: (...args: any[]) => mockReadProcessMemory(...args),
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { HollowingDetectionHandlers } from '@server/domains/process/handlers/hollowing-detection';

type HollowingTestResult = {
  success: boolean;
  isHollowed: boolean;
  confidence: number;
  differences?: Array<{
    memoryBytes?: string;
    diskBytes?: string;
  }>;
  memoryDump?: {
    included: true;
    truncated: boolean;
    totalBytes: number;
  };
  error?: string;
};

describe('HollowingDetectionHandlers', () => {
  let handlers: HollowingDetectionHandlers;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOpenProcessForMemory.mockReturnValue(BigInt(0x1234));
    mockCloseHandle.mockImplementation(() => {});
    mockReadProcessMemory.mockReturnValue(Buffer.alloc(100));
    mockEnumProcessModules.mockReturnValue({
      success: true,
      modules: [BigInt(0x400000)],
      count: 1,
    });
    mockGetModuleFileNameEx.mockReturnValue('C:\\Windows\\System32\\notepad.exe');
    mockGetModuleInformation.mockReturnValue({
      success: true,
      info: {
        lpBaseOfDll: BigInt(0x400000),
        SizeOfImage: 0x100000,
        EntryPoint: BigInt(0x401000),
      },
    });

    handlers = new HollowingDetectionHandlers();
  });

  describe('handleDetectHollowing', () => {
    it('should detect normal (non-hollowed) process', async () => {
      mockCompareMemoryWithDisk.mockResolvedValue({
        isMatch: true,
        confidence: 100,
        differences: [],
      });

      const result = await handlers.handleDetectHollowing({ pid: 1234 });

      expect(result.success).toBe(true);
      expect(result.isHollowed).toBe(false);
      expect(result.confidence).toBe(100);
    });

    it('should detect hollowed process (hash mismatch)', async () => {
      mockCompareMemoryWithDisk.mockResolvedValue({
        isMatch: false,
        confidence: 45,
        differences: [
          {
            sectionName: '.text',
            offsetStart: 0x1000,
            offsetEnd: 0x50000,
            memoryHash: 'deadbeef...',
            diskHash: 'cafebabe...',
            bytesCompared: 0x4f000,
          },
        ],
      });

      const result = await handlers.handleDetectHollowing({ pid: 5678 });

      expect(result.success).toBe(true);
      expect(result.isHollowed).toBe(true);
      expect(result.confidence).toBe(45);
      expect(result.differences).toBeDefined();
      expect(result.differences).toHaveLength(1);
    });

    it('should attach memoryBytes/diskBytes when includeMemoryDump=true', async () => {
      const memoryBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      const diskBytes = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
      // Build a disk buffer whose .text slice (pointerToRawData=0x200, readSize=4) yields diskBytes
      const diskBuffer = Buffer.alloc(0x400);
      diskBytes.copy(diskBuffer, 0x200);

      mockReadFile.mockResolvedValue(diskBuffer);
      mockReadProcessMemory.mockReturnValue(memoryBytes);
      mockParsePEFromBuffer.mockReturnValue({
        fileHeader: { machine: 0x8664, numberOfSections: 1, timeDateStamp: 0 },
        sections: [
          {
            name: '.text',
            virtualAddress: 0x1000,
            virtualSize: 0x4f000,
            pointerToRawData: 0x200,
            sizeOfRawData: 0x4f000,
          },
        ],
      });
      mockCompareMemoryWithDisk.mockResolvedValue({
        isMatch: false,
        confidence: 45,
        differences: [
          {
            sectionName: '.text',
            offsetStart: 0x1000,
            offsetEnd: 0x50000,
            memoryHash: 'deadbeef...',
            diskHash: 'cafebabe...',
            bytesCompared: 0x4,
          },
        ],
      });

      const result = (await handlers.handleDetectHollowing({
        pid: 5678,
        includeMemoryDump: true,
      })) as HollowingTestResult;
      const [difference] = result.differences ?? [];

      expect(result.success).toBe(true);
      expect(result.isHollowed).toBe(true);
      expect(result.differences).toHaveLength(1);
      expect(difference?.memoryBytes).toBe('deadbeef');
      expect(difference?.diskBytes).toBe('cafebabe');
      expect(result.memoryDump).toEqual({ included: true, truncated: false, totalBytes: 4 });
      // ReadProcessMemory called with moduleBase (0x400000) + offsetStart (0x1000)
      expect(mockReadProcessMemory).toHaveBeenCalledWith(
        BigInt(0x1234),
        BigInt(0x400000) + BigInt(0x1000),
        4,
      );
    });

    it('should mark truncated=true when bytesCompared exceeds 65536', async () => {
      const memoryBytes = Buffer.alloc(65536, 0xab);
      const diskBuffer = Buffer.alloc(0x40000 + 0x200);
      mockReadFile.mockResolvedValue(diskBuffer);
      mockReadProcessMemory.mockReturnValue(memoryBytes);
      mockParsePEFromBuffer.mockReturnValue({
        fileHeader: { machine: 0x8664, numberOfSections: 1, timeDateStamp: 0 },
        sections: [
          {
            name: '.text',
            virtualAddress: 0x1000,
            virtualSize: 0x50000,
            pointerToRawData: 0x200,
            sizeOfRawData: 0x50000,
          },
        ],
      });
      mockCompareMemoryWithDisk.mockResolvedValue({
        isMatch: false,
        confidence: 45,
        differences: [
          {
            sectionName: '.text',
            offsetStart: 0x1000,
            offsetEnd: 0x50000,
            memoryHash: 'deadbeef...',
            diskHash: 'cafebabe...',
            bytesCompared: 0x50000, // > 65536
          },
        ],
      });

      const result = (await handlers.handleDetectHollowing({
        pid: 5678,
        includeMemoryDump: true,
      })) as HollowingTestResult;
      const [difference] = result.differences ?? [];

      expect(result.memoryDump).toEqual({ included: true, truncated: true, totalBytes: 65536 });
      // memoryBytes hex string should be 65536*2 = 131072 chars
      expect(difference?.memoryBytes?.length).toBe(131072);
    });

    it('should omit memoryDump when includeMemoryDump is false (default)', async () => {
      mockCompareMemoryWithDisk.mockResolvedValue({
        isMatch: false,
        confidence: 45,
        differences: [
          {
            sectionName: '.text',
            offsetStart: 0x1000,
            offsetEnd: 0x50000,
            memoryHash: 'deadbeef...',
            diskHash: 'cafebabe...',
            bytesCompared: 0x4f000,
          },
        ],
      });

      const result = (await handlers.handleDetectHollowing({
        pid: 5678,
      })) as HollowingTestResult;
      const [difference] = result.differences ?? [];

      expect(result.memoryDump).toBeUndefined();
      expect(difference?.memoryBytes).toBeUndefined();
      expect(difference?.diskBytes).toBeUndefined();
    });

    it('should return error when no modules found', async () => {
      mockEnumProcessModules.mockReturnValue({
        success: false,
        modules: [],
        count: 0,
      });

      const result = await handlers.handleDetectHollowing({ pid: 9999 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No modules found');
    });

    it('should return error when GetModuleFileNameEx fails', async () => {
      mockGetModuleFileNameEx.mockReturnValue(null);

      const result = await handlers.handleDetectHollowing({ pid: 1234 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get module path');
    });
  });
});
