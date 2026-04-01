import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const state = vi.hoisted(() => {
  const spawn = vi.fn();
  const getProjectRoot = vi.fn(() => '/repo/root');
  const ioLimit = vi.fn(async (task: () => Promise<any>) => task());
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
      expect.objectContaining({ cwd: '/repo/root', shell: false }),
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
    child.stdout.emit('data', Buffer.from('more chunk')); // to trigger false branch
    child.emit('close', 0, null);

    const result = await runPromise;
    expect(result.stdout).toBe('abcd');
    expect(result.truncated).toBe(true);
  });

  it('truncates stderr when maxStderrBytes is exceeded', async () => {
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
      maxStderrBytes: 4,
    } as any);

    child.stderr.emit('data', Buffer.from('abcdef'));
    child.stderr.emit('data', Buffer.from('more chunk')); // to cover the false branch of if (stderr.length < maxStderr)
    child.emit('close', 0, null);

    const result = await runPromise;
    expect(result.stderr).toBe('abcd');
    expect(result.truncated).toBe(true);
  });

  it('pipes stdin to child process and filters env via allowlist', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin', envAllowlist: ['TEST_CUSTOM_ENV'] }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    process.env.TEST_CUSTOM_ENV = 'allowed_value';
    const runPromise = runner.run({
      tool: 'wabt.wasm2wat',
      args: [],
      stdin: 'input data',
    } as any);

    child.emit('close', 0, null);
    await runPromise;

    expect(child.stdin.write).toHaveBeenCalledWith('input data');
    expect(state.spawn).toHaveBeenCalledWith(
      'tool-bin',
      [],
      expect.objectContaining({
        env: expect.objectContaining({ TEST_CUSTOM_ENV: 'allowed_value' }),
      }),
    );
    delete process.env.TEST_CUSTOM_ENV;
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
      expect.objectContaining({ cwd: '/repo/root' }),
    );
  });

  it('kills hung process on timeout, reports SIGKILL, and handles late close', async () => {
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
      timeoutMs: 5,
    } as any);

    // Wait for the timeout SIGTERM and then SIGKILL to fire
    await new Promise((resolve) => setTimeout(resolve, 30));

    const result = await pending;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.signal).toBe('SIGKILL');
    expect(result.ok).toBe(false);

    // Emit close late to cover line 130 (if settled return)
    child.emit('close', null, 'SIGKILL');
  });

  it('builds environment with path fallback and systemroot fallbacks', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const origPath = process.env.PATH;
    const origSR = process.env.SYSTEMROOT;
    const origSr = process.env.SystemRoot;
    const origWinDir = process.env.WINDIR;

    try {
      // Test 1: empty PATH, undefined SYSTEMROOT, defined SystemRoot
      delete process.env.PATH;
      delete process.env.SYSTEMROOT;
      process.env.SystemRoot = 'C:\\Windows2';
      delete process.env.WINDIR;

      let p = runner.run({ tool: 'tmp', args: [] } as any);
      child.emit('close', 0, null);
      await p;

      expect(state.spawn).toHaveBeenCalledWith(
        'tool-bin',
        [],
        expect.objectContaining({
          env: expect.objectContaining({ PATH: '', SYSTEMROOT: 'C:\\Windows2' }),
        }),
      );

      // Test 2: empty PATH, undefined SYSTEMROOT and SystemRoot, defined WINDIR
      delete process.env.SystemRoot;
      process.env.WINDIR = 'C:\\Windows3';

      p = runner.run({ tool: 'tmp', args: [] } as any);
      child.emit('close', 0, null);
      await p;

      expect(state.spawn).toHaveBeenCalledWith(
        'tool-bin',
        [],
        expect.objectContaining({
          env: expect.objectContaining({ PATH: '', SYSTEMROOT: 'C:\\Windows3' }),
        }),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform });
      process.env.PATH = origPath;
      process.env.SYSTEMROOT = origSR;
      process.env.SystemRoot = origSr;
      process.env.WINDIR = origWinDir;
    }
  });

  it('handles child process error events', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({ tool: 'wabt.wasm2wat', args: [] } as any);
    child.emit('error', new Error('ENOENT'));

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Spawn error: ENOENT');
  });

  it('allows cwd inside project root', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({ tool: 'tmp', args: [], cwd: '/repo/root/src' } as any);
    child.emit('close', 0, null);
    await runPromise;

    expect(state.spawn).toHaveBeenCalledWith(
      'tool-bin',
      [],
      expect.objectContaining({
        cwd: expect.stringContaining('/repo/root/src'.replace(/\//g, require('path').sep)),
      }),
    );
  });

  it('exits gracefully on SIGTERM before SIGKILL timeout', async () => {
    vi.useFakeTimers();
    try {
      const child = createChildProcessMock();
      state.spawn.mockReturnValue(child);
      const registry = {
        probeAll: vi.fn(),
        getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
        getCachedProbe: vi.fn().mockReturnValue({ available: true }),
      } as any;
      const runner = new ExternalToolRunner(registry);

      const runPromise = runner.run({ tool: 'tmp', args: [], timeoutMs: 10 } as any);

      // Fast-forward to trigger outer timeout (SIGTERM)
      vi.advanceTimersByTime(20);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Emulate a graceful exit as a response to SIGTERM
      child.emit('close', null, 'SIGTERM');

      // Move time forward past the 2s SIGKILL grace period
      // to ensure the inner timeout fires and sees settled = true
      vi.advanceTimersByTime(2500);

      // Must restore real timers so await resolves properly if it hasn't
      // Or just await the promise
      vi.useRealTimers();

      const result = await runPromise;
      expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
      expect(result.signal).toBe('SIGTERM');
      expect(result.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles missing env vars in allowlist safely', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin', envAllowlist: ['MISSING_VAR_XYZ'] }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({ tool: 'tmp', args: [] } as any);
    child.emit('close', 0, null);
    await runPromise;

    expect(state.spawn).toHaveBeenCalledWith(
      'tool-bin',
      [],
      expect.objectContaining({
        env: expect.not.objectContaining({ MISSING_VAR_XYZ: expect.anything() }),
      }),
    );
  });

  it('allows cwd in exact system tmp directory', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    // Mock process.env.TEMP for consistent testing
    const originalTemp = process.env.TEMP;
    process.env.TEMP = '/mock/tmp';

    try {
      const runPromise = runner.run({ tool: 'tmp', args: [], cwd: '/mock/tmp' } as any);
      child.emit('close', 0, null);
      await runPromise;

      expect(state.spawn).toHaveBeenCalledWith(
        'tool-bin',
        [],
        expect.objectContaining({
          cwd: expect.stringContaining('/mock/tmp'.replace(/\//g, require('path').sep)),
        }),
      );
    } finally {
      process.env.TEMP = originalTemp;
    }
  });

  it('handles missing Windows-specific environment variables for fallback safely', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const keys = ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'];
    const backups: Record<string, string | undefined> = {};
    for (const k of keys) {
      backups[k] = process.env[k];
      delete process.env[k];
    }

    try {
      const runPromise = runner.run({ tool: 'tmp', args: [] } as any);
      child.emit('close', 0, null);
      await runPromise;

      expect(state.spawn).toHaveBeenCalledWith(
        'tool-bin',
        [],
        expect.objectContaining({
          env: expect.not.objectContaining({
            SYSTEMROOT: expect.anything(),
            TEMP: expect.anything(),
            TMP: expect.anything(),
          }),
        }),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      for (const k of keys) {
        if (backups[k] !== undefined) process.env[k] = backups[k];
      }
    }
  });

  it('handles late timeout execution when already settled (race condition)', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    // Mock clearTimeout to do nothing, allowing the timeout to fire AFTER process finishes
    const originalClearTimeout = global.clearTimeout;
    global.clearTimeout = vi.fn() as any;

    const runPromise = runner.run({ tool: 'tmp', args: [], timeoutMs: 10 } as any);

    // Finish the process immediately so settled = true
    child.emit('close', 0, null);
    await runPromise;

    // Wait for the timeout to fire and evaluate `if (!settled)` safely avoiding execution
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Restore clearTimeout
    global.clearTimeout = originalClearTimeout;

    // Validate that it didn't kill the child
    expect(child.kill).not.toHaveBeenCalled();
  });
});
