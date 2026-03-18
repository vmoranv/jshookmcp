import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  PAGE: {
    NOACCESS: 0x01,
    READONLY: 0x02,
    READWRITE: 0x04,
    WRITECOPY: 0x08,
    EXECUTE: 0x10,
    EXECUTE_READ: 0x20,
    EXECUTE_READWRITE: 0x40,
    GUARD: 0x100,
  },
  MEM: {
    COMMIT: 0x1000,
    RESERVE: 0x2000,
    FREE: 0x10000,
  },
  MEM_TYPE: {
    IMAGE: 0x1000000,
    MAPPED: 0x40000,
    PRIVATE: 0x20000,
  },
  exec: vi.fn(),
  execAsync: vi.fn(),
  openProcessForMemory: vi.fn(),
  CloseHandle: vi.fn(),
  ReadProcessMemory: vi.fn(),
  WriteProcessMemory: vi.fn(),
  VirtualQueryEx: vi.fn(),
  VirtualProtectEx: vi.fn(),
  VirtualAllocEx: vi.fn(),
  CreateRemoteThread: vi.fn(),
  GetModuleHandle: vi.fn(),
  GetProcAddress: vi.fn(),
  NtQueryInformationProcess: vi.fn(),
  EnumProcessModules: vi.fn(),
  GetModuleBaseName: vi.fn(),
  GetModuleInformation: vi.fn(),
  checkNativeMemoryAvailability: vi.fn(),
  findPatternInBuffer: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('node:child_process', () => ({
  exec: state.exec,
}));

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>();
  return {
    ...actual,
    promisify: vi.fn(() => state.execAsync),
  };
});

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

vi.mock('@native/Win32API', () => ({
  PAGE: state.PAGE,
  MEM: state.MEM,
  MEM_TYPE: state.MEM_TYPE,
  openProcessForMemory: state.openProcessForMemory,
  CloseHandle: state.CloseHandle,
  ReadProcessMemory: state.ReadProcessMemory,
  WriteProcessMemory: state.WriteProcessMemory,
  VirtualQueryEx: state.VirtualQueryEx,
  VirtualProtectEx: state.VirtualProtectEx,
  VirtualAllocEx: state.VirtualAllocEx,
  CreateRemoteThread: state.CreateRemoteThread,
  GetModuleHandle: state.GetModuleHandle,
  GetProcAddress: state.GetProcAddress,
  NtQueryInformationProcess: state.NtQueryInformationProcess,
  EnumProcessModules: state.EnumProcessModules,
  GetModuleBaseName: state.GetModuleBaseName,
  GetModuleInformation: state.GetModuleInformation,
}));

vi.mock('@native/NativeMemoryManager.availability', () => ({
  checkNativeMemoryAvailability: state.checkNativeMemoryAvailability,
}));

import { scanRegionInChunks, NativeMemoryManager } from '@native/NativeMemoryManager.impl';

