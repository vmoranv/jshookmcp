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
  GetModuleHandle: vi.fn(),
  GetProcAddress: vi.fn(),
  NtQueryInformationProcess: vi.fn(),
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

// Mock the platform factory to return our mock provider
vi.mock('@src/native/platform/factory.js', () => ({
  createPlatformProvider: vi.fn(() => state.mockProvider),
}));

// Mock Win32API for Win32-only methods (injection, debug) that use dynamic import
vi.mock('@native/Win32API', () => ({
  PAGE: state.PAGE,
  MEM: state.MEM,
  openProcessForMemory: state.openProcessForMemory,
  CloseHandle: state.CloseHandle,
  WriteProcessMemory: state.WriteProcessMemory,
  VirtualAllocEx: state.VirtualAllocEx,
  VirtualProtectEx: state.VirtualProtectEx,
  CreateRemoteThread: state.CreateRemoteThread,
  GetModuleHandle: state.GetModuleHandle,
  GetProcAddress: state.GetProcAddress,
  NtQueryInformationProcess: state.NtQueryInformationProcess,
}));

vi.mock('@native/NativeMemoryManager.availability', () => ({
  checkNativeMemoryAvailability: state.checkNativeMemoryAvailability,
}));

import { NativeMemoryManager } from '@src/native/NativeMemoryManager.impl';

