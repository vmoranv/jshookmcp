import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  // Platform provider mock
  mockProvider: {
    platform: 'win32' as const,
    openProcess: vi.fn(),
    closeProcess: vi.fn(),
    readMemory: vi.fn(),
    writeMemory: vi.fn(),
    queryRegion: vi.fn(),
    changeProtection: vi.fn(),
    allocateMemory: vi.fn(),
    freeMemory: vi.fn(),
    enumerateModules: vi.fn(),
    checkAvailability: vi.fn(),
  },
  // Win32-only APIs (for injection/debug tests)
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
  exec: vi.fn(),
  execAsync: vi.fn(),
  openProcessForMemory: vi.fn(),
  CloseHandle: vi.fn(),
  WriteProcessMemory: vi.fn(),
  VirtualAllocEx: vi.fn(),
  VirtualProtectEx: vi.fn(),
  CreateRemoteThread: vi.fn(),
  checkNativeMemoryAvailability: vi.fn(),
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

import * as util from 'node:util';

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof util>();
  return {
    ...actual,
    promisify: vi.fn(() => state.execAsync),
  };
});

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

// Mock the platform factory to return our mock provider
vi.mock('@src/native/platform/factory.js', () => ({
  createPlatformProvider: vi.fn(() => state.mockProvider),
}));

// Mock Win32API for Win32-only methods (injection) that use dynamic import
vi.mock('@native/Win32API', () => ({
  PAGE: state.PAGE,
  MEM: state.MEM,
  openProcessForMemory: state.openProcessForMemory,
  CloseHandle: state.CloseHandle,
  WriteProcessMemory: state.WriteProcessMemory,
  VirtualAllocEx: state.VirtualAllocEx,
  VirtualProtectEx: state.VirtualProtectEx,
  CreateRemoteThread: state.CreateRemoteThread,
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
      readChunk,
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
      readChunk,
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
      0,
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
      4096, // chunk larger than region
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
      3,
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
      4096,
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
      4096,
    );

    expect(result).toEqual([0x4000n]);
  });

  it('handles single-byte patterns without carry-over', () => {
    const readChunk = vi.fn().mockReturnValue(Buffer.from([0xaa]));

    const result = scanRegionInChunks(
      { baseAddress: 0x5000n, regionSize: 3 },
      [0xaa],
      [1],
      readChunk,
      1,
    );

    expect(result).toEqual([0x5000n, 0x5001n, 0x5002n]);
    expect(readChunk).toHaveBeenCalledTimes(3);
  });
});

