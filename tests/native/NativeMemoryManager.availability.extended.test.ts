import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  isKoffiAvailable: vi.fn(),
  isWindows: vi.fn(),
  execAsync: vi.fn(),
}));

vi.mock('@native/Win32API', () => ({
  isKoffiAvailable: state.isKoffiAvailable,
  isWindows: state.isWindows,
}));

import { checkNativeMemoryAvailability } from '@native/NativeMemoryManager.availability';

describe('NativeMemoryManager.availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns unavailable when not on Windows', async () => {
    state.isWindows.mockReturnValue(false);

    const result = await checkNativeMemoryAvailability(state.execAsync);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('only supported on Windows');
    expect(state.execAsync).not.toHaveBeenCalled();
  });

  it('returns unavailable when koffi is not available', async () => {
    state.isWindows.mockReturnValue(true);
    state.isKoffiAvailable.mockReturnValue(false);

    const result = await checkNativeMemoryAvailability(state.execAsync);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('koffi library not available');
  });

  it('returns available when running as admin on Windows', async () => {
    state.isWindows.mockReturnValue(true);
    state.isKoffiAvailable.mockReturnValue(true);
    state.execAsync.mockResolvedValue({ stdout: 'True\n', stderr: '' });

    const result = await checkNativeMemoryAvailability(state.execAsync);

    expect(result.available).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns unavailable when not running as admin', async () => {
    state.isWindows.mockReturnValue(true);
    state.isKoffiAvailable.mockReturnValue(true);
    state.execAsync.mockResolvedValue({ stdout: 'False\n', stderr: '' });

    const result = await checkNativeMemoryAvailability(state.execAsync);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('Administrator privileges');
  });

  it('returns unavailable when admin check throws', async () => {
    state.isWindows.mockReturnValue(true);
    state.isKoffiAvailable.mockReturnValue(true);
    state.execAsync.mockRejectedValue(new Error('powershell failed'));

    const result = await checkNativeMemoryAvailability(state.execAsync);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('Failed to check Administrator privileges');
  });

  it('passes the execAsync function as the check command runner', async () => {
    state.isWindows.mockReturnValue(true);
    state.isKoffiAvailable.mockReturnValue(true);
    state.execAsync.mockResolvedValue({ stdout: 'True\n', stderr: '' });

    await checkNativeMemoryAvailability(state.execAsync);

    expect(state.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('IsInRole'),
      expect.objectContaining({ timeout: 5000 })
    );
  });

  it('handles case-insensitive "true" comparison', async () => {
    state.isWindows.mockReturnValue(true);
    state.isKoffiAvailable.mockReturnValue(true);
    state.execAsync.mockResolvedValue({ stdout: '  TRUE  \n', stderr: '' });

    const result = await checkNativeMemoryAvailability(state.execAsync);
    expect(result.available).toBe(true);
  });
});
