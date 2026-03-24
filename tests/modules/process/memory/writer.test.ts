import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  nativeWriteMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/native/NativeMemoryManager', () => ({
  nativeMemoryManager: {
    writeMemory: state.nativeWriteMemory,
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

import { writeMemory, batchMemoryWrite } from '@modules/process/memory/writer';

describe('memory/writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isKoffiAvailable.mockReturnValue(false);
  });

  it('returns validation error for invalid address', async () => {
    const result = await writeMemory('linux', 1, 'nope', 'AA', 'hex', vi.fn());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid address format');
  });

  it('uses native Windows writer when koffi path succeeds', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isKoffiAvailable.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.nativeWriteMemory.mockResolvedValue({ success: true, bytesWritten: 4 });

    const result = await writeMemory('win32', 2, '0x10', 'DEADBEEF', 'hex', vi.fn());

    expect(result.success).toBe(true);
    expect(state.nativeWriteMemory).toHaveBeenCalledWith(2, '0x10', 'DEADBEEF', 'hex');
    expect(state.executePowerShellScript).not.toHaveBeenCalled();
  });

  it('falls back to PowerShell when native Windows writer fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.isKoffiAvailable.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.nativeWriteMemory.mockResolvedValue({ success: false, error: 'native-fail' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"bytesWritten":4}',
      stderr: '',
    });

    const result = await writeMemory('win32', 3, '0x20', 'DE AD BE EF', 'hex', vi.fn());
    expect(result.success).toBe(true);
    expect(result.bytesWritten).toBe(4);
  });

  it('returns macOS protection error when region is not writable', async () => {
    const result = await writeMemory(
      'darwin',
      4,
      '0x3000',
      '90',
      'hex',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      vi.fn().mockResolvedValue({ success: true, isWritable: false, protection: 'r--' }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not writable');
  });

  it('returns unsupported-platform error for unknown targets', async () => {
    const result = await writeMemory('unknown', 4, '0x3000', '90', 'hex', vi.fn());
    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('batchMemoryWrite aggregates per-patch results and error summary', async () => {
    const writeFn = vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValueOnce({ success: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValueOnce({ success: false, error: 'denied' });

    const result = await batchMemoryWrite(
      10,
      [
        { address: '0x10', data: '90' },
        { address: '0x20', data: '91' },
      ],
      writeFn,
    );

    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.error).toContain('Failed to write 1 of 2 patches');
  });
});
