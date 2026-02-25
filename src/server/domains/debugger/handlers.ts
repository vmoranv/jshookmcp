/**
 * Debugger Tool Handlers - Facade Module
 *
 * This file serves as the main entry point for debugger tool handlers.
 * Handlers are organized into atomic modules by functional domain:
 * - debugger-control: Debugger lifecycle (enable/disable, pause/resume)
 * - debugger-stepping: Step into/over/out
 * - debugger-evaluate: Expression evaluation
 * - debugger-state: Paused state and call stack
 * - session-management: Save/load/export sessions
 * - breakpoint-basic: Basic breakpoint operations
 * - breakpoint-exception: Exception breakpoints
 * - xhr-breakpoint: XHR/Fetch breakpoints
 * - event-breakpoint: Event listener breakpoints
 * - watch-expressions: Watch expression management
 * - scope-inspection: Scope variable inspection
 * - blackbox-handlers: Script blackboxing
 */

import type { DebuggerManager } from '../../../modules/debugger/DebuggerManager.js';
import type { RuntimeInspector } from '../../../modules/debugger/RuntimeInspector.js';

// Import handler modules
import { DebuggerControlHandlers } from './handlers/debugger-control.js';
import { DebuggerSteppingHandlers } from './handlers/debugger-stepping.js';
import { DebuggerEvaluateHandlers } from './handlers/debugger-evaluate.js';
import { DebuggerStateHandlers } from './handlers/debugger-state.js';
import { SessionManagementHandlers } from './handlers/session-management.js';
import { BreakpointBasicHandlers } from './handlers/breakpoint-basic.js';
import { BreakpointExceptionHandlers } from './handlers/breakpoint-exception.js';
import { XHRBreakpointHandlers } from './handlers/xhr-breakpoint.js';
import { EventBreakpointHandlers } from './handlers/event-breakpoint.js';
import { WatchExpressionsHandlers } from './handlers/watch-expressions.js';
import { ScopeInspectionHandlers } from './handlers/scope-inspection.js';
import { BlackboxHandlers } from './handlers/blackbox-handlers.js';

export class DebuggerToolHandlers {
  // Core dependencies
  private debuggerManager: DebuggerManager;
  private runtimeInspector: RuntimeInspector;

  // Handler modules
  private debuggerControl: DebuggerControlHandlers;
  private debuggerStepping: DebuggerSteppingHandlers;
  private debuggerEvaluate: DebuggerEvaluateHandlers;
  private debuggerState: DebuggerStateHandlers;
  private sessionManagement: SessionManagementHandlers;
  private breakpointBasic: BreakpointBasicHandlers;
  private breakpointException: BreakpointExceptionHandlers;
  private xhrBreakpoint: XHRBreakpointHandlers;
  private eventBreakpoint: EventBreakpointHandlers;
  private watchExpressions: WatchExpressionsHandlers;
  private scopeInspection: ScopeInspectionHandlers;
  private blackbox: BlackboxHandlers;

  constructor(
    debuggerManager: DebuggerManager,
    runtimeInspector: RuntimeInspector
  ) {
    this.debuggerManager = debuggerManager;
    this.runtimeInspector = runtimeInspector;

    // Initialize handler modules with dependencies
    const commonDeps = {
      debuggerManager: this.debuggerManager,
      runtimeInspector: this.runtimeInspector,
    };

    this.debuggerControl = new DebuggerControlHandlers(commonDeps);
    this.debuggerStepping = new DebuggerSteppingHandlers({
      debuggerManager: this.debuggerManager,
    });
    this.debuggerEvaluate = new DebuggerEvaluateHandlers({
      runtimeInspector: this.runtimeInspector,
    });
    this.debuggerState = new DebuggerStateHandlers(commonDeps);
    this.sessionManagement = new SessionManagementHandlers({
      debuggerManager: this.debuggerManager,
    });
    this.breakpointBasic = new BreakpointBasicHandlers({
      debuggerManager: this.debuggerManager,
    });
    this.breakpointException = new BreakpointExceptionHandlers({
      debuggerManager: this.debuggerManager,
    });
    this.xhrBreakpoint = new XHRBreakpointHandlers({
      debuggerManager: this.debuggerManager,
    });
    this.eventBreakpoint = new EventBreakpointHandlers({
      debuggerManager: this.debuggerManager,
    });
    this.watchExpressions = new WatchExpressionsHandlers({
      debuggerManager: this.debuggerManager,
    });
    this.scopeInspection = new ScopeInspectionHandlers(commonDeps);
    this.blackbox = new BlackboxHandlers({
      debuggerManager: this.debuggerManager,
    });
  }

  // ============ Debugger Control ============
  async handleDebuggerEnable(args: Record<string, unknown>) {
    return this.debuggerControl.handleDebuggerEnable(args);
  }

  async handleDebuggerDisable(args: Record<string, unknown>) {
    return this.debuggerControl.handleDebuggerDisable(args);
  }

  async handleDebuggerPause(args: Record<string, unknown>) {
    return this.debuggerControl.handleDebuggerPause(args);
  }

  async handleDebuggerResume(args: Record<string, unknown>) {
    return this.debuggerControl.handleDebuggerResume(args);
  }

