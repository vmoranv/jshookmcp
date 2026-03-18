import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  isWindows: vi.fn(),
  isKoffiAvailable: vi.fn(),
}));

vi.mock('@native/Win32API', () => ({
  isWindows: state.isWindows,
  isKoffiAvailable: state.isKoffiAvailable,
}));

import { checkNativeMemoryAvailability } from '@src/native/NativeMemoryManager.availability';

describe('NativeMemoryManager.availability', () => {
  const execAsync =
    vi.fn<
      (
        command: string,
        options?: { timeout?: number }
      ) => Promise<{ stdout: string; stderr: string }>
    >();

  beforeEach(() => {
    vi.clearAllMocks();
    state.isWindows.mockReturnValue(true);
    state.isKoffiAvailable.mockReturnValue(true);
  });

  it('rejects non-Windows platforms early', async () => {
    state.isWindows.mockReturnValue(false);

    await expect(checkNativeMemoryAvailability(execAsync)).resolves.toEqual({
      available: false,
      reason: `Native memory operations only supported on Windows. Current platform: ${process.platform}`,
    });
    expect(execAsync).not.toHaveBeenCalled();
  });

  it('rejects when koffi is unavailable', async () => {
    state.isKoffiAvailable.mockReturnValue(false);

    await expect(checkNativeMemoryAvailability(execAsync)).resolves.toEqual({
      available: false,
      reason: 'koffi library not available. Install with: pnpm add koffi',
    });
    expect(execAsync).not.toHaveBeenCalled();
  });

  it('rejects when the admin check returns false', async () => {
    execAsync.mockResolvedValue({ stdout: 'False\r\n', stderr: '' });

    await expect(checkNativeMemoryAvailability(execAsync)).resolves.toEqual({
      available: false,
      reason: 'Native memory operations require Administrator privileges. Run as Administrator.',
    });
    expect(execAsync).toHaveBeenCalledWith(expect.stringContaining('powershell.exe'), {
      timeout: 5000,
    });
  });

  it('rejects when the admin check throws', async () => {
    execAsync.mockRejectedValue(new Error('spawn failed'));

    await expect(checkNativeMemoryAvailability(execAsync)).resolves.toEqual({
      available: false,
      reason: 'Failed to check Administrator privileges.',
    });
  });

  it('returns available when all prerequisites pass', async () => {
    execAsync.mockResolvedValue({ stdout: 'true\n', stderr: '' });

    await expect(checkNativeMemoryAvailability(execAsync)).resolves.toEqual({ available: true });
  });
});
