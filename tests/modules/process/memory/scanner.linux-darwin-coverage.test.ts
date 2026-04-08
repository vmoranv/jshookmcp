import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Linux/Darwin scanner catch-block and edge-case coverage.
 * Fills untested branches beyond tests/modules/process/memory/scanner.test.ts:
 *
 * scanner.linux.ts:
 * - readFileSync /proc/pid/maps throws ENOENT → formatLinuxProcAccessError path
 * - readFileSync /proc/pid/maps throws EPERM → formatLinuxProcAccessError path
 * - openSync /proc/pid/mem throws ENOENT → formatLinuxProcAccessError path
 * - openSync /proc/pid/mem throws EPERM → formatLinuxProcAccessError path
 * - readSync throws non-skip error (not EIO/EFAULT/EACCES/EPERM) → outer catch
 * - linuxRegions is empty (no readable regions) → returns early with empty addresses
 *
 * scanner.darwin.ts (scanMemoryMac):
 * - scanMemoryMacNative throws (caught by outer try-catch) → falls to lldb fallback
 * - scanMemoryMacLldb: fs.writeFile fails → outer catch
 * - scanMemoryMacLldb: lldb returns no SCAN_RESULT line → error path
 * - scanMemoryMacLldb: lldb stdout has error line
 * - scanMemoryMacLldb: JSON parse error on SCAN_RESULT → outer catch
 * - scanMemoryMacLldb: lldb throws → outer catch
 */

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  readFileSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  readSync: vi.fn(),
  nativeScanMemory: vi.fn(),
  isKoffiAvailable: vi.fn(),
  findPatternInBuffer: vi.fn(),
  parseProcMaps: vi.fn(),
  createPlatformProvider: vi.fn(),
  taskSuspend: vi.fn(),
  taskResume: vi.fn(),
  taskForPid: vi.fn(),
  machTaskSelf: vi.fn(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFileSync: state.readFileSync,
    openSync: state.openSync,
    closeSync: state.closeSync,
    readSync: state.readSync,
    promises: {
      ...actual.promises,
      writeFile: state.writeFile,
      unlink: state.unlink,
    },
  };
});

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('@src/native/NativeMemoryManager', () => ({
  nativeMemoryManager: {
    scanMemory: state.nativeScanMemory,
  },
}));

vi.mock('@src/native/NativeMemoryManager.utils', () => ({
  isKoffiAvailable: state.isKoffiAvailable,
  findPatternInBuffer: state.findPatternInBuffer,
}));

vi.mock('@src/modules/process/memory/linux/mapsParser', () => ({
  parseProcMaps: state.parseProcMaps,
}));

vi.mock('@native/platform/factory.js', () => ({
  createPlatformProvider: state.createPlatformProvider,
}));

