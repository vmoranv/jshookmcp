import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  nativeWriteMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
}));

vi.mock('../../../../src/modules/process/memory/types.js', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('../../../../src/native/NativeMemoryManager.js', () => ({
  nativeMemoryManager: {
    writeMemory: state.nativeWriteMemory,
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

import { writeMemory, batchMemoryWrite } from '../../../../src/modules/process/memory/writer.js';

describe('memory/writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isKoffiAvailable.mockReturnValue(false);
  });

  it('returns validation error for invalid address', async () => {
    const result = await writeMemory('linux', 1, 'nope', 'AA', 'hex', vi.fn());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid address format');
  });

  it('uses native Windows writer when koffi path succeeds', async () => {
    state.isKoffiAvailable.mockReturnValue(true);
    state.nativeWriteMemory.mockResolvedValue({ success: true, bytesWritten: 4 });

    const result = await writeMemory('win32', 2, '0x10', 'DEADBEEF', 'hex', vi.fn());

    expect(result.success).toBe(true);
    expect(state.nativeWriteMemory).toHaveBeenCalledWith(2, '0x10', 'DEADBEEF', 'hex');
    expect(state.executePowerShellScript).not.toHaveBeenCalled();
  });

  it('falls back to PowerShell when native Windows writer fails', async () => {
    state.isKoffiAvailable.mockReturnValue(true);
    state.nativeWriteMemory.mockResolvedValue({ success: false, error: 'native-fail' });
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
      vi.fn().mockResolvedValue({ success: true, isWritable: false, protection: 'r--' })
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
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'denied' });

    const result = await batchMemoryWrite(
      10,
      [
        { address: '0x10', data: '90' },
        { address: '0x20', data: '91' },
      ],
      writeFn
    );

    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.error).toContain('Failed to write 1 of 2 patches');
  });
});

