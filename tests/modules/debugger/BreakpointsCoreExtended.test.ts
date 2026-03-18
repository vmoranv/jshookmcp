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

function makeCtx(overrides: Record<string, unknown> = {}) {
  const send = vi.fn(async () => ({ breakpointId: 'bp-default' }));
  const ctx: any = {
    enabled: true,
    cdpSession: { send },
    breakpoints: new Map(),
    ensureSession: vi.fn(async () => {
      ctx.enabled = true;
      ctx.cdpSession = { send };
    }),
    removeBreakpoint: vi.fn(async (id: string) => {
      ctx.breakpoints.delete(id);
    }),
    ...overrides,
  };
  return ctx;
}

describe('BreakpointsCoreExtended - conditional breakpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores condition string on URL-based conditional breakpoint', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-cond-1' });

    const bp = await setBreakpointByUrlCore(ctx, {
      url: 'https://example.com/app.js',
      lineNumber: 10,
      condition: 'i === 5',
    });

    expect(bp.condition).toBe('i === 5');
    expect(bp.enabled).toBe(true);
    expect(bp.hitCount).toBe(0);
    expect(ctx.breakpoints.get('bp-cond-1')?.condition).toBe('i === 5');
  });

  it('stores condition string on script-based conditional breakpoint', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-cond-2' });

    const bp = await setBreakpointCore(ctx, {
      scriptId: 'script-42',
      lineNumber: 20,
      condition: 'x > 100',
    });

    expect(bp.condition).toBe('x > 100');
    expect(bp.breakpointId).toBe('bp-cond-2');
  });

  it('creates breakpoint without condition when condition is undefined', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-no-cond' });

    const bp = await setBreakpointByUrlCore(ctx, {
      url: 'https://example.com/app.js',
      lineNumber: 5,
    });

    expect(bp.condition).toBeUndefined();
    expect(ctx.cdpSession.send).toHaveBeenCalledWith(
      'Debugger.setBreakpointByUrl',
      expect.objectContaining({ condition: undefined })
    );
  });
});

