import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * regions.modules.ts Windows coverage expansion.
 * Fills untested branches beyond tests/modules/process/memory/regions.test.ts:
 *
 * enumerateModules win32:
 * - PowerShell returns empty output → JSON.parse throws → caught
 * - PowerShell returns malformed JSON → JSON.parse throws → caught
 * - PowerShell script throws → caught
 * - PowerShell JSON has success=false → function returns it directly
 */

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
}));

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { enumerateModules } from '@modules/process/memory/regions.modules';

describe('regions.modules - coverage expansion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Windows: PowerShell error paths ───────────────────────────────────────

  describe('enumerateModules win32 error paths', () => {
    it('returns failure when PowerShell returns empty output', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });

      const result = await enumerateModules('win32', 1234);

      expect(result.success).toBe(false);
    });

    it('returns failure when PowerShell returns malformed JSON', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: 'not json', stderr: '' });

      const result = await enumerateModules('win32', 1234);

      expect(result.success).toBe(false);
    });

    it('returns failure when PowerShell script execution fails', async () => {
      state.executePowerShellScript.mockRejectedValue(new Error('Access denied'));

      const result = await enumerateModules('win32', 1234);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied');
    });

    it('returns failure when PowerShell JSON has success=false', async () => {
      state.executePowerShellScript.mockResolvedValue({
        stdout: '{"success":false,"error":"Access denied"}',
        stderr: '',
      });

      const result = await enumerateModules('win32', 1234);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });
  });

  // ── Windows: success path ─────────────────────────────────────────────────

  describe('enumerateModules win32 success path', () => {
    it('parses PowerShell JSON with multiple modules', async () => {
      state.executePowerShellScript.mockResolvedValue({
        stdout: JSON.stringify({
          success: true,
          modules: [
            { name: 'ntdll.dll', baseAddress: '0x10000000', size: 2000000 },
            { name: 'kernel32.dll', baseAddress: '0x20000000', size: 3000000 },
          ],
        }),
        stderr: '',
      });

      const result = await enumerateModules('win32', 1234);

      expect(result.success).toBe(true);
      expect(result.modules).toHaveLength(2);
      expect(result.modules![0]!.name).toBe('ntdll.dll');
      expect(result.modules![1]!.name).toBe('kernel32.dll');
    });
  });
});
