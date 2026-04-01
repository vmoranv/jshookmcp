import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isKoffiAvailable,
  isWindows,
  OpenProcess,
  CloseHandle,
  ReadProcessMemory,
  WriteProcessMemory,
  VirtualQueryEx,
  VirtualProtectEx,
  VirtualAllocEx,
  VirtualFreeEx,
  CreateRemoteThread,
  GetModuleHandle,
  GetProcAddress,
  NtQueryInformationProcess,
  EnumProcessModules,
  GetModuleBaseName,
  GetModuleFileNameEx,
  GetModuleInformation,
  openProcessForMemory,
  unloadLibraries,
} from '@src/native/Win32API';

// ── Mock Koffi completely ──
const { mockFuncs, mockKoffi } = vi.hoisted(() => {
  const funcs = {
    OpenProcess: vi.fn(),
    CloseHandle: vi.fn(),
    ReadProcessMemory: vi.fn(),
    WriteProcessMemory: vi.fn(),
    VirtualQueryEx: vi.fn(),
    VirtualProtectEx: vi.fn(),
    VirtualAllocEx: vi.fn(),
    VirtualFreeEx: vi.fn(),
    CreateRemoteThread: vi.fn(),
    GetModuleHandleA: vi.fn(),
    GetProcAddress: vi.fn(),
    GetLastError: vi.fn(),
    NtQueryInformationProcess: vi.fn(),
    EnumProcessModules: vi.fn(),
    GetModuleBaseNameA: vi.fn(),
    GetModuleFileNameExA: vi.fn(),
    GetModuleInformation: vi.fn(),
  };
  return {
    mockFuncs: funcs,
    mockKoffi: {
      load: vi.fn((name) => {
        if (name === 'error.dll') throw new Error('Load failed');
        return {
          func: vi.fn((sig) => {
            if (sig.includes('OpenProcess')) return funcs.OpenProcess;
            if (sig.includes('CloseHandle')) return funcs.CloseHandle;
            if (sig.includes('ReadProcessMemory')) return funcs.ReadProcessMemory;
            if (sig.includes('WriteProcessMemory')) return funcs.WriteProcessMemory;
            if (sig.includes('VirtualQueryEx')) return funcs.VirtualQueryEx;
            if (sig.includes('VirtualProtectEx')) return funcs.VirtualProtectEx;
            if (sig.includes('VirtualAllocEx')) return funcs.VirtualAllocEx;
            if (sig.includes('VirtualFreeEx')) return funcs.VirtualFreeEx;
            if (sig.includes('CreateRemoteThread')) return funcs.CreateRemoteThread;
            if (sig.includes('GetModuleHandle')) return funcs.GetModuleHandleA;
            if (sig.includes('GetProcAddress')) return funcs.GetProcAddress;
            if (sig.includes('GetLastError')) return funcs.GetLastError;
            if (sig.includes('NtQueryInformationProcess')) return funcs.NtQueryInformationProcess;
            if (sig.includes('EnumProcessModules')) return funcs.EnumProcessModules;
            if (sig.includes('GetModuleBaseName')) return funcs.GetModuleBaseNameA;
            if (sig.includes('GetModuleFileNameEx')) return funcs.GetModuleFileNameExA;
            if (sig.includes('GetModuleInformation')) return funcs.GetModuleInformation;
            return vi.fn();
          }),
          unload: vi.fn(),
        };
      }),
    },
  };
});

vi.mock('koffi', () => ({ default: mockKoffi }));

Object.defineProperty(process, 'platform', {
  value: 'win32',
});

