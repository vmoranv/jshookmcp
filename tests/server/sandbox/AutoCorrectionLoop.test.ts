import { describe, it, expect, vi } from 'vitest';
import { executeWithRetry } from '@server/sandbox/AutoCorrectionLoop';
import type { QuickJSSandbox } from '@server/sandbox/QuickJSSandbox';
import type { SandboxResult } from '@server/sandbox/types';

function createMockSandbox(results: SandboxResult[]): QuickJSSandbox {
  let callIndex = 0;
  return {
    execute: vi.fn().mockImplementation(async () => {
      const result = results[callIndex] ?? results[results.length - 1];
      callIndex++;
      return result;
    }),
  } as unknown as QuickJSSandbox;
}

const SUCCESS: SandboxResult = {
  ok: true,
  output: 42,
  timedOut: false,
  durationMs: 5,
  logs: [],
};

const ERROR: SandboxResult = {
  ok: false,
  error: 'ReferenceError: x is not defined',
  timedOut: false,
  durationMs: 3,
  logs: [],
};

const TIMEOUT: SandboxResult = {
  ok: false,
  error: 'Execution timed out',
  timedOut: true,
  durationMs: 1000,
  logs: [],
};

describe('AutoCorrectionLoop', () => {
  it('returns success on first try', async () => {
    const sandbox = createMockSandbox([SUCCESS]);
    const result = await executeWithRetry(sandbox, 'code', {});

    expect(result.ok).toBe(true);
    expect(result.retryCount).toBe(0);
    expect(sandbox.execute).toHaveBeenCalledTimes(1);
  });

  it('retries on error and appends context', async () => {
    const sandbox = createMockSandbox([ERROR, SUCCESS]);
    const result = await executeWithRetry(sandbox, 'x + 1', {});

    expect(result.ok).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(sandbox.execute).toHaveBeenCalledTimes(2);

    // Second call should include error context
    const secondCall = (sandbox.execute as ReturnType<typeof vi.fn>).mock.calls[1]!;
    expect(secondCall[0]).toContain('Previous error');
    expect(secondCall[0]).toContain('ReferenceError');
  });

  it('gives up after maxRetries', async () => {
    const sandbox = createMockSandbox([ERROR, ERROR, ERROR]);
    const result = await executeWithRetry(sandbox, 'bad code', {}, 2);

    expect(result.ok).toBe(false);
    expect(result.retryCount).toBe(2);
    expect(sandbox.execute).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry on timeout', async () => {
    const sandbox = createMockSandbox([TIMEOUT]);
    const result = await executeWithRetry(sandbox, 'while(true){}', {});

    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.retryCount).toBe(0);
    expect(sandbox.execute).toHaveBeenCalledTimes(1);
  });

  it('respects custom maxRetries', async () => {
    const sandbox = createMockSandbox([ERROR, ERROR, ERROR, ERROR, SUCCESS]);
    const result = await executeWithRetry(sandbox, 'code', {}, 4);

    expect(result.ok).toBe(true);
    expect(result.retryCount).toBe(4);
    expect(sandbox.execute).toHaveBeenCalledTimes(5);
  });

  it('retries with error then succeeds', async () => {
    const sandbox = createMockSandbox([ERROR, ERROR, SUCCESS]);
    const result = await executeWithRetry(sandbox, 'code', {}, 2);

    expect(result.ok).toBe(true);
    expect(result.retryCount).toBe(2);
  });
});
