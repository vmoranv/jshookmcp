import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const execFileAsync = vi.fn();
  const promisify = vi.fn(() => execFileAsync);
  return { execFileAsync, promisify };
});

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: state.promisify,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { probeAll, probeCommand } from '@modules/external/ToolProbe';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform });
}

describe('ToolProbe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // POSIX `which` output below; Windows `where` selection has its own tests.
    setPlatform('linux');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('on Windows skips an extensionless where hit and runs the version check via cmd.exe', async () => {
    setPlatform('win32');
    state.execFileAsync
      .mockResolvedValueOnce({
        stdout: 'C:\\tools\\jadx\\bin\\jadx\r\nC:\\tools\\jadx\\bin\\jadx.bat\r\n',
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: '1.5.6\r\n', stderr: '' });

    const result = await probeCommand('jadx', ['--version'], 1000);

    expect(result).toEqual({
      available: true,
      path: 'C:\\tools\\jadx\\bin\\jadx.bat',
      version: '1.5.6',
    });
    expect(state.execFileAsync).toHaveBeenNthCalledWith(1, 'where', ['jadx'], expect.any(Object));
    expect(state.execFileAsync).toHaveBeenNthCalledWith(
      2,
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', '"C:\\tools\\jadx\\bin\\jadx.bat ^"--version^""'],
      expect.objectContaining({ windowsVerbatimArguments: true, windowsHide: true }),
    );
  });

  it('on Windows runs an .exe where hit directly', async () => {
    setPlatform('win32');
    state.execFileAsync
      .mockResolvedValueOnce({ stdout: 'C:\\sdk\\adb.exe\r\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'Android Debug Bridge 1.0.41\r\n', stderr: '' });

    const result = await probeCommand('adb', ['version'], 1000);

    expect(result.path).toBe('C:\\sdk\\adb.exe');
    expect(state.execFileAsync).toHaveBeenNthCalledWith(
      2,
      'C:\\sdk\\adb.exe',
      ['version'],
      expect.objectContaining({ windowsVerbatimArguments: false }),
    );
  });

  it('on Windows reports unavailable when no where hit is runnable', async () => {
    setPlatform('win32');
    state.execFileAsync.mockResolvedValueOnce({ stdout: 'C:\\tools\\jadx\\bin\\jadx\r\n' });

    const result = await probeCommand('jadx');

    expect(result.available).toBe(false);
    expect(result.reason).toContain('no runnable PATHEXT match');
    expect(state.execFileAsync).toHaveBeenCalledTimes(1);
  });

  it('returns available=true with path and version when both probes succeed', async () => {
    state.execFileAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/tool\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'tool 1.2.3\n', stderr: '' });

    const result = await probeCommand('tool', ['-v'], 1000);

    expect(result).toEqual({
      available: true,
      path: '/usr/bin/tool',
      version: 'tool 1.2.3',
    });
  });

  it('keeps command available even when version probe fails', async () => {
    state.execFileAsync
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/tool\n', stderr: '' })
      .mockRejectedValueOnce(new Error('version failed'));

    const result = await probeCommand('tool');

    expect(result.available).toBe(true);
    expect(result.path).toBe('/usr/local/bin/tool');
    expect(result.version).toBeUndefined();
  });

  it('reports command-not-found when executable lookup returns ENOENT', async () => {
    state.execFileAsync.mockRejectedValueOnce({ code: 'ENOENT', message: 'not found' });

    const result = await probeCommand('missing-tool');

    expect(result.available).toBe(false);
    expect(result.reason).toContain("Command 'missing-tool' not found in PATH");
  });

  it('returns generic probe failure reason for other errors', async () => {
    state.execFileAsync.mockRejectedValueOnce(new Error('boom'));

    const result = await probeCommand('broken');

    expect(result.available).toBe(false);
    expect(result.reason).toContain('Probe failed: boom');
  });

  it('handles non-object string throwables', async () => {
    state.execFileAsync.mockRejectedValueOnce('raw string error');
    const result = await probeCommand('broken');
    expect(result.available).toBe(false);
    expect(result.reason).toContain('Probe failed: raw string error');
  });

  it('handles objects without message property', async () => {
    state.execFileAsync.mockRejectedValueOnce({ special: 'error' });
    const result = await probeCommand('broken');
    expect(result.available).toBe(false);
    expect(result.reason).toContain('Probe failed: [object Object]');
  });

  it('handles non-Error objects with message property', async () => {
    state.execFileAsync.mockRejectedValueOnce({ message: 'custom error message' });
    const result = await probeCommand('broken');
    expect(result.available).toBe(false);
    expect(result.reason).toContain('Probe failed: custom error message');
  });

  it('handles empty version output', async () => {
    state.execFileAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/tool\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '\n', stderr: '' });
    const result = await probeCommand('tool', ['-v'], 1000);
    expect(result.version).toBeUndefined();
  });

  it('reports not found without mentioning PATHEXT when which prints nothing', async () => {
    state.execFileAsync.mockResolvedValueOnce({ stdout: '\n', stderr: '' });

    const result = await probeCommand('tool');

    expect(result).toEqual({ available: false, reason: "Command 'tool' not found in PATH" });
    expect(state.execFileAsync).toHaveBeenCalledTimes(1);
  });

  it('uses which on non-win32 platforms', async () => {
    state.execFileAsync.mockResolvedValueOnce({ stdout: '/bin/tool\n', stderr: '' });
    state.execFileAsync.mockRejectedValueOnce(new Error('no version'));
    const result = await probeCommand('tool');
    expect(state.execFileAsync).toHaveBeenCalledWith('which', ['tool'], expect.any(Object));
    expect(result.path).toBe('/bin/tool');
  });

  it('probes all commands and returns map keyed by command name', async () => {
    state.execFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === 'which' && args[0] === 'tool-a') return { stdout: '/bin/tool-a\n', stderr: '' };
      if (cmd === 'which' && args[0] === 'tool-b') return { stdout: '/bin/tool-b\n', stderr: '' };
      if (cmd === '/bin/tool-a') return { stdout: 'a v1\n', stderr: '' };
      if (cmd === '/bin/tool-b') throw new Error('no version');
      throw new Error('unexpected call');
    });

    const result = await probeAll([
      { command: 'tool-a', versionArgs: ['--version'] },
      { command: 'tool-b', versionArgs: ['--version'] },
    ]);

    expect(result.get('tool-a')?.available).toBe(true);
    expect(result.get('tool-a')?.version).toBe('a v1');
    expect(result.get('tool-b')?.available).toBe(true);
    expect(result.get('tool-b')?.version).toBeUndefined();
  });

  it('hits unavailable branch in probeAll', async () => {
    state.execFileAsync.mockRejectedValue(new Error('not found'));
    const result = await probeAll([{ command: 'missing-tool' }]);
    expect(result.get('missing-tool')?.available).toBe(false);
  });
});
