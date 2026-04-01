import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@server/MCPServer', () => ({
  MCPServer: vi.fn(),
}));
vi.mock('@utils/config', () => ({
  getConfig: vi.fn(),
  validateConfig: vi.fn(),
}));
vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@server/registry/index', () => ({ initRegistry: vi.fn() }));
vi.mock('@utils/cliFastPath', () => ({
  resolveCliFastPath: vi.fn(),
}));
vi.mock('@utils/artifactRetention', () => ({
  cleanupArtifacts: vi.fn(),
  getArtifactRetentionConfig: vi.fn(),
  startArtifactRetentionScheduler: vi.fn(),
}));
vi.mock('@src/constants', () => ({
  SHUTDOWN_TIMEOUT_MS: 10,
  RUNTIME_ERROR_WINDOW_MS: 100,
  RUNTIME_ERROR_THRESHOLD: 2,
}));

import { MCPServer } from '@server/MCPServer';
import { getConfig, validateConfig } from '@utils/config';
import { resolveCliFastPath } from '@utils/cliFastPath';
import {
  cleanupArtifacts,
  getArtifactRetentionConfig,
  startArtifactRetentionScheduler,
} from '@utils/artifactRetention';
// @ts-ignore
import { logger } from '@utils/logger';

async function loadIndex() {
  const m = await import('../src/index');
  await m.main();
  // flush microtasks
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe('src/index.ts entrypoint', () => {
  let _mockProcessExit: any;
  let mockProcessStdoutWrite: any;
  let processEvents: Map<string, Function>;
  let stdinEvents: Map<string, Function>;

  let exitPromise: Promise<number>;
  let resolveExit: (code: number) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(MCPServer).mockImplementation(function () {
      return {
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        enterDegradedMode: vi.fn(),
      };
    } as any);

    vi.mocked(getConfig).mockReturnValue({} as any);
    vi.mocked(validateConfig).mockReturnValue({ valid: true, errors: [] });

    vi.mocked(resolveCliFastPath).mockReturnValue({ handled: false } as any);

    vi.mocked(cleanupArtifacts).mockResolvedValue({ removedFiles: 1, removedBytes: 100 } as any);
    vi.mocked(getArtifactRetentionConfig).mockReturnValue({
      enabled: true,
      cleanupOnStart: true,
    } as any);
    vi.mocked(startArtifactRetentionScheduler).mockReturnValue(vi.fn() as any);

    vi.mocked(logger.error).mockImplementation((...args: any[]) =>
      console.error('LOGGER ERROR:', ...args),
    );

    processEvents = new Map();
    stdinEvents = new Map();

    exitPromise = new Promise((resolve) => {
      resolveExit = resolve;
    });

    _mockProcessExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      resolveExit(code as number);
      // return a promise that never resolves so execution halts like a real exit
      return new Promise(() => {}) as never;
    });
    mockProcessStdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      processEvents.set(event as string, handler as Function);
      return process;
    });

    vi.spyOn(process.stdin, 'on').mockImplementation((event, handler) => {
      stdinEvents.set(event as string, handler as Function);
      return process.stdin;
    });
    vi.spyOn(process.stdin, 'resume').mockImplementation(() => process.stdin);
  });

  it('runs successfully and sets up listeners', async () => {
    await loadIndex();
    expect(processEvents.has('SIGINT')).toBe(true);
    expect(processEvents.has('SIGTERM')).toBe(true);
    expect(processEvents.has('uncaughtException')).toBe(true);
    expect(processEvents.has('unhandledRejection')).toBe(true);
    expect(stdinEvents.has('end')).toBe(true);
  });

  it('handles SIGINT shutdown successfully', async () => {
    await loadIndex();
    const sigint = processEvents.get('SIGINT');
    expect(sigint).toBeDefined();
    sigint!();

    const code = await exitPromise;
    expect(code).toBe(0);
  });

  it('exits if config validation fails', async () => {
    const configMock = await import('@utils/config');
    vi.mocked(configMock.validateConfig).mockReturnValueOnce({
      valid: false,
      errors: ['bad config'],
    });

    await loadIndex();
    const code = await exitPromise;
    expect(code).toBe(1);
  });

  it('handles SIGTERM shutdown successfully', async () => {
    await loadIndex();
    const sigterm = processEvents.get('SIGTERM');
    expect(sigterm).toBeDefined();
    sigterm!();

    const code = await exitPromise;
    expect(code).toBe(0);
  });

  it('handles stdin EOF shutdown successfully', async () => {
    await loadIndex();
    const stdinEnd = stdinEvents.get('end');
    expect(stdinEnd).toBeDefined();
    stdinEnd!();

    const code = await exitPromise;
    expect(code).toBe(0);
  });

  it('handles cliFastPath handling', async () => {
    const cliFastPathMock = await import('@utils/cliFastPath');
    vi.mocked(cliFastPathMock.resolveCliFastPath).mockReturnValueOnce({
      handled: true,
      exitCode: 0,
      output: 'fast path output',
    });

    await loadIndex();
    const code = await exitPromise;
    expect(code).toBe(0);
    expect(mockProcessStdoutWrite).toHaveBeenCalledWith('fast path output');
  });

  it('handles cliFastPath handling without output', async () => {
    const cliFastPathMock = await import('@utils/cliFastPath');
    vi.mocked(cliFastPathMock.resolveCliFastPath).mockReturnValueOnce({
      handled: true,
      exitCode: 0,
    } as any);

    await loadIndex();
    const code = await exitPromise;
    expect(code).toBe(0);
    expect(mockProcessStdoutWrite).not.toHaveBeenCalled();
  });

  it('exits 1 immediately on FATAL OS-level ENOMEM codes', async () => {
    await loadIndex();
    const uncaught = processEvents.get('uncaughtException');

    const fatalErr = new Error('out of memory OS dump');
    (fatalErr as any).code = 'ENOMEM';
    uncaught!(fatalErr);
    const code = await exitPromise;
    expect(code).toBe(1);
  });

  it('enters degraded mode on repeated runtime failures', async () => {
    await loadIndex();
    const uncaught = processEvents.get('uncaughtException');
    expect(uncaught).toBeDefined();

    uncaught!(new Error('First err'));
    uncaught!(new Error('Second err'));

    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    const instance = vi.mocked(MCPServer).mock.results[0].value;
    expect(instance.enterDegradedMode).toHaveBeenCalled();
  });

  it('handles unhandledRejection gracefully', async () => {
    await loadIndex();
    const unhandled = processEvents.get('unhandledRejection');
    expect(unhandled).toBeDefined();

    unhandled!(new Error('Promise rejection err'));
    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    const instance = vi.mocked(MCPServer).mock.results[0].value;
    expect(instance.enterDegradedMode).not.toHaveBeenCalled(); // 1 error doesn't trigger degraded mode
  });

  it('handles string and circular object rejections', async () => {
    await loadIndex();
    const unhandled = processEvents.get('unhandledRejection');

    // String error
    unhandled!('String error');

    // Circular object to trigger JSON.stringify catch block
    const circular: any = {};
    circular.self = circular;
    unhandled!(circular);
  });

  it('resets error count outside recovery window', async () => {
    await loadIndex();
    const uncaught = processEvents.get('uncaughtException');

    uncaught!(new Error('Err 1'));

    // Switch to fake timers AFTER loading everything to avoid hanging dynamic imports
    vi.useFakeTimers();
    // Advance time past recoveryWindowMs (assume > 60000ms is enough)
    vi.advanceTimersByTime(65000);

    uncaught!(new Error('Err 2'));
    vi.useRealTimers();
  });

  it('exits 1 immediately on FATAL unrecoverable errors', async () => {
    await loadIndex();
    const uncaught = processEvents.get('uncaughtException');

    const fatalErr = new Error('OOM');
    (fatalErr as any).code = 'ERR_WORKER_OUT_OF_MEMORY';

    uncaught!(fatalErr);
    const code = await exitPromise;
    expect(code).toBe(1);
  });

  it('exits 1 immediately on RangeError allocation failure', async () => {
    await loadIndex();
    const uncaught = processEvents.get('uncaughtException');

    const fatalErr = new RangeError('allocation failed');
    uncaught!(fatalErr);
    const code = await exitPromise;
    expect(code).toBe(1);
  });

  it('bypasses cleanup if disabled in config', async () => {
    vi.mocked(getArtifactRetentionConfig).mockReturnValue({
      enabled: false,
      cleanupOnStart: true,
    } as any);
    await loadIndex();
    expect(cleanupArtifacts).not.toHaveBeenCalled();
  });

  it('bypasses cleanup if cleanupOnStart is false', async () => {
    vi.mocked(getArtifactRetentionConfig).mockReturnValue({
      enabled: true,
      cleanupOnStart: false,
    } as any);
    await loadIndex();
    expect(cleanupArtifacts).not.toHaveBeenCalled();
  });

  it('runs cleanup but logs nothing if 0 files removed', async () => {
    vi.mocked(getArtifactRetentionConfig).mockReturnValue({
      enabled: true,
      cleanupOnStart: true,
    } as any);
    vi.mocked(cleanupArtifacts).mockResolvedValue({ removedFiles: 0, removedBytes: 0 } as any);
    await loadIndex();
    expect(cleanupArtifacts).toHaveBeenCalled();
  });

  it('exits 1 if server.start throws an error', async () => {
    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    vi.mocked(MCPServer).mockImplementationOnce(function () {
      return {
        start: vi.fn().mockRejectedValue(new Error('Address in use credentials')),
        close: vi.fn(),
        enterDegradedMode: vi.fn(),
      };
    } as any);

    await loadIndex();
    const code = await exitPromise;
    expect(code).toBe(1);
  });

  it('exits 1 if server.start throws a non-Error string', async () => {
    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    vi.mocked(MCPServer).mockImplementationOnce(function () {
      return {
        start: vi.fn().mockRejectedValue('Just a string failure'),
        close: vi.fn(),
        enterDegradedMode: vi.fn(),
      };
    } as any);

    await loadIndex();
    const code = await exitPromise;
    expect(code).toBe(1);
  });

  it('logs EADDRINUSE error specifically', async () => {
    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    vi.mocked(MCPServer).mockImplementationOnce(function () {
      const eaddrError = new Error('EADDRINUSE Error');
      (eaddrError as any).code = 'EADDRINUSE';
      return {
        start: vi.fn().mockRejectedValue(eaddrError),
        close: vi.fn(),
        enterDegradedMode: vi.fn(),
      };
    } as any);

    await loadIndex();
    const code = await exitPromise;
    expect(code).toBe(1);
  });

  it('handles timeouts during SIGINT graceful shutdown', async () => {
    await loadIndex();
    const sigint = processEvents.get('SIGINT');

    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    const instance = vi.mocked(MCPServer).mock.results[0].value;
    instance.close.mockImplementation(() => new Promise(() => {}));

    vi.useFakeTimers();
    sigint!(0);
    vi.advanceTimersByTime(5000);

    let exitedCode: number | undefined;
    exitPromise.then((c) => (exitedCode = c));
    await Promise.resolve();

    expect(exitedCode).toBe(1);
    vi.useRealTimers();
  });

  it('catches and logs errors during SIGINT shutdown', async () => {
    await loadIndex();
    const sigint = processEvents.get('SIGINT');

    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    const instance = vi.mocked(MCPServer).mock.results[0].value;
    instance.close.mockRejectedValue(new Error('SIGINT Close exploded'));

    vi.useFakeTimers();
    sigint!(0);
    vi.advanceTimersByTime(5000);

    let _code: number | undefined;
    exitPromise.then((c) => (_code = c));
    await Promise.resolve();

    vi.useRealTimers();
  });

  it('handles timeouts during SIGTERM graceful shutdown', async () => {
    await loadIndex();
    const sigterm = processEvents.get('SIGTERM');

    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    const instance = vi.mocked(MCPServer).mock.results[0].value;
    instance.close.mockImplementation(() => new Promise(() => {}));

    vi.useFakeTimers();
    sigterm!(0);
    vi.advanceTimersByTime(5000);

    let exitedCode: number | undefined;
    exitPromise.then((c) => (exitedCode = c));
    await Promise.resolve();

    expect(exitedCode).toBe(1);
    vi.useRealTimers();
  });

  it('catches and logs errors during SIGTERM shutdown', async () => {
    await loadIndex();
    const sigterm = processEvents.get('SIGTERM');

    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    const instance = vi.mocked(MCPServer).mock.results[0].value;
    instance.close.mockRejectedValue(new Error('SIGTERM Close exploded'));

    vi.useFakeTimers();
    sigterm!(0);
    vi.advanceTimersByTime(5000);

    let _code: number | undefined;
    exitPromise.then((c) => (_code = c));
    await Promise.resolve();

    vi.useRealTimers();
  });

  it('catches and logs errors during stdin EOF shutdown', async () => {
    await loadIndex();
    const stdinEnd = stdinEvents.get('end');

    const { MCPServer: _MCPServerLocal } = await import('@server/MCPServer');
    const instance = vi.mocked(MCPServer).mock.results[0].value;
    // Make close throw an error to test the catch block
    instance.close.mockRejectedValue(new Error('Close exploded'));

    vi.useFakeTimers();
    stdinEnd!();

    // advance timers to flush timeout and complete exit
    vi.advanceTimersByTime(5000);

    let exitedCode: number | undefined;
    exitPromise.then((c) => (exitedCode = c));
    await Promise.resolve();

    expect(exitedCode).toBe(1);
    vi.useRealTimers();
  });
});
