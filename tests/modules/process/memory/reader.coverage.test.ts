import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Reader catch-block coverage expansion.
 * Fills untested branches beyond tests/modules/process/memory/reader.test.ts:
 *
 * reader.ts Windows path:
 * - readMemoryWindows: PowerShell returns malformed JSON → JSON.parse throws → caught
 * - readMemoryWindows: PowerShell returns whitespace-only → JSON.parse throws → caught
 * - readMemoryWindows: PowerShell throws → caught by outer catch
 *
 * reader.ts Darwin path (readMemoryMac):
 * - lldb stdout has no "bytes written" → error path
 * - lldb stdout has error line → error path
 * - lldb throws → caught and returned as error
 * - fs.unlink in finally suppresses errors (Promise-based)
 * - native path: checkAvailability unavailable → fallback to lldb
 * - checkProtectionFn throws → caught and returned
 */

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  nativeReadMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
  createPlatformProvider: vi.fn(),
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

vi.mock('node:fs', () => ({
  promises: {
    readFile: state.readFile,
    unlink: state.unlink,
  },
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

describe('memory/reader - coverage expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isKoffiAvailable.mockReturnValue(false);
    // Default: no file read, no unlink (avoids issues with undefined)
    state.readFile.mockResolvedValue(Buffer.alloc(0));
    state.unlink.mockResolvedValue(undefined);
  });

  // ── Windows: readMemoryWindows error paths ──────────────────────────────────

  describe('readMemory windows error branches', () => {
    it('returns error when PowerShell returns whitespace-only output (JSON.parse throws)', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: '   \n  ', stderr: '' });

      const result = await readMemory('win32', 1, '0x1000', 4, vi.fn());

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('returns error when PowerShell returns malformed JSON (JSON.parse throws)', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: 'not json at all', stderr: '' });

      const result = await readMemory('win32', 1, '0x1000', 4, vi.fn());

      expect(result.success).toBe(false);
      // JSON.parse throws SyntaxError which is caught and returned as error
      expect(result.error).toBeTruthy();
    });

    it('returns error when PowerShell throws', async () => {
      state.executePowerShellScript.mockRejectedValue(new Error('powershell unavailable'));

      const result = await readMemory('win32', 1, '0x1000', 4, vi.fn());

      expect(result.success).toBe(false);
      expect(result.error).toContain('powershell unavailable');
    });

    it('returns error when PowerShell throws with EPERM code', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      state.executePowerShellScript.mockRejectedValue(err);

      const result = await readMemory('win32', 1, '0x1000', 4, vi.fn());

      expect(result.success).toBe(false);
    });

    it('parses PowerShell JSON with success=false', async () => {
      state.executePowerShellScript.mockResolvedValue({
        stdout: '{"success":false,"error":"Access denied"}',
        stderr: '',
      });

      const result = await readMemory('win32', 1, '0x1000', 4, vi.fn());

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });

    it('parses PowerShell JSON with success=true', async () => {
      state.executePowerShellScript.mockResolvedValue({
        stdout: '{"success":true,"data":"AA BB CC DD"}',
        stderr: '',
      });

      const result = await readMemory('win32', 1, '0x1000', 4, vi.fn());

      expect(result.success).toBe(true);
      expect(result.data).toBe('AA BB CC DD');
    });
  });

  // ── Darwin: lldb fallback error paths ─────────────────────────────────────

  describe('readMemory darwin lldb fallback error paths', () => {
    it('returns error when lldb stdout has no bytes written', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockResolvedValue({
        stdout: 'Process 1\nsome other output',
        stderr: '',
      });

      const result = await readMemory(
        'darwin',
        1,
        '0x1000',
        4,
        vi.fn().mockResolvedValue({ success: true, isReadable: true }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('lldb memory read failed');
    });

    it('extracts error line from lldb output', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockResolvedValue({
        stdout: 'Process 1\nerror: unable to read memory\nmore output',
        stderr: '',
      });

      const result = await readMemory(
        'darwin',
        1,
        '0x1000',
        4,
        vi.fn().mockResolvedValue({ success: true, isReadable: true }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('unable to read memory');
    });

    it('returns error when lldb throws', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockRejectedValue(new Error('lldb timeout'));

      const result = await readMemory(
        'darwin',
        1,
        '0x1000',
        4,
        vi.fn().mockResolvedValue({ success: true, isReadable: true }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('lldb timeout');
    });

    it('returns error when lldb throws non-Error value', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockRejectedValue('string error');

      const result = await readMemory(
        'darwin',
        1,
        '0x1000',
        4,
        vi.fn().mockResolvedValue({ success: true, isReadable: true }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('suppresses unlink errors in finally block', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockResolvedValue({
        stdout: '16 bytes written to /tmp/mread.bin',
        stderr: '',
      });
      state.readFile.mockResolvedValue(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
      state.unlink.mockRejectedValue(new Error('unlink failed'));

      const result = await readMemory(
        'darwin',
        1,
        '0x1000',
        4,
        vi.fn().mockResolvedValue({ success: true, isReadable: true }),
      );

      // The unlink error is suppressed by .catch(() => {})
      expect(result.success).toBe(true);
      expect(result.data).toBe('AA BB CC DD');
    });
  });

  // ── Darwin: native path failures ──────────────────────────────────────────

  describe('readMemory darwin native path failure', () => {
    it('falls back to lldb when native readMemory throws', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: true }),
        openProcess: vi.fn().mockReturnValue({ handle: 'handle' }),
        readMemory: vi.fn().mockImplementation(() => {
          throw new Error('Native read failed');
        }),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockResolvedValue({
        stdout: '16 bytes written to /tmp/mread.bin',
        stderr: '',
      });
      state.readFile.mockResolvedValue(Buffer.from([0xde, 0xad]));
      state.unlink.mockResolvedValue(undefined);

      const result = await readMemory(
        'darwin',
        1,
        '0x1000',
        2,
        vi.fn().mockResolvedValue({ success: true, isReadable: true }),
      );

      expect(result.success).toBe(true);
    });

    it('falls back to lldb when native provider returns unavailable', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockResolvedValue({
        stdout: '16 bytes written to /tmp/mread.bin',
        stderr: '',
      });
      state.readFile.mockResolvedValue(Buffer.from([0xde, 0xad]));
      state.unlink.mockResolvedValue(undefined);

      const result = await readMemory(
        'darwin',
        1,
        '0x1000',
        2,
        vi.fn().mockResolvedValue({ success: true, isReadable: true }),
      );

      expect(result.success).toBe(true);
    });
  });

  // ── Darwin: checkProtectionFn failure ─────────────────────────────────────

  describe('readMemory darwin checkProtectionFn', () => {
    it('returns error when checkProtectionFn returns failure', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });

      const result = await readMemory(
        'darwin',
        1,
        '0x1000',
        4,
        vi.fn().mockResolvedValue({ success: false, error: 'process not accessible' }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot verify memory region');
    });

    it('returns error when checkProtectionFn throws', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });

      await expect(
        readMemory(
          'darwin',
          1,
          '0x1000',
          4,
          vi.fn().mockRejectedValue(new Error('protection check failed')),
        ),
      ).rejects.toThrow('protection check failed');
    });
  });

  // ── Darwin: native path returns read bytes ─────────────────────────────────

  describe('readMemory darwin native success', () => {
    it('returns uppercase hex bytes from native readMemory', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: true }),
        openProcess: vi.fn().mockReturnValue({ handle: 'handle' }),
        readMemory: vi.fn().mockReturnValue({
          data: Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]),
          bytesRead: 4,
        }),
        closeProcess: vi.fn(),
      });

      const result = await readMemory('darwin', 1, '0x1000', 4, vi.fn());

      expect(result.success).toBe(true);
      expect(result.data).toBe('0A 0B 0C 0D');
    });
  });
});
