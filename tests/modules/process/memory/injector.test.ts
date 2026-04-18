import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { injectDll, injectShellcode } from '@modules/process/memory/injector';

describe('memory/injector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injectDll rejects unknown platform', async () => {
    const result = await injectDll('unknown' as any, 1, 'a.dll');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported on this platform');
  });

  it('injectDll handles linux gdb execution', async () => {
    state.execAsync.mockResolvedValue({ stdout: 'Done', stderr: '' });
    const result = await injectDll('linux', 1, 'a.so');
    expect(result.success).toBe(true);
    expect(state.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('gdb -p 1 -batch'),
      expect.any(Object),
    );
  });

  it('injectDll handles darwin lldb execution', async () => {
    state.execAsync.mockResolvedValue({ stdout: 'Done', stderr: '' });
    const result = await injectDll('darwin', 1, 'a.dylib');
    expect(result.success).toBe(true);
    expect(state.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('lldb --batch -p 1'),
      expect.any(Object),
    );
  });

  it('injectDll parses successful PowerShell response', async () => {
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"remoteThreadId":42}',
      stderr: '',
    });

    const result = await injectDll('win32', 2, 'C:\\test.dll');
    expect(result).toEqual({ success: true, remoteThreadId: 42, error: undefined });
  });

  it('injectDll fails when PowerShell returns empty output', async () => {
    state.executePowerShellScript.mockResolvedValue({ stdout: '   ', stderr: '' });
    const result = await injectDll('win32', 3, 'C:\\test.dll');

    expect(result.success).toBe(false);
    expect(result.error).toContain('PowerShell returned empty output');
  });

  it('injectShellcode rejects unknown platform', async () => {
    const result = await injectShellcode('unknown' as any, 1, '90', 'hex');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not supported on this platform');
  });

  it('injectShellcode handles linux gdb execution', async () => {
    state.execAsync.mockResolvedValue({ stdout: 'SUCCESS_INJECT: 1', stderr: '' });
    const result = await injectShellcode('linux', 1, '90', 'hex');
    expect(result.success).toBe(true);
    expect(state.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('gdb -p 1 -batch'),
      expect.any(Object),
    );
  });

  it('injectShellcode handles darwin lldb execution', async () => {
    state.execAsync.mockResolvedValue({ stdout: 'SUCCESS_INJECT', stderr: '' });
    const result = await injectShellcode('darwin', 1, '90', 'hex');
    expect(result.success).toBe(true);
    expect(state.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('lldb --batch -p 1'),
      expect.any(Object),
    );
  });

  it('injectShellcode supports base64 input and parses success result', async () => {
    state.executePowerShellScript.mockResolvedValue({
      stdout: '{"success":true,"remoteThreadId":100}',
      stderr: '',
    });
    const payload = Buffer.from([0x90, 0x90]).toString('base64');
    const result = await injectShellcode('win32', 4, payload, 'base64');

    expect(result.success).toBe(true);
    expect(result.remoteThreadId).toBe(100);
    expect(state.executePowerShellScript).toHaveBeenCalled();
  });

  it('injectShellcode returns failure when script execution throws', async () => {
    state.executePowerShellScript.mockRejectedValue(new Error('execution failed'));
    const result = await injectShellcode('win32', 5, '90', 'hex');

    expect(result.success).toBe(false);
    expect(result.error).toContain('execution failed');
  });
});
