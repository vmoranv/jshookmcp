/**
 * Tests for process hollowing detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HollowingDetectionHandlers } from '@server/domains/process/handlers/hollowing-detection';

// Mock native modules
vi.mock('@native/PEAnalyzer');
vi.mock('@native/Win32API');
vi.mock('@utils/logger');

describe('HollowingDetectionHandlers', () => {
  let handlers: HollowingDetectionHandlers;

  beforeEach(() => {
    handlers = new HollowingDetectionHandlers();
    vi.clearAllMocks();
  });

  describe('handleDetectHollowing', () => {
    it('should detect normal (non-hollowed) process', async () => {
      // Mock Win32 APIs
      const {
        openProcessForMemory,
        CloseHandle,
        EnumProcessModules,
        GetModuleFileNameEx,
        GetModuleInformation,
        ReadProcessMemory,
      } = await import('@native/Win32API');
      vi.mocked(openProcessForMemory).mockReturnValue(BigInt(0x1234));
      vi.mocked(CloseHandle).mockImplementation((_hObject: bigint) => true);
      vi.mocked(ReadProcessMemory).mockReturnValue(Buffer.alloc(100));
      vi.mocked(EnumProcessModules).mockReturnValue({
        success: true,
        modules: [BigInt(0x400000)],
        count: 1,
      });
      vi.mocked(GetModuleFileNameEx).mockReturnValue('C:\\Windows\\System32\\notepad.exe');
      vi.mocked(GetModuleInformation).mockReturnValue({
        success: true,
        info: {
          lpBaseOfDll: BigInt(0x400000),
          SizeOfImage: 0x100000,
          EntryPoint: BigInt(0x401000),
        },
      });

      // Mock PEAnalyzer to return matching hashes (no hollowing)
      const { PEAnalyzer } = await import('@native/PEAnalyzer');
      const mockCompare = vi.fn().mockResolvedValue({
        isMatch: true,
        confidence: 100,
        differences: [],
      });
      vi.mocked(PEAnalyzer).mockImplementation(
        () =>
          ({
            compareMemoryWithDisk: mockCompare,
          }) as any,
      );

      const result = await handlers.handleDetectHollowing({ pid: 1234 });

      expect(result.success).toBe(true);
      expect(result.isHollowed).toBe(false);
      expect(result.confidence).toBe(100);
      expect(result.differences).toEqual([]);
    });

    it('should detect hollowed process (hash mismatch)', async () => {
      const {
        openProcessForMemory,
        CloseHandle,
        EnumProcessModules,
        GetModuleFileNameEx,
        GetModuleInformation,
        ReadProcessMemory,
      } = await import('@native/Win32API');
      vi.mocked(openProcessForMemory).mockReturnValue(BigInt(0x1234));
      vi.mocked(CloseHandle).mockImplementation((_hObject: bigint) => true);
      vi.mocked(ReadProcessMemory).mockReturnValue(Buffer.alloc(100));
      vi.mocked(EnumProcessModules).mockReturnValue({
        success: true,
        modules: [BigInt(0x400000)],
        count: 1,
      });
      vi.mocked(GetModuleFileNameEx).mockReturnValue('C:\\Windows\\System32\\svchost.exe');
      vi.mocked(GetModuleInformation).mockReturnValue({
        success: true,
        info: {
          lpBaseOfDll: BigInt(0x400000),
          SizeOfImage: 0x100000,
          EntryPoint: BigInt(0x401000),
        },
      });

      const { PEAnalyzer } = await import('@native/PEAnalyzer');
      const mockCompare = vi.fn().mockResolvedValue({
        isMatch: false,
        confidence: 45,
        differences: [
          {
            sectionName: '.text',
            offsetStart: 0x1000,
            offsetEnd: 0x50000,
            memoryHash: 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
            diskHash: 'cafebabe1234567890abcdef1234567890abcdef1234567890abcdef12345678',
            bytesCompared: 0x4f000,
          },
        ],
      });
      vi.mocked(PEAnalyzer).mockImplementation(
        () =>
          ({
            compareMemoryWithDisk: mockCompare,
          }) as any,
      );

      const result = await handlers.handleDetectHollowing({ pid: 5678 });

      expect(result.success).toBe(true);
      expect(result.isHollowed).toBe(true);
      expect(result.confidence).toBe(45);
      expect(result.differences).toBeDefined();
      expect(result.differences).toHaveLength(1);
      expect(result.differences?.[0]?.section).toBe('.text');
      expect(result.warning).toContain('hollowed');
    });

    it('should return error when no modules found', async () => {
      const { openProcessForMemory, CloseHandle, EnumProcessModules } =
        await import('@native/Win32API');
      vi.mocked(openProcessForMemory).mockReturnValue(BigInt(0x1234));
      vi.mocked(CloseHandle).mockImplementation((_hObject: bigint) => true);
      vi.mocked(EnumProcessModules).mockReturnValue({
        success: false,
        modules: [],
        count: 0,
      });

      const result = await handlers.handleDetectHollowing({ pid: 9999 });

      expect(result.success).toBe(false);
      expect(result.isHollowed).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.error).toContain('No modules found');
    });

    it('should return error when GetModuleFileNameEx fails', async () => {
      const { openProcessForMemory, CloseHandle, EnumProcessModules, GetModuleFileNameEx } =
        await import('@native/Win32API');
      vi.mocked(openProcessForMemory).mockReturnValue(BigInt(0x1234));
      vi.mocked(CloseHandle).mockImplementation((_hObject: bigint) => true);
      vi.mocked(EnumProcessModules).mockReturnValue({
        success: true,
        modules: [BigInt(0x400000)],
        count: 1,
      });
      vi.mocked(GetModuleFileNameEx).mockReturnValue(null);

      const result = await handlers.handleDetectHollowing({ pid: 1234 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to get module path');
    });
  });
});
