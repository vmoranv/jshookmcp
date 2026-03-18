import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { PrerequisiteError } from '@errors/PrerequisiteError';
import {
  evaluateOnCallFrameCore,
  getPauseOnExceptionsStateCore,
  getPausedStateCore,
  isPausedCore,
  pauseCore,
  resumeCore,
  setPauseOnExceptionsCore,
  stepIntoCore,
  stepOutCore,
  stepOverCore,
  waitForPausedCore,
} from '@modules/debugger/DebuggerManager.impl.core.execution';

describe('DebuggerManager execution core helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates pause-on-exception state and issues pause/resume/step commands', async () => {
    const send = vi.fn(async () => ({}));
    const ctx: any = {
      enabled: true,
      cdpSession: { send },
      pauseOnExceptionsState: 'none',
      pausedState: null,
      pausedResolvers: [],
    };

    await setPauseOnExceptionsCore(ctx, 'all');
    await pauseCore(ctx);
    await resumeCore(ctx);
    await stepIntoCore(ctx);
    await stepOverCore(ctx);
    await stepOutCore(ctx);

    expect(getPauseOnExceptionsStateCore(ctx)).toBe('all');
    expect(send).toHaveBeenCalledWith('Debugger.setPauseOnExceptions', { state: 'all' });
    expect(send).toHaveBeenCalledWith('Debugger.pause');
    expect(send).toHaveBeenCalledWith('Debugger.resume');
    expect(send).toHaveBeenCalledWith('Debugger.stepInto');
    expect(send).toHaveBeenCalledWith('Debugger.stepOver');
    expect(send).toHaveBeenCalledWith('Debugger.stepOut');
  });

  it('reports pause state and evaluates expressions on a paused call frame', async () => {
    const send = vi.fn(async (method: string) =>
      method === 'Debugger.evaluateOnCallFrame' ? { result: { value: 42 } } : {}
    );
    const pausedState = {
      reason: 'other',
      callFrames: [{ callFrameId: 'cf-1' }],
      timestamp: 1,
    };
    const ctx: any = {
      enabled: true,
      cdpSession: { send },
      pauseOnExceptionsState: 'none',
      pausedState,
      pausedResolvers: [],
    };

    expect(getPausedStateCore(ctx)).toBe(pausedState);
    expect(isPausedCore(ctx)).toBe(true);
    await expect(waitForPausedCore(ctx, 5)).resolves.toBe(pausedState);
    await expect(
      evaluateOnCallFrameCore(ctx, {
        callFrameId: 'cf-1',
        expression: '21 * 2',
      })
    ).resolves.toEqual({ value: 42 });
  });

  it('throws prerequisite errors when execution APIs are used without a debugger or pause state', async () => {
    const ctx: any = {
      enabled: false,
      cdpSession: null,
      pauseOnExceptionsState: 'none',
      pausedState: null,
      pausedResolvers: [],
    };

    await expect(pauseCore(ctx)).rejects.toBeInstanceOf(PrerequisiteError);
    await expect(waitForPausedCore(ctx)).rejects.toBeInstanceOf(PrerequisiteError);

    ctx.enabled = true;
    ctx.cdpSession = { send: vi.fn(async () => ({})) };
    await expect(
      evaluateOnCallFrameCore(ctx, {
        callFrameId: 'cf-1',
        expression: 'x',
      })
    ).rejects.toBeInstanceOf(PrerequisiteError);
  });
});
