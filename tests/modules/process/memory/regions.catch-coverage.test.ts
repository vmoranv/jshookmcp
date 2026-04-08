import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Catch-block coverage for memory/regions module (enumerateRegions, checkMemoryProtection).
 * Fills untested branches beyond tests/modules/process/memory/regions.test.ts:
 *
 * regions.enumerate.ts catch blocks:
 * - enumerateRegions('linux'): outer catch → returns { success: false }
 * - enumerateRegions('darwin'): outer catch → returns { success: false }
 * - enumerateRegions('win32'): outer catch when PowerShell throws
 *
 * regions.protection.ts catch blocks:
 * - checkMemoryProtection('linux'): outer catch → returns { success: false }
 * - checkMemoryProtection('darwin'): outer catch when vmmap throws
 * - checkMemoryProtection('win32'): outer catch when PowerShell throws
 */

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  execFileAsync: vi.fn(),
  nativeCheckMemoryProtection: vi.fn(),
  nativeEnumerateRegions: vi.fn(),
  isKoffiAvailable: vi.fn(),
  createPlatformProvider: vi.fn(),
  readFileSync: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
  execFileAsync: state.execFileAsync,
}));

vi.mock('@native/NativeMemoryManager', () => ({
  nativeMemoryManager: {
    checkMemoryProtection: state.nativeCheckMemoryProtection,
    enumerateRegions: state.nativeEnumerateRegions,
  },
}));

vi.mock('@native/NativeMemoryManager.utils', () => ({
  isKoffiAvailable: state.isKoffiAvailable,
}));

vi.mock('@native/platform/factory.js', () => ({
  createPlatformProvider: state.createPlatformProvider,
}));

vi.mock('node:fs', () => ({
  promises: {
    readFile: state.readFile,
  },
  readFileSync: state.readFileSync,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  dumpMemoryRegion,
  enumerateRegions,
  checkMemoryProtection,
} from '@modules/process/memory/regions';

describe('memory/regions - catch blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isKoffiAvailable.mockReturnValue(false);
  });

  // ── enumerateRegions catch blocks ───────────────────────────────────────────

  describe('enumerateRegions', () => {
    it('returns failure when Linux /proc/maps readFileSync throws (EPERM)', async () => {
      state.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const result = await enumerateRegions('linux', 9999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('returns failure when Darwin vmmap throws EPERM', async () => {
      state.execAsync.mockRejectedValue(new Error('Operation not permitted') as any);
      const result = await enumerateRegions('darwin', 9999);
      expect(result.success).toBe(false);
    });

    it('returns failure when Windows PowerShell enumerateRegions throws', async () => {
      state.executePowerShellScript.mockRejectedValue(new Error('powershell crashed'));
      const result = await enumerateRegions('win32', 1234);
      expect(result.success).toBe(false);
      expect(result.error).toContain('powershell crashed');
    });

    it('returns failure when Windows PowerShell throws EPERM', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      state.executePowerShellScript.mockRejectedValue(err);
      const result = await enumerateRegions('win32', 1234);
      expect(result.success).toBe(false);
    });
  });

  // ── checkMemoryProtection catch blocks ────────────────────────────────────

  describe('checkMemoryProtection', () => {
    it('returns failure when Linux /proc/maps readFile throws EPERM', async () => {
      state.readFile.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const result = await checkMemoryProtection('linux', 9999, '0x1000');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('returns failure when Darwin vmmap throws', async () => {
      state.execAsync.mockRejectedValue(new Error('vmmap failed'));
      const result = await checkMemoryProtection('darwin', 9999, '0x1000');
      expect(result.success).toBe(false);
      expect(result.error).toContain('vmmap failed');
    });

    it('returns failure when Darwin vmmap throws EPERM', async () => {
      const err = new Error('Automation untrusted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const result = await checkMemoryProtection('darwin', 9999, '0x1000');
      expect(result.success).toBe(false);
    });

    it('returns failure when Windows PowerShell checkProtection throws', async () => {
      state.executePowerShellScript.mockRejectedValue(new Error('powershell crashed'));
      const result = await checkMemoryProtection('win32', 1234, '0x1000');
      expect(result.success).toBe(false);
      expect(result.error).toContain('powershell crashed');
    });

    it('returns failure when Windows PowerShell throws EPERM', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      state.executePowerShellScript.mockRejectedValue(err);
      const result = await checkMemoryProtection('win32', 1234, '0x1000');
      expect(result.success).toBe(false);
    });
  });

  // ── dumpMemoryRegion catch blocks ──────────────────────────────────────────

  describe('dumpMemoryRegion', () => {
    it('returns failure when Linux readMemoryBlockLinux throws readFileSync EPERM', async () => {
      state.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const result = await dumpMemoryRegion('linux', 1, '0x1000', 8, '/tmp/dump.bin');
      expect(result.success).toBe(false);
    });

    it('returns failure when Linux readMemoryBlockLinux throws execAsync EPERM', async () => {
      state.readFileSync.mockReturnValue('anonymous 00001000-00002000 rw-p 00000000 00:00 0\n');
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const result = await dumpMemoryRegion('linux', 1, '0x1000', 8, '/tmp/dump.bin');
      expect(result.success).toBe(false);
    });
  });
});
