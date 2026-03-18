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
  clearAllBreakpointsCore,
  getBreakpointCore,
  listBreakpointsCore,
  removeBreakpointCore,
  setBreakpointByUrlCore,
  setBreakpointCore,
} from '@modules/debugger/DebuggerManager.impl.core.breakpoints';

describe('DebuggerManager breakpoint core helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-reconnects and stores breakpoints created by url and script id', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ breakpointId: 'bp-url' })
      .mockResolvedValueOnce({ breakpointId: 'bp-script' });
    const ctx: any = {
      enabled: false,
      cdpSession: null,
      breakpoints: new Map(),
      ensureSession: vi.fn(async () => {
        ctx.enabled = true;
        ctx.cdpSession = { send };
      }),
      removeBreakpoint: vi.fn(),
    };

    const byUrl = await setBreakpointByUrlCore(ctx, {
      url: 'https://example.com/app.js',
      lineNumber: 4,
      condition: 'x > 1',
    });
    const byScript = await setBreakpointCore(ctx, {
      scriptId: 'script-1',
      lineNumber: 8,
      columnNumber: 2,
    });

    expect(byUrl.breakpointId).toBe('bp-url');
    expect(byScript.breakpointId).toBe('bp-script');
    expect(getBreakpointCore(ctx, 'bp-url')?.condition).toBe('x > 1');
    expect(listBreakpointsCore(ctx)).toHaveLength(2);
  });

  it('validates breakpoint params and removal preconditions', async () => {
    const ctx: any = {
      enabled: true,
      cdpSession: { send: vi.fn(async () => ({})) },
      breakpoints: new Map(),
      ensureSession: vi.fn(),
      removeBreakpoint: vi.fn(),
    };

    await expect(setBreakpointByUrlCore(ctx, { url: '', lineNumber: 1 })).rejects.toThrow(
      'url parameter is required'
    );
    await expect(setBreakpointCore(ctx, { scriptId: 's', lineNumber: -1 })).rejects.toThrow(
      'lineNumber must be a non-negative number'
    );
    await expect(removeBreakpointCore(ctx, 'missing')).rejects.toThrow('Breakpoint not found');

    ctx.enabled = false;
    await expect(removeBreakpointCore(ctx, 'bp')).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('removes and clears breakpoints through the context callbacks', async () => {
    const send = vi.fn(async () => ({}));
    const removed: string[] = [];
    const ctx: any = {
      enabled: true,
      cdpSession: { send },
      breakpoints: new Map([
        ['bp-1', { breakpointId: 'bp-1' }],
        ['bp-2', { breakpointId: 'bp-2' }],
      ]),
      ensureSession: vi.fn(),
      removeBreakpoint: vi.fn(async (id: string) => {
        removed.push(id);
        ctx.breakpoints.delete(id);
      }),
    };

    await removeBreakpointCore(
      {
        ...ctx,
        breakpoints: new Map([['bp-1', { breakpointId: 'bp-1' }]]),
      },
      'bp-1'
    );
    await clearAllBreakpointsCore(ctx);

    expect(removed).toEqual(['bp-1', 'bp-2']);
  });
});
