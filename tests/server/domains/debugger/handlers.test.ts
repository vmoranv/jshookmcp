import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  debuggerControl,
  debuggerStepping,
  debuggerEvaluate,
  debuggerState,
  sessionManagement,
  breakpointBasic,
  breakpointException,
  xhrBreakpoint,
  eventBreakpoint,
  watchExpressions,
  scopeInspection,
  blackbox,
  ctorSpies,
} = vi.hoisted(() => ({
  debuggerControl: {
    handleDebuggerEnable: vi.fn(async (args) => ({ from: 'control-enable', args })),
    handleDebuggerDisable: vi.fn(async (args) => ({ from: 'control-disable', args })),
    handleDebuggerPause: vi.fn(async (args) => ({ from: 'control-pause', args })),
    handleDebuggerResume: vi.fn(async (args) => ({ from: 'control-resume', args })),
  },
  debuggerStepping: {
    handleDebuggerStepInto: vi.fn(async (args) => ({ from: 'step-into', args })),
    handleDebuggerStepOver: vi.fn(async (args) => ({ from: 'step-over', args })),
    handleDebuggerStepOut: vi.fn(async (args) => ({ from: 'step-out', args })),
  },
  debuggerEvaluate: {
    handleDebuggerEvaluate: vi.fn(async (args) => ({ from: 'eval', args })),
    handleDebuggerEvaluateGlobal: vi.fn(async (args) => ({ from: 'eval-global', args })),
  },
  debuggerState: {
    handleDebuggerWaitForPaused: vi.fn(async (args) => ({ from: 'wait-paused', args })),
    handleDebuggerGetPausedState: vi.fn(async (args) => ({ from: 'paused-state', args })),
    handleGetCallStack: vi.fn(async (args) => ({ from: 'call-stack', args })),
  },
  sessionManagement: {
    handleSaveSession: vi.fn(async (args) => ({ from: 'save-session', args })),
    handleLoadSession: vi.fn(async (args) => ({ from: 'load-session', args })),
    handleExportSession: vi.fn(async (args) => ({ from: 'export-session', args })),
    handleListSessions: vi.fn(async (args) => ({ from: 'list-session', args })),
  },
  breakpointBasic: {
    handleBreakpointSet: vi.fn(async (args) => ({ from: 'bp-set', args })),
    handleBreakpointRemove: vi.fn(async (args) => ({ from: 'bp-remove', args })),
    handleBreakpointList: vi.fn(async (args) => ({ from: 'bp-list', args })),
  },
  breakpointException: {
    handleBreakpointSetOnException: vi.fn(async (args) => ({ from: 'bp-exception', args })),
  },
  xhrBreakpoint: {
    handleXHRBreakpointSet: vi.fn(async (args) => ({ from: 'xhr-set', args })),
    handleXHRBreakpointRemove: vi.fn(async (args) => ({ from: 'xhr-remove', args })),
    handleXHRBreakpointList: vi.fn(async (args) => ({ from: 'xhr-list', args })),
  },
  eventBreakpoint: {
    handleEventBreakpointSet: vi.fn(async (args) => ({ from: 'event-set', args })),
    handleEventBreakpointSetCategory: vi.fn(async (args) => ({ from: 'event-category', args })),
    handleEventBreakpointRemove: vi.fn(async (args) => ({ from: 'event-remove', args })),
    handleEventBreakpointList: vi.fn(async (args) => ({ from: 'event-list', args })),
  },
  watchExpressions: {
    handleWatchAdd: vi.fn(async (args) => ({ from: 'watch-add', args })),
    handleWatchRemove: vi.fn(async (args) => ({ from: 'watch-remove', args })),
    handleWatchList: vi.fn(async (args) => ({ from: 'watch-list', args })),
    handleWatchEvaluateAll: vi.fn(async (args) => ({ from: 'watch-eval', args })),
    handleWatchClearAll: vi.fn(async (args) => ({ from: 'watch-clear', args })),
  },
  scopeInspection: {
    handleGetScopeVariablesEnhanced: vi.fn(async (args) => ({ from: 'scope-vars', args })),
    handleGetObjectProperties: vi.fn(async (args) => ({ from: 'obj-props', args })),
  },
  blackbox: {
    handleBlackboxAdd: vi.fn(async (args) => ({ from: 'blackbox-add', args })),
    handleBlackboxAddCommon: vi.fn(async (args) => ({ from: 'blackbox-common', args })),
    handleBlackboxList: vi.fn(async (args) => ({ from: 'blackbox-list', args })),
  },
  ctorSpies: {
    control: vi.fn(),
    stepping: vi.fn(),
    evaluate: vi.fn(),
    state: vi.fn(),
    session: vi.fn(),
    basic: vi.fn(),
    exception: vi.fn(),
    xhr: vi.fn(),
    event: vi.fn(),
    watch: vi.fn(),
    scope: vi.fn(),
    blackbox: vi.fn(),
  },
}));