describe('Win32API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    unloadLibraries();
  });

  it('checks isWindows flag', () => {
    expect(isWindows()).toBe(true);
  });

  it('checks isKoffiAvailable', () => {
    expect(isKoffiAvailable()).toBe(true);
    // Cached return
    expect(isKoffiAvailable()).toBe(true);
  });

  it('handles basic OpenProcess and CloseHandle', () => {
    mockFuncs.OpenProcess.mockReturnValue(1234n);
    mockFuncs.CloseHandle.mockReturnValue(1);

    expect(OpenProcess(1, false, 999)).toBe(1234n);
    expect(CloseHandle(1234n)).toBe(true);
  });

  it('handles ReadProcessMemory success and failure', () => {
    mockFuncs.ReadProcessMemory.mockImplementation((hProcess, lpBase, buf, size, bytesRead) => {
      buf.write('test');
      bytesRead.writeBigUInt64LE(4n);
      return 1;
    });

    const buf = ReadProcessMemory(1234n, 1000n, 4);
    expect(buf.toString('utf8', 0, 4)).toBe('test');

    mockFuncs.ReadProcessMemory.mockReturnValue(0);
    mockFuncs.GetLastError.mockReturnValue(0x5);
    expect(() => ReadProcessMemory(1234n, 1000n, 4)).toThrow('0x5');
  });

  it('handles WriteProcessMemory success and failure', () => {
    mockFuncs.WriteProcessMemory.mockImplementation((hProcess, lpBase, buf, size, bytesWritten) => {
      bytesWritten.writeBigUInt64LE(4n);
      return 1;
    });

    const written = WriteProcessMemory(1234n, 1000n, Buffer.from('test'));
    expect(written).toBe(4);

    mockFuncs.WriteProcessMemory.mockReturnValue(0);
    mockFuncs.GetLastError.mockReturnValue(0x5);
    expect(() => WriteProcessMemory(1234n, 1000n, Buffer.from('test'))).toThrow('0x5');
  });

  it('handles VirtualQueryEx', () => {
    mockFuncs.VirtualQueryEx.mockImplementation((hProcess, lpAddress, buf, _size) => {
      buf.writeBigUInt64LE(0x1000n, 0); // BaseAddress
      buf.writeBigUInt64LE(0x1000n, 8); // AllocationBase
      buf.writeUInt32LE(0x04, 16); // AllocationProtect
      buf.writeBigUInt64LE(4096n, 24); // RegionSize
      buf.writeUInt32LE(0x1000, 32); // State
      buf.writeUInt32LE(0x04, 36); // Protect
      buf.writeUInt32LE(0x20000, 40); // Type
      return 48; // struct size
    });

    const res = VirtualQueryEx(1234n, 1000n);
    expect(res.success).toBe(true);
    expect(res.info.BaseAddress).toBe(0x1000n);

    // Test failure
    mockFuncs.VirtualQueryEx.mockReturnValue(0);
    const fail = VirtualQueryEx(1234n, 1000n);
    expect(fail.success).toBe(false);
  });

  it('handles VirtualProtectEx', () => {
    mockFuncs.VirtualProtectEx.mockImplementation((h, a, s, n, oldP) => {
      oldP.writeUInt32LE(0x02, 0);
      return 1;
    });
    const res = VirtualProtectEx(1234n, 1000n, 4096, 0x04);
    expect(res.success).toBe(true);
    expect(res.oldProtect).toBe(0x02);
  });

  it('handles VirtualAllocEx and VirtualFreeEx', () => {
    mockFuncs.VirtualAllocEx.mockReturnValue(0x5000n);
    mockFuncs.VirtualFreeEx.mockReturnValue(1);

    expect(VirtualAllocEx(1234n, 0n, 4096, 0x1000, 0x04)).toBe(0x5000n);
    expect(VirtualFreeEx(1234n, 0x5000n, 0, 0x8000)).toBe(true);
  });

  it('handles CreateRemoteThread', () => {
    mockFuncs.CreateRemoteThread.mockImplementation((h, s, sz, start, p, c, tidBuf) => {
      tidBuf.writeUInt32LE(9999, 0);
      return 0x9000n;
    });
    const { handle, threadId } = CreateRemoteThread(1234n, 0x1000n, 0x2000n);
    expect(handle).toBe(0x9000n);
    expect(threadId).toBe(9999);
  });

  it('handles module handlers GetModuleHandle and GetProcAddress', () => {
    mockFuncs.GetModuleHandleA.mockReturnValue(0x1000n);
    mockFuncs.GetProcAddress.mockReturnValue(0x2000n);
    expect(GetModuleHandle('kernel32.dll')).toBe(0x1000n);
    expect(GetProcAddress(0x1000n, 'LoadLibraryA')).toBe(0x2000n);
  });

  it('handles NtQueryInformationProcess', () => {
    mockFuncs.NtQueryInformationProcess.mockImplementation((h, c, buf, _s, _ret) => {
      buf.writeBigUInt64LE(0xffffffffn, 0);
      return 0; // STATUS_SUCCESS
    });
    const res = NtQueryInformationProcess(1234n, 7);
    expect(res.status).toBe(0);
    expect(res.debugPort).toBe(4294967295); // 0xffffffffn
  });

  it('handles EnumProcessModules', () => {
    mockFuncs.EnumProcessModules.mockImplementation((h, buf, s, needed) => {
      buf.writeBigUInt64LE(0x1000n, 0);
      buf.writeBigUInt64LE(0x2000n, 8);
      needed.writeUInt32LE(16, 0);
      return 1;
    });
    const res = EnumProcessModules(1234n);
    expect(res.success).toBe(true);
    expect(res.count).toBe(2);
    expect(res.modules[0]).toBe(0x1000n);
  });

  it('handles GetModuleBaseName', () => {
    mockFuncs.GetModuleBaseNameA.mockImplementation((h, m, buf, _size) => {
      buf.write('test.exe\0');
      return 8;
    });
    expect(GetModuleBaseName(1234n, 0x1000n)).toBe('test.exe');
  });

  it('handles GetModuleFileNameEx', () => {
    mockFuncs.GetModuleFileNameExA.mockImplementation((h, m, buf, _size) => {
      buf.write('C:\\test.exe\0');
      return 11;
    });
    expect(GetModuleFileNameEx(1234n, 0x1000n)).toBe('C:\\test.exe');

    // Test failure
    mockFuncs.GetModuleFileNameExA.mockReturnValue(0);
    expect(GetModuleFileNameEx(1234n, 0x1000n)).toBe(null);
  });

  it('handles GetModuleInformation', () => {
    mockFuncs.GetModuleInformation.mockImplementation((h, m, buf, _size) => {
      buf.writeBigUInt64LE(0x1000n, 0); // lpBaseOfDll
      buf.writeUInt32LE(4096, 8); // SizeOfImage
      buf.writeBigUInt64LE(0x1100n, 16); // EntryPoint
      return 1;
    });
    const res = GetModuleInformation(1234n, 0x1000n);
    expect(res.success).toBe(true);
    expect(res.info.lpBaseOfDll).toBe(0x1000n);
  });

  it('handles openProcessForMemory helper', () => {
    mockFuncs.OpenProcess.mockReturnValue(1234n);
    expect(openProcessForMemory(999, true)).toBe(1234n);
    expect(openProcessForMemory(999, false)).toBe(1234n);

    // Test failure
    mockFuncs.OpenProcess.mockReturnValue(0n);
    mockFuncs.GetLastError.mockReturnValue(0x5);
    expect(() => openProcessForMemory(999)).toThrow('0x5');
  });
});