describe('NativeMemoryManager.impl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup platform provider mock defaults
    state.mockProvider.openProcess.mockReturnValue({ pid: 99, writeAccess: false });
    state.mockProvider.readMemory.mockReturnValue({
      data: Buffer.from([0xaa, 0xbb]),
      bytesRead: 2,
    });
    state.mockProvider.writeMemory.mockReturnValue({ bytesWritten: 2 });
    state.mockProvider.closeProcess.mockReturnValue(undefined);
    state.checkNativeMemoryAvailability.mockResolvedValue({ available: true });
    // Win32-only mocks
    state.openProcessForMemory.mockReturnValue(1234);
    state.GetModuleHandle.mockReturnValue(0x5000n);
    state.GetProcAddress.mockReturnValue(0x6000n);
    state.VirtualAllocEx.mockReturnValue(0x7000n);
    state.CreateRemoteThread.mockReturnValue({ handle: 4321, threadId: 77 });
  });

  it('delegates availability checks to the availability helper with the promisified exec function', async () => {
    const manager = new NativeMemoryManager();

    await expect(manager.checkAvailability()).resolves.toEqual({ available: true });
    expect(state.checkNativeMemoryAvailability).toHaveBeenCalledWith(state.execAsync);
  });

  it('reads memory, normalizes the address, and returns uppercase spaced hex', async () => {
    const manager = new NativeMemoryManager();

    await expect(manager.readMemory(99, '1000', 2)).resolves.toEqual({
      success: true,
      data: 'AA BB',
    });
    expect(state.mockProvider.openProcess).toHaveBeenCalledWith(99, false);
    expect(state.mockProvider.readMemory).toHaveBeenCalledWith(
      { pid: 99, writeAccess: false },
      0x1000n,
      2,
    );
    expect(state.mockProvider.closeProcess).toHaveBeenCalled();
  });

  it('returns a structured error when reading memory fails', async () => {
    state.mockProvider.openProcess.mockImplementation(() => {
      throw new Error('boom');
    });

    const manager = new NativeMemoryManager();
    const result = await manager.readMemory(99, '0x2000', 4);

    expect(result).toEqual({
      success: false,
      error: 'boom',
    });
    expect(state.logger.error).toHaveBeenCalledWith(
      'Native memory read failed',
      expect.objectContaining({
        pid: 99,
        address: '0x2000',
        size: 4,
        error: 'boom',
      }),
    );
  });

  it('writes normalized hex and base64 payloads through writeMemory', async () => {
    state.mockProvider.openProcess.mockReturnValue({ pid: 7, writeAccess: true });

    const manager = new NativeMemoryManager();

    await expect(manager.writeMemory(7, 'ABC', 'DE AD')).resolves.toEqual({
      success: true,
      bytesWritten: 2,
    });
    expect(state.mockProvider.writeMemory).toHaveBeenNthCalledWith(
      1,
      { pid: 7, writeAccess: true },
      0xabcn,
      Buffer.from([0xde, 0xad]),
    );

    await expect(manager.writeMemory(7, '0xABC', '3q0=', 'base64')).resolves.toEqual({
      success: true,
      bytesWritten: 2,
    });
    expect(state.mockProvider.writeMemory).toHaveBeenNthCalledWith(
      2,
      { pid: 7, writeAccess: true },
      0xabcn,
      Buffer.from([0xde, 0xad]),
    );
  });

  it('enumerates memory regions and maps them into response objects', async () => {
    state.mockProvider.openProcess.mockReturnValue({ pid: 123, writeAccess: false });
    state.mockProvider.queryRegion
      .mockReturnValueOnce({
        baseAddress: 0x1000n,
        size: 512,
        protection: 0x03, // Read | Write
        state: 'committed',
        type: 'private',
        isReadable: true,
        isWritable: true,
        isExecutable: false,
      })
      .mockReturnValueOnce(null);

    const manager = new NativeMemoryManager();
    const result = await manager.enumerateRegions(123);

    expect(result).toEqual({
      success: true,
      regions: [
        {
          baseAddress: '0x1000',
          size: 512,
          state: 'COMMITTED',
          protection: 'RW',
          isReadable: true,
          isWritable: true,
          isExecutable: false,
          type: 'PRIVATE',
        },
      ],
    });
  });

  it('returns a failure when memory protection lookup cannot query the region', async () => {
    state.mockProvider.openProcess.mockReturnValue({ pid: 55, writeAccess: false });
    state.mockProvider.queryRegion.mockReturnValue(null);

    const manager = new NativeMemoryManager();

    await expect(manager.checkMemoryProtection(55, '0x1000')).resolves.toEqual({
      success: false,
      error: 'Failed to query memory region',
    });
  });

  it('injectDll reports a missing LoadLibraryA address as a structured failure', async () => {
    state.GetProcAddress.mockReturnValue(0n);

    const manager = new NativeMemoryManager();

    await expect(manager.injectDll(17, 'C:\\temp\\demo.dll')).resolves.toEqual(
      process.platform === 'win32'
        ? { success: false, error: 'Failed to get LoadLibraryA address' }
        : { success: false, error: 'DLL injection is only supported on Windows' },
    );
  });

  it('injectDll writes the DLL path into remote memory and returns the thread id (Win32 only)', async () => {
    if (process.platform !== 'win32') {
      const manager = new NativeMemoryManager();
      const result = await manager.injectDll(17, 'C:\\temp\\demo.dll');
      expect(result).toEqual({
        success: false,
        error: 'DLL injection is only supported on Windows',
      });
      return;
    }

    const manager = new NativeMemoryManager();
    const result = await manager.injectDll(17, 'C:\\temp\\demo.dll');

    expect(result).toEqual({
      success: true,
      remoteThreadId: 77,
    });
    expect(state.VirtualAllocEx).toHaveBeenCalledWith(
      1234,
      0n,
      'C:\\temp\\demo.dll'.length + 1,
      state.MEM.COMMIT | state.MEM.RESERVE,
      state.PAGE.READWRITE,
    );
    expect(state.WriteProcessMemory).toHaveBeenCalledWith(1234, 0x7000n, expect.any(Buffer));
    expect(state.CloseHandle).toHaveBeenCalledWith(4321);
  });

  it('reports debugger presence from NtQueryInformationProcess (Win32 only)', async () => {
    if (process.platform !== 'win32') {
      const manager = new NativeMemoryManager();
      await expect(manager.checkDebugPort(42)).resolves.toEqual({
        success: false,
        error: 'Debug port check is only supported on Windows',
      });
      return;
    }

    state.NtQueryInformationProcess.mockReturnValueOnce({ status: 0, debugPort: 1 });

    const manager = new NativeMemoryManager();
    await expect(manager.checkDebugPort(42)).resolves.toEqual({
      success: true,
      isDebugged: true,
    });

    state.NtQueryInformationProcess.mockReturnValueOnce({ status: 0, debugPort: 0 });
    await expect(manager.checkDebugPort(42)).resolves.toEqual({
      success: true,
      isDebugged: false,
    });

    state.NtQueryInformationProcess.mockReturnValueOnce({ status: 5, debugPort: 0 });
    await expect(manager.checkDebugPort(42)).resolves.toEqual({
      success: false,
      error: 'NtQueryInformationProcess failed with status 0x5',
    });
  });

  it('returns Windows-only errors when the platform is forced to linux', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    try {
      const manager = new NativeMemoryManager();

      await expect(manager.injectDll(17, 'C:\\temp\\demo.dll')).resolves.toEqual({
        success: false,
        error: 'DLL injection is only supported on Windows',
      });

      await expect(manager.injectShellcode(17, 'CC DD')).resolves.toEqual({
        success: false,
        error: 'Shellcode injection is only supported on Windows',
      });

      await expect(manager.checkDebugPort(17)).resolves.toEqual({
        success: false,
        error: 'Debug port check is only supported on Windows',
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('returns a structured error when NtQueryInformationProcess throws', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    state.openProcessForMemory.mockImplementation(() => {
      throw new Error('ntquery failed');
    });

    const manager = new NativeMemoryManager();
    await expect(manager.checkDebugPort(42)).resolves.toEqual({
      success: false,
      error: 'ntquery failed',
    });

    expect(state.logger.error).toHaveBeenCalledWith(
      'Native debug port check failed',
      expect.objectContaining({
        pid: 42,
        error: 'ntquery failed',
      }),
    );
  });
});
