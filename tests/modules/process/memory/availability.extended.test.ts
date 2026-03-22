import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
  getuid: vi.fn(),
}));

vi.mock('@src/modules/process/memory/types', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

async function loadModule() {
  return import('@modules/process/memory/availability');
}

describe('memory/availability extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('checkAvailability - unsupported platform', () => {
    it('returns unavailable for unrecognized platform', async () => {
      const { checkAvailability } = await loadModule();
      const result = await checkAvailability('unknown');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('not supported');
    });
  });

  describe('checkAvailability - win32', () => {
    it('returns unavailable with unexpected PowerShell output', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: 'unexpected output', stderr: '' });
      const { checkAvailability } = await loadModule();

      const result = await checkAvailability('win32');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('unexpected output');
    });

    it('returns unavailable with empty PowerShell output', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });
      const { checkAvailability } = await loadModule();

      const result = await checkAvailability('win32');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('(empty)');
    });

    it('maps "is not recognized" error to PowerShell unavailable', async () => {
      const error = new Error('is not recognized as an internal or external command');
      state.executePowerShellScript.mockRejectedValue(error);
      const { checkAvailability } = await loadModule();

      const result = await checkAvailability('win32');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('PowerShell is unavailable');
    });

    it('maps "command not found" error to PowerShell unavailable', async () => {
      const error = new Error('command not found');
      state.executePowerShellScript.mockRejectedValue(error);
      const { checkAvailability } = await loadModule();

      const result = await checkAvailability('win32');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('PowerShell is unavailable');
    });

    it('maps "cannot find powershell" stderr to PowerShell unavailable', async () => {
      const error = Object.assign(new Error('exec failed'), {
        stderr: 'cannot find the path for powershell',
      });
      state.executePowerShellScript.mockRejectedValue(error);
      const { checkAvailability } = await loadModule();

      const result = await checkAvailability('win32');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('PowerShell is unavailable');
    });

    it('maps generic errors to execution-failed reason', async () => {
      state.executePowerShellScript.mockRejectedValue(new Error('timeout'));
      const { checkAvailability } = await loadModule();

      const result = await checkAvailability('win32');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('PowerShell command execution failed');
    });
  });

  describe('checkAvailability - linux', () => {
    it('returns unavailable for non-root without ptrace capability', async () => {
      state.execAsync
        .mockResolvedValueOnce({ stdout: '1000\n', stderr: '' }) // id -u
        .mockRejectedValueOnce(new Error('capsh failed')); // capsh check fails
      const { checkAvailability } = await loadModule();

      const result = await checkAvailability('linux');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('root privileges or CAP_SYS_PTRACE');
    });

    it('returns unavailable when id -u throws', async () => {
      state.execAsync.mockRejectedValueOnce(new Error('id failed'));
      const { checkAvailability } = await loadModule();

      const result = await checkAvailability('linux');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('root privileges');
    });
  });

  describe('checkAvailability - darwin', () => {
    it('returns available when lldb exists and running as root', async () => {
      state.execAsync.mockResolvedValue({ stdout: '/usr/bin/lldb', stderr: '' });
      const origGetuid = process.getuid;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      process.getuid = (() => 0) as any;

      try {
        const { checkAvailability } = await loadModule();
        const result = await checkAvailability('darwin');

        expect(result.available).toBe(true);
        expect(result.reason).toBeUndefined();
      } finally {
        process.getuid = origGetuid;
      }
    });

    it('returns available with warning when not root', async () => {
      state.execAsync.mockResolvedValue({ stdout: '/usr/bin/lldb', stderr: '' });
      const origGetuid = process.getuid;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      process.getuid = (() => 1000) as any;

      try {
        const { checkAvailability } = await loadModule();
        const result = await checkAvailability('darwin');

        expect(result.available).toBe(true);
        expect(result.reason).toContain('without root');
      } finally {
        process.getuid = origGetuid;
      }
    });
  });

  describe('checkDebugPort', () => {
    it('returns success false for non-windows', async () => {
      const { checkDebugPort } = await loadModule();
      const result = await checkDebugPort('linux', 123);

      expect(result.success).toBe(false);
      expect(result.error).toContain('only implemented for Windows');
    });

    it('returns parsed JSON from PowerShell on Windows', async () => {
      state.executePowerShellScript.mockResolvedValue({
        stdout: '{"success":true,"isDebugged":true}',
        stderr: '',
      });

      const { checkDebugPort } = await loadModule();
      const result = await checkDebugPort('win32', 999);

      expect(result).toEqual({ success: true, isDebugged: true });
    });

    it('returns error when PowerShell returns empty output', async () => {
      state.executePowerShellScript.mockResolvedValue({ stdout: '', stderr: '' });

      const { checkDebugPort } = await loadModule();
      const result = await checkDebugPort('win32', 999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty output');
    });

    it('returns error when PowerShell throws', async () => {
      state.executePowerShellScript.mockRejectedValue(new Error('ps failed'));

      const { checkDebugPort } = await loadModule();
      const result = await checkDebugPort('win32', 999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('ps failed');
    });

    it('returns generic error for non-Error thrown value', async () => {
      state.executePowerShellScript.mockRejectedValue('string error');

      const { checkDebugPort } = await loadModule();
      const result = await checkDebugPort('win32', 999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('PowerShell execution failed');
    });
  });
});
