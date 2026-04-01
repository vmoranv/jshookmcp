import { describe, it, expect, vi, beforeEach } from 'vitest';

const classMocks = vi.hoisted(() => {
  const createManagerClass = () =>
    class {
      public session: any;
      public close = vi.fn().mockResolvedValue(undefined);
      public clearAll = vi.fn();

      constructor(session: any) {
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
    },
    setBreakpointByUrlCore: vi.fn().mockResolvedValue({ breakpointId: 'bp-1' }),
    setBreakpointCore: vi.fn().mockResolvedValue({ breakpointId: 'bp-2' }),
    removeBreakpointCore: vi.fn().mockResolvedValue(undefined),
    listBreakpointsCore: vi.fn().mockReturnValue([]),
    getBreakpointCore: vi.fn().mockReturnValue(undefined),
    clearAllBreakpointsCore: vi.fn().mockResolvedValue(undefined),
    setPauseOnExceptionsCore: vi.fn().mockResolvedValue(undefined),
    getPauseOnExceptionsStateCore: vi.fn().mockReturnValue('none'),
    pauseCore: vi.fn().mockResolvedValue(undefined),
    resumeCore: vi.fn().mockResolvedValue(undefined),
    stepIntoCore: vi.fn().mockResolvedValue(undefined),
    stepOutCore: vi.fn().mockResolvedValue(undefined),
    stepOverCore: vi.fn().mockResolvedValue(undefined),
    getPausedStateCore: vi.fn().mockReturnValue(null),
    isPausedCore: vi.fn().mockReturnValue(false),
    waitForPausedCore: vi.fn().mockResolvedValue({ reason: 'test', callFrames: [], timestamp: 0 }),
    evaluateOnCallFrameCore: vi.fn().mockResolvedValue({ value: 'test' }),
    getScopeVariablesCore: vi.fn().mockResolvedValue({ variables: [] }),
    getObjectPropertiesByIdCore: vi.fn().mockResolvedValue([]),
    getObjectPropertiesCore: vi.fn().mockResolvedValue([]),
    onBreakpointHitCore: vi.fn(),
    offBreakpointHitCore: vi.fn(),
    clearBreakpointHitCallbacksCore: vi.fn(),
    getBreakpointHitCallbackCountCore: vi.fn().mockReturnValue(0),
    handlePausedCore: vi.fn().mockResolvedValue(undefined),
    handleResumedCore: vi.fn(),
    handleBreakpointResolvedCore: vi.fn(),
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

vi.mock('@modules/debugger/DebuggerManager.impl.core.breakpoints', () => ({
  setBreakpointByUrlCore: classMocks.setBreakpointByUrlCore,
  setBreakpointCore: classMocks.setBreakpointCore,
  removeBreakpointCore: classMocks.removeBreakpointCore,
  listBreakpointsCore: classMocks.listBreakpointsCore,
  getBreakpointCore: classMocks.getBreakpointCore,
  clearAllBreakpointsCore: classMocks.clearAllBreakpointsCore,
}));

vi.mock('@modules/debugger/DebuggerManager.impl.core.execution', () => ({
  setPauseOnExceptionsCore: classMocks.setPauseOnExceptionsCore,
  getPauseOnExceptionsStateCore: classMocks.getPauseOnExceptionsStateCore,
  pauseCore: classMocks.pauseCore,
  resumeCore: classMocks.resumeCore,
  stepIntoCore: classMocks.stepIntoCore,
  stepOutCore: classMocks.stepOutCore,
  stepOverCore: classMocks.stepOverCore,
  getPausedStateCore: classMocks.getPausedStateCore,
  isPausedCore: classMocks.isPausedCore,
  waitForPausedCore: classMocks.waitForPausedCore,
  evaluateOnCallFrameCore: classMocks.evaluateOnCallFrameCore,
}));

vi.mock('@modules/debugger/DebuggerManager.impl.core.scope', () => ({
  getScopeVariablesCore: classMocks.getScopeVariablesCore,
  getObjectPropertiesByIdCore: classMocks.getObjectPropertiesByIdCore,
  getObjectPropertiesCore: classMocks.getObjectPropertiesCore,
}));

vi.mock('@modules/debugger/DebuggerManager.impl.core.events', () => ({
  onBreakpointHitCore: classMocks.onBreakpointHitCore,
  offBreakpointHitCore: classMocks.offBreakpointHitCore,
  clearBreakpointHitCallbacksCore: classMocks.clearBreakpointHitCallbacksCore,
  getBreakpointHitCallbackCountCore: classMocks.getBreakpointHitCallbackCountCore,
  handlePausedCore: classMocks.handlePausedCore,
  handleResumedCore: classMocks.handleResumedCore,
  handleBreakpointResolvedCore: classMocks.handleBreakpointResolvedCore,
}));

import { DebuggerManager } from '@modules/debugger/DebuggerManager.impl.core.class';

function createCDPSession() {
  const listeners = new Map<string, Set<(payload?: any) => void>>();

  return {
    session: {
      send: vi.fn().mockResolvedValue({}),
      on: vi.fn((event: string, handler: (payload?: any) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(handler);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, handler: (payload?: any) => void) => {
        listeners.get(event)?.delete(handler);
      }),
      detach: vi.fn().mockResolvedValue(undefined),
      emit(event: string, payload?: any) {
        listeners.get(event)?.forEach((handler) => handler(payload));
      },
    },
    listeners,
  };
}

function createCollector(session: any) {
  return {
    getActivePage: vi.fn().mockResolvedValue({
      createCDPSession: vi.fn().mockResolvedValue(session),
    }),
  };
}

describe('DebuggerManager.impl.core.class additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mock returns after clearAllMocks
    classMocks.setBreakpointByUrlCore.mockResolvedValue({ breakpointId: 'bp-1' });
    classMocks.setBreakpointCore.mockResolvedValue({ breakpointId: 'bp-2' });
    classMocks.listBreakpointsCore.mockReturnValue([]);
    classMocks.getPauseOnExceptionsStateCore.mockReturnValue('none');
    classMocks.getPausedStateCore.mockReturnValue(null);
    classMocks.isPausedCore.mockReturnValue(false);
    classMocks.waitForPausedCore.mockResolvedValue({
      reason: 'test',
      callFrames: [],
      timestamp: 0,
    });
    classMocks.evaluateOnCallFrameCore.mockResolvedValue({ value: 'test' });
    classMocks.getScopeVariablesCore.mockResolvedValue({ variables: [] });
    classMocks.getObjectPropertiesByIdCore.mockResolvedValue([]);
    classMocks.getObjectPropertiesCore.mockResolvedValue([]);
    classMocks.getBreakpointHitCallbackCountCore.mockReturnValue(0);
  });

  describe('init() behavior', () => {
    it('only initializes once even when called multiple times', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      await Promise.all([manager.init(), manager.init(), manager.init()]);

      expect(cdp.session.send).toHaveBeenCalledWith('Debugger.enable');
      expect(cdp.session.send).toHaveBeenCalledTimes(1);
    });

    it('throws error if init fails', async () => {
      const collector = {
        getActivePage: vi.fn().mockRejectedValue(new Error('No page')),
      };
      const manager = new DebuggerManager(collector as never);

      await expect(manager.init()).rejects.toThrow('No page');
      expect(classMocks.logger.error).toHaveBeenCalled();
    });
  });

  describe('enable() alias', () => {
    it('calls init()', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      await manager.enable();

      expect(manager.isEnabled()).toBe(true);
    });
  });

  describe('getCDPSession()', () => {
    it('throws when debugger not enabled', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      expect(() => manager.getCDPSession()).toThrow('Debugger not enabled');
    });

    it('returns session when enabled', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      await manager.init();
      const session = manager.getCDPSession();

      expect(session).toBe(cdp.session);
    });
  });

  describe('getBreakpoints()', () => {
    it('returns readonly map of breakpoints', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);
      const breakpoints = manager.getBreakpoints();

      expect(breakpoints).toBeInstanceOf(Map);
      expect(breakpoints.size).toBe(0);
    });
  });

  describe('manager getters without initialization', () => {
    it('getWatchManager throws when not initialized', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      expect(() => manager.getWatchManager()).toThrow('WatchExpressionManager not initialized');
    });

    it('getXHRManager throws when not initialized', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      expect(() => manager.getXHRManager()).toThrow('XHRBreakpointManager not initialized');
    });

    it('getEventManager throws when not initialized', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      expect(() => manager.getEventManager()).toThrow('EventBreakpointManager not initialized');
    });

    it('getBlackboxManager throws when not initialized', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      expect(() => manager.getBlackboxManager()).toThrow('BlackboxManager not initialized');
    });
  });

  describe('initAdvancedFeatures()', () => {
    it('throws when debugger not enabled', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await expect(manager.initAdvancedFeatures()).rejects.toThrow(
        'Debugger must be enabled before initializing advanced features',
      );
    });

    it('initializes managers without runtimeInspector', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      await manager.init();
      await manager.initAdvancedFeatures();

      // WatchManager should not be initialized without runtimeInspector
      expect(() => manager.getWatchManager()).toThrow();
      // But other managers should be initialized
      expect(manager.getXHRManager()).toBeDefined();
      expect(manager.getEventManager()).toBeDefined();
      expect(manager.getBlackboxManager()).toBeDefined();
    });
  });

  describe('ensureSession()', () => {
    it('reinitializes when not enabled', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      expect(manager.isSessionConnected()).toBe(false);

      await manager.ensureSession();

      expect(manager.isSessionConnected()).toBe(true);
    });
  });

  describe('ensureAdvancedFeatures()', () => {
    it('throws when session unavailable after reconnect attempt', async () => {
      const manager = new DebuggerManager({
        getActivePage: vi.fn().mockRejectedValue(new Error('No page')),
      } as never);

      vi.spyOn(manager, 'ensureSession').mockResolvedValue(undefined);
      (manager as any).cdpSession = null;

      await expect(manager.ensureAdvancedFeatures()).rejects.toThrow(
        'CDP session unavailable after reconnect',
      );
    });
  });

  describe('disable() behavior', () => {
    it('warns when debugger not enabled', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.disable();

      expect(classMocks.logger.warn).toHaveBeenCalledWith('Debugger not enabled');
    });

    it('cleans up all managers and listeners on disable', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      await manager.init();
      await manager.initAdvancedFeatures({ inspect: vi.fn() } as never);
      await manager.disable();

      expect(manager.isEnabled()).toBe(false);
      expect(cdp.session.send).toHaveBeenCalledWith('Debugger.disable');
      expect(cdp.session.detach).toHaveBeenCalled();
      expect(manager.listBreakpoints()).toHaveLength(0);
    });
  });

  describe('breakpoint methods delegate to core', () => {
    it('setBreakpointByUrl delegates to core', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      const result = await manager.setBreakpointByUrl({ url: 'test.js', lineNumber: 10 });

      expect(classMocks.setBreakpointByUrlCore).toHaveBeenCalled();
      expect(result.breakpointId).toBe('bp-1');
    });

    it('setBreakpoint delegates to core', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      const result = await manager.setBreakpoint({ scriptId: 's-1', lineNumber: 5 });

      expect(classMocks.setBreakpointCore).toHaveBeenCalled();
      expect(result.breakpointId).toBe('bp-2');
    });

    it('removeBreakpoint delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.removeBreakpoint('bp-1');

      expect(classMocks.removeBreakpointCore).toHaveBeenCalledWith(manager, 'bp-1');
    });

    it('listBreakpoints delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      manager.listBreakpoints();

      expect(classMocks.listBreakpointsCore).toHaveBeenCalledWith(manager);
    });

    it('getBreakpoint delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      manager.getBreakpoint('bp-1');

      expect(classMocks.getBreakpointCore).toHaveBeenCalledWith(manager, 'bp-1');
    });

    it('clearAllBreakpoints delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.clearAllBreakpoints();

      expect(classMocks.clearAllBreakpointsCore).toHaveBeenCalledWith(manager);
    });
  });

  describe('execution methods delegate to core', () => {
    it('setPauseOnExceptions delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.setPauseOnExceptions('all');

      expect(classMocks.setPauseOnExceptionsCore).toHaveBeenCalledWith(manager, 'all');
    });

    it('getPauseOnExceptionsState delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      const result = manager.getPauseOnExceptionsState();

      expect(classMocks.getPauseOnExceptionsStateCore).toHaveBeenCalledWith(manager);
      expect(result).toBe('none');
    });

    it('pause delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.pause();

      expect(classMocks.pauseCore).toHaveBeenCalledWith(manager);
    });

    it('resume delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.resume();

      expect(classMocks.resumeCore).toHaveBeenCalledWith(manager);
    });

    it('stepInto delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.stepInto();

      expect(classMocks.stepIntoCore).toHaveBeenCalledWith(manager);
    });

    it('stepOver delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.stepOver();

      expect(classMocks.stepOverCore).toHaveBeenCalledWith(manager);
    });

    it('stepOut delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.stepOut();

      expect(classMocks.stepOutCore).toHaveBeenCalledWith(manager);
    });

    it('getPausedState delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      const result = manager.getPausedState();

      expect(classMocks.getPausedStateCore).toHaveBeenCalledWith(manager);
      expect(result).toBeNull();
    });

    it('isPaused delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      const result = manager.isPaused();

      expect(classMocks.isPausedCore).toHaveBeenCalledWith(manager);
      expect(result).toBe(false);
    });

    it('waitForPaused delegates to core with timeout', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.waitForPaused(5000);

      expect(classMocks.waitForPausedCore).toHaveBeenCalledWith(manager, 5000);
    });

    it('evaluateOnCallFrame delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.evaluateOnCallFrame({
        callFrameId: 'cf-1',
        expression: 'x + y',
      });

      expect(classMocks.evaluateOnCallFrameCore).toHaveBeenCalledWith(manager, {
        callFrameId: 'cf-1',
        expression: 'x + y',
      });
    });
  });

  describe('scope methods delegate to core', () => {
    it('getScopeVariables delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.getScopeVariables({ callFrameId: 'cf-1' });

      expect(classMocks.getScopeVariablesCore).toHaveBeenCalledWith(manager, {
        callFrameId: 'cf-1',
      });
    });

    it('getObjectPropertiesById delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.getObjectPropertiesById('obj-1');

      expect(classMocks.getObjectPropertiesByIdCore).toHaveBeenCalledWith(manager, 'obj-1');
    });

    it('getObjectProperties delegates to core', async () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      await manager.getObjectProperties('obj-1', 3);

      expect(classMocks.getObjectPropertiesCore).toHaveBeenCalledWith(manager, 'obj-1', 3);
    });
  });

  describe('event methods delegate to core', () => {
    it('onBreakpointHit delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);
      const callback = vi.fn();

      manager.onBreakpointHit(callback);

      expect(classMocks.onBreakpointHitCore).toHaveBeenCalledWith(manager, callback);
    });

    it('offBreakpointHit delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);
      const callback = vi.fn();

      manager.offBreakpointHit(callback);

      expect(classMocks.offBreakpointHitCore).toHaveBeenCalledWith(manager, callback);
    });

    it('clearBreakpointHitCallbacks delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      manager.clearBreakpointHitCallbacks();

      expect(classMocks.clearBreakpointHitCallbacksCore).toHaveBeenCalledWith(manager);
    });

    it('getBreakpointHitCallbackCount delegates to core', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      const count = manager.getBreakpointHitCallbackCount();

      expect(classMocks.getBreakpointHitCallbackCountCore).toHaveBeenCalledWith(manager);
      expect(count).toBe(0);
    });
  });

  describe('session manager methods', () => {
    it('exportSession delegates to sessionManager', () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      manager.exportSession({ description: 'test' });

      const sessionManager = (manager as any).sessionManager;
      expect(sessionManager.exportSession).toHaveBeenCalledWith({ description: 'test' });
    });

    it('saveSession delegates to sessionManager', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      const path = await manager.saveSession('output.json', { description: 'test' });

      expect(path).toBe('session.json');
    });

    it('loadSessionFromFile delegates to sessionManager', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      await manager.loadSessionFromFile('input.json');

      const sessionManager = (manager as any).sessionManager;
      expect(sessionManager.loadSessionFromFile).toHaveBeenCalledWith('input.json');
    });

    it('importSession delegates to sessionManager', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      await manager.importSession('{"metadata":{}}');

      const sessionManager = (manager as any).sessionManager;
      expect(sessionManager.importSession).toHaveBeenCalledWith('{"metadata":{}}');
    });

    it('listSavedSessions delegates to sessionManager', async () => {
      const cdp = createCDPSession();
      const collector = createCollector(cdp.session);
      const manager = new DebuggerManager(collector as never);

      await manager.listSavedSessions();

      const sessionManager = (manager as any).sessionManager;
      expect(sessionManager.listSavedSessions).toHaveBeenCalled();
    });
  });

  describe('normalization edge cases', () => {
    it('normalizes empty paused event params', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      const result = (manager as any).normalizePausedEventParams({});

      expect(result).toEqual({
        callFrames: [],
        reason: 'unknown',
        data: undefined,
        hitBreakpoints: undefined,
      });
    });

    it('normalizes null paused event params', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      const result = (manager as any).normalizePausedEventParams(null);

      expect(result).toEqual({
        callFrames: [],
        reason: 'unknown',
        data: undefined,
        hitBreakpoints: undefined,
      });
    });

    it('normalizes breakpoint resolved with empty params', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      const result = (manager as any).normalizeBreakpointResolvedParams({});

      expect(result).toEqual({
        breakpointId: '',
        location: undefined,
      });
    });

    it('normalizes all scope types correctly', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);
      const validTypes = [
        'global',
        'local',
        'with',
        'closure',
        'catch',
        'block',
        'script',
        'eval',
        'module',
      ];

      for (const scopeType of validTypes) {
        const result = (manager as any).normalizeScopeType(scopeType);
        expect(result).toBe(scopeType);
      }

      // Invalid types should default to 'local'
      expect((manager as any).normalizeScopeType('invalid')).toBe('local');
      expect((manager as any).normalizeScopeType(123)).toBe('local');
      expect((manager as any).normalizeScopeType(null)).toBe('local');
    });

    it('asRecord handles non-objects', () => {
      const manager = new DebuggerManager({ getActivePage: vi.fn() } as never);

      expect((manager as any).asRecord(null)).toEqual({});
      expect((manager as any).asRecord(undefined)).toEqual({});
      expect((manager as any).asRecord(123)).toEqual({});
      expect((manager as any).asRecord('string')).toEqual({});
      expect((manager as any).asRecord({ key: 'value' })).toEqual({ key: 'value' });
    });
  });
});