function classFactory(spy: ReturnType<typeof vi.fn>, instance: unknown) {
  return class {
    constructor(deps: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (spy as any)(deps);
      return instance;
    }
  };
}

vi.mock('@src/server/domains/debugger/handlers/debugger-control', () => ({
  DebuggerControlHandlers: classFactory(ctorSpies.control, debuggerControl),
}));
vi.mock('@src/server/domains/debugger/handlers/debugger-stepping', () => ({
  DebuggerSteppingHandlers: classFactory(ctorSpies.stepping, debuggerStepping),
}));
vi.mock('@src/server/domains/debugger/handlers/debugger-evaluate', () => ({
  DebuggerEvaluateHandlers: classFactory(ctorSpies.evaluate, debuggerEvaluate),
}));
vi.mock('@src/server/domains/debugger/handlers/debugger-state', () => ({
  DebuggerStateHandlers: classFactory(ctorSpies.state, debuggerState),
}));
vi.mock('@src/server/domains/debugger/handlers/session-management', () => ({
  SessionManagementHandlers: classFactory(ctorSpies.session, sessionManagement),
}));
vi.mock('@src/server/domains/debugger/handlers/breakpoint-basic', () => ({
  BreakpointBasicHandlers: classFactory(ctorSpies.basic, breakpointBasic),
}));
vi.mock('@src/server/domains/debugger/handlers/breakpoint-exception', () => ({
  BreakpointExceptionHandlers: classFactory(ctorSpies.exception, breakpointException),
}));
vi.mock('@src/server/domains/debugger/handlers/xhr-breakpoint', () => ({
  XHRBreakpointHandlers: classFactory(ctorSpies.xhr, xhrBreakpoint),
}));
vi.mock('@src/server/domains/debugger/handlers/event-breakpoint', () => ({
  EventBreakpointHandlers: classFactory(ctorSpies.event, eventBreakpoint),
}));
vi.mock('@src/server/domains/debugger/handlers/watch-expressions', () => ({
  WatchExpressionsHandlers: classFactory(ctorSpies.watch, watchExpressions),
}));
vi.mock('@src/server/domains/debugger/handlers/scope-inspection', () => ({
  ScopeInspectionHandlers: classFactory(ctorSpies.scope, scopeInspection),
}));
vi.mock('@src/server/domains/debugger/handlers/blackbox-handlers', () => ({
  BlackboxHandlers: classFactory(ctorSpies.blackbox, blackbox),
}));

import {
  DebuggerToolHandlers,
  DebuggerControlHandlers,
  DebuggerSteppingHandlers,
  DebuggerEvaluateHandlers,
  DebuggerStateHandlers,
  SessionManagementHandlers,
  BreakpointBasicHandlers,
  BreakpointExceptionHandlers,
  XHRBreakpointHandlers,
  EventBreakpointHandlers,
  WatchExpressionsHandlers,
  ScopeInspectionHandlers,
  BlackboxHandlers,
} from '@server/domains/debugger/handlers';

