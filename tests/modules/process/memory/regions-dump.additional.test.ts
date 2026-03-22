import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@modules/process/memory/types', () => ({
  execFileAsync: vi.fn(),
  executePowerShellScript: vi.fn(),
}));

import { dumpMemoryRegion } from '@modules/process/memory/regions.dump';
import { execFileAsync, executePowerShellScript } from '@modules/process/memory/types';

const mockExecFileAsync = vi.mocked(execFileAsync);
const mockExecutePowerShellScript = vi.mocked(executePowerShellScript);

describe('dumpMemoryRegion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('unsupported platform', () => {
    it('returns error for linux platform', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await dumpMemoryRegion('linux' as any, 1234, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('only implemented for Windows and macOS');
    });

    it('returns error for unknown platform', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await dumpMemoryRegion('unknown' as any, 1234, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('only implemented for Windows and macOS');
    });
  });

  describe('darwin platform', () => {
    it('returns error for invalid hex address', async () => {
      const result = await dumpMemoryRegion('darwin', 1234, 'ZZZZ', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid address format');
    });

    it('returns error for invalid pid (zero)', async () => {
      const result = await dumpMemoryRegion('darwin', 0, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid pid');
    });

    it('returns error for negative pid', async () => {
      const result = await dumpMemoryRegion('darwin', -1, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid pid');
    });

    it('returns error for non-integer pid', async () => {
      const result = await dumpMemoryRegion('darwin', 1.5, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid pid');
    });

    it('returns error for invalid size (zero)', async () => {
      const result = await dumpMemoryRegion('darwin', 1234, 'FF00', 0, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid size');
    });

    it('returns error for negative size', async () => {
      const result = await dumpMemoryRegion('darwin', 1234, 'FF00', -10, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid size');
    });

    it('returns error for non-integer size', async () => {
      const result = await dumpMemoryRegion('darwin', 1234, 'FF00', 1.5, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid size');
    });

    it('succeeds when lldb reports bytes written', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: '100 bytes written to /tmp/dump.bin',
        stderr: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      const result = await dumpMemoryRegion('darwin', 1234, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'lldb',
        expect.arrayContaining(['--batch', '-p', '1234']),
        expect.objectContaining({ timeout: 60000 })
      );
    });

    it('returns error when lldb output does not contain bytes written', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: 'error: some lldb error\nother output',
        stderr: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      const result = await dumpMemoryRegion('darwin', 1234, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('lldb dump failed');
      expect(result.error).toContain('error: some lldb error');
    });

    it('returns error when lldb output has no error line', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: 'no match here',
        stderr: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      const result = await dumpMemoryRegion('darwin', 1234, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('lldb dump failed');
    });

    it('handles lldb execution throwing an Error', async () => {
      mockExecFileAsync.mockRejectedValue(new Error('lldb not found'));

      const result = await dumpMemoryRegion('darwin', 1234, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('lldb not found');
    });

    it('handles lldb execution throwing a non-Error', async () => {
      mockExecFileAsync.mockRejectedValue('string error');

      const result = await dumpMemoryRegion('darwin', 1234, 'FF00', 100, '/tmp/dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('correctly converts hex address to 0x format for lldb', async () => {
      mockExecFileAsync.mockResolvedValue({
        stdout: '64 bytes written to /tmp/dump.bin',
        stderr: '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      await dumpMemoryRegion('darwin', 1234, 'A0FF', 64, '/tmp/dump.bin');

      const call = mockExecFileAsync.mock.calls[0];
      const args = call![1] as string[];
      const memoryReadArg = args.find((a: string) => a.includes('0xa0ff'));
      expect(memoryReadArg).toBeDefined();
    });
  });

  describe('win32 platform', () => {
    it('returns error for invalid hex address', async () => {
      const result = await dumpMemoryRegion('win32', 1234, 'ZZZZ', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid address format');
    });

    it('returns error for invalid pid', async () => {
      const result = await dumpMemoryRegion('win32', 0, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid pid');
    });

    it('returns error for negative pid', async () => {
      const result = await dumpMemoryRegion('win32', -5, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid pid');
    });

    it('returns error for invalid size', async () => {
      const result = await dumpMemoryRegion('win32', 1234, 'FF00', 0, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid size');
    });

    it('returns error for negative size', async () => {
      const result = await dumpMemoryRegion('win32', 1234, 'FF00', -1, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid size');
    });

    it('succeeds when PowerShell returns success JSON', async () => {
      mockExecutePowerShellScript.mockResolvedValue({
        stdout: JSON.stringify({ success: true, message: 'Dumped 100 bytes' }),
        stderr: '',
      });

      const result = await dumpMemoryRegion('win32', 1234, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(true);
      expect(mockExecutePowerShellScript).toHaveBeenCalled();
    });

    it('returns error when PowerShell returns error JSON', async () => {
      mockExecutePowerShellScript.mockResolvedValue({
        stdout: JSON.stringify({ success: false, error: 'Access denied' }),
        stderr: '',
      });

      const result = await dumpMemoryRegion('win32', 1234, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Access denied');
    });

    it('returns error when PowerShell returns empty output', async () => {
      mockExecutePowerShellScript.mockResolvedValue({
        stdout: '',
        stderr: '',
      });

      const result = await dumpMemoryRegion('win32', 1234, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('PowerShell returned empty output');
    });

    it('returns error when PowerShell returns whitespace-only output', async () => {
      mockExecutePowerShellScript.mockResolvedValue({
        stdout: '   \n  ',
        stderr: '',
      });

      const result = await dumpMemoryRegion('win32', 1234, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
    });

    it('returns error when PowerShell returns invalid JSON', async () => {
      mockExecutePowerShellScript.mockResolvedValue({
        stdout: 'not valid json at all',
        stderr: '',
      });

      const result = await dumpMemoryRegion('win32', 1234, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
    });

    it('handles PowerShell execution throwing an Error', async () => {
      mockExecutePowerShellScript.mockRejectedValue(new Error('PowerShell not found'));

      const result = await dumpMemoryRegion('win32', 1234, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('PowerShell not found');
    });

    it('handles PowerShell execution throwing a non-Error', async () => {
      mockExecutePowerShellScript.mockRejectedValue('unexpected failure');

      const result = await dumpMemoryRegion('win32', 1234, 'FF00', 100, 'C:\\dump.bin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('PowerShell execution failed');
    });
  });
});
