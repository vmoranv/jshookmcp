import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => {
  const spawn = vi.fn();
  const getProjectRoot = vi.fn(() => '/repo/root');
  const ioLimit = vi.fn(async (task: () => Promise<unknown>) => task());
  return { spawn, getProjectRoot, ioLimit };
});

vi.mock('node:child_process', () => ({
  spawn: state.spawn,
  execFile: vi.fn(),
}));

vi.mock('@src/utils/outputPaths', () => ({
  getProjectRoot: state.getProjectRoot,
}));

vi.mock('@src/utils/concurrency', () => ({
  ioLimit: state.ioLimit,
}));

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ExternalToolRunner } from '@modules/external/ExternalToolRunner';

function createChildProcessMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  child.kill = vi.fn();
  return child;
}

describe('ExternalToolRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('delegates probeAll to registry', async () => {
    const registry = {
      probeAll: vi.fn().mockResolvedValue({ ok: true }),
      getSpec: vi.fn(),
      getCachedProbe: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const runner = new ExternalToolRunner(registry);
    const result = await runner.probeAll(true);

    expect(registry.probeAll).toHaveBeenCalledWith(true);
    expect(result).toEqual({ ok: true });
  });

  it('returns early when cached probe indicates unavailable tool', async () => {
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'wasm2wat' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: false, reason: 'missing' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const runner = new ExternalToolRunner(registry);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const result = await runner.run({ tool: 'wabt.wasm2wat', args: [] } as any);

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not available: missing');
    expect(state.spawn).not.toHaveBeenCalled();
  });

  it('spawns process with merged args and captures output', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({
        command: 'tool-bin',
        defaultArgs: ['--default'],
      }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const runner = new ExternalToolRunner(registry);
    const progress = vi.fn();

    const runPromise = runner.run({
      tool: 'wabt.wasm2wat',
      args: ['--foo'],
      onProgress: progress,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    child.stdout.emit('data', Buffer.from('hello'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    child.stderr.emit('data', Buffer.from('warn'));
    child.emit('close', 0, null);

    const result = await runPromise;

    expect(state.spawn).toHaveBeenCalledWith(
      'tool-bin',
      ['--default', '--foo'],
      expect.objectContaining({ cwd: '/repo/root', shell: false })
    );
    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      stdout: 'hello',
      stderr: 'warn',
      truncated: false,
    });
    expect(progress).toHaveBeenCalled();
  });

  it('truncates stdout when maxStdoutBytes is exceeded', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({
      tool: 'wabt.wasm2wat',
      args: [],
      maxStdoutBytes: 4,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    child.stdout.emit('data', Buffer.from('abcdef'));
    child.emit('close', 0, null);

    const result = await runPromise;
    expect(result.stdout).toBe('abcd');
    expect(result.truncated).toBe(true);
  });

  it('uses project root when cwd is outside allowed boundaries', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({
      tool: 'wabt.wasm2wat',
      args: [],
      cwd: '/etc',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);
    child.emit('close', 0, null);
    await runPromise;

    expect(state.spawn).toHaveBeenCalledWith(
      'tool-bin',
      [],
      expect.objectContaining({ cwd: '/repo/root' })
    );
  });

  it('kills hung process on timeout and reports SIGKILL', async () => {
    vi.useFakeTimers();
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    const runner = new ExternalToolRunner(registry);

    const pending = runner.run({
      tool: 'wabt.wasm2wat',
      args: [],
      timeoutMs: 10,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any);

    await vi.advanceTimersByTimeAsync(11);
    await vi.advanceTimersByTimeAsync(2001);
    const result = await pending;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.signal).toBe('SIGKILL');
    expect(result.ok).toBe(false);
  });
});
