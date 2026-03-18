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

import { NativeMemoryManager } from '@src/native/NativeMemoryManager.impl';

function makeMemoryInfo(overrides?: Partial<Record<string, unknown>>) {
  return {
    BaseAddress: 0x1000n,
    AllocationBase: 0x1000n,
    AllocationProtect: state.PAGE.READWRITE,
    RegionSize: 0x200n,
    State: state.MEM.COMMIT,
    Protect: state.PAGE.READWRITE,
    Type: state.MEM_TYPE.PRIVATE,
    ...overrides,
  };
}

describe('NativeMemoryManager.impl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.openProcessForMemory.mockReturnValue(1234);
    state.ReadProcessMemory.mockReturnValue(Buffer.from([0xaa, 0xbb]));
    state.WriteProcessMemory.mockReturnValue(2);
    state.checkNativeMemoryAvailability.mockResolvedValue({ available: true });
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
    expect(state.openProcessForMemory).toHaveBeenCalledWith(99, false);
    expect(state.ReadProcessMemory).toHaveBeenCalledWith(1234, 0x1000n, 2);
    expect(state.CloseHandle).toHaveBeenCalledWith(1234);
  });

  it('returns a structured error when reading memory fails', async () => {
    state.ReadProcessMemory.mockImplementation(() => {
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
      })
    );
  });

  it('writes normalized hex and base64 payloads through WriteProcessMemory', async () => {
    const manager = new NativeMemoryManager();

    await expect(manager.writeMemory(7, 'ABC', 'DE AD')).resolves.toEqual({
      success: true,
      bytesWritten: 2,
    });
    expect(state.WriteProcessMemory).toHaveBeenNthCalledWith(
      1,
      1234,
      0xabcn,
      Buffer.from([0xde, 0xad])
    );

    await expect(manager.writeMemory(7, '0xABC', '3q0=', 'base64')).resolves.toEqual({
      success: true,
      bytesWritten: 2,
    });
    expect(state.WriteProcessMemory).toHaveBeenNthCalledWith(
      2,
      1234,
      0xabcn,
      Buffer.from([0xde, 0xad])
    );
  });

  it('enumerates memory regions and maps them into response objects', async () => {
    state.VirtualQueryEx.mockReturnValueOnce({
      success: true,
      info: makeMemoryInfo(),
    }).mockReturnValueOnce({
      success: false,
      info: makeMemoryInfo({ BaseAddress: 0x1200n, RegionSize: 0n }),
    });

    const manager = new NativeMemoryManager();
    const result = await manager.enumerateRegions(123);

    expect(result).toEqual({
      success: true,
      regions: [
        {
          baseAddress: '0x1000',
          size: 512,
          state: 'COMMIT',
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
    state.VirtualQueryEx.mockReturnValue({
      success: false,
      info: makeMemoryInfo(),
    });

    const manager = new NativeMemoryManager();

    await expect(manager.checkMemoryProtection(55, '0x1000')).resolves.toEqual({
      success: false,
      error: 'Failed to query memory region',
    });
  });

  it('injectDll reports a missing LoadLibraryA address as a structured failure', async () => {
    state.GetProcAddress.mockReturnValue(0n);

    const manager = new NativeMemoryManager();

    await expect(manager.injectDll(17, 'C:\\temp\\demo.dll')).resolves.toEqual({
      success: false,
      error: 'Failed to get LoadLibraryA address',
    });
    expect(state.CloseHandle).toHaveBeenCalledWith(1234);
  });

  it('injectDll writes the DLL path into remote memory and returns the thread id', async () => {
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
      state.PAGE.READWRITE
    );
    expect(state.WriteProcessMemory).toHaveBeenCalledWith(1234, 0x7000n, expect.any(Buffer));
    expect(state.CloseHandle).toHaveBeenCalledWith(4321);
  });

  it('reports debugger presence from NtQueryInformationProcess and returns status errors when needed', async () => {
    state.NtQueryInformationProcess.mockReturnValueOnce({ status: 0, debugPort: 1 });

    const manager = new NativeMemoryManager();
    await expect(manager.checkDebugPort(42)).resolves.toEqual({
      success: true,
      isDebugged: true,
    });

    state.NtQueryInformationProcess.mockReturnValueOnce({ status: 5, debugPort: 0 });
    await expect(manager.checkDebugPort(42)).resolves.toEqual({
      success: false,
      error: 'NtQueryInformationProcess failed with status 0x5',
    });
  });
});
