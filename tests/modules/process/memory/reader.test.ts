import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  nativeReadMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
  createPlatformProvider: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: {
    readFile: state.readFile,
    unlink: state.unlink,
  },
}));

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('@src/native/NativeMemoryManager', () => ({
  nativeMemoryManager: {
    readMemory: state.nativeReadMemory,
  },
}));

vi.mock('@src/native/Win32API', () => ({
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

import { readMemory } from '@modules/process/memory/reader';
import { MEMORY_MAX_READ_BYTES } from '@src/constants';

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

  it('rejects read sizes outside the allowed range', async () => {
    const result = await readMemory('linux', 1, '0x10', MEMORY_MAX_READ_BYTES + 1, vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Read size must be');
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

  it('returns Linux read failure when the shell command throws', async () => {
    state.execAsync.mockRejectedValueOnce(new Error('boom'));

    const result = await readMemory('linux', 4, '0x30', 8, vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Run as root or use ptrace');
  });

  it('returns macOS protection error when region is not readable', async () => {
    const result = await readMemory(
      'darwin',
      5,
      '0x1000',
      16,
      vi.fn().mockResolvedValue({ success: true, isReadable: false, protection: '---' }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not readable');
  });

  it('rejects macOS null pointers before probing protection', async () => {
    const result = await readMemory('darwin', 5, '0x0', 16, vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('null pointer');
  });

  it('rejects macOS reads that exceed the maximum size', async () => {
    const result = await readMemory('darwin', 5, '0x1000', MEMORY_MAX_READ_BYTES + 1, vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Read size must be');
  });

  it('uses the macOS native fast-path when the provider is available', async () => {
    state.createPlatformProvider.mockReturnValue({
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      openProcess: vi.fn().mockReturnValue({ handle: 'darwin-handle' }),
      readMemory: vi.fn().mockReturnValue({
        data: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        bytesRead: 4,
      }),
      closeProcess: vi.fn(),
    });

    const result = await readMemory('darwin', 5, '0x1000', 4, vi.fn());

    expect(result.success).toBe(true);
    expect(result.data).toBe('DE AD BE EF');
    expect(state.createPlatformProvider).toHaveBeenCalled();
  });

  it('returns unsupported-platform error for unknown targets', async () => {
    const result = await readMemory('freebsd' as never, 6, '0x2000', 4, vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('reads macOS memory dump and returns uppercase hex bytes', async () => {
    state.createPlatformProvider.mockReturnValue({
      checkAvailability: vi.fn().mockResolvedValue({ available: false }),
      openProcess: vi.fn(),
      readMemory: vi.fn(),
      closeProcess: vi.fn(),
    });
    state.execAsync.mockResolvedValue({ stdout: '16 bytes written', stderr: '' });
    state.readFile.mockResolvedValue(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    state.unlink.mockResolvedValue(undefined);

    const result = await readMemory(
      'darwin',
      6,
      '0x2000',
      4,
      vi.fn().mockResolvedValue({ success: true, isReadable: true }),
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('DE AD BE EF');
    expect(state.unlink).toHaveBeenCalled();
  });
});
