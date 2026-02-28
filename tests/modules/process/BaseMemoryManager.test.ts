import { describe, expect, it } from 'vitest';
import { BaseMemoryManager } from '../../../src/modules/process/BaseMemoryManager.js';
import type {
  MemoryProtectionInfo,
  MemoryReadResult,
  MemoryScanResult,
  MemoryWriteResult,
  ModuleInfo,
  PatternType,
} from '../../../src/modules/process/types.js';

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
    _outputPath: string
  ): Promise<{ success: boolean; error?: string }> {
    return Promise.resolve({ success: true });
  }
  injectDll(_pid: number, _dllPath: string): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
    return Promise.resolve({ success: true, remoteThreadId: 1 });
  }
  injectShellcode(
    _pid: number,
    _shellcode: Buffer
  ): Promise<{ success: boolean; remoteThreadId?: number; error?: string }> {
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

describe('BaseMemoryManager', () => {
  it('converts hex pattern with wildcard bytes', () => {
    const mgr = new TestMemoryManager();
    const result = mgr.convert('AA ?? BB', 'hex');

    expect(result.bytes).toEqual([0xaa, 0x00, 0xbb]);
    expect(result.mask).toEqual([1, 0, 1]);
  });

  it('converts int32 pattern in little-endian form', () => {
    const mgr = new TestMemoryManager();
    const result = mgr.convert('305419896', 'int32'); // 0x12345678

    expect(result.bytes).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(result.mask).toEqual([1, 1, 1, 1]);
  });

  it('converts int64 pattern to 8 bytes', () => {
    const mgr = new TestMemoryManager();
    const result = mgr.convert('1', 'int64');

    expect(result.bytes.length).toBe(8);
    expect(result.mask.length).toBe(8);
    expect(result.bytes[0]).toBe(1);
  });

  it('converts float and double patterns to expected byte sizes', () => {
    const mgr = new TestMemoryManager();
    const floatResult = mgr.convert('3.5', 'float');
    const doubleResult = mgr.convert('3.5', 'double');

    expect(floatResult.bytes.length).toBe(4);
    expect(doubleResult.bytes.length).toBe(8);
  });

  it('converts utf8 string pattern with full mask', () => {
    const mgr = new TestMemoryManager();
    const result = mgr.convert('ABC', 'string');

    expect(result.bytes).toEqual([65, 66, 67]);
    expect(result.mask).toEqual([1, 1, 1]);
  });

  it('returns empty arrays for invalid numeric patterns', () => {
    const mgr = new TestMemoryManager();
    const result = mgr.convert('not-a-number', 'int32');

    expect(result.bytes).toEqual([]);
    expect(result.mask).toEqual([]);
  });
});

