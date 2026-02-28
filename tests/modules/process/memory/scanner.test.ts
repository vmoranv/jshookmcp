import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: {
    writeFile: state.writeFile,
    unlink: state.unlink,
  },
}));

vi.mock('../../../../src/modules/process/memory/types.js', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('../../../../src/utils/logger.js', () => ({
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
} from '../../../../src/modules/process/memory/scanner.js';

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

    expect(int32Bytes).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(strBytes).toEqual([65, 66]);
  });

  it('scanMemory returns unsupported error on unknown platform', async () => {
    const result = await scanMemory('unknown', 1, 'AA', 'hex');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('scanMemory(win32) parses successful PowerShell JSON', async () => {
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"addresses":["0x100","0x200"],"stats":{"patternLength":2,"resultsFound":2}}',
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
    const result = await scanMemoryFiltered(
      1,
      'AA',
      ['xyz', 'qwerty'],
      'hex',
      vi.fn(),
      vi.fn()
    );

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
});
