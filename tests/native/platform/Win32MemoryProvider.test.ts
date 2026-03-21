/**
 * Win32MemoryProvider — unit tests.
 *
 * Mocks @native/Win32API to test the adapter logic:
 * handle mapping, protection translation, region mapping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  openProcessForMemory: vi.fn(),
  CloseHandle: vi.fn(),
  ReadProcessMemory: vi.fn(),
  WriteProcessMemory: vi.fn(),
  VirtualQueryEx: vi.fn(),
  VirtualProtectEx: vi.fn(),
  VirtualAllocEx: vi.fn(),
  VirtualFreeEx: vi.fn(),
  EnumProcessModules: vi.fn(),
  GetModuleBaseName: vi.fn(),
  GetModuleInformation: vi.fn(),
  isWindows: vi.fn(() => true),
  isKoffiAvailable: vi.fn(() => true),
  PAGE: {
    NOACCESS: 0x01,
    READONLY: 0x02,
    READWRITE: 0x04,
    WRITECOPY: 0x08,
    EXECUTE: 0x10,
    EXECUTE_READ: 0x20,
    EXECUTE_READWRITE: 0x40,
    EXECUTE_WRITECOPY: 0x80,
    GUARD: 0x100,
  },
  MEM: {
    COMMIT: 0x1000,
    RESERVE: 0x2000,
    RELEASE: 0x8000,
  },
}));

vi.mock('@native/Win32API', () => ({
  ...state,
  PAGE: state.PAGE,
  MEM: state.MEM,
}));

// Use dynamic import since Win32MemoryProvider imports Win32API at top level
import { Win32MemoryProvider } from '@src/native/platform/win32/Win32MemoryProvider.js';
import { MemoryProtection } from '@src/native/platform/types.js';

describe('Win32MemoryProvider', () => {
  let provider: Win32MemoryProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new Win32MemoryProvider();
    state.openProcessForMemory.mockReturnValue(0x1234n);
    state.CloseHandle.mockReturnValue(true);
  });

  it('has platform set to "win32"', () => {
    expect(provider.platform).toBe('win32');
  });

  describe('checkAvailability', () => {
    it('returns available when Windows + koffi', async () => {
      const result = await provider.checkAvailability();
      expect(result.available).toBe(true);
      expect(result.platform).toBe('win32');
    });

    it('returns unavailable when not Windows', async () => {
      state.isWindows.mockReturnValue(false);
      const result = await provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.reason).toContain('Not running on Windows');
    });

    it('returns unavailable when koffi missing', async () => {
      state.isKoffiAvailable.mockReturnValue(false);
      const result = await provider.checkAvailability();
      expect(result.available).toBe(false);
      expect(result.reason).toContain('koffi');
    });
  });

  describe('openProcess / closeProcess', () => {
    it('opens process and returns ProcessHandle', () => {
      const handle = provider.openProcess(42, false);
      expect(handle.pid).toBe(42);
      expect(handle.writeAccess).toBe(false);
      expect(state.openProcessForMemory).toHaveBeenCalledWith(42, false);
    });

    it('closes process without error', () => {
      const handle = provider.openProcess(42, false);
      provider.closeProcess(handle);
      expect(state.CloseHandle).toHaveBeenCalledWith(0x1234n);
    });
  });

  describe('readMemory', () => {
    it('reads memory and returns MemoryReadResult', () => {
      const handle = provider.openProcess(1, false);
      const buf = Buffer.from([0xAA, 0xBB]);
      state.ReadProcessMemory.mockReturnValue(buf);

      const result = provider.readMemory(handle, 0x1000n, 2);
      expect(result.data).toEqual(buf);
      expect(result.bytesRead).toBe(2);
      expect(state.ReadProcessMemory).toHaveBeenCalledWith(0x1234n, 0x1000n, 2);
    });
  });

  describe('writeMemory', () => {
    it('writes memory and returns bytesWritten', () => {
      const handle = provider.openProcess(1, true);
      state.WriteProcessMemory.mockReturnValue(4);

      const result = provider.writeMemory(handle, 0x2000n, Buffer.from([1, 2, 3, 4]));
      expect(result.bytesWritten).toBe(4);
    });
  });

  describe('queryRegion', () => {
    it('maps Win32 MEMORY_BASIC_INFORMATION to MemoryRegionInfo', () => {
      const handle = provider.openProcess(1, false);
      state.VirtualQueryEx.mockReturnValue({
        success: true,
        info: {
          BaseAddress: 0x10000n,
          RegionSize: 4096n,
          State: state.MEM.COMMIT,
          Protect: state.PAGE.READWRITE,
          Type: 0x20000, // MEM_PRIVATE
        },
      });

      const region = provider.queryRegion(handle, 0x10000n);
      expect(region).not.toBeNull();
      expect(region!.baseAddress).toBe(0x10000n);
      expect(region!.size).toBe(4096);
      expect(region!.state).toBe('committed');
      expect(region!.type).toBe('private');
      expect(region!.isReadable).toBe(true);
      expect(region!.isWritable).toBe(true);
      expect(region!.isExecutable).toBe(false);
    });

    it('returns null when VirtualQueryEx fails', () => {
      const handle = provider.openProcess(1, false);
      state.VirtualQueryEx.mockReturnValue({
        success: false,
        info: { BaseAddress: 0n, RegionSize: 0n, State: 0, Protect: 0, Type: 0 },
      });

      expect(provider.queryRegion(handle, 0x10000n)).toBeNull();
    });

    it('returns null when RegionSize is zero', () => {
      const handle = provider.openProcess(1, false);
      state.VirtualQueryEx.mockReturnValue({
        success: true,
        info: { BaseAddress: 0x10000n, RegionSize: 0n, State: 0, Protect: 0, Type: 0 },
      });

      expect(provider.queryRegion(handle, 0x10000n)).toBeNull();
    });

    it('maps EXECUTE_READ protection correctly', () => {
      const handle = provider.openProcess(1, false);
      state.VirtualQueryEx.mockReturnValue({
        success: true,
        info: {
          BaseAddress: 0x10000n,
          RegionSize: 4096n,
          State: state.MEM.COMMIT,
          Protect: state.PAGE.EXECUTE_READ,
          Type: 0x1000000, // MEM_IMAGE
        },
      });

      const region = provider.queryRegion(handle, 0x10000n);
      expect(region!.isReadable).toBe(true);
      expect(region!.isExecutable).toBe(true);
      expect(region!.isWritable).toBe(false);
      expect(region!.type).toBe('image');
    });

    it('maps MEM_RESERVE to "reserved" state', () => {
      const handle = provider.openProcess(1, false);
      state.VirtualQueryEx.mockReturnValue({
        success: true,
        info: {
          BaseAddress: 0n,
          RegionSize: 4096n,
          State: state.MEM.RESERVE,
          Protect: state.PAGE.NOACCESS,
          Type: 0x20000,
        },
      });

      const region = provider.queryRegion(handle, 0n);
      expect(region!.state).toBe('reserved');
    });

    it('maps MEM_MAPPED type correctly', () => {
      const handle = provider.openProcess(1, false);
      state.VirtualQueryEx.mockReturnValue({
        success: true,
        info: {
          BaseAddress: 0n,
          RegionSize: 4096n,
          State: state.MEM.COMMIT,
          Protect: state.PAGE.READONLY,
          Type: 0x40000, // MEM_MAPPED
        },
      });

      const region = provider.queryRegion(handle, 0n);
      expect(region!.type).toBe('mapped');
    });
  });

  describe('changeProtection', () => {
    it('delegates to VirtualProtectEx and returns old protection', () => {
      const handle = provider.openProcess(1, true);
      state.VirtualProtectEx.mockReturnValue({ success: true, oldProtect: state.PAGE.READONLY });

      const result = provider.changeProtection(handle, 0x1000n, 4096, MemoryProtection.ReadWrite);
      expect(result.oldProtection).toBe(MemoryProtection.Read);
      expect(state.VirtualProtectEx).toHaveBeenCalled();
    });

    it('throws when VirtualProtectEx fails', () => {
      const handle = provider.openProcess(1, true);
      state.VirtualProtectEx.mockReturnValue({ success: false, oldProtect: 0 });

      expect(() =>
        provider.changeProtection(handle, 0x1000n, 4096, MemoryProtection.ReadWrite)
      ).toThrow('VirtualProtectEx failed');
    });
  });

  describe('allocateMemory', () => {
    it('allocates and returns address', () => {
      const handle = provider.openProcess(1, true);
      state.VirtualAllocEx.mockReturnValue(0x50000n);

      const result = provider.allocateMemory(handle, 4096, MemoryProtection.ReadWrite);
      expect(result.address).toBe(0x50000n);
    });

    it('throws when VirtualAllocEx returns null', () => {
      const handle = provider.openProcess(1, true);
      state.VirtualAllocEx.mockReturnValue(0n);

      expect(() =>
        provider.allocateMemory(handle, 4096, MemoryProtection.ReadWrite)
      ).toThrow('VirtualAllocEx failed');
    });
  });

  describe('freeMemory', () => {
    it('delegates to VirtualFreeEx', () => {
      const handle = provider.openProcess(1, true);
      provider.freeMemory(handle, 0x50000n, 4096);
      expect(state.VirtualFreeEx).toHaveBeenCalledWith(0x1234n, 0x50000n, 0, state.MEM.RELEASE);
    });
  });

  describe('enumerateModules', () => {
    it('returns mapped module list', () => {
      const handle = provider.openProcess(1, false);
      state.EnumProcessModules.mockReturnValue({
        success: true,
        modules: [0x10000n, 0x20000n],
        count: 2,
      });
      state.GetModuleBaseName
        .mockReturnValueOnce('kernel32.dll')
        .mockReturnValueOnce('ntdll.dll');
      state.GetModuleInformation
        .mockReturnValueOnce({
          success: true,
          info: { lpBaseOfDll: 0x10000n, SizeOfImage: 4096, EntryPoint: 0n },
        })
        .mockReturnValueOnce({
          success: true,
          info: { lpBaseOfDll: 0x20000n, SizeOfImage: 8192, EntryPoint: 0n },
        });

      const modules = provider.enumerateModules(handle);
      expect(modules).toHaveLength(2);
      expect(modules[0]!.name).toBe('kernel32.dll');
      expect(modules[0]!.baseAddress).toBe(0x10000n);
      expect(modules[0]!.size).toBe(4096);
      expect(modules[1]!.name).toBe('ntdll.dll');
    });

    it('throws when EnumProcessModules fails', () => {
      const handle = provider.openProcess(1, false);
      state.EnumProcessModules.mockReturnValue({
        success: false, modules: [], count: 0,
      });

      expect(() => provider.enumerateModules(handle)).toThrow('EnumProcessModules failed');
    });

    it('skips modules where GetModuleInformation fails', () => {
      const handle = provider.openProcess(1, false);
      state.EnumProcessModules.mockReturnValue({
        success: true, modules: [0x10000n, 0x20000n], count: 2,
      });
      state.GetModuleBaseName.mockReturnValue('test.dll');
      state.GetModuleInformation
        .mockReturnValueOnce({ success: false, info: null })
        .mockReturnValueOnce({
          success: true,
          info: { lpBaseOfDll: 0x20000n, SizeOfImage: 2048, EntryPoint: 0n },
        });

      const modules = provider.enumerateModules(handle);
      expect(modules).toHaveLength(1);
      expect(modules[0]!.baseAddress).toBe(0x20000n);
    });
  });

  describe('handle validation', () => {
    it('throws for invalid handle on readMemory', () => {
      const fakeHandle = { pid: 99, writeAccess: false };
      expect(() => provider.readMemory(fakeHandle, 0n, 1)).toThrow('Invalid ProcessHandle');
    });

    it('throws for invalid handle on writeMemory', () => {
      const fakeHandle = { pid: 99, writeAccess: true };
      expect(() => provider.writeMemory(fakeHandle, 0n, Buffer.alloc(1))).toThrow('Invalid ProcessHandle');
    });
  });
});