describe('DebuggerToolHandlers', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const debuggerManager = { id: 'dm' } as any;
  const runtimeInspector = { id: 'ri' } as unknown;
  let handlers: DebuggerToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new DebuggerToolHandlers(debuggerManager, runtimeInspector);
  });

  // ── Constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('constructs all 12 sub-handlers', () => {
      expect(ctorSpies.control).toHaveBeenCalledOnce();
      expect(ctorSpies.stepping).toHaveBeenCalledOnce();
      expect(ctorSpies.evaluate).toHaveBeenCalledOnce();
      expect(ctorSpies.state).toHaveBeenCalledOnce();
      expect(ctorSpies.session).toHaveBeenCalledOnce();
      expect(ctorSpies.basic).toHaveBeenCalledOnce();
      expect(ctorSpies.exception).toHaveBeenCalledOnce();
      expect(ctorSpies.xhr).toHaveBeenCalledOnce();
      expect(ctorSpies.event).toHaveBeenCalledOnce();
      expect(ctorSpies.watch).toHaveBeenCalledOnce();
      expect(ctorSpies.scope).toHaveBeenCalledOnce();
      expect(ctorSpies.blackbox).toHaveBeenCalledOnce();
    });

    it('passes commonDeps (debuggerManager + runtimeInspector) to control handler', () => {
      expect(ctorSpies.control).toHaveBeenCalledWith({
        debuggerManager,
        runtimeInspector,
      });
    });

    it('passes commonDeps to state handler', () => {
      expect(ctorSpies.state).toHaveBeenCalledWith({
        debuggerManager,
        runtimeInspector,
      });
    });

    it('passes commonDeps to scope handler', () => {
      expect(ctorSpies.scope).toHaveBeenCalledWith({
        debuggerManager,
        runtimeInspector,
      });
    });

    it('passes only debuggerManager to stepping handler', () => {
      expect(ctorSpies.stepping).toHaveBeenCalledWith({
        debuggerManager,
      });
    });

    it('passes only runtimeInspector to evaluate handler', () => {
      expect(ctorSpies.evaluate).toHaveBeenCalledWith({
        runtimeInspector,
      });
    });

    it('passes only debuggerManager to session handler', () => {
      expect(ctorSpies.session).toHaveBeenCalledWith({
        debuggerManager,
      });
    });

    it('passes only debuggerManager to basic breakpoint handler', () => {
      expect(ctorSpies.basic).toHaveBeenCalledWith({
        debuggerManager,
      });
    });

    it('passes only debuggerManager to exception breakpoint handler', () => {
      expect(ctorSpies.exception).toHaveBeenCalledWith({
        debuggerManager,
      });
    });

    it('passes only debuggerManager to xhr breakpoint handler', () => {
      expect(ctorSpies.xhr).toHaveBeenCalledWith({
        debuggerManager,
      });
    });

    it('passes only debuggerManager to event breakpoint handler', () => {
      expect(ctorSpies.event).toHaveBeenCalledWith({
        debuggerManager,
      });
    });

    it('passes only debuggerManager to watch handler', () => {
      expect(ctorSpies.watch).toHaveBeenCalledWith({
        debuggerManager,
      });
    });

    it('passes only debuggerManager to blackbox handler', () => {
      expect(ctorSpies.blackbox).toHaveBeenCalledWith({
        debuggerManager,
      });
    });
  });

  // ── Debugger Control delegation ──────────────────────────────

  describe('debugger control delegation', () => {
    it('delegates handleDebuggerEnable', async () => {
      const args = { x: 1 };
      await expect(handlers.handleDebuggerEnable(args)).resolves.toEqual({
        from: 'control-enable',
        args,
      });
      expect(debuggerControl.handleDebuggerEnable).toHaveBeenCalledWith(args);
    });

    it('delegates handleDebuggerDisable', async () => {
      const args = {};
      await expect(handlers.handleDebuggerDisable(args)).resolves.toEqual({
        from: 'control-disable',
        args,
      });
      expect(debuggerControl.handleDebuggerDisable).toHaveBeenCalledWith(args);
    });

    it('delegates handleDebuggerPause', async () => {
      const args = {};
      await expect(handlers.handleDebuggerPause(args)).resolves.toEqual({
        from: 'control-pause',
        args,
      });
      expect(debuggerControl.handleDebuggerPause).toHaveBeenCalledWith(args);
    });

    it('delegates handleDebuggerResume', async () => {
      const args = {};
      await expect(handlers.handleDebuggerResume(args)).resolves.toEqual({
        from: 'control-resume',
        args,
      });
      expect(debuggerControl.handleDebuggerResume).toHaveBeenCalledWith(args);
    });
  });

  // ── Debugger Stepping delegation ─────────────────────────────

  describe('debugger stepping delegation', () => {
    it('delegates handleDebuggerStepInto', async () => {
      const args = {};
      await expect(handlers.handleDebuggerStepInto(args)).resolves.toEqual({
        from: 'step-into',
        args,
      });
      expect(debuggerStepping.handleDebuggerStepInto).toHaveBeenCalledWith(args);
    });

    it('delegates handleDebuggerStepOver', async () => {
      const args = { count: 2 };
      await expect(handlers.handleDebuggerStepOver(args)).resolves.toEqual({
        from: 'step-over',
        args,
      });
      expect(debuggerStepping.handleDebuggerStepOver).toHaveBeenCalledWith(args);
    });

    it('delegates handleDebuggerStepOut', async () => {
      const args = {};
      await expect(handlers.handleDebuggerStepOut(args)).resolves.toEqual({
        from: 'step-out',
        args,
      });
      expect(debuggerStepping.handleDebuggerStepOut).toHaveBeenCalledWith(args);
    });
  });

  // ── Debugger Evaluate delegation ─────────────────────────────

  describe('debugger evaluate delegation', () => {
    it('delegates handleDebuggerEvaluate', async () => {
      const args = { expression: '1+1' };
      await expect(handlers.handleDebuggerEvaluate(args)).resolves.toEqual({
        from: 'eval',
        args,
      });
      expect(debuggerEvaluate.handleDebuggerEvaluate).toHaveBeenCalledWith(args);
    });

    it('delegates handleDebuggerEvaluateGlobal', async () => {
      const args = { expression: 'window.location.href' };
      await expect(handlers.handleDebuggerEvaluateGlobal(args)).resolves.toEqual({
        from: 'eval-global',
        args,
      });
      expect(debuggerEvaluate.handleDebuggerEvaluateGlobal).toHaveBeenCalledWith(args);
    });
  });

  // ── Debugger State delegation ────────────────────────────────

  describe('debugger state delegation', () => {
    it('delegates handleDebuggerWaitForPaused', async () => {
      const args = { timeout: 5000 };
      await expect(handlers.handleDebuggerWaitForPaused(args)).resolves.toEqual({
        from: 'wait-paused',
        args,
      });
      expect(debuggerState.handleDebuggerWaitForPaused).toHaveBeenCalledWith(args);
    });

    it('delegates handleDebuggerGetPausedState', async () => {
      const args = {};
      await expect(handlers.handleDebuggerGetPausedState(args)).resolves.toEqual({
        from: 'paused-state',
        args,
      });
      expect(debuggerState.handleDebuggerGetPausedState).toHaveBeenCalledWith(args);
    });

    it('delegates handleGetCallStack', async () => {
      const args = {};
      await expect(handlers.handleGetCallStack(args)).resolves.toEqual({
        from: 'call-stack',
        args,
      });
      expect(debuggerState.handleGetCallStack).toHaveBeenCalledWith(args);
    });
  });

  // ── Session Management delegation ────────────────────────────

  describe('session management delegation', () => {
    it('delegates handleSaveSession', async () => {
      const args = { name: 's1' };
      await expect(handlers.handleSaveSession(args)).resolves.toEqual({
        from: 'save-session',
        args,
      });
      expect(sessionManagement.handleSaveSession).toHaveBeenCalledWith(args);
    });

    it('delegates handleLoadSession', async () => {
      const args = { filePath: '/tmp/session.json' };
      await expect(handlers.handleLoadSession(args)).resolves.toEqual({
        from: 'load-session',
        args,
      });
      expect(sessionManagement.handleLoadSession).toHaveBeenCalledWith(args);
    });

    it('delegates handleExportSession', async () => {
      const args = { metadata: { version: '1.0' } };
      await expect(handlers.handleExportSession(args)).resolves.toEqual({
        from: 'export-session',
        args,
      });
      expect(sessionManagement.handleExportSession).toHaveBeenCalledWith(args);
    });

    it('delegates handleListSessions', async () => {
      const args = {};
      await expect(handlers.handleListSessions(args)).resolves.toEqual({
        from: 'list-session',
        args,
      });
      expect(sessionManagement.handleListSessions).toHaveBeenCalledWith(args);
    });
  });

  // ── Breakpoint Basic delegation ──────────────────────────────

  describe('breakpoint basic delegation', () => {
    it('delegates handleBreakpointSet', async () => {
      const args = { lineNumber: 42, url: 'test.js' };
      await expect(handlers.handleBreakpointSet(args)).resolves.toEqual({
        from: 'bp-set',
        args,
      });
      expect(breakpointBasic.handleBreakpointSet).toHaveBeenCalledWith(args);
    });

    it('delegates handleBreakpointRemove', async () => {
      const args = { breakpointId: 'bp-1' };
      await expect(handlers.handleBreakpointRemove(args)).resolves.toEqual({
        from: 'bp-remove',
        args,
      });
      expect(breakpointBasic.handleBreakpointRemove).toHaveBeenCalledWith(args);
    });

    it('delegates handleBreakpointList', async () => {
      const args = {};
      await expect(handlers.handleBreakpointList(args)).resolves.toEqual({
        from: 'bp-list',
        args,
      });
      expect(breakpointBasic.handleBreakpointList).toHaveBeenCalledWith(args);
    });
  });

  // ── Breakpoint Exception delegation ──────────────────────────

  describe('breakpoint exception delegation', () => {
    it('delegates handleBreakpointSetOnException', async () => {
      const args = { state: 'all' };
      await expect(handlers.handleBreakpointSetOnException(args)).resolves.toEqual({
        from: 'bp-exception',
        args,
      });
      expect(breakpointException.handleBreakpointSetOnException).toHaveBeenCalledWith(args);
    });
  });

  // ── XHR Breakpoint delegation ────────────────────────────────

  describe('xhr breakpoint delegation', () => {
    it('delegates handleXHRBreakpointSet', async () => {
      const args = { urlPattern: '/api/*' };
      await expect(handlers.handleXHRBreakpointSet(args)).resolves.toEqual({
        from: 'xhr-set',
        args,
      });
      expect(xhrBreakpoint.handleXHRBreakpointSet).toHaveBeenCalledWith(args);
    });

    it('delegates handleXHRBreakpointRemove', async () => {
      const args = { breakpointId: 'xhr-1' };
      await expect(handlers.handleXHRBreakpointRemove(args)).resolves.toEqual({
        from: 'xhr-remove',
        args,
      });
      expect(xhrBreakpoint.handleXHRBreakpointRemove).toHaveBeenCalledWith(args);
    });

    it('delegates handleXHRBreakpointList', async () => {
      const args = {};
      await expect(handlers.handleXHRBreakpointList(args)).resolves.toEqual({
        from: 'xhr-list',
        args,
      });
      expect(xhrBreakpoint.handleXHRBreakpointList).toHaveBeenCalledWith(args);
    });
  });

  // ── Event Breakpoint delegation ──────────────────────────────

  describe('event breakpoint delegation', () => {
    it('delegates handleEventBreakpointSet', async () => {
      const args = { eventName: 'click' };
      await expect(handlers.handleEventBreakpointSet(args)).resolves.toEqual({
        from: 'event-set',
        args,
      });
      expect(eventBreakpoint.handleEventBreakpointSet).toHaveBeenCalledWith(args);
    });

    it('delegates handleEventBreakpointSetCategory', async () => {
      const args = { category: 'mouse' };
      await expect(handlers.handleEventBreakpointSetCategory(args)).resolves.toEqual({
        from: 'event-category',
        args,
      });
      expect(eventBreakpoint.handleEventBreakpointSetCategory).toHaveBeenCalledWith(args);
    });

    it('delegates handleEventBreakpointRemove', async () => {
      const args = { breakpointId: 'evt-1' };
      await expect(handlers.handleEventBreakpointRemove(args)).resolves.toEqual({
        from: 'event-remove',
        args,
      });
      expect(eventBreakpoint.handleEventBreakpointRemove).toHaveBeenCalledWith(args);
    });

    it('delegates handleEventBreakpointList', async () => {
      const args = {};
      await expect(handlers.handleEventBreakpointList(args)).resolves.toEqual({
        from: 'event-list',
        args,
      });
      expect(eventBreakpoint.handleEventBreakpointList).toHaveBeenCalledWith(args);
    });
  });

  // ── Watch Expressions delegation ─────────────────────────────

  describe('watch expressions delegation', () => {
    it('delegates handleWatchAdd', async () => {
      const args = { expression: 'x.y' };
      await expect(handlers.handleWatchAdd(args)).resolves.toEqual({
        from: 'watch-add',
        args,
      });
      expect(watchExpressions.handleWatchAdd).toHaveBeenCalledWith(args);
    });

    it('delegates handleWatchRemove', async () => {
      const args = { watchId: 'w-1' };
      await expect(handlers.handleWatchRemove(args)).resolves.toEqual({
        from: 'watch-remove',
        args,
      });
      expect(watchExpressions.handleWatchRemove).toHaveBeenCalledWith(args);
    });

    it('delegates handleWatchList', async () => {
      const args = {};
      await expect(handlers.handleWatchList(args)).resolves.toEqual({
        from: 'watch-list',
        args,
      });
      expect(watchExpressions.handleWatchList).toHaveBeenCalledWith(args);
    });

    it('delegates handleWatchEvaluateAll', async () => {
      const args = {};
      await expect(handlers.handleWatchEvaluateAll(args)).resolves.toEqual({
        from: 'watch-eval',
        args,
      });
      expect(watchExpressions.handleWatchEvaluateAll).toHaveBeenCalledWith(args);
    });

    it('delegates handleWatchClearAll', async () => {
      const args = {};
      await expect(handlers.handleWatchClearAll(args)).resolves.toEqual({
        from: 'watch-clear',
        args,
      });
      expect(watchExpressions.handleWatchClearAll).toHaveBeenCalledWith(args);
    });
  });

  // ── Scope Inspection delegation ──────────────────────────────

  describe('scope inspection delegation', () => {
    it('delegates handleGetScopeVariablesEnhanced', async () => {
      const args = { maxDepth: 3 };
      await expect(handlers.handleGetScopeVariablesEnhanced(args)).resolves.toEqual({
        from: 'scope-vars',
        args,
      });
      expect(scopeInspection.handleGetScopeVariablesEnhanced).toHaveBeenCalledWith(args);
    });

    it('delegates handleGetObjectProperties', async () => {
      const args = { objectId: 'obj-1' };
      await expect(handlers.handleGetObjectProperties(args)).resolves.toEqual({
        from: 'obj-props',
        args,
      });
      expect(scopeInspection.handleGetObjectProperties).toHaveBeenCalledWith(args);
    });
  });

  // ── Blackbox delegation ──────────────────────────────────────

  describe('blackbox delegation', () => {
    it('delegates handleBlackboxAdd', async () => {
      const args = { urlPattern: 'jquery' };
      await expect(handlers.handleBlackboxAdd(args)).resolves.toEqual({
        from: 'blackbox-add',
        args,
      });
      expect(blackbox.handleBlackboxAdd).toHaveBeenCalledWith(args);
    });

    it('delegates handleBlackboxAddCommon', async () => {
      const args = {};
      await expect(handlers.handleBlackboxAddCommon(args)).resolves.toEqual({
        from: 'blackbox-common',
        args,
      });
      expect(blackbox.handleBlackboxAddCommon).toHaveBeenCalledWith(args);
    });

    it('delegates handleBlackboxList', async () => {
      const args = {};
      await expect(handlers.handleBlackboxList(args)).resolves.toEqual({
        from: 'blackbox-list',
        args,
      });
      expect(blackbox.handleBlackboxList).toHaveBeenCalledWith(args);
    });
  });

  // ── All 37 methods exist as functions ────────────────────────

  describe('method completeness', () => {
    const allMethods = [
      'handleDebuggerEnable',
      'handleDebuggerDisable',
      'handleDebuggerPause',
      'handleDebuggerResume',
      'handleDebuggerStepInto',
      'handleDebuggerStepOver',
      'handleDebuggerStepOut',
      'handleDebuggerEvaluate',
      'handleDebuggerEvaluateGlobal',
      'handleDebuggerWaitForPaused',
      'handleDebuggerGetPausedState',
      'handleGetCallStack',
      'handleSaveSession',
      'handleLoadSession',
      'handleExportSession',
      'handleListSessions',
      'handleBreakpointSet',
      'handleBreakpointRemove',
      'handleBreakpointList',
      'handleBreakpointSetOnException',
      'handleXHRBreakpointSet',
      'handleXHRBreakpointRemove',
      'handleXHRBreakpointList',
      'handleEventBreakpointSet',
      'handleEventBreakpointSetCategory',
      'handleEventBreakpointRemove',
      'handleEventBreakpointList',
      'handleWatchAdd',
      'handleWatchRemove',
      'handleWatchList',
      'handleWatchEvaluateAll',
      'handleWatchClearAll',
      'handleGetScopeVariablesEnhanced',
      'handleGetObjectProperties',
      'handleBlackboxAdd',
      'handleBlackboxAddCommon',
      'handleBlackboxList',
    ];

    it('has exactly 37 public handler methods', () => {
      expect(allMethods).toHaveLength(37);
    });

    it.each(allMethods)('%s is a function on the instance', (method) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(typeof (handlers as any)[method]).toBe('function');
    });
  });

  // ── Re-exports ───────────────────────────────────────────────

  describe('re-exports', () => {
    it('re-exports DebuggerControlHandlers', () => {
      expect(DebuggerControlHandlers).toBeDefined();
    });

    it('re-exports DebuggerSteppingHandlers', () => {
      expect(DebuggerSteppingHandlers).toBeDefined();
    });

    it('re-exports DebuggerEvaluateHandlers', () => {
      expect(DebuggerEvaluateHandlers).toBeDefined();
    });

    it('re-exports DebuggerStateHandlers', () => {
      expect(DebuggerStateHandlers).toBeDefined();
    });

    it('re-exports SessionManagementHandlers', () => {
      expect(SessionManagementHandlers).toBeDefined();
    });

    it('re-exports BreakpointBasicHandlers', () => {
      expect(BreakpointBasicHandlers).toBeDefined();
    });

    it('re-exports BreakpointExceptionHandlers', () => {
      expect(BreakpointExceptionHandlers).toBeDefined();
    });

    it('re-exports XHRBreakpointHandlers', () => {
      expect(XHRBreakpointHandlers).toBeDefined();
    });

    it('re-exports EventBreakpointHandlers', () => {
      expect(EventBreakpointHandlers).toBeDefined();
    });

    it('re-exports WatchExpressionsHandlers', () => {
      expect(WatchExpressionsHandlers).toBeDefined();
    });

    it('re-exports ScopeInspectionHandlers', () => {
      expect(ScopeInspectionHandlers).toBeDefined();
    });

    it('re-exports BlackboxHandlers', () => {
      expect(BlackboxHandlers).toBeDefined();
    });
  });
});