describe('NativeMemoryManager extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup platform provider mock defaults
    state.mockProvider.openProcess.mockReturnValue({ pid: 100, writeAccess: false });
    state.mockProvider.closeProcess.mockReturnValue(undefined);
    state.mockProvider.readMemory.mockReturnValue({ data: Buffer.alloc(0), bytesRead: 0 });
    state.mockProvider.writeMemory.mockReturnValue({ bytesWritten: 0 });
    state.checkNativeMemoryAvailability.mockResolvedValue({ available: true });
    // Win32-only mocks
    state.openProcessForMemory.mockReturnValue(9999n);
    state.CloseHandle.mockReturnValue(true);
  });

  describe('writeMemory', () => {
    it('returns error when provider.openProcess throws', async () => {
      state.mockProvider.openProcess.mockImplementation(() => {
        throw new Error('access denied');
      });

      const manager = new NativeMemoryManager();
      const result = await manager.writeMemory(100, '0x1000', 'AABB');

      expect(result.success).toBe(false);
      expect(result.error).toBe('access denied');
    });
  });

  describe('enumerateRegions', () => {
    it('returns error when provider.openProcess throws', async () => {
      state.mockProvider.openProcess.mockImplementation(() => {
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
      state.mockProvider.openProcess.mockReturnValue({ pid: 50, writeAccess: false });
      state.mockProvider.enumerateModules.mockReturnValue([
        { name: 'kernel32.dll', baseAddress: 0x10000n, size: 4096 },
        { name: 'ntdll.dll', baseAddress: 0x20000n, size: 8192 },
      ]);

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

    it('returns failure when provider.enumerateModules throws', async () => {
      state.mockProvider.openProcess.mockReturnValue({ pid: 50, writeAccess: false });
      state.mockProvider.enumerateModules.mockImplementation(() => {
        throw new Error('enumeration failed');
      });

      const manager = new NativeMemoryManager();
      const result = await manager.enumerateModules(50);

      expect(result.success).toBe(false);
      expect(result.error).toBe('enumeration failed');
    });

    it('returns empty array when no modules loaded', async () => {
      state.mockProvider.openProcess.mockReturnValue({ pid: 50, writeAccess: false });
      state.mockProvider.enumerateModules.mockReturnValue([]);

      const manager = new NativeMemoryManager();
      const result = await manager.enumerateModules(50);

      expect(result.success).toBe(true);
      expect(result.modules).toHaveLength(0);
    });
  });

  describe('injectShellcode', () => {
    it('returns platform error on non-Windows', async () => {
      if (process.platform === 'win32') return; // skip on Windows

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'CC DD');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Shellcode injection is only supported on Windows');
    });

    it('injects hex-encoded shellcode successfully (Win32 only)', async () => {
      if (process.platform !== 'win32') return;

      state.VirtualAllocEx.mockReturnValue(0x8000n);
      state.WriteProcessMemory.mockReturnValue(2);
      state.VirtualProtectEx.mockReturnValue({ success: true, oldProtect: 4 });
      state.CreateRemoteThread.mockReturnValue({ handle: 5555n, threadId: 99 });

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'CC DD');

      expect(result.success).toBe(true);
      expect(result.remoteThreadId).toBe(99);
    });

    it('injects base64-encoded shellcode (Win32 only)', async () => {
      if (process.platform !== 'win32') return;

      state.VirtualAllocEx.mockReturnValue(0x9000n);
      state.WriteProcessMemory.mockReturnValue(3);
      state.VirtualProtectEx.mockReturnValue({ success: true, oldProtect: 4 });
      state.CreateRemoteThread.mockReturnValue({ handle: 6666n, threadId: 88 });

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'zM0=', 'base64');

      expect(result.success).toBe(true);
      expect(result.remoteThreadId).toBe(88);
    });

    it('returns failure when VirtualAllocEx returns null (Win32 only)', async () => {
      if (process.platform !== 'win32') return;

      state.VirtualAllocEx.mockReturnValue(0n);

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'CC DD');

      expect(result.success).toBe(false);
      expect(result.error).toContain('allocate remote memory');
    });

    it('returns failure when VirtualProtectEx fails (Win32 only)', async () => {
      if (process.platform !== 'win32') return;

      state.VirtualAllocEx.mockReturnValue(0x8000n);
      state.WriteProcessMemory.mockReturnValue(2);
      state.VirtualProtectEx.mockReturnValue({ success: false, oldProtect: 0 });

      const manager = new NativeMemoryManager();
      const result = await manager.injectShellcode(200, 'CC DD');

      expect(result.success).toBe(false);
      expect(result.error).toContain('memory protection');
    });

    it('returns failure when CreateRemoteThread returns null handle (Win32 only)', async () => {
      if (process.platform !== 'win32') return;

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
      state.mockProvider.openProcess.mockReturnValue({ pid: 42, writeAccess: false });
      state.mockProvider.queryRegion.mockReturnValue({
        baseAddress: 0x1000n,
        size: 8192,
        protection: 0x05, // Read | Execute
        state: 'committed',
        type: 'image',
        isReadable: true,
        isWritable: false,
        isExecutable: true,
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

    it('formats additional protection combinations', async () => {
      state.mockProvider.openProcess.mockReturnValue({ pid: 42, writeAccess: false });
      state.mockProvider.queryRegion
        .mockReturnValueOnce({
          baseAddress: 0x2000n,
          size: 4096,
          protection: 0,
          state: 'committed',
          type: 'private',
          isReadable: false,
          isWritable: false,
          isExecutable: false,
        })
        .mockReturnValueOnce({
          baseAddress: 0x3000n,
          size: 4096,
          protection: 0x01,
          state: 'committed',
          type: 'private',
          isReadable: true,
          isWritable: false,
          isExecutable: false,
        })
        .mockReturnValueOnce({
          baseAddress: 0x4000n,
          size: 4096,
          protection: 0x04,
          state: 'committed',
          type: 'private',
          isReadable: false,
          isWritable: false,
          isExecutable: true,
        })
        .mockReturnValueOnce({
          baseAddress: 0x5000n,
          size: 4096,
          protection: 0x07,
          state: 'committed',
          type: 'private',
          isReadable: true,
          isWritable: true,
          isExecutable: true,
        });

      const manager = new NativeMemoryManager();
      await expect(manager.checkMemoryProtection(42, '0x2000')).resolves.toMatchObject({
        success: true,
        protection: 'NOACCESS',
      });
      await expect(manager.checkMemoryProtection(42, '0x3000')).resolves.toMatchObject({
        success: true,
        protection: 'R',
      });
      await expect(manager.checkMemoryProtection(42, '0x4000')).resolves.toMatchObject({
        success: true,
        protection: 'X',
      });
      await expect(manager.checkMemoryProtection(42, '0x5000')).resolves.toMatchObject({
        success: true,
        protection: 'RWX',
      });
    });

    it('returns error when the outer openProcess throws', async () => {
      state.mockProvider.openProcess.mockImplementation(() => {
        throw new Error('permission denied');
      });

      const manager = new NativeMemoryManager();
      const result = await manager.checkMemoryProtection(42, '0x1000');

      expect(result.success).toBe(false);
      expect(result.error).toBe('permission denied');
    });
  });

  describe('scanMemory', () => {
    it('returns invalid pattern when parsing produces no bytes', async () => {
      const manager = new NativeMemoryManager();
      const result = await manager.scanMemory(100, 'ZZ', 'hex');

      expect(result).toEqual({
        success: false,
        addresses: [],
        error: 'Invalid pattern',
      });
    });

    it('scans readable regions and formats found addresses', async () => {
      state.mockProvider.openProcess.mockReturnValue({ pid: 100, writeAccess: false });
      state.mockProvider.queryRegion.mockImplementation((_handle, address) => {
        if (address === 0n) {
          return {
            baseAddress: 0x1000n,
            size: 4,
            protection: state.PAGE.READONLY,
            state: 'committed',
            type: 'private',
            isReadable: false,
            isWritable: false,
            isExecutable: false,
          };
        }

        if (address === 0x1004n) {
          return {
            baseAddress: 0x2000n,
            size: 6,
            protection: state.PAGE.READWRITE,
            state: 'committed',
            type: 'private',
            isReadable: true,
            isWritable: true,
            isExecutable: false,
          };
        }

        return null;
      });
      state.mockProvider.readMemory.mockReturnValue({
        data: Buffer.from([0x11, 0xaa, 0xbb, 0x22, 0x33, 0x44]),
        bytesRead: 6,
      });

      const manager = new NativeMemoryManager();
      const result = await manager.scanMemory(100, 'AA BB', 'hex');

      expect(result.success).toBe(true);
      expect(result.addresses).toEqual(['0x2001']);
      expect(result.stats).toEqual({
        patternLength: 2,
        resultsFound: 1,
      });
      expect(state.mockProvider.readMemory).toHaveBeenCalledTimes(1);
      expect(state.mockProvider.queryRegion).toHaveBeenCalledTimes(3);
      expect(state.mockProvider.closeProcess).toHaveBeenCalled();
    });
  });
});