describe('BreakpointsCoreExtended - hit counts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes hitCount to 0 for URL breakpoints', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-hit' });

    const bp = await setBreakpointByUrlCore(ctx, {
      url: 'https://example.com/index.js',
      lineNumber: 1,
    });

    expect(bp.hitCount).toBe(0);
  });

  it('initializes hitCount to 0 for script breakpoints', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-script-hit' });

    const bp = await setBreakpointCore(ctx, {
      scriptId: 'script-1',
      lineNumber: 1,
    });

    expect(bp.hitCount).toBe(0);
  });

  it('records createdAt timestamp on breakpoint creation', async () => {
    const ctx = makeCtx();
    const before = Date.now();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-ts' });

    const bp = await setBreakpointByUrlCore(ctx, {
      url: 'https://example.com/app.js',
      lineNumber: 1,
    });

    expect(bp.createdAt).toBeGreaterThanOrEqual(before);
    expect(bp.createdAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('BreakpointsCoreExtended - breakpoint removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes a breakpoint from the map and sends CDP command', async () => {
    const send = vi.fn(async () => ({}));
    const ctx = makeCtx({ cdpSession: { send } });
    ctx.breakpoints.set('bp-rm', { breakpointId: 'bp-rm', enabled: true });

    await removeBreakpointCore(ctx, 'bp-rm');

    expect(send).toHaveBeenCalledWith('Debugger.removeBreakpoint', { breakpointId: 'bp-rm' });
    expect(ctx.breakpoints.has('bp-rm')).toBe(false);
  });

  it('throws when removing a breakpoint that does not exist', async () => {
    const ctx = makeCtx();

    await expect(removeBreakpointCore(ctx, 'nonexistent')).rejects.toThrow(
      'Breakpoint not found: nonexistent'
    );
  });

  it('throws when removing breakpoint with empty ID', async () => {
    const ctx = makeCtx();

    await expect(removeBreakpointCore(ctx, '')).rejects.toThrow(
      'breakpointId parameter is required'
    );
  });

  it('throws PrerequisiteError when debugger not enabled', async () => {
    const ctx = makeCtx({ enabled: false, cdpSession: null });

    await expect(removeBreakpointCore(ctx, 'bp-1')).rejects.toBeInstanceOf(PrerequisiteError);
  });

  it('propagates CDP error on removal failure', async () => {
    const send = vi.fn(async () => {
      throw new Error('CDP protocol error');
    });
    const ctx = makeCtx({ cdpSession: { send } });
    ctx.breakpoints.set('bp-fail', { breakpointId: 'bp-fail' });

    await expect(removeBreakpointCore(ctx, 'bp-fail')).rejects.toThrow('CDP protocol error');
    expect(loggerState.error).toHaveBeenCalled();
  });
});

describe('BreakpointsCoreExtended - error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws PrerequisiteError when auto-reconnect fails for setBreakpointByUrlCore', async () => {
    const ctx = makeCtx({
      enabled: false,
      cdpSession: null,
    });
    ctx.ensureSession = vi.fn(async () => {
      throw new Error('reconnect failed');
    });

    await expect(
      setBreakpointByUrlCore(ctx, { url: 'https://x.com/a.js', lineNumber: 0 })
    ).rejects.toBeInstanceOf(PrerequisiteError);
    expect(loggerState.warn).toHaveBeenCalledWith(expect.stringContaining('auto-reconnect failed'));
  });

  it('throws PrerequisiteError when auto-reconnect fails for setBreakpointCore', async () => {
    const ctx = makeCtx({
      enabled: false,
      cdpSession: null,
    });
    ctx.ensureSession = vi.fn(async () => {
      throw new Error('cannot reconnect');
    });

    await expect(setBreakpointCore(ctx, { scriptId: 's1', lineNumber: 0 })).rejects.toBeInstanceOf(
      PrerequisiteError
    );
  });

  it('logs warn with non-Error thrown from ensureSession', async () => {
    const ctx = makeCtx({
      enabled: false,
      cdpSession: null,
    });
    ctx.ensureSession = vi.fn(async () => {
      throw 'string error';
    });

    await expect(
      setBreakpointByUrlCore(ctx, { url: 'https://x.com/a.js', lineNumber: 0 })
    ).rejects.toBeInstanceOf(PrerequisiteError);
    expect(loggerState.warn).toHaveBeenCalledWith(expect.stringContaining('string error'));
  });

  it('validates negative lineNumber for setBreakpointByUrlCore', async () => {
    const ctx = makeCtx();

    await expect(
      setBreakpointByUrlCore(ctx, { url: 'https://x.com/a.js', lineNumber: -1 })
    ).rejects.toThrow('lineNumber must be a non-negative number');
  });

  it('validates negative columnNumber for setBreakpointByUrlCore', async () => {
    const ctx = makeCtx();

    await expect(
      setBreakpointByUrlCore(ctx, { url: 'https://x.com/a.js', lineNumber: 1, columnNumber: -5 })
    ).rejects.toThrow('columnNumber must be a non-negative number');
  });

  it('validates empty scriptId for setBreakpointCore', async () => {
    const ctx = makeCtx();

    await expect(setBreakpointCore(ctx, { scriptId: '', lineNumber: 1 })).rejects.toThrow(
      'scriptId parameter is required'
    );
  });

  it('validates negative columnNumber for setBreakpointCore', async () => {
    const ctx = makeCtx();

    await expect(
      setBreakpointCore(ctx, { scriptId: 's1', lineNumber: 1, columnNumber: -3 })
    ).rejects.toThrow('columnNumber must be a non-negative number');
  });

  it('propagates CDP send error for setBreakpointByUrlCore', async () => {
    const send = vi.fn(async () => {
      throw new Error('Protocol method not found');
    });
    const ctx = makeCtx({ cdpSession: { send } });

    await expect(
      setBreakpointByUrlCore(ctx, { url: 'https://x.com/a.js', lineNumber: 1 })
    ).rejects.toThrow('Protocol method not found');
    expect(loggerState.error).toHaveBeenCalledWith('Failed to set breakpoint:', expect.any(Error));
  });

  it('propagates CDP send error for setBreakpointCore', async () => {
    const send = vi.fn(async () => {
      throw new Error('Session closed');
    });
    const ctx = makeCtx({ cdpSession: { send } });

    await expect(setBreakpointCore(ctx, { scriptId: 's1', lineNumber: 1 })).rejects.toThrow(
      'Session closed'
    );
  });
});