vi.mock('@native/platform/darwin/DarwinAPI.js', () => ({
  taskSuspend: state.taskSuspend,
  taskResume: state.taskResume,
  taskForPid: state.taskForPid,
  machTaskSelf: state.machTaskSelf,
  KERN: { SUCCESS: 0 },
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { scanMemory } from '@modules/process/memory/scanner';

describe('scanner linux/darwin - coverage expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isKoffiAvailable.mockReturnValue(false);
    state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  // ── Linux: readFileSync /proc/pid/maps throws ─────────────────────────────

  describe('scanMemory linux - /proc/pid/maps error handling', () => {
    it('returns error when readFileSync throws ENOENT', async () => {
      state.readFileSync.mockImplementation(() => {
        const err = new Error('ENOENT: No such file') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      });

      const result = await scanMemory('linux', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('no longer exists');
    });

    it('returns error when readFileSync throws EPERM', async () => {
      state.readFileSync.mockImplementation(() => {
        const err = new Error('Permission denied') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      });

      const result = await scanMemory('linux', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('root privileges');
    });

    it('returns error when openSync throws ENOENT', async () => {
      state.readFileSync.mockReturnValue('user 0 0 0 0 0 r-x /mem\n');
      state.openSync.mockImplementation(() => {
        const err = new Error('ENOENT: No such file') as NodeJS.ErrnOException;
        err.code = 'ENOENT';
        throw err;
      });

      const result = await scanMemory('linux', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('no longer exists');
    });

    it('returns error when openSync throws EPERM', async () => {
      state.readFileSync.mockReturnValue('user 0 0 0 0 0 r-x /mem\n');
      state.openSync.mockImplementation(() => {
        const err = new Error('Permission denied') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      });

      const result = await scanMemory('linux', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('root privileges');
    });
  });

  // ── Linux: empty regions ────────────────────────────────────────────────────

  describe('scanMemory linux - empty regions', () => {
    it('returns early with empty addresses when parseProcMaps returns no readable regions', async () => {
      state.readFileSync.mockReturnValue('');
      state.parseProcMaps.mockReturnValue([]); // No readable regions
      state.openSync.mockReturnValue(3); // fd

      const result = await scanMemory('linux', 1, 'AA BB', 'hex');

      expect(result.success).toBe(true);
      expect(result.addresses).toEqual([]);
      expect(result.stats?.resultsFound).toBe(0);
      // fd should still be closed
      expect(state.closeSync).toHaveBeenCalledWith(3);
    });
  });

  // ── Linux: readSync non-skip error → outer catch ─────────────────────────

  describe('scanMemory linux - readSync throws non-skip error', () => {
    it('propagates to outer catch when readSync throws unexpected error', async () => {
      state.readFileSync.mockReturnValue('user 0 0 0 0 0 r-x /mem\n');
      state.parseProcMaps.mockReturnValue([
        { start: 0x400000n, end: 0x401000n, permissions: { read: true, write: false, execute: true } } as any,
      ]);
      state.openSync.mockReturnValue(4);
      // readSync throws error not in EIO/EFAULT/EACCES/EPERM
      state.readSync.mockImplementation(() => {
        throw new Error('Unexpected system error');
      });

      const result = await scanMemory('linux', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected system error');
    });
  });

  // ── Darwin: scanMemoryMac native path throws ──────────────────────────────

  describe('scanMemory darwin - native path throws', () => {
    it('falls back to lldb when native scan throws', async () => {
      state.createPlatformProvider.mockImplementation(() => {
        throw new Error('Native provider unavailable');
      });
      // Fallback lldb returns valid scan result
      state.execAsync.mockResolvedValue({
        stdout: 'SCAN_RESULT:{"success":true,"addresses":["0x1000"],"stats":{"patternLength":2,"resultsFound":1}}\n',
        stderr: '',
      });
      state.writeFile.mockResolvedValue(undefined);
      state.unlink.mockResolvedValue(undefined);

      const result = await scanMemory('darwin', 1, 'AA BB', 'hex');

      expect(result.success).toBe(true);
      expect(result.addresses).toEqual(['0x1000']);
    });
  });

  // ── Darwin: scanMemoryMacLldb error paths ────────────────────────────────

  describe('scanMemory darwin - lldb fallback error paths', () => {
    it('returns error when lldb has no SCAN_RESULT line', async () => {
      state.createPlatformProvider.mockImplementation(() => {
        throw new Error('Native unavailable');
      });
      state.writeFile.mockResolvedValue(undefined);
      state.execAsync.mockResolvedValue({
        stdout: 'some other output\nno scan result here',
        stderr: '',
      });
      state.unlink.mockResolvedValue(undefined);

      const result = await scanMemory('darwin', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('lldb scan returned no result');
    });

    it('extracts error from lldb stderr line', async () => {
      state.createPlatformProvider.mockImplementation(() => {
        throw new Error('Native unavailable');
      });
      state.writeFile.mockResolvedValue(undefined);
      state.execAsync.mockResolvedValue({
        stdout: 'SCAN_RESULT:\nerror: process not found\nmore output',
        stderr: '',
      });
      state.unlink.mockResolvedValue(undefined);

      const result = await scanMemory('darwin', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('process not found');
    });

    it('returns error when SCAN_RESULT JSON is malformed', async () => {
      state.createPlatformProvider.mockImplementation(() => {
        throw new Error('Native unavailable');
      });
      state.writeFile.mockResolvedValue(undefined);
      state.execAsync.mockResolvedValue({
        stdout: 'SCAN_RESULT:{"success":true,\n',
        stderr: '',
      });
      state.unlink.mockResolvedValue(undefined);

      const result = await scanMemory('darwin', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
    });

    it('returns error when lldb subprocess throws', async () => {
      state.createPlatformProvider.mockImplementation(() => {
        throw new Error('Native unavailable');
      });
      state.writeFile.mockResolvedValue(undefined);
      state.execAsync.mockRejectedValue(new Error('lldb not installed'));
      state.unlink.mockResolvedValue(undefined);

      const result = await scanMemory('darwin', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('lldb not installed');
    });

    it('returns error when fs.writeFile fails', async () => {
      state.createPlatformProvider.mockImplementation(() => {
        throw new Error('Native unavailable');
      });
      state.writeFile.mockRejectedValue(new Error('ENOSPC: no space left'));

      const result = await scanMemory('darwin', 1, 'AA BB', 'hex');

      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOSPC');
    });
  });

  // ── Darwin: scanMemoryMacNative null availability ──────────────────────────

  describe('scanMemory darwin - native availability returns null', () => {
    it(' falls back to lldb when native provider returns unavailable', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockResolvedValue({
        stdout: 'SCAN_RESULT:{"success":true,"addresses":[],"stats":{"patternLength":2,"resultsFound":0}}\n',
        stderr: '',
      });
      state.writeFile.mockResolvedValue(undefined);
      state.unlink.mockResolvedValue(undefined);

      const result = await scanMemory('darwin', 1, 'AA BB', 'hex');

      expect(result.success).toBe(true);
    });
  });
});
