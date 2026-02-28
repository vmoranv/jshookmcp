import { beforeEach, describe, expect, it, vi } from 'vitest';

const debuggerControl = {
  handleDebuggerEnable: vi.fn(async (args) => ({ from: 'control-enable', args })),
  handleDebuggerDisable: vi.fn(async (args) => ({ from: 'control-disable', args })),
  handleDebuggerPause: vi.fn(async (args) => ({ from: 'control-pause', args })),
  handleDebuggerResume: vi.fn(async (args) => ({ from: 'control-resume', args })),
};
const debuggerStepping = {
  handleDebuggerStepInto: vi.fn(async (args) => ({ from: 'step-into', args })),
  handleDebuggerStepOver: vi.fn(async (args) => ({ from: 'step-over', args })),
  handleDebuggerStepOut: vi.fn(async (args) => ({ from: 'step-out', args })),
};
const debuggerEvaluate = {
  handleDebuggerEvaluate: vi.fn(async (args) => ({ from: 'eval', args })),
  handleDebuggerEvaluateGlobal: vi.fn(async (args) => ({ from: 'eval-global', args })),
};
const debuggerState = {
  handleDebuggerWaitForPaused: vi.fn(async (args) => ({ from: 'wait-paused', args })),
  handleDebuggerGetPausedState: vi.fn(async (args) => ({ from: 'paused-state', args })),
  handleGetCallStack: vi.fn(async (args) => ({ from: 'call-stack', args })),
};
const sessionManagement = {
  handleSaveSession: vi.fn(async (args) => ({ from: 'save-session', args })),
  handleLoadSession: vi.fn(async (args) => ({ from: 'load-session', args })),
  handleExportSession: vi.fn(async (args) => ({ from: 'export-session', args })),
  handleListSessions: vi.fn(async (args) => ({ from: 'list-session', args })),
};
const breakpointBasic = {
  handleBreakpointSet: vi.fn(async (args) => ({ from: 'bp-set', args })),
  handleBreakpointRemove: vi.fn(async (args) => ({ from: 'bp-remove', args })),
  handleBreakpointList: vi.fn(async (args) => ({ from: 'bp-list', args })),
};
const breakpointException = {
  handleBreakpointSetOnException: vi.fn(async (args) => ({ from: 'bp-exception', args })),
};
const xhrBreakpoint = {
  handleXHRBreakpointSet: vi.fn(async (args) => ({ from: 'xhr-set', args })),
  handleXHRBreakpointRemove: vi.fn(async (args) => ({ from: 'xhr-remove', args })),
  handleXHRBreakpointList: vi.fn(async (args) => ({ from: 'xhr-list', args })),
};
const eventBreakpoint = {
  handleEventBreakpointSet: vi.fn(async (args) => ({ from: 'event-set', args })),
  handleEventBreakpointSetCategory: vi.fn(async (args) => ({ from: 'event-category', args })),
  handleEventBreakpointRemove: vi.fn(async (args) => ({ from: 'event-remove', args })),
  handleEventBreakpointList: vi.fn(async (args) => ({ from: 'event-list', args })),
};
const watchExpressions = {
  handleWatchAdd: vi.fn(async (args) => ({ from: 'watch-add', args })),
  handleWatchRemove: vi.fn(async (args) => ({ from: 'watch-remove', args })),
  handleWatchList: vi.fn(async (args) => ({ from: 'watch-list', args })),
  handleWatchEvaluateAll: vi.fn(async (args) => ({ from: 'watch-eval', args })),
  handleWatchClearAll: vi.fn(async (args) => ({ from: 'watch-clear', args })),
};
const scopeInspection = {
  handleGetScopeVariablesEnhanced: vi.fn(async (args) => ({ from: 'scope-vars', args })),
  handleGetObjectProperties: vi.fn(async (args) => ({ from: 'obj-props', args })),
};
const blackbox = {
  handleBlackboxAdd: vi.fn(async (args) => ({ from: 'blackbox-add', args })),
  handleBlackboxAddCommon: vi.fn(async (args) => ({ from: 'blackbox-common', args })),
  handleBlackboxList: vi.fn(async (args) => ({ from: 'blackbox-list', args })),
};

const ctorSpies = vi.hoisted(() => ({
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
}));

function classFactory(spy: ReturnType<typeof vi.fn>, instance: any) {
  return class {
    constructor(deps: unknown) {
      spy(deps);
      return instance;
    }
  };
}

