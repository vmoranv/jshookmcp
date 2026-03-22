import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const execFileAsync = vi.fn();
  const promisify = vi.fn(() => execFileAsync);
  return { execFileAsync, promisify };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('node:util', () => ({
  promisify: state.promisify,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { probeAll, probeCommand } from '@modules/external/ToolProbe';

describe('ToolProbe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available=true with path and version when both probes succeed', async () => {
    state.execFileAsync
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValueOnce({ stdout: '/usr/bin/tool\n', stderr: '' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValueOnce({ stdout: '/usr/local/bin/tool\n', stderr: '' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockRejectedValueOnce(new Error('version failed'));

    const result = await probeCommand('tool');

    expect(result.available).toBe(true);
    expect(result.path).toBe('/usr/local/bin/tool');
    expect(result.version).toBeUndefined();
  });

  it('reports command-not-found when executable lookup returns ENOENT', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.execFileAsync.mockRejectedValueOnce({ code: 'ENOENT', message: 'not found' });

    const result = await probeCommand('missing-tool');

    expect(result.available).toBe(false);
    expect(result.reason).toContain("Command 'missing-tool' not found in PATH");
  });

  it('returns generic probe failure reason for other errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.execFileAsync.mockRejectedValueOnce(new Error('boom'));

    const result = await probeCommand('broken');

    expect(result.available).toBe(false);
    expect(result.reason).toContain('Probe failed: boom');
  });

  it('probes all commands and returns map keyed by command name', async () => {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    state.execFileAsync.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === whichCmd && args[0] === 'tool-a') return { stdout: '/bin/tool-a\n', stderr: '' };
      if (cmd === whichCmd && args[0] === 'tool-b') return { stdout: '/bin/tool-b\n', stderr: '' };
      if (cmd === 'tool-a') return { stdout: 'a v1\n', stderr: '' };
      if (cmd === 'tool-b') throw new Error('no version');
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
});
