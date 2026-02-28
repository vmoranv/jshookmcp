import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  execFileAsync: vi.fn(),
}));

vi.mock('../../../../src/modules/process/memory/types.js', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
  execFileAsync: state.execFileAsync,
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
  dumpMemoryRegion,
  enumerateRegions,
  checkMemoryProtection,
  enumerateModules,
} from '../../../../src/modules/process/memory/regions.js';

describe('memory/regions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
    state.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    state.executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('rejects dumpMemoryRegion on unsupported platform', async () => {
    const result = await dumpMemoryRegion('linux', 1, '0x10', 8, '/tmp/a.bin');
    expect(result.success).toBe(false);
    expect(result.error).toContain('only implemented for Windows and macOS');
  });

  it('validates darwin dump inputs', async () => {
    const badAddress = await dumpMemoryRegion('darwin', 1, 'bad', 8, '/tmp/a.bin');
    const badPid = await dumpMemoryRegion('darwin', 0, '0x10', 8, '/tmp/a.bin');
    const badSize = await dumpMemoryRegion('darwin', 1, '0x10', 0, '/tmp/a.bin');

    expect(badAddress.error).toContain('lldb dump failed');
    expect(badPid.error).toBeDefined();
    expect(badSize.error).toBeDefined();
  });

  it('parses successful darwin lldb dump output', async () => {
    state.execFileAsync.mockResolvedValue({ stdout: '16 bytes written to file', stderr: '' });
    const result = await dumpMemoryRegion('darwin', 2, '0x20', 16, '/tmp/out.bin');

    expect(result.success).toBe(true);
    expect(state.execFileAsync).toHaveBeenCalled();
  });

  it('enumerateRegions parses darwin vmmap output', async () => {
    state.execAsync.mockResolvedValue({
      stdout: 'MALLOC_LARGE  0000000100000000-0000000100001000 [  4K] rw-/rwx',
      stderr: '',
    });
    const result = await enumerateRegions('darwin', 3);

    expect(result.success).toBe(true);
    expect(result.regions).toHaveLength(1);
    expect(result.regions?.[0]?.baseAddress).toBe('0x0000000100000000');
    expect(result.regions?.[0]?.isWritable).toBe(true);
  });

  it('checkMemoryProtection(darwin) returns not-found for unmatched address', async () => {
    state.execAsync.mockResolvedValue({
      stdout: 'STACK GUARD 0000000101000000-0000000101001000 [4K] r--/r--',
      stderr: '',
    });
    const result = await checkMemoryProtection('darwin', 4, '0x20000000');

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('enumerateModules rejects non-windows platform', async () => {
    const result = await enumerateModules('darwin', 5);
    expect(result.success).toBe(false);
    expect(result.error).toContain('only implemented for Windows');
  });

  it('enumerateModules parses PowerShell JSON on windows', async () => {
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"modules":[{"name":"a.dll","baseAddress":"0x1000","size":4096}]}',
      stderr: '',
    });
    const result = await enumerateModules('win32', 6);

    expect(result.success).toBe(true);
    expect(result.modules?.[0]?.name).toBe('a.dll');
  });
});
