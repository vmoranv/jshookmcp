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
}));

vi.mock('../../../src/utils/outputPaths.js', () => ({
  getProjectRoot: state.getProjectRoot,
}));

vi.mock('../../../src/utils/concurrency.js', () => ({
  ioLimit: state.ioLimit,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ExternalToolRunner } from '../../../src/modules/external/ExternalToolRunner.js';

function createChildProcessMock() {
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
    } as any;
    const runner = new ExternalToolRunner(registry);

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
    } as any;
    const runner = new ExternalToolRunner(registry);
    const progress = vi.fn();

    const runPromise = runner.run({
      tool: 'wabt.wasm2wat',
      args: ['--foo'],
      onProgress: progress,
    } as any);

    child.stdout.emit('data', Buffer.from('hello'));
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
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({
      tool: 'wabt.wasm2wat',
      args: [],
      maxStdoutBytes: 4,
    } as any);

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
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({
      tool: 'wabt.wasm2wat',
      args: [],
      cwd: '/etc',
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
    } as any;
    const runner = new ExternalToolRunner(registry);

    const pending = runner.run({
      tool: 'wabt.wasm2wat',
      args: [],
      timeoutMs: 10,
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