vi.mock('../../../../src/server/domains/debugger/handlers/debugger-control.js', () => ({
  DebuggerControlHandlers: classFactory(ctorSpies.control, debuggerControl),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/debugger-stepping.js', () => ({
  DebuggerSteppingHandlers: classFactory(ctorSpies.stepping, debuggerStepping),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/debugger-evaluate.js', () => ({
  DebuggerEvaluateHandlers: classFactory(ctorSpies.evaluate, debuggerEvaluate),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/debugger-state.js', () => ({
  DebuggerStateHandlers: classFactory(ctorSpies.state, debuggerState),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/session-management.js', () => ({
  SessionManagementHandlers: classFactory(ctorSpies.session, sessionManagement),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/breakpoint-basic.js', () => ({
  BreakpointBasicHandlers: classFactory(ctorSpies.basic, breakpointBasic),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/breakpoint-exception.js', () => ({
  BreakpointExceptionHandlers: classFactory(ctorSpies.exception, breakpointException),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/xhr-breakpoint.js', () => ({
  XHRBreakpointHandlers: classFactory(ctorSpies.xhr, xhrBreakpoint),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/event-breakpoint.js', () => ({
  EventBreakpointHandlers: classFactory(ctorSpies.event, eventBreakpoint),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/watch-expressions.js', () => ({
  WatchExpressionsHandlers: classFactory(ctorSpies.watch, watchExpressions),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/scope-inspection.js', () => ({
  ScopeInspectionHandlers: classFactory(ctorSpies.scope, scopeInspection),
}));
vi.mock('../../../../src/server/domains/debugger/handlers/blackbox-handlers.js', () => ({
  BlackboxHandlers: classFactory(ctorSpies.blackbox, blackbox),
}));

import { DebuggerToolHandlers } from '../../../../src/server/domains/debugger/handlers.js';

describe('DebuggerToolHandlers', () => {
  const debuggerManager = { id: 'dm' } as any;
  const runtimeInspector = { id: 'ri' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs all sub-handlers with dependencies', () => {
    new DebuggerToolHandlers(debuggerManager, runtimeInspector);
    expect(ctorSpies.control).toHaveBeenCalledOnce();
    expect(ctorSpies.stepping).toHaveBeenCalledOnce();
    expect(ctorSpies.blackbox).toHaveBeenCalledOnce();
  });

  it('delegates debugger_enable', async () => {
    const handlers = new DebuggerToolHandlers(debuggerManager, runtimeInspector);
    const args = { x: 1 };
    await expect(handlers.handleDebuggerEnable(args)).resolves.toEqual({
      from: 'control-enable',
      args,
    });
    expect(debuggerControl.handleDebuggerEnable).toHaveBeenCalledWith(args);
  });

  it('delegates debugger_step_over', async () => {
    const handlers = new DebuggerToolHandlers(debuggerManager, runtimeInspector);
    const args = { count: 2 };
    await expect(handlers.handleDebuggerStepOver(args)).resolves.toEqual({
      from: 'step-over',
      args,
    });
    expect(debuggerStepping.handleDebuggerStepOver).toHaveBeenCalledWith(args);
  });

  it('delegates save_session', async () => {
    const handlers = new DebuggerToolHandlers(debuggerManager, runtimeInspector);
    const args = { name: 's1' };
    await expect(handlers.handleSaveSession(args)).resolves.toEqual({
      from: 'save-session',
      args,
    });
    expect(sessionManagement.handleSaveSession).toHaveBeenCalledWith(args);
  });

  it('delegates watch_evaluate_all', async () => {
    const handlers = new DebuggerToolHandlers(debuggerManager, runtimeInspector);
    const args = {};
    await expect(handlers.handleWatchEvaluateAll(args)).resolves.toEqual({
      from: 'watch-eval',
      args,
    });
    expect(watchExpressions.handleWatchEvaluateAll).toHaveBeenCalledWith(args);
  });

  it('delegates blackbox_list', async () => {
    const handlers = new DebuggerToolHandlers(debuggerManager, runtimeInspector);
    const args = {};
    await expect(handlers.handleBlackboxList(args)).resolves.toEqual({
      from: 'blackbox-list',
      args,
    });
    expect(blackbox.handleBlackboxList).toHaveBeenCalledWith(args);
  });
});