describe('scanRegionInChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when patternBytes is empty', () => {
    const readChunk = vi.fn();
    const result = scanRegionInChunks(
      { baseAddress: 0x1000n, regionSize: 1024 },
      [],
      [],
      readChunk
    );
    expect(result).toEqual([]);
    expect(readChunk).not.toHaveBeenCalled();
  });

  it('returns empty when region is smaller than pattern', () => {
    const readChunk = vi.fn();
    const result = scanRegionInChunks(
      { baseAddress: 0x1000n, regionSize: 2 },
      [0xaa, 0xbb, 0xcc],
      [1, 1, 1],
      readChunk
    );
    expect(result).toEqual([]);
  });

  it('returns empty when chunkSize is zero or negative', () => {
    const readChunk = vi.fn();
    const result = scanRegionInChunks(
      { baseAddress: 0x1000n, regionSize: 1024 },
      [0xaa],
      [1],
      readChunk,
      0
    );
    expect(result).toEqual([]);
  });

  it('finds a single match in a small region', () => {
    const data = Buffer.from([0x00, 0xaa, 0xbb, 0x00]);
    const readChunk = vi.fn().mockReturnValue(data);

    const result = scanRegionInChunks(
      { baseAddress: 0x1000n, regionSize: 4 },
      [0xaa, 0xbb],
      [1, 1],
      readChunk,
      4096 // chunk larger than region
    );

    expect(result).toEqual([0x1001n]);
  });

  it('finds matches spanning multiple chunks with carry-over', () => {
    // Pattern is [0xCC, 0xDD], chunkSize=3, region has [0xAA, 0xBB, 0xCC, 0xDD, 0xEE]
    // Chunk 1: [0xAA, 0xBB, 0xCC] — no full match
    // Chunk 2: [0xDD, 0xEE] — with carry-over [0xCC], the scan buffer is [0xCC, 0xDD, 0xEE]
    const chunk1 = Buffer.from([0xaa, 0xbb, 0xcc]);
    const chunk2 = Buffer.from([0xdd, 0xee]);
    const readChunk = vi.fn().mockReturnValueOnce(chunk1).mockReturnValueOnce(chunk2);

    const result = scanRegionInChunks(
      { baseAddress: 0x2000n, regionSize: 5 },
      [0xcc, 0xdd],
      [1, 1],
      readChunk,
      3
    );

    expect(result).toEqual([0x2002n]);
  });

  it('finds multiple matches across the region', () => {
    // Region: [AA, BB, 00, AA, BB]
    const data = Buffer.from([0xaa, 0xbb, 0x00, 0xaa, 0xbb]);
    const readChunk = vi.fn().mockReturnValue(data);

    const result = scanRegionInChunks(
      { baseAddress: 0x3000n, regionSize: 5 },
      [0xaa, 0xbb],
      [1, 1],
      readChunk,
      4096
    );

    expect(result).toEqual([0x3000n, 0x3003n]);
  });

  it('supports wildcard mask matches', () => {
    // Pattern: [AA, ??, CC] where ?? is wildcard (mask=0)
    const data = Buffer.from([0xaa, 0xff, 0xcc]);
    const readChunk = vi.fn().mockReturnValue(data);

    const result = scanRegionInChunks(
      { baseAddress: 0x4000n, regionSize: 3 },
      [0xaa, 0x00, 0xcc],
      [1, 0, 1],
      readChunk,
      4096
    );

    expect(result).toEqual([0x4000n]);
  });
});

