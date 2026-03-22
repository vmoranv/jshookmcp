import { describe, it, expect, vi, beforeEach } from 'vitest';

const classMocks = vi.hoisted(() => {
  const createManagerClass = () =>
    class {
      public session: unknown;
      public close = vi.fn().mockResolvedValue(undefined);
      public clearAll = vi.fn();

      constructor(session: unknown) {
        this.session = session;
      }
    };

  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
    },
    WatchExpressionManager: createManagerClass(),
    XHRBreakpointManager: createManagerClass(),
    EventBreakpointManager: createManagerClass(),
    BlackboxManager: createManagerClass(),
    DebuggerSessionManager: class {
      public exportSession = vi.fn().mockReturnValue({ metadata: {} });
      public saveSession = vi.fn().mockResolvedValue('session.json');
      public loadSessionFromFile = vi.fn().mockResolvedValue(undefined);
      public importSession = vi.fn().mockResolvedValue(undefined);
      public listSavedSessions = vi.fn().mockResolvedValue([]);

      constructor(_manager: unknown) {}
    },
  };
});

vi.mock('@utils/logger', () => ({
  logger: classMocks.logger,
}));

vi.mock('@modules/debugger/WatchExpressionManager', () => ({
  WatchExpressionManager: classMocks.WatchExpressionManager,
}));

vi.mock('@modules/debugger/XHRBreakpointManager', () => ({
  XHRBreakpointManager: classMocks.XHRBreakpointManager,
}));

vi.mock('@modules/debugger/EventBreakpointManager', () => ({
  EventBreakpointManager: classMocks.EventBreakpointManager,
}));

vi.mock('@modules/debugger/BlackboxManager', () => ({
  BlackboxManager: classMocks.BlackboxManager,
}));

vi.mock('@modules/debugger/DebuggerSessionManager', () => ({
  DebuggerSessionManager: classMocks.DebuggerSessionManager,
}));

import { DebuggerManager } from '@modules/debugger/DebuggerManager.impl.core.class';

function createCDPSession() {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();

  return {
    session: {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: (payload?: unknown) => void) => {
        listeners.get(event)?.delete(handler);
      }),
      detach: vi.fn().mockResolvedValue(undefined),
      emit(event: string, payload?: unknown) {
        listeners.get(event)?.forEach((handler) => handler(payload));
      },
    },
    listeners,
  };
}

describe('DebuggerManager core class internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes advanced feature managers and tracks the active session', async () => {
    const cdp = createCDPSession();
    const collector = {
      getActivePage: vi.fn().mockResolvedValue({
        createCDPSession: vi.fn().mockResolvedValue(cdp.session),
      }),
    };
    const manager = new DebuggerManager(collector as never);
    const runtimeInspector = { inspect: vi.fn() };

    await manager.init();
    await manager.initAdvancedFeatures(runtimeInspector as never);

    expect(manager.getWatchManager()).toBeInstanceOf(classMocks.WatchExpressionManager);
    expect(manager.getXHRManager()).toBeInstanceOf(classMocks.XHRBreakpointManager);
    expect(manager.getEventManager()).toBeInstanceOf(classMocks.EventBreakpointManager);
    expect(manager.getBlackboxManager()).toBeInstanceOf(classMocks.BlackboxManager);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((manager as any).advancedFeatureSession).toBe(cdp.session);
  });

  it('marks itself disconnected and clears advanced managers on session disconnect', async () => {
    const cdp = createCDPSession();
    const collector = {
      getActivePage: vi.fn().mockResolvedValue({
        createCDPSession: vi.fn().mockResolvedValue(cdp.session),
      }),
    };
    const manager = new DebuggerManager(collector as never);

    await manager.init();
    await manager.initAdvancedFeatures({ inspect: vi.fn() } as never);
    cdp.session.emit('disconnected');

    expect(manager.isEnabled()).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((manager as any).cdpSession).toBeNull();
    expect((manager as unknown).advancedFeatureSession).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((manager as any)._xhrManager).toBeNull();
    expect((manager as unknown)._eventManager).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((manager as any)._blackboxManager).toBeNull();
  });

  it('reinitializes advanced features when the session changed or managers are missing', async () => {
    const collector = {
      getActivePage: vi.fn(),
    };
    const manager = new DebuggerManager(collector as never);
    const currentSession = { send: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (manager as any).cdpSession = currentSession;
    (manager as unknown).advancedFeatureSession = { send: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (manager as any)._xhrManager = null;
    (manager as unknown)._eventManager = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (manager as any)._blackboxManager = {};

    const ensureSessionSpy = vi.spyOn(manager, 'ensureSession').mockResolvedValue(undefined);
    const initAdvancedSpy = vi
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .spyOn(manager as any, 'initAdvancedFeatures')
      .mockResolvedValue(undefined);

    await manager.ensureAdvancedFeatures();

    expect(ensureSessionSpy).toHaveBeenCalledTimes(1);
    expect(initAdvancedSpy).toHaveBeenCalledTimes(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (manager as any).advancedFeatureSession = currentSession;
    (manager as unknown)._xhrManager = {};
    initAdvancedSpy.mockClear();

    await manager.ensureAdvancedFeatures();
    expect(initAdvancedSpy).not.toHaveBeenCalled();
  });

  it('normalizes paused and breakpoint-resolved event payloads defensively', () => {
    const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const paused = (manager as any).normalizePausedEventParams({
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: 42,
          location: {
            scriptId: 'script-1',
            lineNumber: 'bad',
          },
          url: null,
          scopeChain: [
            {
              type: 'mystery',
              object: {},
              name: 10,
              startLocation: { scriptId: 1 },
            },
          ],
          this: 'self',
        },
      ],
      reason: 10,
      data: { ok: true },
      hitBreakpoints: ['bp-1', 2],
    });

    expect(paused).toEqual({
      callFrames: [
        {
          callFrameId: 'cf-1',
          functionName: '',
          location: {
            scriptId: 'script-1',
            lineNumber: 0,
            columnNumber: 0,
          },
          url: '',
          scopeChain: [
            {
              type: 'local',
              object: {
                type: 'object',
                objectId: undefined,
                className: undefined,
                description: undefined,
              },
              name: undefined,
              startLocation: {
                scriptId: '',
                lineNumber: 0,
                columnNumber: 0,
              },
              endLocation: undefined,
            },
          ],
          this: 'self',
        },
      ],
      reason: 'unknown',
      data: { ok: true },
      hitBreakpoints: ['bp-1'],
    });

    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (manager as any).normalizeBreakpointResolvedParams({
        breakpointId: 5,
        location: { scriptId: 'script-1' },
      })
    ).toEqual({
      breakpointId: '',
      location: { scriptId: 'script-1' },
    });
  });

  it('calls disable during close when enabled and detaches residual sessions', async () => {
    const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);
    const detach = vi.fn().mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (manager as any).enabled = true;
    (manager as unknown).cdpSession = { detach };
    const disableSpy = vi.spyOn(manager, 'disable').mockResolvedValue(undefined);

    await manager.close();

    expect(disableSpy).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledTimes(1);

    const secondManager = new DebuggerManager({ getActivePage: vi.fn() } as never);
    const secondDetach = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (secondManager as any).cdpSession = { detach: secondDetach };

    await secondManager.close();

    expect(secondDetach).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect((secondManager as any).cdpSession).toBeNull();
  });
});
