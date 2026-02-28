import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  nativeReadMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: {
    readFile: state.readFile,
    unlink: state.unlink,
  },
}));

vi.mock('../../../../src/modules/process/memory/types.js', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('../../../../src/native/NativeMemoryManager.js', () => ({
  nativeMemoryManager: {
    readMemory: state.nativeReadMemory,
  },
}));

vi.mock('../../../../src/native/Win32API.js', () => ({
  isKoffiAvailable: state.isKoffiAvailable,
}));

vi.mock('../../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { readMemory } from '../../../../src/modules/process/memory/reader.js';

describe('memory/reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isKoffiAvailable.mockReturnValue(false);
  });

  it('returns validation error for invalid address format', async () => {
    const result = await readMemory('linux', 1, 'not-hex', 4, vi.fn());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid address format');
  });

  it('uses native Windows reader when koffi is available and succeeds', async () => {
    state.isKoffiAvailable.mockReturnValue(true);
    state.nativeReadMemory.mockResolvedValue({ success: true, data: 'AA BB' });

    const result = await readMemory('win32', 2, '0x10', 2, vi.fn());

    expect(result).toEqual({ success: true, data: 'AA BB' });
    expect(state.nativeReadMemory).toHaveBeenCalledWith(2, '0x10', 2);
    expect(state.executePowerShellScript).not.toHaveBeenCalled();
  });

  it('falls back to PowerShell on native Windows read failure', async () => {
    state.isKoffiAvailable.mockReturnValue(true);
    state.nativeReadMemory.mockResolvedValue({ success: false, error: 'native-fail' });
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"data":"DE AD BE EF"}',
      stderr: '',
    });

    const result = await readMemory('win32', 3, '0x20', 4, vi.fn());

    expect(result.success).toBe(true);
    expect(result.data).toBe('DE AD BE EF');
  });

  it('returns Linux privilege error when read output is empty', async () => {
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
      vi.fn().mockResolvedValue({ success: true, isReadable: false, protection: '---' })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not readable');
  });

  it('reads macOS memory dump and returns uppercase hex bytes', async () => {
    state.execAsync.mockResolvedValue({ stdout: '16 bytes written', stderr: '' });
    state.readFile.mockResolvedValue(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    state.unlink.mockResolvedValue(undefined);

    const result = await readMemory(
      'darwin',
      6,
      '0x2000',
      4,
      vi.fn().mockResolvedValue({ success: true, isReadable: true })
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('DE AD BE EF');
    expect(state.unlink).toHaveBeenCalled();
  });
});

