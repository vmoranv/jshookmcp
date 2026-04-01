import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  nativeWriteMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
  createPlatformProvider: vi.fn(),
}));

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('@src/native/NativeMemoryManager', () => ({
  nativeMemoryManager: {
    writeMemory: state.nativeWriteMemory,
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

import { writeMemory, batchMemoryWrite } from '@modules/process/memory/writer';
import { MEMORY_MAX_WRITE_BYTES } from '@src/constants';

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

  it('rejects zero-length payloads', async () => {
    const result = await writeMemory('linux', 1, '0x10', '', 'hex', vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Write size must be');
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

  it('falls back to PowerShell when the native Windows writer throws', async () => {
    state.isKoffiAvailable.mockReturnValue(true);
    state.nativeWriteMemory.mockRejectedValueOnce(new Error('native-crash'));
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"bytesWritten":2}',
      stderr: '',
    });

    const result = await writeMemory('win32', 3, '0x20', 'ABCD', 'hex', vi.fn());

    expect(result.success).toBe(true);
    expect(state.executePowerShellScript).toHaveBeenCalled();
  });

  it('returns a Linux memory write error when stderr reports a failure', async () => {
    state.execAsync.mockResolvedValue({
      stdout: '',
      stderr: 'error: permission denied',
    });

    const result = await writeMemory('linux', 4, '0x30', 'AA', 'hex', vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Requires root privileges');
  });

  it('returns a Linux memory write error when the shell command throws', async () => {
    state.execAsync.mockRejectedValueOnce(new Error('boom'));

    const result = await writeMemory('linux', 4, '0x30', 'AA', 'hex', vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Run as root');
  });

  it('returns macOS protection error when region is not writable', async () => {
    const result = await writeMemory(
      'darwin',
      4,
      '0x3000',
      '90',
      'hex',
      vi.fn().mockResolvedValue({ success: true, isWritable: false, protection: 'r--' }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not writable');
  });

  it('rejects macOS null pointers and oversized payloads before writing', async () => {
    const nullPtr = await writeMemory('darwin', 4, '0x0', '90', 'hex', vi.fn());
    const oversized = await writeMemory(
      'darwin',
      4,
      '0x3000',
      '90'.repeat(MEMORY_MAX_WRITE_BYTES + 1),
      'hex',
      vi.fn(),
    );

    expect(nullPtr.success).toBe(false);
    expect(nullPtr.error).toContain('null pointer');
    expect(oversized.success).toBe(false);
    expect(oversized.error).toContain('Write size must be');
  });

  it('uses the macOS native fast-path when the provider is available', async () => {
    state.createPlatformProvider.mockReturnValue({
      checkAvailability: vi.fn().mockResolvedValue({ available: true }),
      openProcess: vi.fn().mockReturnValue({ handle: 'darwin-handle' }),
      writeMemory: vi.fn().mockReturnValue({ bytesWritten: 2 }),
      closeProcess: vi.fn(),
    });

    const result = await writeMemory('darwin', 4, '0x3000', '90 90', 'hex', vi.fn());

    expect(result.success).toBe(true);
    expect(result.bytesWritten).toBe(2);
  });

  it('returns unsupported-platform error for unknown targets', async () => {
    const result = await writeMemory('unknown', 4, '0x3000', '90', 'hex', vi.fn());
    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('returns the batch size guard when too many patches are provided', async () => {
    const patches = Array.from({ length: 1001 }, (_, index) => ({
      address: `0x${(index + 1).toString(16)}`,
      data: '90',
    }));

    const result = await batchMemoryWrite(10, patches, vi.fn());

    expect(result.success).toBe(false);
    expect(result.error).toContain('Too many patches');
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
      writeFn,
    );

    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.error).toContain('Failed to write 1 of 2 patches');
  });

  it('batchMemoryWrite defaults patch encoding to hex when omitted', async () => {
    const writeFn = vi.fn().mockResolvedValue({ success: true });

    const result = await batchMemoryWrite(10, [{ address: '0x10', data: '90' }], writeFn);

    expect(result.success).toBe(true);
    expect(writeFn).toHaveBeenCalledWith(10, '0x10', '90', 'hex');
  });
});
