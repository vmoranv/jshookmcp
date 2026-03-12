import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const PAGE = {
    NOACCESS: 0x01,
    READONLY: 0x02,
    READWRITE: 0x04,
    WRITECOPY: 0x08,
    EXECUTE: 0x10,
    EXECUTE_READ: 0x20,
    EXECUTE_READWRITE: 0x40,
    GUARD: 0x100,
  };

  const MEM = {
    COMMIT: 0x1000,
    RESERVE: 0x2000,
    FREE: 0x10000,
  };

  const MEM_TYPE = {
    IMAGE: 0x1000000,
    MAPPED: 0x40000,
    PRIVATE: 0x20000,
  };

  return {
    PAGE,
    MEM,
    MEM_TYPE,
    openProcessForMemory: vi.fn(() => 1234),
    CloseHandle: vi.fn(),
    ReadProcessMemory: vi.fn(),
    loggerError: vi.fn(),
  };
});

vi.mock('@native/Win32API', () => ({
  PAGE: state.PAGE,
  MEM: state.MEM,
  MEM_TYPE: state.MEM_TYPE,
  isKoffiAvailable: vi.fn(() => true),
  openProcessForMemory: state.openProcessForMemory,
  CloseHandle: state.CloseHandle,
  ReadProcessMemory: state.ReadProcessMemory,
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
}));

vi.mock('@native/NativeMemoryManager.availability', () => ({
  checkNativeMemoryAvailability: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: state.loggerError,
    debug: vi.fn(),
  },
}));

import { ReadProcessMemory, VirtualQueryEx } from '@native/Win32API';
import { NativeMemoryManager, scanRegionInChunks } from '@src/native/NativeMemoryManager.impl';

function createChunkReader(source: Buffer, baseAddress = 0n) {
  return (address: bigint, size: number): Buffer => {
    const start = Number(address - baseAddress);
    return source.subarray(start, start + size);
  };
}

describe('NativeMemoryManager chunked scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.openProcessForMemory.mockReturnValue(1234);
  });

  it('matches patterns that span chunk boundaries without duplicates', () => {
    const source = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xaa, 0xbb, 0xcc, 0xdd]);
    const matches = scanRegionInChunks(
      { baseAddress: 0n, regionSize: source.length },
      [0xaa, 0xbb, 0xcc, 0xdd],
      [1, 1, 1, 1],
      createChunkReader(source),
      3
    );

    expect(matches).toEqual([0n, 4n]);
  });

  it('does not duplicate matches when overlap is zero', () => {
    const source = Buffer.from([0xaa, 0xaa, 0xaa]);
    const matches = scanRegionInChunks(
      { baseAddress: 0n, regionSize: source.length },
      [0xaa],
      [1],
      createChunkReader(source),
      1
    );

    expect(matches).toEqual([0n, 1n, 2n]);
  });

  it('supports patterns longer than the chunk size', () => {
    const source = Buffer.from([1, 2, 3, 4, 5, 6]);
    const matches = scanRegionInChunks(
      { baseAddress: 0n, regionSize: source.length },
      [1, 2, 3, 4, 5],
      [1, 1, 1, 1, 1],
      createChunkReader(source),
      2
    );

    expect(matches).toEqual([0n]);
  });

  it('scanMemory keeps large readable regions and reads them in chunks', async () => {
    const hugeRegionSize = BigInt(1024 * 1024 * 1024 + 1);
    vi.mocked(VirtualQueryEx)
      .mockReturnValueOnce({
        success: true,
        info: {
          BaseAddress: 0n,
          AllocationBase: 0n,
          AllocationProtect: 0x04,
          RegionSize: hugeRegionSize,
          State: state.MEM.COMMIT,
          Protect: state.PAGE.READWRITE,
          Type: state.MEM_TYPE.PRIVATE,
        },
      })
      .mockReturnValueOnce({
        success: false,
        info: {
          BaseAddress: hugeRegionSize,
          AllocationBase: 0n,
          AllocationProtect: 0,
          RegionSize: 0n,
          State: 0,
          Protect: 0,
          Type: 0,
        },
      });

    vi.mocked(ReadProcessMemory).mockImplementation(() => Buffer.from([0xaa]));

    const manager = new NativeMemoryManager();
    const result = await manager.scanMemory(42, 'AA', 'hex');

    expect(result.success).toBe(true);
    expect(ReadProcessMemory).toHaveBeenCalledTimes(result.addresses.length);
    expect(vi.mocked(ReadProcessMemory).mock.calls.length).toBeGreaterThan(1);
    expect(state.openProcessForMemory).toHaveBeenCalledTimes(2);
  });
});
