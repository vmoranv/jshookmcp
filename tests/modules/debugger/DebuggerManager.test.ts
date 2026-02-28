import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { DebuggerManager } from '../../../src/modules/debugger/DebuggerManager.js';

function createMockCDPSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  const send = vi.fn(async (method: string) => {
    if (method === 'Debugger.setBreakpointByUrl') {
      return { breakpointId: 'bp-url-1' };
    }
    if (method === 'Debugger.setBreakpoint') {
      return { breakpointId: 'bp-script-1' };
    }
    if (method === 'Runtime.getProperties') {
      return { result: [] };
    }
    return {};
  });
  const on = vi.fn((event: string, handler: (payload: any) => void) => {
    const group = listeners.get(event) ?? new Set();
    group.add(handler);
    listeners.set(event, group);
  });
  const off = vi.fn((event: string, handler: (payload: any) => void) => {
    listeners.get(event)?.delete(handler);
  });
  const detach = vi.fn().mockResolvedValue(undefined);
  const emit = (event: string, payload: any) => {
    listeners.get(event)?.forEach((handler) => void handler(payload));
  };

  return {
    session: { send, on, off, detach } as any,
    send,
    off,
    detach,
    emit,
  };
}

function pausedPayload(hitBreakpoints: string[] = []) {
  return {
    reason: 'other',
    hitBreakpoints,
    callFrames: [
      {
        callFrameId: 'cf-1',
        functionName: 'main',
        location: { scriptId: 's1', lineNumber: 10, columnNumber: 2 },
        url: 'https://site/app.js',
        scopeChain: [],
        this: {},
      },
    ],
  };
}

describe('DebuggerManager', () => {
  let cdp: ReturnType<typeof createMockCDPSession>;
  let manager: DebuggerManager;
  let collector: any;

  beforeEach(() => {
    cdp = createMockCDPSession();
    const page = { createCDPSession: vi.fn().mockResolvedValue(cdp.session) };
    collector = { getActivePage: vi.fn().mockResolvedValue(page) };
    manager = new DebuggerManager(collector);
  });

  it('initializes debugger and registers CDP listeners', async () => {
    await manager.init();

    expect(cdp.send).toHaveBeenCalledWith('Debugger.enable');
    expect(manager.isEnabled()).toBe(true);
    expect(cdp.session.on).toHaveBeenCalledWith('Debugger.paused', expect.any(Function));
    expect(cdp.session.on).toHaveBeenCalledWith('Debugger.resumed', expect.any(Function));
  });

  it('sets breakpoint by url and persists it in manager state', async () => {
    await manager.init();
    const bp = await manager.setBreakpointByUrl({
      url: 'https://site/app.js',
      lineNumber: 12,
      condition: 'x > 1',
    });

    expect(bp.breakpointId).toBe('bp-url-1');
    expect(manager.listBreakpoints()).toHaveLength(1);
    expect(manager.getBreakpoint('bp-url-1')?.condition).toBe('x > 1');
  });

  it('rejects removing a breakpoint that does not exist', async () => {
    await manager.init();
    await expect(manager.removeBreakpoint('missing-bp')).rejects.toThrow('Breakpoint not found');
  });

  it('waitForPaused resolves when paused event arrives', async () => {
    await manager.init();
    const waiting = manager.waitForPaused(1000);

    cdp.emit('Debugger.paused', pausedPayload());
    const state = await waiting;

    expect(state.reason).toBe('other');
    expect(state.callFrames[0]?.functionName).toBe('main');
    expect(manager.isPaused()).toBe(true);
  });

  it('increments hit count and invokes breakpoint-hit callbacks', async () => {
    await manager.init();
    await manager.setBreakpointByUrl({ url: 'https://site/app.js', lineNumber: 10 });

    const callback = vi.fn();
    manager.onBreakpointHit(callback);

    cdp.emit('Debugger.paused', pausedPayload(['bp-url-1']));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.getBreakpoint('bp-url-1')?.hitCount).toBe(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('disables debugger and detaches session during cleanup', async () => {
    await manager.init();
    await manager.disable();

    expect(cdp.send).toHaveBeenCalledWith('Debugger.disable');
    expect(cdp.detach).toHaveBeenCalled();
    expect(manager.isEnabled()).toBe(false);
  });
});

