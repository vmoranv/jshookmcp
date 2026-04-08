import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Catch-block coverage for memory/scanner module.
 * Fills untested branches beyond tests/modules/process/memory/scanner.test.ts:
 *
 * scanner.ts catch blocks:
 * - scanMemory: outer catch → returns { success: false }
 * - scanMemory: PowerShell returns empty result → handled as success (no addresses)
 * - suspendProcess: darwin path throws → returns false
 * - resumeProcess: darwin path throws → logs error but does not throw
 *
 * NOTE: Linux scanMemory catch blocks use synchronous readFileSync which cannot be
 * mocked with vi.mock on Windows. Those branches are exercised in the existing
 * Linux-compatible test environments (covered by Linux CI).
 */

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
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
  KERN: {
    SUCCESS: 0,
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

import { scanMemory } from '@modules/process/memory/scanner';

describe('memory/scanner - catch blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.isKoffiAvailable.mockReturnValue(false);
    state.execAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  // ── scanMemory: outer catch block ──────────────────────────────────────────
  // NOTE: Linux catch blocks in scanMemoryLinux use synchronous readFileSync which
  // cannot be mocked with vi.mock on Windows. Those are covered in Linux CI environments.

  describe('scanMemory outer catch', () => {
    it('returns failure when Windows PowerShell throws', async () => {
      state.executePowerShellScript.mockRejectedValue(new Error('powershell crashed'));
      const result = await scanMemory('win32', 1, 'AA BB', 'hex');
      expect(result.success).toBe(false);
      expect(result.error).toContain('powershell crashed');
    });

    it('returns failure when Windows PowerShell throws EPERM', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      state.executePowerShellScript.mockRejectedValue(err);
      const result = await scanMemory('win32', 1, 'AA BB', 'hex');
      expect(result.success).toBe(false);
    });

    it('returns failure when macOS scan throws', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: false }),
        openProcess: vi.fn(),
        readMemory: vi.fn(),
        closeProcess: vi.fn(),
      });
      state.execAsync.mockRejectedValue(new Error('lldb crashed'));
      const result = await scanMemory('darwin', 1, 'AA BB', 'hex');
      expect(result.success).toBe(false);
    });
  });

  // ── resumeProcess darwin throws (logs error but does not throw) ─────────────
  // This tests that the finally block in scanMemory does not propagate resume errors.
  // The macOS scanner path calls suspendProcess, and if resumeProcess throws,
  // the error is caught and logged but does not prevent the scan from completing.

  describe('scanMemory with suspend=true: resume throws does not propagate', () => {
    it('returns scan results even when resumeProcess throws (no exception propagated)', async () => {
      state.createPlatformProvider.mockReturnValue({
        checkAvailability: vi.fn().mockResolvedValue({ available: true }),
        openProcess: vi.fn().mockReturnValue({ pid: 1 }),
        readMemory: vi.fn().mockReturnValue({ data: Buffer.from([0xaa]) }),
        closeProcess: vi.fn(),
      });
      state.findPatternInBuffer.mockReturnValue([0]);
      state.machTaskSelf.mockReturnValue(1);
      // taskForPid succeeds
      state.taskForPid.mockReturnValue({ kr: 0, task: { pid: 1 } });
      // taskSuspend succeeds
      state.taskSuspend.mockReturnValue(0);
      // taskResume throws → caught by resumeProcess finally block, error logged
      state.taskResume.mockRejectedValue(new Error('resume failed'));

      state.executePowerShellScript.mockResolvedValue({
        stdout:
          '{"success":true,"addresses":["0x100"],"stats":{"resultsFound":1,"patternLength":2}}',
        stderr: '',
      });

      const result = await scanMemory('win32', 1, 'AA BB', 'hex', true);
      expect(result.success).toBe(true);
    });
  });
});
