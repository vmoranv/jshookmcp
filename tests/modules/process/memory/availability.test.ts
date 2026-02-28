import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  executePowerShellScript: vi.fn(),
  execAsync: vi.fn(),
}));

vi.mock('../../../../src/modules/process/memory/types.js', () => ({
  executePowerShellScript: state.executePowerShellScript,
  execAsync: state.execAsync,
}));

async function loadAvailabilityModule() {
  return import('../../../../src/modules/process/memory/availability.js');
}

describe('memory/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('caches successful Windows availability checks within TTL', async () => {
    state.executePowerShellScript.mockResolvedValue({ stdout: 'True\n', stderr: '' });
    const { checkAvailability } = await loadAvailabilityModule();

    const first = await checkAvailability('win32');
    const second = await checkAvailability('win32');

    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(state.executePowerShellScript).toHaveBeenCalledTimes(1);
  });

  it('returns administrator-required reason when PowerShell outputs false', async () => {
    state.executePowerShellScript.mockResolvedValue({ stdout: 'False\n', stderr: '' });
    const { checkAvailability } = await loadAvailabilityModule();

    const result = await checkAvailability('win32');
    expect(result.available).toBe(false);
    expect(result.reason).toContain('Administrator privileges');
  });

  it('maps PowerShell-not-found errors to a specific reason', async () => {
    state.executePowerShellScript.mockRejectedValue(new Error('spawn ENOENT powershell'));
    const { checkAvailability } = await loadAvailabilityModule();

    const result = await checkAvailability('win32');
    expect(result.available).toBe(false);
    expect(result.reason).toContain('PowerShell is unavailable');
  });

  it('reports Linux available when running as root', async () => {
    state.execAsync.mockResolvedValueOnce({ stdout: '0\n', stderr: '' });
    const { checkAvailability } = await loadAvailabilityModule();

    const result = await checkAvailability('linux');
    expect(result).toEqual({ available: true });
  });

  it('reports Linux available when CAP_SYS_PTRACE exists for non-root', async () => {
    state.execAsync
      .mockResolvedValueOnce({ stdout: '1000\n', stderr: '' }) // id -u
      .mockResolvedValueOnce({ stdout: '', stderr: '' }); // capsh check
    const { checkAvailability } = await loadAvailabilityModule();

    const result = await checkAvailability('linux');
    expect(result.available).toBe(true);
  });

  it('reports missing lldb on macOS', async () => {
    state.execAsync.mockRejectedValue(new Error('lldb not found'));
    const { checkAvailability } = await loadAvailabilityModule();

    const result = await checkAvailability('darwin');
    expect(result.available).toBe(false);
    expect(result.reason).toContain('xcode-select --install');
  });

  it('checkDebugPort rejects non-windows platform', async () => {
    const { checkDebugPort } = await loadAvailabilityModule();
    const result = await checkDebugPort('linux', 123);

    expect(result.success).toBe(false);
    expect(result.error).toContain('only implemented for Windows');
  });

  it('checkDebugPort parses successful windows JSON output', async () => {
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"isDebugged":false}',
      stderr: '',
    });
    const { checkDebugPort } = await loadAvailabilityModule();
    const result = await checkDebugPort('win32', 555);

    expect(result).toEqual({ success: true, isDebugged: false });
  });
});

