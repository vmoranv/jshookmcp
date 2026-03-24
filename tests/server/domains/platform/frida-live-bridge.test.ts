import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be before imports
// ---------------------------------------------------------------------------

const mockExecFileAsync = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());

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

type JsonTextResponse = { content: Array<{ text: string }> };
type RunnerResult = Awaited<ReturnType<ExternalToolRunner['run']>>;
type ProbeAllResult = Awaited<ReturnType<ExternalToolRunner['probeAll']>>;

function parsePayload(response: JsonTextResponse): Record<string, unknown> {
  return JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;
}

function makeRunner(): ExternalToolRunner {
  return {
    run: vi.fn<ExternalToolRunner['run']>(
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
    ),
    probeAll: vi.fn<ExternalToolRunner['probeAll']>(async () => ({}) as ProbeAllResult),
  } as unknown as ExternalToolRunner;
}

// ---------------------------------------------------------------------------
// Tests — Frida live bridge actions
// ---------------------------------------------------------------------------

describe('BridgeHandlers — Frida live actions', () => {
  let handlers: BridgeHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new BridgeHandlers(makeRunner());
  });

  describe('action = list_sessions', () => {
    it('should return session list', async () => {
      const result = parsePayload(await handlers.handleFridaBridge({ action: 'list_sessions' }));

      expect(result.success).toBe(true);
      expect(result.action).toBe('list_sessions');
      expect(typeof result.count).toBe('number');
      expect(Array.isArray(result.sessions)).toBe(true);
    });
  });

  describe('action = attach', () => {
    it('should error if frida CLI is not found', async () => {
      mockExecFileAsync.mockRejectedValueOnce(new Error('spawn frida ENOENT'));

      const result = parsePayload(
        await handlers.handleFridaBridge({ action: 'attach', pid: 1234 }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('frida CLI not found');
    });

    it('should require pid or processName', async () => {
      await expect(handlers.handleFridaBridge({ action: 'attach' })).rejects.toThrow(
        'pid or processName',
      );
    });

    it('should spawn frida and return session ID on successful attach', async () => {
      // Mock frida --version check
      mockExecFileAsync.mockResolvedValueOnce({ stdout: '16.1.0', stderr: '' });

      // Mock spawn to return a fake child process
      const mockStdout = { on: vi.fn() };
      const mockStderr = { on: vi.fn() };
      const mockStdin = { write: vi.fn() };
      const mockChild = {
        pid: 9999,
        stdout: mockStdout,
        stderr: mockStderr,
        stdin: mockStdin,
        on: vi.fn(),
        unref: vi.fn(),
      };
      mockSpawn.mockReturnValueOnce(mockChild);

      const result = parsePayload(
        await handlers.handleFridaBridge({ action: 'attach', pid: 1234 }),
      );

      expect(result.success).toBe(true);
      expect(result.action).toBe('attach');
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId as string).toContain('frida-1234');
      expect(mockSpawn).toHaveBeenCalledWith(
        'frida',
        ['-p', '1234', '--no-pause'],
        expect.any(Object),
      );
    });
  });

  describe('action = run_script (one-shot)', () => {
    it('should run script via frida CLI when no session exists', async () => {
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: '[+] Hooked!\nData captured\n',
        stderr: '',
      });

      const result = parsePayload(
        await handlers.handleFridaBridge({
          action: 'run_script',
          sessionId: 'nonexistent',
          script: 'console.log("test")',
          pid: 5678,
        }),
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('one-shot');
      expect(result.stdout as string).toContain('Hooked');
    });

    it('should error when no session and no pid/processName', async () => {
      const result = parsePayload(
        await handlers.handleFridaBridge({
          action: 'run_script',
          sessionId: 'nonexistent',
          script: 'test',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('action = detach', () => {
    it('should error for non-existent session', async () => {
      const result = parsePayload(
        await handlers.handleFridaBridge({
          action: 'detach',
          sessionId: 'nonexistent-session',
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('action = guide (updated)', () => {
    it('should include new actions in guide', async () => {
      const result = parsePayload(await handlers.handleFridaBridge({ action: 'guide' }));

      expect(result.success).toBe(true);
      const guide = result.guide as Record<string, unknown>;
      expect(guide.actions).toContain('attach');
      expect(guide.actions).toContain('run_script');
      expect(guide.actions).toContain('detach');
      expect(guide.actions).toContain('list_sessions');
    });
  });
});
