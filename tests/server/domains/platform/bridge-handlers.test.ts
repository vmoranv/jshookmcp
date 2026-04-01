import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockExecFileAsync, mockSpawn } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: mockSpawn,
}));

vi.mock('node:util', () => ({
  promisify: () => mockExecFileAsync,
}));

vi.mock('@utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(async () => ({
    absolutePath: '/tmp/artifacts/test.tmpdir',
    displayPath: 'artifacts/test.tmpdir',
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { BridgeHandlers } from '@server/domains/platform/handlers/bridge-handlers';
import type { ExternalToolRunner } from '@server/domains/shared/modules';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonTextResponse = {
  content: Array<{ text: string }>;
};

type RunnerOverrides = Partial<Pick<ExternalToolRunner, 'run' | 'probeAll'>>;

type RunnerResult = Awaited<ReturnType<ExternalToolRunner['run']>>;
type ProbeAllResult = Awaited<ReturnType<ExternalToolRunner['probeAll']>>;

function parsePayload(response: JsonTextResponse): Record<string, unknown> {
  const text = response.content[0]?.text;
  if (!text) {
    throw new Error('Missing text response payload');
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function makeRunner(overrides: RunnerOverrides = {}): ExternalToolRunner {
  const run = vi.fn<ExternalToolRunner['run']>(
    async () =>
      ({
        ok: true,
        exitCode: 0,
        signal: null,
        stdout: 'done',
        stderr: '',
        truncated: false,
        durationMs: 100,
      }) satisfies RunnerResult,
  );

  const probeAll = vi.fn<ExternalToolRunner['probeAll']>(async () => ({}) as ProbeAllResult);

  return {
    run,
    probeAll,
    ...overrides,
  } as unknown as ExternalToolRunner;
}

function createFridaChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BridgeHandlers', () => {
  let runner: ExternalToolRunner;
  let handlers: BridgeHandlers;

  beforeEach(() => {
    runner = makeRunner();
    handlers = new BridgeHandlers(runner);
  });

  // =========================================================================
  // handleFridaBridge
  // =========================================================================
  describe('handleFridaBridge', () => {
    describe('action = guide', () => {
      it('throws when action is not provided (required param)', async () => {
        await expect(handlers.handleFridaBridge({})).rejects.toThrow(
          'action must be a non-empty string',
        );
      });

      it('returns a guide when action is explicitly "guide"', async () => {
        const result = parsePayload(await handlers.handleFridaBridge({ action: 'guide' }));
        expect(result.success).toBe(true);
        expect(result).toHaveProperty('guide');
        const guide = result.guide as Record<string, unknown>;
        expect(guide).toHaveProperty('what');
        expect(guide).toHaveProperty('install');
        expect(guide).toHaveProperty('workflow');
        expect(guide).toHaveProperty('links');
        expect(guide).toHaveProperty('integration');
      });
    });

    describe('action = check_env', () => {
      it('reports frida as available when the command succeeds', async () => {
        mockExecFileAsync.mockResolvedValueOnce({
          stdout: '16.1.0\n',
          stderr: '',
        });

        const result = parsePayload(await handlers.handleFridaBridge({ action: 'check_env' }));

        expect(result.success).toBe(true);
        expect(result.available).toBe(true);
        expect(result.version).toBe('16.1.0');
        expect(result.tool).toBe('frida');
      });

      it('reports frida as unavailable when the command fails', async () => {
        mockExecFileAsync.mockRejectedValueOnce(new Error('spawn frida ENOENT'));

        const result = parsePayload(await handlers.handleFridaBridge({ action: 'check_env' }));

        expect(result.success).toBe(true);
        expect(result.available).toBe(false);
        expect(result.reason).toContain('ENOENT');
        expect(result.installHint).toBe('pip install frida-tools');
      });
    });

    describe('action = generate_script', () => {
      it('generates an intercept script by default', async () => {
        const result = parsePayload(
          await handlers.handleFridaBridge({
            action: 'generate_script',
            target: 'com.example.app',
            functionName: 'encrypt',
          }),
        );

        expect(result.success).toBe(true);
        expect(result.target).toBe('com.example.app');
        expect(result.hookType).toBe('intercept');
        expect(result.functionName).toBe('encrypt');
        expect(typeof result.script).toBe('string');
        expect(result.script as string).toContain('Interceptor.attach');
        expect(result.script as string).toContain('encrypt');
        expect(typeof result.usage).toBe('string');
      });

      it('generates a replace script when hookType is "replace"', async () => {
        const result = parsePayload(
          await handlers.handleFridaBridge({
            action: 'generate_script',
            hookType: 'replace',
            functionName: 'verify',
          }),
        );

        expect(result.hookType).toBe('replace');
        expect(result.script as string).toContain('Interceptor.replace');
        expect(result.script as string).toContain('NativeCallback');
      });

      it('generates a stalker script when hookType is "stalker"', async () => {
        const result = parsePayload(
          await handlers.handleFridaBridge({
            action: 'generate_script',
            hookType: 'stalker',
            functionName: 'processData',
          }),
        );

        expect(result.hookType).toBe('stalker');
        expect(result.script as string).toContain('Stalker.follow');
        expect(result.script as string).toContain('Stalker.unfollow');
      });

      it('generates a module_export script when hookType is "module_export"', async () => {
        const result = parsePayload(
          await handlers.handleFridaBridge({
            action: 'generate_script',
            hookType: 'module_export',
            functionName: 'libcrypto.so',
          }),
        );

        expect(result.hookType).toBe('module_export');
        expect(result.script as string).toContain('Module.enumerateExports');
        expect(result.script as string).toContain('libcrypto.so');
      });

      it('falls back to intercept template for unknown hookType', async () => {
        const result = parsePayload(
          await handlers.handleFridaBridge({
            action: 'generate_script',
            hookType: 'unknown_type',
            functionName: 'fn',
          }),
        );

        expect(result.script as string).toContain('Interceptor.attach');
      });

      it('uses placeholder defaults when target/functionName are omitted', async () => {
        const result = parsePayload(
          await handlers.handleFridaBridge({ action: 'generate_script' }),
        );

        expect(result.target).toBe('<process_name>');
        expect(result.functionName).toBe('<target_function>');
      });
    });

    describe('action = attach/run_script/detach/list_sessions', () => {
      it('attaches to a pid, tracks the session, and detaches cleanly', async () => {
        vi.useFakeTimers();
        const child = createFridaChild();
        mockExecFileAsync.mockResolvedValueOnce({ stdout: '16.1.0\n', stderr: '' });
        mockSpawn.mockReturnValueOnce(child as any);

        try {
          const attachPromise = handlers.handleFridaBridge({ action: 'attach', pid: 4242 });
          await Promise.resolve();
          child.stdout.emit('data', Buffer.from('ready\n'));
          await vi.advanceTimersByTimeAsync(2000);

          const attachResult = parsePayload(await attachPromise);
          const sessionId = String(attachResult.sessionId);

          expect(attachResult.success).toBe(true);
          expect(attachResult.action).toBe('attach');
          expect(attachResult.pid).toBe(4242);
          expect(attachResult.initialOutput).toContain('ready');
          expect(mockSpawn).toHaveBeenCalledWith(
            'frida',
            expect.arrayContaining(['-p', '4242', '--no-pause']),
            expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
          );

          const sessions = parsePayload(
            await handlers.handleFridaBridge({ action: 'list_sessions' }),
          );
          expect(sessions.count).toBe(1);
          expect(sessions.sessions[0].sessionId).toBe(sessionId);

          const detachResult = parsePayload(
            await handlers.handleFridaBridge({ action: 'detach', sessionId }),
          );
          expect(detachResult.success).toBe(true);
          expect(child.stdin.write).toHaveBeenCalledWith('%quit\n');
          expect(
            parsePayload(await handlers.handleFridaBridge({ action: 'list_sessions' })).count,
          ).toBe(0);
        } finally {
          vi.useRealTimers();
        }
      });

      it('runs a one-shot script when no interactive session exists', async () => {
        mockExecFileAsync.mockResolvedValueOnce({ stdout: 'hello\n', stderr: 'warn\n' });

        const result = parsePayload(
          await handlers.handleFridaBridge({
            action: 'run_script',
            sessionId: 'missing-session',
            script: 'console.log(1);',
            pid: 1337,
          }),
        );

        expect(result.success).toBe(true);
        expect(result.action).toBe('run_script');
        expect(result.mode).toBe('one-shot');
        expect(result.stdout).toContain('hello');
        expect(result.stderr).toContain('warn');
        expect(mockExecFileAsync).toHaveBeenCalledWith(
          'frida',
          expect.arrayContaining(['-p', '1337', '--no-pause', '-e', 'console.log(1);']),
          expect.objectContaining({ timeout: 30000 }),
        );
      });

      it('returns an error when run_script cannot resolve a session or target', async () => {
        const result = parsePayload(
          await handlers.handleFridaBridge({
            action: 'run_script',
            sessionId: 'missing-session',
            script: 'console.log(1);',
          }),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Provide pid or processName');
      });

      it('returns an error when detaching a missing session', async () => {
        const result = parsePayload(
          await handlers.handleFridaBridge({
            action: 'detach',
            sessionId: 'missing-session',
          }),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('Session not found');
      });
    });
  });

  // =========================================================================
  // handleJadxBridge
  // =========================================================================
  describe('handleJadxBridge', () => {
    describe('action = guide', () => {
      it('throws when action is not provided (required param)', async () => {
        await expect(handlers.handleJadxBridge({})).rejects.toThrow(
          'action must be a non-empty string',
        );
      });

      it('returns a jadx guide when action is explicitly "guide"', async () => {
        const result = parsePayload(await handlers.handleJadxBridge({ action: 'guide' }));
        expect(result.success).toBe(true);
        expect(result).toHaveProperty('guide');
        const guide = result.guide as Record<string, unknown>;
        expect(guide).toHaveProperty('what');
        expect(guide).toHaveProperty('install');
        expect(guide).toHaveProperty('workflow');
        expect(guide).toHaveProperty('commonArgs');
        expect(guide).toHaveProperty('links');
      });
    });

    describe('action = check_env', () => {
      it('reports jadx as available', async () => {
        mockExecFileAsync.mockResolvedValueOnce({
          stdout: 'jadx 1.4.7\n',
          stderr: '',
        });

        const result = parsePayload(await handlers.handleJadxBridge({ action: 'check_env' }));

        expect(result.success).toBe(true);
        expect(result.available).toBe(true);
        expect(result.version).toBe('jadx 1.4.7');
        expect(result.tool).toBe('jadx');
      });

      it('reports jadx as unavailable on error', async () => {
        mockExecFileAsync.mockRejectedValueOnce(new Error('spawn jadx ENOENT'));

        const result = parsePayload(await handlers.handleJadxBridge({ action: 'check_env' }));

        expect(result.available).toBe(false);
        expect(result.installHint).toContain('jadx/releases');
      });
    });

    describe('action = decompile', () => {
      it('throws when inputPath is missing', async () => {
        // parseStringArg(args, 'inputPath', true) throws before reaching
        // the manual "inputPath is required" check
        await expect(handlers.handleJadxBridge({ action: 'decompile' })).rejects.toThrow(
          'inputPath must be a non-empty string',
        );
      });

      it('runs jadx with correct arguments on successful decompile', async () => {
        const mockRun = vi.fn<ExternalToolRunner['run']>(
          async () =>
            ({
              ok: true,
              exitCode: 0,
              signal: null,
              stdout: 'Decompilation complete',
              stderr: '',
              truncated: false,
              durationMs: 5000,
            }) satisfies RunnerResult,
        );

        const customRunner = makeRunner({ run: mockRun });
        const customHandlers = new BridgeHandlers(customRunner);

        const result = parsePayload(
          await customHandlers.handleJadxBridge({
            action: 'decompile',
            inputPath: '/path/to/app.apk',
          }),
        );

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(mockRun).toHaveBeenCalledOnce();
        const firstCall = mockRun.mock.calls[0];
        if (!firstCall) {
          throw new Error('Expected jadx runner to be called');
        }
        const [callArgs] = firstCall;
        expect(callArgs.tool).toBe('platform.jadx');
        expect(callArgs.timeoutMs).toBe(300_000);
      });

      it('passes extra args to jadx', async () => {
        const mockRun = vi.fn<ExternalToolRunner['run']>(
          async () =>
            ({
              ok: true,
              exitCode: 0,
              signal: null,
              stdout: 'done',
              stderr: '',
              truncated: false,
              durationMs: 100,
            }) satisfies RunnerResult,
        );

        const customRunner = makeRunner({ run: mockRun });
        const customHandlers = new BridgeHandlers(customRunner);

        await customHandlers.handleJadxBridge({
          action: 'decompile',
          inputPath: '/path/to/app.apk',
          extraArgs: ['--deobf', '--show-bad-code'],
        });

        const firstCall = mockRun.mock.calls[0];
        if (!firstCall) {
          throw new Error('Expected jadx runner to be called');
        }
        const [callArgs] = firstCall;
        expect(callArgs.args).toContain('--deobf');
        expect(callArgs.args).toContain('--show-bad-code');
      });

      it('filters non-string entries from extraArgs', async () => {
        const mockRun = vi.fn<ExternalToolRunner['run']>(
          async () =>
            ({
              ok: true,
              exitCode: 0,
              signal: null,
              stdout: 'done',
              stderr: '',
              truncated: false,
              durationMs: 100,
            }) satisfies RunnerResult,
        );

        const customRunner = makeRunner({ run: mockRun });
        const customHandlers = new BridgeHandlers(customRunner);

        await customHandlers.handleJadxBridge({
          action: 'decompile',
          inputPath: '/path/to/app.apk',
          extraArgs: ['--deobf', 42, null, '--threads-count'],
        });

        const firstCall = mockRun.mock.calls[0];
        if (!firstCall) {
          throw new Error('Expected jadx runner to be called');
        }
        const [callArgs] = firstCall;
        expect(callArgs.args).toContain('--deobf');
        expect(callArgs.args).toContain('--threads-count');
        expect(callArgs.args).not.toContain('42');
      });

      it('returns error payload when runner throws', async () => {
        const mockRun = vi.fn(async () => {
          throw new Error('jadx not found');
        });

        const customRunner = makeRunner({ run: mockRun });
        const customHandlers = new BridgeHandlers(customRunner);

        const result = parsePayload(
          await customHandlers.handleJadxBridge({
            action: 'decompile',
            inputPath: '/path/to/app.apk',
          }),
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('jadx not found');
        expect(result.hint).toContain('jadx');
      });

      it('returns runner failure details when exit code is non-zero', async () => {
        const mockRun = vi.fn<ExternalToolRunner['run']>(
          async () =>
            ({
              ok: false,
              exitCode: 1,
              signal: null,
              stdout: 'partial output',
              stderr: 'some error',
              truncated: false,
              durationMs: 200,
            }) satisfies RunnerResult,
        );

        const customRunner = makeRunner({ run: mockRun });
        const customHandlers = new BridgeHandlers(customRunner);

        const result = parsePayload(
          await customHandlers.handleJadxBridge({
            action: 'decompile',
            inputPath: '/path/to/app.apk',
          }),
        );

        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe('some error');
      });
    });
  });
});
