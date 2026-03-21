import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  isWindows: vi.fn(),
  isKoffiAvailable: vi.fn(),
}));

vi.mock('@native/Win32API', () => ({
  isWindows: state.isWindows,
  isKoffiAvailable: state.isKoffiAvailable,
}));

// Mock koffi dynamic import for macOS path
vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => ({ unload: vi.fn() })),
  },
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

  const originalPlatform = process.platform;

  afterEach(() => {
    vi.clearAllMocks();
    // Restore platform
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('unsupported platforms', () => {
    it('rejects unsupported platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      state.isWindows.mockReturnValue(false);

      await expect(checkNativeMemoryAvailability(execAsync)).resolves.toEqual({
        available: false,
        reason: expect.stringContaining('require Windows or macOS'),
      });
      expect(execAsync).not.toHaveBeenCalled();
    });
  });

  describe('Windows path', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      state.isWindows.mockReturnValue(true);
      state.isKoffiAvailable.mockReturnValue(true);
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

  describe('macOS (Darwin) path', () => {
    const originalGetuid = process.getuid;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
    });

    afterEach(() => {
      if (originalGetuid) {
        process.getuid = originalGetuid;
      }
    });

    it('rejects when not running as root', async () => {
      process.getuid = () => 501; // non-root
      execAsync.mockResolvedValue({ stdout: '', stderr: '' }); // csrutil check

      const result = await checkNativeMemoryAvailability(execAsync);
      expect(result.available).toBe(false);
      expect(result.reason).toContain('root privileges');
    });

    it('returns available when running as root', async () => {
      process.getuid = () => 0; // root
      execAsync.mockResolvedValue({ stdout: 'System Integrity Protection status: enabled.', stderr: '' });

      const result = await checkNativeMemoryAvailability(execAsync);
      expect(result.available).toBe(true);
    });
  });
});
