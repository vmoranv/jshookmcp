import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { resolve as resolvePath } from 'node:path';

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
    await new Promise((done) => setTimeout(done, 30));

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
    await new Promise((done) => setTimeout(done, 20));

    // Restore clearTimeout
    global.clearTimeout = originalClearTimeout;

    // Validate that it didn't kill the child
    expect(child.kill).not.toHaveBeenCalled();
  });

  // ── Remaining branch coverage ─────────────────────────────────────────────

  it('reports ok=false for non-zero exit codes', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({ tool: 'tmp', args: [] } as any);
    child.stdout.emit('data', Buffer.from('some output'));
    child.stderr.emit('data', Buffer.from('error output'));
    child.emit('close', 127, null);

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe('some output');
    expect(result.stderr).toBe('error output');
    expect(result.truncated).toBe(false);
  });

  it('calls onProgress for all phases including timeout', async () => {
    vi.useFakeTimers();
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);
    const progressCalls: Array<{ phase: string }> = [];

    const runPromise = runner.run({
      tool: 'tmp',
      args: [],
      timeoutMs: 10,
      // @ts-expect-error
      onProgress: (p) => progressCalls.push(p),
    } as any);

    vi.advanceTimersByTime(5);
    child.stdout.emit('data', Buffer.from('a'));

    vi.advanceTimersByTime(5);
    child.stderr.emit('data', Buffer.from('b'));

    vi.advanceTimersByTime(20);
    vi.advanceTimersByTime(2500);

    await runPromise;

    const phases = progressCalls.map((c) => c.phase);
    expect(phases).toContain('spawn');
    expect(phases).toContain('stdout');
    expect(phases).toContain('stderr');
    expect(phases).toContain('timeout');

    vi.useRealTimers();
  });

  it('finish() guards against double invocation via close then error', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({ tool: 'tmp', args: [] } as any);

    // First close fires finish()
    child.emit('close', 0, null);

    // Then error fires — should be ignored (settled=true)
    child.emit('error', new Error('should be ignored'));

    const result = await runPromise;
    // Result should be from close, not error
    expect(result.exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.stderr).not.toContain('Spawn error');
  });

  it('processes multiple stdout chunks without truncation', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({ tool: 'tmp', args: [], maxStdoutBytes: 100 } as any);
    child.stdout.emit('data', Buffer.from('chunk1-'));
    child.stdout.emit('data', Buffer.from('chunk2-'));
    child.stdout.emit('data', Buffer.from('chunk3'));
    child.emit('close', 0, null);

    const result = await runPromise;
    expect(result.stdout).toBe('chunk1-chunk2-chunk3');
    expect(result.truncated).toBe(false);
  });

  it('writes stdin to child stdin when provided', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({
      tool: 'tmp',
      args: [],
      stdin: 'hello world',
    } as any);
    child.emit('close', 0, null);
    await runPromise;

    expect(child.stdin.write).toHaveBeenCalledWith('hello world');
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('no stdin.write called when stdin is undefined', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({ tool: 'tmp', args: [] } as any);
    child.emit('close', 0, null);
    await runPromise;

    // stdin.end() is still called (line 163: child.stdin.end())
    expect(child.stdin.end).toHaveBeenCalled();
    // But stdin.write should NOT be called with data
    expect(child.stdin.write).not.toHaveBeenCalled();
  });

  it('validateCwd allows temp subdirectory', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    // Override TEMP to control the temp root used in validation
    const origTemp = process.env.TEMP;
    process.env.TEMP = '/test-temp';

    try {
      const runPromise = runner.run({
        tool: 'tmp',
        args: [],
        cwd: '/test-temp/jshook-work',
      } as any);
      child.emit('close', 0, null);
      await runPromise;

      // validateCwd should accept /test-temp/jshook-work because it starts with resolved /test-temp/
      expect(state.spawn).toHaveBeenCalledWith(
        'tool-bin',
        [],
        expect.objectContaining({
          cwd: resolvePath('/test-temp/jshook-work'),
        }),
      );
    } finally {
      process.env.TEMP = origTemp;
    }
  });

  it('validateCwd allows exact system temp directory on Unix', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const origTemp = process.env.TEMP;
    const origTmp = process.env.TMP;

    try {
      // Clear Windows-style env vars to force Unix temp path matching
      delete process.env.TEMP;
      delete process.env.TMP;

      const runPromise = runner.run({ tool: 'tmp', args: [], cwd: '/tmp' } as any);
      child.emit('close', 0, null);
      await runPromise;

      expect(state.spawn).toHaveBeenCalledWith(
        'tool-bin',
        [],
        expect.objectContaining({ cwd: resolvePath('/tmp') }),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform });
      process.env.TEMP = origTemp;
      process.env.TMP = origTmp;
    }
  });

  it('validateCwd allows /var/tmp directory', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const origTemp = process.env.TEMP;
    const origTmp = process.env.TMP;

    try {
      delete process.env.TEMP;
      delete process.env.TMP;

      const runPromise = runner.run({ tool: 'tmp', args: [], cwd: '/var/tmp' } as any);
      child.emit('close', 0, null);
      await runPromise;

      expect(state.spawn).toHaveBeenCalledWith(
        'tool-bin',
        [],
        expect.objectContaining({ cwd: resolvePath('/var/tmp') }),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform });
      process.env.TEMP = origTemp;
      process.env.TMP = origTmp;
    }
  });

  it('sets TEMP and TMP env vars on Windows when both are defined', async () => {
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
    const origEnv = { ...process.env };

    try {
      process.env.TEMP = 'C:\\Windows\\Temp';
      process.env.TMP = 'C:\\Windows\\Temp';
      delete process.env.SYSTEMROOT;
      delete process.env.SystemRoot;
      delete process.env.WINDIR;
      delete process.env.PATH;

      const runPromise = runner.run({ tool: 'tmp', args: [] } as any);
      child.emit('close', 0, null);
      await runPromise;

      expect(state.spawn).toHaveBeenCalledWith(
        'tool-bin',
        [],
        expect.objectContaining({
          env: expect.objectContaining({
            TEMP: 'C:\\Windows\\Temp',
            TMP: 'C:\\Windows\\Temp',
          }),
        }),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform });
      process.env = origEnv;
    }
  });

  it('handles stdout data arriving after process close gracefully', async () => {
    const child = createChildProcessMock();
    state.spawn.mockReturnValue(child);
    const registry = {
      probeAll: vi.fn(),
      getSpec: vi.fn().mockReturnValue({ command: 'tool-bin' }),
      getCachedProbe: vi.fn().mockReturnValue({ available: true }),
    } as any;
    const runner = new ExternalToolRunner(registry);

    const runPromise = runner.run({ tool: 'tmp', args: [] } as any);

    // Emit close first, then emit stdout data (should be ignored since settled=true)
    child.emit('close', 0, null);
    child.stdout.emit('data', Buffer.from('should be ignored'));
    child.stderr.emit('data', Buffer.from('should also be ignored'));

    const result = await runPromise;

    // Result should be from close event, not from late data
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    // Stdout should be empty since the data arrived after close
    expect(result.stdout).toBe('');
  });
});
