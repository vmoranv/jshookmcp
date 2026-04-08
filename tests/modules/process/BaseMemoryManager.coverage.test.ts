import { describe, expect, it } from 'vitest';
import { BaseMemoryManager } from '@modules/process/BaseMemoryManager';
import type {
  MemoryProtectionInfo,
  MemoryReadResult,
  MemoryScanResult,
  MemoryWriteResult,
  ModuleInfo,
  PatternType,
} from '@modules/process/types';

/**
 * Coverage expansion for BaseMemoryManager.convertPatternToBytes.
 * Fills untested branches beyond tests/modules/process/BaseMemoryManager.test.ts:
 * - hex pattern with '**' wildcard
 * - hex pattern with '?' single-char wildcard
 * - hex pattern with empty/whitespace input
 * - int32 pattern with NaN (skips byte)
 * - int64 pattern when BigInt throws on invalid input
 * - float pattern with NaN (skips bytes)
 * - double pattern with NaN (skips bytes)
 */

class TestMemoryManager extends BaseMemoryManager {
  readonly platform = 'test';

  readMemory(_pid: number, _address: number, _size: number): Promise<MemoryReadResult> {
    return Promise.resolve({ success: true, data: '' });
  }
  writeMemory(_pid: number, _address: number, _data: Buffer): Promise<MemoryWriteResult> {
    return Promise.resolve({ success: true, bytesWritten: 0 });
  }
  scanMemory(_pid: number, _pattern: string, _patternType: PatternType): Promise<MemoryScanResult> {
    return Promise.resolve({ success: true, addresses: [] });
  }
  checkMemoryProtection(_pid: number, _address: number): Promise<MemoryProtectionInfo> {
    return Promise.resolve({ success: true, isReadable: true });
  }
  enumerateRegions(_pid: number): Promise<{ success: boolean; regions?: ModuleInfo[]; error?: string }> {
    return Promise.resolve({ success: true, regions: [] });
  }
  enumerateModules(_pid: number): Promise<{ success: boolean; modules?: ModuleInfo[]; error?: string }> {
    return Promise.resolve({ success: true, modules: [] });
  }
  dumpMemoryRegion(
    _pid: number,
    _address: number,
    _size: number,
    _outputPath: string,
  ): Promise<{ success: boolean; error?: string }> {
    return Promise.resolve({ success: true });
  }
  injectDll(_pid: number, _dllPath: string): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    return Promise.resolve({ success: true, remoteThreadId: 1 });
  }
  injectShellcode(_pid: number, _shellcode: Buffer): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    return Promise.resolve({ success: true, remoteThreadId: 1 });
  }
  checkDebugPort(_pid: number): Promise<{ success: boolean; isDebugged?: boolean; error?: string }> {
    return Promise.resolve({ success: true, isDebugged: false });
  }
  checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    return Promise.resolve({ available: true });
  }

  convert(pattern: string, type: PatternType) {
    return this.convertPatternToBytes(pattern, type);
  }
}

describe('BaseMemoryManager.convertPatternToBytes - coverage expansion', () => {
  const mgr = new TestMemoryManager();

  // ── hex wildcard variants ───────────────────────────────────────────────────

  describe('hex wildcards', () => {
    it('treats "**" as a wildcard byte (mask bit = 0)', () => {
      const result = mgr.convert('AA ** BB CC', 'hex');
      expect(result.bytes).toEqual([0xaa, 0x00, 0xbb, 0xcc]);
      expect(result.mask).toEqual([1, 0, 1, 1]);
    });

    it('treats "?" as a single-char wildcard (mask bit = 0)', () => {
      const result = mgr.convert('?A B?', 'hex');
      expect(result.bytes).toEqual([0x00, 0x41, 0x20, 0x00]);
      expect(result.mask).toEqual([0, 1, 1, 0]);
    });

    it('handles empty hex pattern gracefully', () => {
      const result = mgr.convert('', 'hex');
      expect(result.bytes).toEqual([]);
      expect(result.mask).toEqual([]);
    });

    it('handles whitespace-only hex pattern', () => {
      const result = mgr.convert('   ', 'hex');
      expect(result.bytes).toEqual([]);
      expect(result.mask).toEqual([]);
    });
  });

  // ── numeric pattern NaN branches ───────────────────────────────────────────

  describe('numeric patterns with NaN values', () => {
    it('skips bytes when int32 pattern is not a number', () => {
      const result = mgr.convert('not-a-number', 'int32');
      // parseInt returns NaN → skipped → empty
      expect(result.bytes).toEqual([]);
      expect(result.mask).toEqual([]);
    });

    it('skips bytes when float pattern is not a number', () => {
      const result = mgr.convert('not-a-float', 'float');
      // parseFloat returns NaN → skipped → empty
      expect(result.bytes).toEqual([]);
      expect(result.mask).toEqual([]);
    });

    it('skips bytes when double pattern is not a number', () => {
      const result = mgr.convert('not-a-double', 'double');
      // parseFloat returns NaN → skipped → empty
      expect(result.bytes).toEqual([]);
      expect(result.mask).toEqual([]);
    });
  });

  // ── int64 error branch ─────────────────────────────────────────────────────

  describe('int64 pattern error handling', () => {
    it('propagates BigInt error when int64 pattern is not a valid integer string', () => {
      // BigInt('abc') throws a SyntaxError which propagates from convertPatternToBytes
      expect(() => mgr.convert('abc', 'int64')).toThrow(SyntaxError);
    });
  });

  // ── integer conversion correctness ────────────────────────────────────────

  describe('integer conversions produce correct byte sizes', () => {
    it('produces 4 bytes for int32', () => {
      const result = mgr.convert('12345678', 'int32');
      expect(result.bytes.length).toBe(4);
      expect(result.mask.length).toBe(4);
      // All mask bits should be 1
      expect(result.mask.every((m) => m === 1)).toBe(true);
    });

    it('produces 8 bytes for int64', () => {
      const result = mgr.convert('123456789', 'int64');
      expect(result.bytes.length).toBe(8);
      expect(result.mask.length).toBe(8);
      expect(result.mask.every((m) => m === 1)).toBe(true);
    });

    it('produces 4 bytes for float', () => {
      const result = mgr.convert('3.14159', 'float');
      expect(result.bytes.length).toBe(4);
      expect(result.mask.length).toBe(4);
    });

    it('produces 8 bytes for double', () => {
      const result = mgr.convert('3.14159', 'double');
      expect(result.bytes.length).toBe(8);
      expect(result.mask.length).toBe(8);
    });
  });

  // ── string pattern ─────────────────────────────────────────────────────────

  describe('string pattern', () => {
    it('produces correct bytes and full mask for ASCII string', () => {
      const result = mgr.convert('Hi', 'string');
      expect(result.bytes).toEqual([72, 105]);
      expect(result.mask).toEqual([1, 1]);
    });

    it('produces empty arrays for empty string', () => {
      const result = mgr.convert('', 'string');
      expect(result.bytes).toEqual([]);
      expect(result.mask).toEqual([]);
    });
  });

  // ── mixed wildcard and real bytes ──────────────────────────────────────────

  describe('mixed hex wildcards and real bytes', () => {
    it('handles multiple wildcards interspersed with real bytes', () => {
      const result = mgr.convert('?? AA ?? ?? BB ??', 'hex');
      expect(result.bytes.length).toBe(6);
      expect(result.mask.filter((m) => m === 0).length).toBe(3); // 3 wildcards
      expect(result.mask.filter((m) => m === 1).length).toBe(3); // 3 real bytes
    });
  });
});
