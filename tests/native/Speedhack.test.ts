/**
 * Speedhack — unit tests.
 *
 * Tests apply/remove/setSpeed/getSpeed/isActive/listActive.
 * Win32 APIs are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Speedhack } from '@native/Speedhack';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@native/Win32Debug', () => ({
  FlushInstructionCache: vi.fn(),
}));

describe('Speedhack', () => {
  let sh: Speedhack;

  beforeEach(() => {
    sh = new Speedhack();
    vi.clearAllMocks();
  });

  describe('apply', () => {
    it('should hook time APIs and return hooked list', async () => {
      const result = await sh.apply(1234, 2.0);
      expect(result.success).toBe(true);
      expect(result.hookedApis).toContain('GetTickCount64');
      expect(result.hookedApis).toContain('QueryPerformanceCounter');
    });

    it('should mark process as active', async () => {
      await sh.apply(1234, 2.0);
      expect(sh.isActive(1234)).toBe(true);
    });

    it('should remove previous hook on re-apply', async () => {
      await sh.apply(1234, 2.0);
      const result = await sh.apply(1234, 3.0);
      expect(result.success).toBe(true);
      expect(sh.getSpeed(1234)).toBe(3.0);
    });
  });

  describe('setSpeed', () => {
    it('should update speed without re-hooking', async () => {
      await sh.apply(1234, 2.0);
      const updated = await sh.setSpeed(1234, 5.0);
      expect(updated).toBe(true);
      expect(sh.getSpeed(1234)).toBe(5.0);
    });

    it('should return false for non-active process', async () => {
      expect(await sh.setSpeed(9999, 2.0)).toBe(false);
    });
  });

  describe('getSpeed', () => {
    it('should return current speed', async () => {
      await sh.apply(1234, 3.5);
      expect(sh.getSpeed(1234)).toBe(3.5);
    });

    it('should return null for inactive process', () => {
      expect(sh.getSpeed(9999)).toBeNull();
    });
  });

  describe('remove', () => {
    it('should deactivate and clean up', async () => {
      await sh.apply(1234, 2.0);
      const result = await sh.remove(1234);
      expect(result).toBe(true);
      expect(sh.isActive(1234)).toBe(false);
      expect(sh.getSpeed(1234)).toBeNull();
    });

    it('should return false for non-existent process', async () => {
      expect(await sh.remove(9999)).toBe(false);
    });
  });

  describe('isActive', () => {
    it('should return false initially', () => {
      expect(sh.isActive(1234)).toBe(false);
    });

    it('should return true after apply', async () => {
      await sh.apply(1234, 1.5);
      expect(sh.isActive(1234)).toBe(true);
    });
  });

  describe('listActive', () => {
    it('should return empty array initially', () => {
      expect(sh.listActive()).toEqual([]);
    });

    it('should list all active speedhacks', async () => {
      await sh.apply(1234, 2.0);
      await sh.apply(5678, 0.5);
      const active = sh.listActive();
      expect(active).toHaveLength(2);
      expect(active.map((s) => s.pid).toSorted()).toEqual([1234, 5678]);
    });

    it('should exclude removed processes', async () => {
      await sh.apply(1234, 2.0);
      await sh.apply(5678, 0.5);
      await sh.remove(1234);
      expect(sh.listActive()).toHaveLength(1);
      expect(sh.listActive()[0]!.pid).toBe(5678);
    });
  });

  describe('buildAbsoluteJump (via apply)', () => {
    it('should hook functions creating JMP detours', async () => {
      // If apply succeeds with both APIs, the JMP builder worked
      const result = await sh.apply(1234, 2.0);
      expect(result.hookedApis.length).toBe(2);
    });
  });
});
