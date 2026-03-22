import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  nativeReadMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:fs', () => ({
  promises: {
    readFile: state.readFile,
    unlink: state.unlink,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/native/NativeMemoryManager', () => ({
  nativeMemoryManager: {
    readMemory: state.nativeReadMemory,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/native/Win32API', () => ({
  isKoffiAvailable: state.isKoffiAvailable,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { readMemory } from '@modules/process/memory/reader';

describe('memory/reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isKoffiAvailable.mockReturnValue(false);
  });

  it('returns validation error for invalid address format', async () => {
    const result = await readMemory('linux', 1, 'not-hex', 4, vi.fn());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid address format');
  });

  it('uses native Windows reader when koffi is available and succeeds', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isKoffiAvailable.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.nativeReadMemory.mockResolvedValue({ success: true, data: 'AA BB' });

    const result = await readMemory('win32', 2, '0x10', 2, vi.fn());

    expect(result).toEqual({ success: true, data: 'AA BB' });
    expect(state.nativeReadMemory).toHaveBeenCalledWith(2, '0x10', 2);
    expect(state.executePowerShellScript).not.toHaveBeenCalled();
  });

  it('falls back to PowerShell on native Windows read failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isKoffiAvailable.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.nativeReadMemory.mockResolvedValue({ success: false, error: 'native-fail' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"data":"DE AD BE EF"}',
      stderr: '',
    });

    const result = await readMemory('win32', 3, '0x20', 4, vi.fn());

    expect(result.success).toBe(true);
    expect(result.data).toBe('DE AD BE EF');
  });

  it('returns Linux privilege error when read output is empty', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
    const result = await readMemory('linux', 4, '0x30', 8, vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Requires root');
  });

  it('returns macOS protection error when region is not readable', async () => {
    const result = await readMemory(
      'darwin',
      5,
      '0x1000',
      16,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.fn().mockResolvedValue({ success: true, isReadable: false, protection: '---' })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not readable');
  });

  it('reads macOS memory dump and returns uppercase hex bytes', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.execAsync.mockResolvedValue({ stdout: '16 bytes written', stderr: '' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.readFile.mockResolvedValue(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.unlink.mockResolvedValue(undefined);

    const result = await readMemory(
      'darwin',
      6,
      '0x2000',
      4,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.fn().mockResolvedValue({ success: true, isReadable: true })
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('DE AD BE EF');
    expect(state.unlink).toHaveBeenCalled();
  });
});
