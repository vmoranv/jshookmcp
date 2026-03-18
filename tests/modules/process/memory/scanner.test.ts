import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  readFileSync: vi.fn(() => {
    throw new Error('Linux memory scan not supported in test environment');
  }),
  nativeScanMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
  parseProcMaps: vi.fn(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFileSync: state.readFileSync,
    promises: {
      ...actual.promises,
      writeFile: state.writeFile,
      unlink: state.unlink,
    },
  };
});

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('@src/native/NativeMemoryManager', () => ({
  nativeMemoryManager: {
    scanMemory: state.nativeScanMemory,
  },
}));

vi.mock('@src/native/NativeMemoryManager.utils', () => ({
  isKoffiAvailable: state.isKoffiAvailable,
}));

vi.mock('@src/modules/process/memory/linux/mapsParser', () => ({
  parseProcMaps: state.parseProcMaps,
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
  buildPatternBytesAndMask,
  patternToBytesMac,
  scanMemory,
  scanMemoryFiltered,
} from '@modules/process/memory/scanner';

describe('memory/scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('buildPatternBytesAndMask handles hex wildcard mask', () => {
    const result = buildPatternBytesAndMask('AA ?? BB', 'hex');
    expect(result.patternBytes).toEqual([0xaa, 0x00, 0xbb]);
    expect(result.mask).toEqual([1, 0, 1]);
  });

  it('buildPatternBytesAndMask throws for invalid patterns', () => {
    expect(() => buildPatternBytesAndMask('ZZ', 'hex')).toThrow('Invalid pattern');
  });

  it('patternToBytesMac supports int32 and string pattern types', () => {
    const int32Bytes = patternToBytesMac('305419896', 'int32');
    const strBytes = patternToBytesMac('AB', 'string');

    expect(int32Bytes).toEqual({ bytes: [0x78, 0x56, 0x34, 0x12], mask: [1, 1, 1, 1] });
    expect(strBytes).toEqual({ bytes: [65, 66], mask: [1, 1] });
  });

  it('scanMemory returns unsupported error on unknown platform', async () => {
    const result = await scanMemory('unknown', 1, 'AA', 'hex');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('scanMemory(win32) parses successful PowerShell JSON', async () => {
    state.executePowerShellScript.mockResolvedValue({
      stdout:
        '{"success":true,"addresses":["0x100","0x200"],"stats":{"patternLength":2,"resultsFound":2}}',
      stderr: '',
    });
    const result = await scanMemory('win32', 2, 'AA BB', 'hex');

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual(['0x100', '0x200']);
    expect(result.stats?.resultsFound).toBe(2);
  });

  it('scanMemory(win32) returns stderr failure when PowerShell reports error', async () => {
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{}',
      stderr: 'Error: access denied',
    });
    const result = await scanMemory('win32', 2, 'AA BB', 'hex');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Error');
  });

  it('scanMemoryFiltered rejects when no valid addresses provided', async () => {
    const result = await scanMemoryFiltered(1, 'AA', ['xyz', 'qwerty'], 'hex', vi.fn(), vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('No valid addresses');
  });

  it('scanMemoryFiltered keeps only matches near provided address window', async () => {
    const result = await scanMemoryFiltered(
      1,
      'AA',
      ['0x1000'],
      'hex',
      vi.fn(),
      vi.fn().mockResolvedValue({
        success: true,
        addresses: ['0x0F50', '0x10F0', '0x2000', '0x10F0'],
      })
    );

    expect(result.success).toBe(true);
    expect(result.addresses).toEqual(['0x0F50', '0x10F0']);
    expect(result.stats?.resultsFound).toBe(2);
  });

  describe('Windows native fallback to PowerShell', () => {
    it('falls back to PowerShell when native scan fails', async () => {
      state.isKoffiAvailable.mockReturnValue(true);
      state.nativeScanMemory.mockResolvedValue({
        success: false,
        addresses: [],
        error: 'Native scan failed',
      });
      state.executePowerShellScript.mockResolvedValue({
        stdout:
          '{"success":true,"addresses":["0x300"],"stats":{"patternLength":2,"resultsFound":1}}',
        stderr: '',
      });

      const result = await scanMemory('win32', 1, 'AA BB', 'hex');

      expect(result.success).toBe(true);
      expect(result.addresses).toEqual(['0x300']);
      expect(state.nativeScanMemory).toHaveBeenCalledWith(1, 'AA BB', 'hex');
      expect(state.executePowerShellScript).toHaveBeenCalled();
    });

    it('falls back to PowerShell when native scan throws', async () => {
      state.isKoffiAvailable.mockReturnValue(true);
      state.nativeScanMemory.mockRejectedValue(new Error('Native crash'));
      state.executePowerShellScript.mockResolvedValue({
        stdout:
          '{"success":true,"addresses":["0x400"],"stats":{"patternLength":2,"resultsFound":1}}',
        stderr: '',
      });

      const result = await scanMemory('win32', 1, 'CC DD', 'hex');

      expect(result.success).toBe(true);
      expect(result.addresses).toEqual(['0x400']);
      expect(state.executePowerShellScript).toHaveBeenCalled();
    });

    it('skips native when koffi not available', async () => {
      state.isKoffiAvailable.mockReturnValue(false);
      state.executePowerShellScript.mockResolvedValue({
        stdout:
          '{"success":true,"addresses":["0x500"],"stats":{"patternLength":2,"resultsFound":1}}',
        stderr: '',
      });

      const result = await scanMemory('win32', 1, 'EE FF', 'hex');

      expect(result.success).toBe(true);
      expect(state.nativeScanMemory).not.toHaveBeenCalled();
      expect(state.executePowerShellScript).toHaveBeenCalled();
    });
  });

  describe('Linux memory scan error paths', () => {
    it('returns not implemented error for linux platform', async () => {
      const result = await scanMemory('linux', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported');
    });
  });
});
