/**
 * Speedhack coverage tests — exercise uncovered error branches.
 *
 * Gaps in the main test suite:
 *  - apply(): GetModuleHandle returns 0 (kernel32 not found)
 *  - apply(): VirtualAllocEx returns 0 (allocation failure)
 *  - apply(): both APIs unavailable → hookedApis=[], success=false
 *  - apply(): GetProcAddress returns 0 for one API → only other hooked
 *  - remove(): ReadProcessMemory throws in restore loop (best-effort catch)
 *  - remove(): best-effort cleanup when VirtualFreeEx throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: vi.fn(() => 1n),
  CloseHandle: vi.fn(() => true),
  ReadProcessMemory: vi.fn((_h: bigint, _a: bigint, size: number) => Buffer.alloc(size)),
  WriteProcessMemory: vi.fn((_h: bigint, _a: bigint, data: Buffer) => data.length),
  VirtualAllocEx: vi.fn(() => 0x50000n),
  VirtualFreeEx: vi.fn(() => true),
  VirtualProtectEx: vi.fn(() => ({ success: true, oldProtect: 0x20 })),
  GetModuleHandle: vi.fn(() => 0x7ff000000000n),
  GetProcAddress: vi.fn((base: bigint, name: string) => {
    if (name === 'GetTickCount64') return base + 0x1000n;
    if (name === 'QueryPerformanceCounter') return base + 0x2000n;
    return 0n;
  }),
  PAGE: { EXECUTE_READWRITE: 0x40, EXECUTE_READ: 0x20 },
  MEM: { COMMIT: 0x1000, RESERVE: 0x2000, RELEASE: 0x8000 },
}));

vi.mock('@native/Win32Debug', () => ({
  FlushInstructionCache: vi.fn(),
}));

import { Speedhack } from '@native/Speedhack';
import {
  GetModuleHandle,
  VirtualAllocEx,
  GetProcAddress,
  ReadProcessMemory,
} from '@native/Win32API';

describe('Speedhack coverage: apply() — error branches', () => {
  let sh: Speedhack;

  beforeEach(() => {
    sh = new Speedhack();
    vi.clearAllMocks();
  });

  it('throws when GetModuleHandle returns 0 (kernel32 not found)', async () => {
    (GetModuleHandle as ReturnType<typeof vi.fn>).mockReturnValueOnce(0n);

    await expect(sh.apply(1234, 2.0)).rejects.toThrow('Cannot find kernel32.dll');
  });

  it('throws when VirtualAllocEx returns 0 (allocation failure)', async () => {
    (VirtualAllocEx as ReturnType<typeof vi.fn>).mockReturnValueOnce(0n);

    await expect(sh.apply(1234, 2.0)).rejects.toThrow('VirtualAllocEx failed');
  });

  it('returns success=false when both GetProcAddress calls return 0', async () => {
    // Neither GetTickCount64 nor QueryPerformanceCounter are available
    (GetProcAddress as ReturnType<typeof vi.fn>).mockReturnValue(0n);

    const result = await sh.apply(1234, 2.0);

    expect(result.success).toBe(false);
    expect(result.hookedApis).toHaveLength(0);
  });

  it('hooks only available API when one GetProcAddress returns 0', async () => {
    // GetTickCount64 available, QueryPerformanceCounter not
    (GetProcAddress as ReturnType<typeof vi.fn>).mockImplementation(
      (_base: bigint, name: string) => {
        if (name === 'GetTickCount64') return 0x7ff0000001000n;
        return 0n; // QueryPerformanceCounter not found
      },
    );

    const result = await sh.apply(1234, 2.0);

    expect(result.success).toBe(true);
    expect(result.hookedApis).toContain('GetTickCount64');
    expect(result.hookedApis).not.toContain('QueryPerformanceCounter');
  });

  it('best-effort restore when ReadProcessMemory throws in remove()', async () => {
    // First apply successfully
    const result = await sh.apply(1234, 2.0);
    expect(result.success).toBe(true);

    // Now make ReadProcessMemory throw during restore
    (ReadProcessMemory as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('read fault during restore');
    });

    // Should not throw — best-effort cleanup
    const removed = await sh.remove(1234);
    expect(removed).toBe(true);
    expect(sh.isActive(1234)).toBe(false);
  });

  it('still marks inactive when remove encounters multiple errors', async () => {
    const result = await sh.apply(1234, 2.0);
    expect(result.success).toBe(true);

    // Throw on every restore attempt
    (ReadProcessMemory as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('repeated read faults');
    });

    const removed = await sh.remove(1234);
    // Best-effort: returns true even with errors
    expect(removed).toBe(true);
    expect(sh.isActive(1234)).toBe(false);
  });

  it('isActive returns false after failed remove due to errors', async () => {
    await sh.apply(1234, 2.0);
    (ReadProcessMemory as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('unavailable');
    });
    await sh.remove(1234);
    expect(sh.isActive(1234)).toBe(false);
  });
});

describe('Speedhack coverage: setSpeed() — error branches', () => {
  let sh: Speedhack;

  beforeEach(() => {
    sh = new Speedhack();
    vi.clearAllMocks();
  });

  it('returns false when setSpeed is called with no active state', async () => {
    const result = await sh.setSpeed(9999, 3.0);
    expect(result).toBe(false);
  });

  it('getSpeed returns null for never-applied pid', () => {
    expect(sh.getSpeed(9999)).toBeNull();
  });
});

describe('Speedhack coverage: listActive() — boundary cases', () => {
  it('returns empty array when no speedhacks are active', () => {
    const sh = new Speedhack();
    expect(sh.listActive()).toEqual([]);
  });
});
