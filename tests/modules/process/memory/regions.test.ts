import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  execFileAsync: vi.fn(),
  nativeCheckMemoryProtection: vi.fn(),
  nativeEnumerateRegions: vi.fn(),
  isKoffiAvailable: vi.fn(),
  createPlatformProvider: vi.fn(),
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
  enumerateModules,
} from '@modules/process/memory/regions';

describe('memory/regions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
    state.execFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    state.executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });
    state.isKoffiAvailable.mockReturnValue(false);
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
    // DarwinMemoryRegion has isWritable property
    expect((result.regions?.[0] as { isWritable: boolean })?.isWritable).toBe(true);
  });

  it('enumerateRegions uses the macOS native fast-path when available', async () => {
    const provider = {
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      openProcess: vi.fn().mockReturnValue({ handle: 'darwin-handle' }),
      queryRegion: vi.fn().mockReturnValue({
        baseAddress: 0x1000n,
        size: 4096,
        isReadable: true,
        isWritable: false,
        isExecutable: false,
      }),
      closeProcess: vi.fn(),
    };
    state.createPlatformProvider.mockReturnValue(provider);

    const result = await checkMemoryProtection('darwin', 3, '0x1000');

    expect(result.success).toBe(true);
    expect(result.protection).toBe('r--');
    expect(provider.closeProcess).toHaveBeenCalled();
  });

  it('enumerateRegions falls back to PowerShell when native Windows enumeration fails', async () => {
    state.isKoffiAvailable.mockReturnValue(true);
    state.nativeEnumerateRegions.mockResolvedValue({
      success: false,
      error: 'native-fail',
    });
    state.executePowerShellScript.mockResolvedValue({
      stdout:
        '{"success":true,"regions":[{"baseAddress":"0x1000","size":4096,"state":"COMMIT","protection":"rw-","isReadable":true,"type":"PRIVATE"}]}',
      stderr: '',
    });

    const result = await enumerateRegions('win32', 8);

    expect(result.success).toBe(true);
    expect(result.regions?.[0]).toMatchObject({
      baseAddress: '0x1000',
      protection: 'rw-',
    });
  });

  it('checkMemoryProtection falls back to PowerShell on Windows and surfaces silent output errors', async () => {
    state.isKoffiAvailable.mockReturnValue(true);
    state.nativeCheckMemoryProtection.mockResolvedValue({
      success: false,
      error: 'native-fail',
    });
    state.executePowerShellScript.mockResolvedValue({
      stdout: '   ',
      stderr: '',
    });

    const result = await checkMemoryProtection('win32', 9, '0x2000');

    expect(result.success).toBe(false);
    expect(result.error).toContain('PowerShell returned empty output');
  });

  it('checkMemoryProtection rejects invalid macOS addresses before vmmap parsing', async () => {
    await expect(checkMemoryProtection('darwin', 4, 'not-hex')).rejects.toThrow(
      /Cannot convert 0xnot-hex to a BigInt/,
    );
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

  it('enumerateModules returns an error when PowerShell is silent', async () => {
    state.executePowerShellScript.mockResolvedValue({
      stdout: '   ',
      stderr: '',
    });
    const result = await enumerateModules('win32', 6);

    expect(result.success).toBe(false);
    expect(result.error).toContain('PowerShell returned empty output');
  });

  it('uses native Windows protection and region enumeration when available', async () => {
    state.isKoffiAvailable.mockReturnValue(true);
    state.nativeCheckMemoryProtection.mockResolvedValue({
      success: true,
      protection: 'rw-',
      isReadable: true,
      isWritable: true,
      isExecutable: false,
      regionStart: '0x1000',
      regionSize: 4096,
    });
    state.nativeEnumerateRegions.mockResolvedValue({
      success: true,
      regions: [{ baseAddress: '0x1000', size: 4096, state: 'COMMIT', protection: 'rw-' }],
    });

    const protection = await checkMemoryProtection('win32', 7, '0x1000');
    const regions = await enumerateRegions('win32', 7);

    expect(protection.success).toBe(true);
    expect(protection.protection).toBe('rw-');
    expect(regions.success).toBe(true);
    expect(regions.regions?.[0]).toMatchObject({ baseAddress: '0x1000', protection: 'rw-' });
  });
});
