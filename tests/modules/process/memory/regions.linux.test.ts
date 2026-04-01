import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  readFile: vi.fn(),
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: state.readFileSync,
  promises: {
    readFile: state.readFile,
  },
}));

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('@native/NativeMemoryManager', () => ({
  nativeMemoryManager: {
    checkMemoryProtection: vi.fn(),
    enumerateRegions: vi.fn(),
  },
}));

vi.mock('@native/NativeMemoryManager.utils', () => ({
  isKoffiAvailable: vi.fn(() => false),
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: state.debug,
    warn: state.warn,
    error: state.error,
    info: vi.fn(),
  },
}));

import { checkMemoryProtection, enumerateRegions } from '@modules/process/memory/regions';

describe('memory/regions linux paths', () => {
  const mapsContent = [
    '00400000-00452000 r-xp 00000000 08:01 12345 /usr/bin/cat',
    '00652000-00653000 rw-p 00052000 08:01 12345 /usr/bin/cat',
  ].join('\n');

  beforeEach(() => {
    vi.clearAllMocks();
    state.readFileSync.mockReturnValue(mapsContent);
    state.readFile.mockResolvedValue(mapsContent);
    state.executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });
    state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('enumerates readable linux regions', async () => {
    const result = await enumerateRegions('linux', 7);

    expect(result.success).toBe(true);
    expect(result.regions).toHaveLength(2);
    expect(result.regions?.[0]).toMatchObject({
      baseAddress: '0x400000',
      size: 0x52000,
      isReadable: true,
      protection: 'r-x',
      type: '/usr/bin/cat',
    });
  });

  it('checks linux protection for matching addresses', async () => {
    const result = await checkMemoryProtection('linux', 7, '0x400010');

    expect(result.success).toBe(true);
    expect(result.protection).toBe('r-x');
    expect(result.isReadable).toBe(true);
    expect(result.regionStart).toBe('0x400000');
    expect(result.regionSize).toBe(0x52000);
  });

  it('returns not-found when the linux address is outside all regions', async () => {
    const result = await checkMemoryProtection('linux', 7, '0x900000');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns the unsupported-platform error for region enumeration', async () => {
    const result = await enumerateRegions('freebsd' as never, 7);

    expect(result.success).toBe(false);
    expect(result.error).toContain('only implemented for Windows, Linux, and macOS');
  });

  it('returns the filesystem error when linux region enumeration cannot read /proc/maps', async () => {
    state.readFileSync.mockImplementationOnce(() => {
      throw new Error('permission denied');
    });

    const result = await enumerateRegions('linux', 7);

    expect(result.success).toBe(false);
    expect(result.error).toContain('permission denied');
  });
});