describe('BreakpointsCoreExtended - list and get', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array from listBreakpointsCore when no breakpoints exist', () => {
    const ctx = makeCtx();
    expect(listBreakpointsCore(ctx)).toEqual([]);
  });

  it('returns all breakpoints from listBreakpointsCore', () => {
    const ctx = makeCtx();
    ctx.breakpoints.set('bp-a', { breakpointId: 'bp-a', hitCount: 0 });
    ctx.breakpoints.set('bp-b', { breakpointId: 'bp-b', hitCount: 1 });

    const list = listBreakpointsCore(ctx);
    expect(list).toHaveLength(2);
    expect(list.map((b: any) => b.breakpointId)).toEqual(['bp-a', 'bp-b']);
  });

  it('returns undefined from getBreakpointCore for non-existent ID', () => {
    const ctx = makeCtx();
    expect(getBreakpointCore(ctx, 'missing')).toBeUndefined();
  });

  it('returns the correct breakpoint from getBreakpointCore', () => {
    const ctx = makeCtx();
    const info = { breakpointId: 'bp-x', hitCount: 5 };
    ctx.breakpoints.set('bp-x', info);

    expect(getBreakpointCore(ctx, 'bp-x')).toBe(info);
  });
});

describe('BreakpointsCoreExtended - clearAllBreakpointsCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls removeBreakpoint for every breakpoint in the map', async () => {
    const removed: string[] = [];
    const ctx = makeCtx();
    ctx.breakpoints.set('bp-1', { breakpointId: 'bp-1' });
    ctx.breakpoints.set('bp-2', { breakpointId: 'bp-2' });
    ctx.breakpoints.set('bp-3', { breakpointId: 'bp-3' });
    ctx.removeBreakpoint = vi.fn(async (id: string) => {
      removed.push(id);
    });

    await clearAllBreakpointsCore(ctx);

    expect(removed).toEqual(['bp-1', 'bp-2', 'bp-3']);
    expect(loggerState.info).toHaveBeenCalledWith('Cleared 3 breakpoints');
  });

  it('does nothing when breakpoints map is empty', async () => {
    const ctx = makeCtx();

    await clearAllBreakpointsCore(ctx);

    expect(ctx.removeBreakpoint).not.toHaveBeenCalled();
    expect(loggerState.info).toHaveBeenCalledWith('Cleared 0 breakpoints');
  });
});

describe('BreakpointsCoreExtended - columnNumber edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes columnNumber=0 for URL breakpoints without error', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-col0' });

    const bp = await setBreakpointByUrlCore(ctx, {
      url: 'https://x.com/app.js',
      lineNumber: 5,
      columnNumber: 0,
    });

    expect(bp.location.columnNumber).toBe(0);
    expect(ctx.cdpSession.send).toHaveBeenCalledWith(
      'Debugger.setBreakpointByUrl',
      expect.objectContaining({ columnNumber: 0 })
    );
  });

  it('passes columnNumber=0 for script breakpoints without error', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-col0-s' });

    const bp = await setBreakpointCore(ctx, {
      scriptId: 's1',
      lineNumber: 5,
      columnNumber: 0,
    });

    expect(bp.location.columnNumber).toBe(0);
  });

  it('stores location with scriptId for script breakpoints', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-loc' });

    const bp = await setBreakpointCore(ctx, {
      scriptId: 'script-99',
      lineNumber: 42,
      columnNumber: 7,
    });

    expect(bp.location).toEqual({
      scriptId: 'script-99',
      lineNumber: 42,
      columnNumber: 7,
    });
  });

  it('stores location with url for URL breakpoints', async () => {
    const ctx = makeCtx();
    ctx.cdpSession.send.mockResolvedValueOnce({ breakpointId: 'bp-uloc' });

    const bp = await setBreakpointByUrlCore(ctx, {
      url: 'https://example.com/bundle.js',
      lineNumber: 100,
      columnNumber: 15,
    });

    expect(bp.location).toEqual({
      url: 'https://example.com/bundle.js',
      lineNumber: 100,
      columnNumber: 15,
    });
  });
});
