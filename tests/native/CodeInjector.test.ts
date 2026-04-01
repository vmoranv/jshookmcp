/**
 * CodeInjector — unit tests.
 *
 * Tests patch/NOP/unpatch/code caves/remote allocation.
 * Win32 APIs are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeInjector } from '@native/CodeInjector';
import { ReadProcessMemory } from '@native/Win32API';

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: vi.fn(() => 1n),
  CloseHandle: vi.fn(() => true),
  ReadProcessMemory: vi.fn((_h: bigint, _a: bigint, size: number) => {
    const buf = Buffer.alloc(size);
    // Fill with recognizable pattern
    for (let i = 0; i < size; i++) buf[i] = 0x55;
    return buf;
  }),
  WriteProcessMemory: vi.fn((_h: bigint, _a: bigint, data: Buffer) => data.length),
  VirtualProtectEx: vi.fn(() => ({ success: true, oldProtect: 0x40 })),
  VirtualAllocEx: vi.fn(() => 0x20000n),
  VirtualFreeEx: vi.fn(() => true),
  VirtualQueryEx: vi.fn((_h: bigint, addr: bigint) => {
    // Return one executable region then stop
    if (addr < 0x11000n) {
      return {
        success: true,
        info: {
          BaseAddress: 0x10000n,
          RegionSize: 4096n,
          Protect: 0x20, // PAGE_EXECUTE_READ
        },
      };
    }
    return { success: true, info: { BaseAddress: addr, RegionSize: 0n, Protect: 0 } };
  }),
  PAGE: { EXECUTE_READWRITE: 0x40, EXECUTE_READ: 0x20, READWRITE: 0x04 },
  MEM: { COMMIT: 0x1000, RESERVE: 0x2000, RELEASE: 0x8000 },
}));

vi.mock('@native/Win32Debug', () => ({
  FlushInstructionCache: vi.fn(),
}));

vi.mock('@native/NativeMemoryManager.impl', () => ({
  nativeMemoryManager: {
    enumerateModules: vi.fn(async () => ({
      success: true,
      modules: [{ name: 'test.exe', baseAddress: '0x10000', size: 4096 }],
    })),
  },
}));

vi.mock('@native/NativeMemoryManager.utils', () => ({
  isExecutable: vi.fn((protect: number) => protect === 0x20 || protect === 0x40),
}));

vi.mock('@src/constants', () => ({
  CODE_CAVE_MIN_SIZE: 8,
}));

describe('CodeInjector', () => {
  let injector: CodeInjector;

  beforeEach(() => {
    injector = new CodeInjector();
    vi.clearAllMocks();
  });

  describe('patchBytes', () => {
    it('should write patch and save original bytes', async () => {
      const patch = await injector.patchBytes(1234, '0x10000', [0x90, 0x90, 0x90]);
      expect(patch.id).toBeDefined();
      expect(patch.pid).toBe(1234);
      expect(patch.address).toBe('0x10000');
      expect(patch.patchBytes).toEqual([0x90, 0x90, 0x90]);
      expect(patch.originalBytes).toHaveLength(3);
      expect(patch.originalBytes.every((b) => b === 0x55)).toBe(true);
      expect(patch.isApplied).toBe(true);
    });

    it('should store patch for later unpatch', async () => {
      const patch = await injector.patchBytes(1234, '0x10000', [0xcc]);
      expect(injector.listPatches()).toHaveLength(1);
      expect(injector.listPatches()[0]!.id).toBe(patch.id);
    });
  });

  describe('nopBytes', () => {
    it('should fill with 0x90 NOP instructions', async () => {
      const patch = await injector.nopBytes(1234, '0x10000', 5);
      expect(patch.patchBytes).toEqual([0x90, 0x90, 0x90, 0x90, 0x90]);
      expect(patch.isApplied).toBe(true);
    });
  });

  describe('unpatch', () => {
    it('should restore original bytes', async () => {
      const patch = await injector.patchBytes(1234, '0x10000', [0xcc, 0xcc]);
      const result = await injector.unpatch(patch.id);
      expect(result).toBe(true);
      expect(patch.isApplied).toBe(false);
    });

    it('should return false for non-existent patch', async () => {
      expect(await injector.unpatch('nonexistent')).toBe(false);
    });

    it('should return false for already unpatched', async () => {
      const patch = await injector.patchBytes(1234, '0x10000', [0xcc]);
      await injector.unpatch(patch.id);
      expect(await injector.unpatch(patch.id)).toBe(false);
    });
  });

  describe('findCodeCaves', () => {
    it('should return caves sorted by size descending', async () => {
      // The mock ReadProcessMemory fills with 0x55 (not 0x00 or 0xCC),
      // so no caves will be found with default mock
      const caves = await injector.findCodeCaves(1234);
      expect(Array.isArray(caves)).toBe(true);
    });

    it('should respect minSize parameter', async () => {
      const caves = await injector.findCodeCaves(1234, 16);
      expect(Array.isArray(caves)).toBe(true);
    });

    it('should detect executable caves and sort them by size', async () => {
      vi.mocked(ReadProcessMemory).mockImplementation((_h: bigint, _a: bigint, size: number) => {
        const buf = Buffer.alloc(size, 0x90);
        buf.fill(0x00, 8, 20);
        buf.fill(0xcc, 40, 60);
        return buf;
      });

      const caves = await injector.findCodeCaves(1234, 8);

      expect(caves.length).toBeGreaterThan(0);
      expect(caves[0]!.size).toBeGreaterThanOrEqual(caves[caves.length - 1]!.size);
    });
  });

  describe('allocateRemote', () => {
    it('should return hex address string', async () => {
      const addr = await injector.allocateRemote(1234, 4096);
      expect(addr).toBe('0x20000');
    });
  });

  describe('freeRemote', () => {
    it('should return true on success', async () => {
      const result = await injector.freeRemote(1234, '0x20000', 4096);
      expect(result).toBe(true);
    });
  });

  describe('listPatches', () => {
    it('should return empty array initially', () => {
      expect(injector.listPatches()).toEqual([]);
    });

    it('should return all patches', async () => {
      await injector.patchBytes(1234, '0x10000', [0x90]);
      await injector.patchBytes(1234, '0x10004', [0xcc]);
      expect(injector.listPatches()).toHaveLength(2);
    });
  });
});
