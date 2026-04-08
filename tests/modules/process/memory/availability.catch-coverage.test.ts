import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Catch-block coverage for memory/availability module.
 * Fills untested branches beyond tests/modules/process/memory/availability.test.ts:
 *
 * availability.ts catch blocks:
 * - checkAvailability('linux'): outer try-catch when `id -u` throws
 * - checkAvailability('darwin'): outer try-catch when `which lldb` throws
 * - checkDebugPort: outer catch → returns { success: false }
 * - checkDebugPort: empty stdout → throw caught by outer catch
 * - checkDebugPort: JSON.parse error on malformed output
 */

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
}));

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

async function loadAvailabilityModule() {
  return import('@modules/process/memory/availability');
}

describe('memory/availability - catch blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  // ── checkAvailability: Linux outer catch ───────────────────────────────────

  describe('checkAvailability linux', () => {
    it('returns not available when id -u throws (outer catch)', async () => {
      state.execAsync.mockRejectedValue(new Error('id command not found'));
      const { checkAvailability } = await loadAvailabilityModule();
      const result = await checkAvailability('linux');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('Requires root privileges');
    });

    it('returns not available when id -u throws EPERM', async () => {
      const err = new Error('Operation not permitted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const { checkAvailability } = await loadAvailabilityModule();
      const result = await checkAvailability('linux');
      expect(result.available).toBe(false);
    });
  });

  // ── checkAvailability: Darwin outer catch ────────────────────────────────────

  describe('checkAvailability darwin', () => {
    it('returns not available when which lldb throws (outer catch)', async () => {
      state.execAsync.mockRejectedValue(new Error('which failed'));
      const { checkAvailability } = await loadAvailabilityModule();
      const result = await checkAvailability('darwin');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('xcode-select --install');
    });

    it('returns not available when lldb check throws EPERM', async () => {
      const err = new Error('Automation untrusted') as any;
      err.code = 'EPERM';
      state.execAsync.mockRejectedValue(err);
      const { checkAvailability } = await loadAvailabilityModule();
      const result = await checkAvailability('darwin');
      expect(result.available).toBe(false);
    });
  });

  // ── checkDebugPort catch blocks ─────────────────────────────────────────────

  describe('checkDebugPort', () => {
    it('returns failure when executePowerShellScript throws', async () => {
      state.executePowerShellScript.mockRejectedValue(new Error('powershell crashed'));
      const { checkDebugPort } = await loadAvailabilityModule();
      const result = await checkDebugPort('win32', 1234);
      expect(result.success).toBe(false);
      expect(result.error).toContain('powershell crashed');
    });

    it('returns failure when executePowerShellScript throws EPERM', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      state.executePowerShellScript.mockRejectedValue(err);
      const { checkDebugPort } = await loadAvailabilityModule();
      const result = await checkDebugPort('win32', 1234);
      expect(result.success).toBe(false);
    });

    it('returns failure when PowerShell output is empty (throw caught by outer catch)', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });
      const { checkDebugPort } = await loadAvailabilityModule();
      const result = await checkDebugPort('win32', 1234);
      expect(result.success).toBe(false);
      expect(result.error).toContain('PowerShell returned empty output');
    });

    it('returns failure when PowerShell output is whitespace-only', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: '   \n', stderr: '' });
      const { checkDebugPort } = await loadAvailabilityModule();
      const result = await checkDebugPort('win32', 1234);
      expect(result.success).toBe(false);
      expect(result.error).toContain('PowerShell returned empty output');
    });

    it('returns failure on invalid JSON output', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: 'not-json', stderr: '' });
      const { checkDebugPort } = await loadAvailabilityModule();
      const result = await checkDebugPort('win32', 1234);
      expect(result.success).toBe(false);
      expect(result.error).toContain('PowerShell returned empty output');
    });

    it('returns failure when PowerShell JSON has success=false', async () => {
      state.executePowerShellScript.mockResolvedValue({
        stdout: '{"success":false,"error":"Access denied"}',
        stderr: '',
      });
      const { checkDebugPort } = await loadAvailabilityModule();
      const result = await checkDebugPort('win32', 1234);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });
});
