import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Catch-block and error-path coverage for memory sub-module injector.
 * Fills untested branches in tests/modules/process/memory/injector.test.ts:
 *
 * injector.ts catch blocks:
 * - injectDll: executePowerShellScript throws → catch returns { success: false }
 * - injectShellcode: Buffer.from hex decode throws → outer catch catches TypeError
 * - injectShellcode: executePowerShellScript returns empty stdout → throw caught
 * - injectShellcode: JSON.parse error on malformed output → outer catch catches it
 */

const executePowerShellScript = vi.hoisted(() => vi.fn());

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { injectDll, injectShellcode } from '@modules/process/memory/injector';

describe('memory/injector - catch blocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── injectDll catch blocks ─────────────────────────────────────────────────

  describe('injectDll', () => {
    it('returns failure when executePowerShellScript throws', async () => {
      executePowerShellScript.mockRejectedValue(new Error('powershell crashed'));
      const result = await injectDll('win32', 1234, 'C:\\test.dll');
      expect(result.success).toBe(false);
      expect(result.error).toContain('powershell crashed');
    });

    it('returns failure when executePowerShellScript throws with EPERM', async () => {
      const err = new Error('Access is denied') as any;
      err.code = 'EPERM';
      executePowerShellScript.mockRejectedValue(err);
      const result = await injectDll('win32', 1234, 'C:\\test.dll');
      expect(result.success).toBe(false);
    });

    it('returns failure when PowerShell output is empty (throw caught by outer try-catch)', async () => {
      executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });
      const result = await injectDll('win32', 1234, 'C:\\test.dll');
      expect(result.success).toBe(false);
      expect(result.error).toContain('PowerShell returned empty output');
    });

    it('returns failure when PowerShell output is whitespace-only', async () => {
      executePowerShellScript.mockResolvedValue({ stdout: '   \n  ', stderr: '' });
      const result = await injectDll('win32', 1234, 'C:\\test.dll');
      expect(result.success).toBe(false);
      expect(result.error).toContain('PowerShell returned empty output');
    });

    it('returns failure when PowerShell JSON is invalid (JSON.parse throws → caught by outer catch)', async () => {
      executePowerShellScript.mockResolvedValue({ stdout: 'not-json', stderr: '' });
      const result = await injectDll('win32', 1234, 'C:\\test.dll');
      expect(result.success).toBe(false);
      // Outer catch catches JSON.parse error and returns its message
      expect(result.error).toContain('not valid JSON');
    });

    it('returns failure when PowerShell JSON has success=false', async () => {
      executePowerShellScript.mockResolvedValue({
        stdout: '{"success":false,"error":"Access denied"}',
        stderr: '',
      });
      const result = await injectDll('win32', 1234, 'C:\\test.dll');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });

  // ── injectShellcode catch blocks ────────────────────────────────────────────

  describe('injectShellcode', () => {
    it('returns failure when Buffer.from hex decoding throws (TypeError caught by outer catch)', async () => {
      // Invalid hex causes Buffer.from to throw; the outer catch returns this error
      const result = await injectShellcode('win32', 1234, 'xyz', 'hex');
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy(); // TypeError message from Buffer.from
    });

    it('returns failure when executePowerShellScript throws', async () => {
      executePowerShellScript.mockRejectedValue(new Error('powershell crashed'));
      const result = await injectShellcode('win32', 1234, '90', 'hex');
      expect(result.success).toBe(false);
      expect(result.error).toContain('powershell crashed');
    });

    it('returns failure when PowerShell output is empty', async () => {
      executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });
      const result = await injectShellcode('win32', 1234, '90', 'hex');
      expect(result.success).toBe(false);
      expect(result.error).toContain('PowerShell returned empty output');
    });

    it('returns failure when PowerShell JSON is invalid (JSON.parse throws → caught by outer catch)', async () => {
      executePowerShellScript.mockResolvedValue({ stdout: 'malformed{', stderr: '' });
      const result = await injectShellcode('win32', 1234, '90', 'hex');
      expect(result.success).toBe(false);
      // Outer catch catches JSON.parse error
      expect(result.error).toContain('not valid JSON');
    });

    it('returns failure when PowerShell JSON has success=false', async () => {
      executePowerShellScript.mockResolvedValue({
        stdout: '{"success":false,"error":"Access denied"}',
        stderr: '',
      });
      const result = await injectShellcode('win32', 1234, '90', 'hex');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });

    it('returns failure when base64 decoding fails', async () => {
      // Invalid base64 string
      const result = await injectShellcode('win32', 1234, '!!!invalid!!!', 'base64');
      expect(result.success).toBe(false);
      // The TypeError from Buffer.from is caught by outer catch
      expect(result.error).toBeTruthy();
    });
  });
});