  // ============ Debugger Stepping ============
  async handleDebuggerStepInto(args: Record<string, unknown>) {
    return this.debuggerStepping.handleDebuggerStepInto(args);
  }

  async handleDebuggerStepOver(args: Record<string, unknown>) {
    return this.debuggerStepping.handleDebuggerStepOver(args);
  }

  async handleDebuggerStepOut(args: Record<string, unknown>) {
    return this.debuggerStepping.handleDebuggerStepOut(args);
  }

  // ============ Debugger Evaluate ============
  async handleDebuggerEvaluate(args: Record<string, unknown>) {
    return this.debuggerEvaluate.handleDebuggerEvaluate(args);
  }

  async handleDebuggerEvaluateGlobal(args: Record<string, unknown>) {
    return this.debuggerEvaluate.handleDebuggerEvaluateGlobal(args);
  }

  // ============ Debugger State ============
  async handleDebuggerWaitForPaused(args: Record<string, unknown>) {
    return this.debuggerState.handleDebuggerWaitForPaused(args);
  }

  async handleDebuggerGetPausedState(args: Record<string, unknown>) {
    return this.debuggerState.handleDebuggerGetPausedState(args);
  }

  async handleGetCallStack(args: Record<string, unknown>) {
    return this.debuggerState.handleGetCallStack(args);
  }

  // ============ Session Management ============
  async handleSaveSession(args: Record<string, unknown>) {
    return this.sessionManagement.handleSaveSession(args);
  }

  async handleLoadSession(args: Record<string, unknown>) {
    return this.sessionManagement.handleLoadSession(args);
  }

  async handleExportSession(args: Record<string, unknown>) {
    return this.sessionManagement.handleExportSession(args);
  }

  async handleListSessions(args: Record<string, unknown>) {
    return this.sessionManagement.handleListSessions(args);
  }

  // ============ Basic Breakpoints ============
  async handleBreakpointSet(args: Record<string, unknown>) {
    return this.breakpointBasic.handleBreakpointSet(args);
  }

  async handleBreakpointRemove(args: Record<string, unknown>) {
    return this.breakpointBasic.handleBreakpointRemove(args);
  }

  async handleBreakpointList(args: Record<string, unknown>) {
    return this.breakpointBasic.handleBreakpointList(args);
  }

  // ============ Exception Breakpoints ============
  async handleBreakpointSetOnException(args: Record<string, unknown>) {
    return this.breakpointException.handleBreakpointSetOnException(args);
  }

  // ============ XHR Breakpoints ============
  async handleXHRBreakpointSet(args: Record<string, unknown>) {
    return this.xhrBreakpoint.handleXHRBreakpointSet(args);
  }

  async handleXHRBreakpointRemove(args: Record<string, unknown>) {
    return this.xhrBreakpoint.handleXHRBreakpointRemove(args);
  }

  async handleXHRBreakpointList(args: Record<string, unknown>) {
    return this.xhrBreakpoint.handleXHRBreakpointList(args);
  }

  // ============ Event Breakpoints ============
  async handleEventBreakpointSet(args: Record<string, unknown>) {
    return this.eventBreakpoint.handleEventBreakpointSet(args);
  }

  async handleEventBreakpointSetCategory(args: Record<string, unknown>) {
    return this.eventBreakpoint.handleEventBreakpointSetCategory(args);
  }

  async handleEventBreakpointRemove(args: Record<string, unknown>) {
    return this.eventBreakpoint.handleEventBreakpointRemove(args);
  }

  async handleEventBreakpointList(args: Record<string, unknown>) {
    return this.eventBreakpoint.handleEventBreakpointList(args);
  }

  // ============ Watch Expressions ============
  async handleWatchAdd(args: Record<string, unknown>) {
    return this.watchExpressions.handleWatchAdd(args);
  }

  async handleWatchRemove(args: Record<string, unknown>) {
    return this.watchExpressions.handleWatchRemove(args);
  }

  async handleWatchList(args: Record<string, unknown>) {
    return this.watchExpressions.handleWatchList(args);
  }

  async handleWatchEvaluateAll(args: Record<string, unknown>) {
    return this.watchExpressions.handleWatchEvaluateAll(args);
  }

  async handleWatchClearAll(args: Record<string, unknown>) {
    return this.watchExpressions.handleWatchClearAll(args);
  }

  // ============ Scope Inspection ============
  async handleGetScopeVariablesEnhanced(args: Record<string, unknown>) {
    return this.scopeInspection.handleGetScopeVariablesEnhanced(args);
  }

  async handleGetObjectProperties(args: Record<string, unknown>) {
    return this.scopeInspection.handleGetObjectProperties(args);
  }

  // ============ Blackbox ============
  async handleBlackboxAdd(args: Record<string, unknown>) {
    return this.blackbox.handleBlackboxAdd(args);
  }

  async handleBlackboxAddCommon(args: Record<string, unknown>) {
    return this.blackbox.handleBlackboxAddCommon(args);
  }

  async handleBlackboxList(args: Record<string, unknown>) {
    return this.blackbox.handleBlackboxList(args);
  }
}

// Re-export handler classes for direct access if needed
export {
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
};