describe('NativeMemoryManager extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.openProcessForMemory.mockReturnValue(9999n);
    state.CloseHandle.mockReturnValue(true);
    state.checkNativeMemoryAvailability.mockResolvedValue({ available: true });
  });

  describe('writeMemory', () => {
    it('returns error when openProcessForMemory throws', async () => {
      state.openProcessForMemory.mockImplementation(() => {
        throw new Error('access denied');
      });

      const manager = new NativeMemoryManager();
      const result = await manager.writeMemory(100, '0x1000', 'AABB');

      expect(result.success).toBe(false);
      expect(result.error).toBe('access denied');
    });
  });

  describe('enumerateRegions', () => {
    it('returns error when openProcessForMemory throws', async () => {
      state.openProcessForMemory.mockImplementation(() => {
        throw new Error('no access');
      });

      const manager = new NativeMemoryManager();
      const result = await manager.enumerateRegions(100);

      expect(result.success).toBe(false);
      expect(result.error).toBe('no access');
    });
  });

  describe('enumerateModules', () => {
    it('returns modules with name and base address', async () => {
      state.EnumProcessModules.mockReturnValue({
        success: true,
        modules: [0x10000n, 0x20000n],
        count: 2,
      });
      state.GetModuleBaseName.mockReturnValueOnce('kernel32.dll').mockReturnValueOnce('ntdll.dll');
      state.GetModuleInformation.mockReturnValueOnce({
        success: true,
        info: { lpBaseOfDll: 0x10000n, SizeOfImage: 4096, EntryPoint: 0x10100n },
      }).mockReturnValueOnce({
        success: true,
        info: { lpBaseOfDll: 0x20000n, SizeOfImage: 8192, EntryPoint: 0x20100n },
      });

      const manager = new NativeMemoryManager();
      const result = await manager.enumerateModules(50);

      expect(result.success).toBe(true);
      expect(result.modules).toHaveLength(2);
      expect(result.modules![0]).toEqual({
        name: 'kernel32.dll',
        baseAddress: '0x10000',
        size: 4096,
      });
      expect(result.modules![1]).toEqual({
        name: 'ntdll.dll',
        baseAddress: '0x20000',
        size: 8192,
      });
    });

    it('returns failure when EnumProcessModules fails', async () => {
      state.EnumProcessModules.mockReturnValue({
        success: false,
        modules: [],
        count: 0,
      });

      const manager = new NativeMemoryManager();
      const result = await manager.enumerateModules(50);

      expect(result.success).toBe(false);
      expect(result.error).toBe('EnumProcessModules failed');
    });

    it('skips modules where GetModuleInformation fails', async () => {
      state.EnumProcessModules.mockReturnValue({
        success: true,
        modules: [0x10000n, 0x20000n],
        count: 2,
      });
      state.GetModuleBaseName.mockReturnValue('test.dll');
      state.GetModuleInformation.mockReturnValueOnce({
        success: false,
        info: {},
      }).mockReturnValueOnce({
        success: true,
        info: { lpBaseOfDll: 0x20000n, SizeOfImage: 2048, EntryPoint: 0n },
      });

      const manager = new NativeMemoryManager();
      const result = await manager.enumerateModules(50);
      const onlyModule = result.modules?.[0];

      expect(result.modules).toHaveLength(1);
      expect(onlyModule?.baseAddress).toBe('0x20000');
    });
  });

  describe('injectShellcode', () => {
    it('injects hex-encoded shellcode successfully', async () => {
      state.VirtualAllocEx.mockReturnValue(0x8000n);
      state.WriteProcessMemory.mockReturnValue(2);
      state.VirtualProtectEx.mockReturnValue({ success: true, oldProtect: 4 });
      state.CreateRemoteThread.mockReturnValue({ handle: 5555n, threadId: 99 });

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'CC DD');

      expect(result.success).toBe(true);
      expect(result.remoteThreadId).toBe(99);
    });

    it('injects base64-encoded shellcode', async () => {
      state.VirtualAllocEx.mockReturnValue(0x9000n);
      state.WriteProcessMemory.mockReturnValue(3);
      state.VirtualProtectEx.mockReturnValue({ success: true, oldProtect: 4 });
      state.CreateRemoteThread.mockReturnValue({ handle: 6666n, threadId: 88 });

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'zM0=', 'base64');

      expect(result.success).toBe(true);
      expect(result.remoteThreadId).toBe(88);
    });

    it('returns failure when VirtualAllocEx returns null', async () => {
      state.VirtualAllocEx.mockReturnValue(0n);

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'CC DD');

      expect(result.success).toBe(false);
      expect(result.error).toContain('allocate remote memory');
    });

    it('returns failure when VirtualProtectEx fails', async () => {
      state.VirtualAllocEx.mockReturnValue(0x8000n);
      state.WriteProcessMemory.mockReturnValue(2);
      state.VirtualProtectEx.mockReturnValue({ success: false, oldProtect: 0 });

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'CC DD');

      expect(result.success).toBe(false);
      expect(result.error).toContain('memory protection');
    });

    it('returns failure when CreateRemoteThread returns null handle', async () => {
      state.VirtualAllocEx.mockReturnValue(0x8000n);
      state.WriteProcessMemory.mockReturnValue(2);
      state.VirtualProtectEx.mockReturnValue({ success: true, oldProtect: 4 });
      state.CreateRemoteThread.mockReturnValue({ handle: 0n, threadId: 0 });

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'CC DD');

      expect(result.success).toBe(false);
      expect(result.error).toContain('remote thread');
    });
  });

  describe('checkMemoryProtection', () => {
    it('returns protection details on success', async () => {
      state.VirtualQueryEx.mockReturnValue({
        success: true,
        info: {
          BaseAddress: 0x1000n,
          AllocationBase: 0x1000n,
          AllocationProtect: state.PAGE.READWRITE,
          RegionSize: 0x2000n,
          State: state.MEM.COMMIT,
          Protect: state.PAGE.EXECUTE_READ,
          Type: state.MEM_TYPE.IMAGE,
        },
      });

      const manager = new NativeMemoryManager();
      const result = await manager.checkMemoryProtection(42, '0x1000');

      expect(result.success).toBe(true);
      expect(result.protection).toBe('RX');
      expect(result.isReadable).toBe(true);
      expect(result.isExecutable).toBe(true);
      expect(result.regionStart).toBe('0x1000');
      expect(result.regionSize).toBe(8192);
    });

    it('returns error when the outer openProcess throws', async () => {
      state.openProcessForMemory.mockImplementation(() => {
        throw new Error('permission denied');
      });

      const manager = new NativeMemoryManager();
      const result = await manager.checkMemoryProtection(42, '0x1000');

      expect(result.success).toBe(false);
      expect(result.error).toBe('permission denied');
    });
  });
});
