import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  isKoffiAvailable: vi.fn(),
  isWindows: vi.fn(),
  execAsync: vi.fn(),
}));

vi.mock('@native/Win32API', () => ({
  isKoffiAvailable: state.isKoffiAvailable,
  isWindows: state.isWindows,
}));

// Mock koffi dynamic import for macOS path
vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => ({ unload: vi.fn() })),
  },
}));

import { checkNativeMemoryAvailability } from '@native/NativeMemoryManager.availability';

describe('NativeMemoryManager.availability', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('unsupported platform', () => {
    it('returns unavailable when not on Windows or macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      state.isWindows.mockReturnValue(false);

      const result = await checkNativeMemoryAvailability(state.execAsync);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('require Windows or macOS');
      expect(state.execAsync).not.toHaveBeenCalled();
    });
  });

  describe('Windows path', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      state.isWindows.mockReturnValue(true);
      state.isKoffiAvailable.mockReturnValue(true);
    });

    it('returns unavailable when koffi is not available', async () => {
      state.isKoffiAvailable.mockReturnValue(false);

      const result = await checkNativeMemoryAvailability(state.execAsync);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('koffi library not available');
    });

    it('returns available when running as admin on Windows', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'True\n', stderr: '' });

      const result = await checkNativeMemoryAvailability(state.execAsync);

      expect(result.available).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns unavailable when not running as admin', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'False\n', stderr: '' });

      const result = await checkNativeMemoryAvailability(state.execAsync);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('Administrator privileges');
    });

    it('returns unavailable when admin check throws', async () => {
      state.execAsync.mockRejectedValue(new Error('powershell failed'));

      const result = await checkNativeMemoryAvailability(state.execAsync);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('Failed to check Administrator privileges');
    });

    it('passes the execAsync function as the check command runner', async () => {
      state.execAsync.mockResolvedValue({ stdout: 'True\n', stderr: '' });

      await checkNativeMemoryAvailability(state.execAsync);

      expect(state.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('IsInRole'),
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it('handles case-insensitive "true" comparison', async () => {
      state.execAsync.mockResolvedValue({ stdout: '  TRUE  \n', stderr: '' });

      const result = await checkNativeMemoryAvailability(state.execAsync);
      expect(result.available).toBe(true);
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

    it('returns unavailable when not running as root', async () => {
      process.getuid = () => 501;
      state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await checkNativeMemoryAvailability(state.execAsync);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('root privileges');
    });

    it('returns available when running as root', async () => {
      process.getuid = () => 0;
      state.execAsync.mockResolvedValue({ stdout: 'enabled', stderr: '' });

      const result = await checkNativeMemoryAvailability(state.execAsync);

      expect(result.available).toBe(true);
    });

    it('returns available when process.getuid is unavailable', async () => {
      Object.defineProperty(process, 'getuid', {
        value: undefined,
        configurable: true,
      });
      state.execAsync.mockResolvedValue({ stdout: 'enabled', stderr: '' });

      const result = await checkNativeMemoryAvailability(state.execAsync);

      expect(result.available).toBe(true);
    });
  });
});
