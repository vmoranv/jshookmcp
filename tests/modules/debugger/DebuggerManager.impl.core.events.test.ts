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

import {
  clearBreakpointHitCallbacksCore,
  getBreakpointHitCallbackCountCore,
  handleBreakpointResolvedCore,
  handlePausedCore,
  handleResumedCore,
  offBreakpointHitCore,
  onBreakpointHitCore,
} from '@modules/debugger/DebuggerManager.impl.core.events';

describe('DebuggerManager event core helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers callbacks and dispatches breakpoint hit events with variables', async () => {
    const callback = vi.fn();
    let resolvedState: any;
    const ctx: any = {
      breakpointHitCallbacks: new Set(),
      breakpoints: new Map([['bp-1', { breakpointId: 'bp-1', hitCount: 0 }]]),
      pausedState: null,
      pausedResolvers: [(state: unknown) => (resolvedState = state)],
      getScopeVariables: vi.fn(async () => ({
        variables: [{ name: 'token', value: 'abc', type: 'string' }],
      })),
    };

    onBreakpointHitCore(ctx, callback);
    expect(getBreakpointHitCallbackCountCore(ctx)).toBe(1);

    await handlePausedCore(ctx, {
      reason: 'other',
      hitBreakpoints: ['bp-1'],
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 'main',
          location: { scriptId: 'script-1', lineNumber: 10, columnNumber: 1 },
          url: 'https://example.com/app.js',
          scopeChain: [],
          this: {},
        },
      ],
    });

    expect(ctx.breakpoints.get('bp-1')?.hitCount).toBe(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        breakpointId: 'bp-1',
        variables: [{ name: 'token', value: 'abc', type: 'string' }],
      })
    );
    expect(resolvedState.reason).toBe('other');
    expect(ctx.pausedResolvers).toEqual([]);
  });

  it('supports unregistering callbacks and clearing paused state', () => {
    const callback = vi.fn();
    const ctx: any = {
      breakpointHitCallbacks: new Set<unknown>([callback]),
      breakpoints: new Map(),
      pausedState: { reason: 'other' },
      pausedResolvers: [],
      getScopeVariables: vi.fn(),
    };

    offBreakpointHitCore(ctx, callback);
    expect(getBreakpointHitCallbackCountCore(ctx)).toBe(0);

    clearBreakpointHitCallbacksCore(ctx);
    handleResumedCore(ctx);
    handleBreakpointResolvedCore(ctx, { breakpointId: 'missing' });

    expect(ctx.pausedState).toBeNull();
  });
});
