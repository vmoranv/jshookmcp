import { logger } from '../../utils/logger.js';
import type {
  BreakpointHitCallback,
  BreakpointHitEvent,
  ScopeVariable,
} from '../../types/index.js';
import type {
  BreakpointInfo,
  CallFrame,
  PausedState,
} from './DebuggerManager.impl.core.class.js';

interface EventsCoreContext {
  breakpointHitCallbacks: Set<BreakpointHitCallback>;
  breakpoints: Map<string, BreakpointInfo>;
  pausedState: PausedState | null;
  pausedResolvers: Array<(state: PausedState) => void>;
  getScopeVariables(options?: { skipErrors?: boolean }): Promise<{ variables: ScopeVariable[] }>;
}

interface PausedEventParams {
  callFrames: CallFrame[];
  reason: string;
  data?: unknown;
  hitBreakpoints?: string[];
}

interface BreakpointResolvedParams {
  breakpointId: string;
  location?: unknown;
}

function asEventsCoreContext(ctx: unknown): EventsCoreContext {
  return ctx as EventsCoreContext;
}

export function onBreakpointHitCore(ctx: unknown, callback: BreakpointHitCallback): void {
  const coreCtx = asEventsCoreContext(ctx);
  coreCtx.breakpointHitCallbacks.add(callback);
  logger.info('Breakpoint hit callback registered', {
    totalCallbacks: coreCtx.breakpointHitCallbacks.size,
  });
}

export function offBreakpointHitCore(ctx: unknown, callback: BreakpointHitCallback): void {
  const coreCtx = asEventsCoreContext(ctx);
  coreCtx.breakpointHitCallbacks.delete(callback);
  logger.info('Breakpoint hit callback removed', {
    totalCallbacks: coreCtx.breakpointHitCallbacks.size,
  });
}

export function clearBreakpointHitCallbacksCore(ctx: unknown): void {
  const coreCtx = asEventsCoreContext(ctx);
  coreCtx.breakpointHitCallbacks.clear();
  logger.info('All breakpoint hit callbacks cleared');
}

export function getBreakpointHitCallbackCountCore(ctx: unknown): number {
  const coreCtx = asEventsCoreContext(ctx);
  return coreCtx.breakpointHitCallbacks.size;
}

export async function handlePausedCore(ctx: unknown, params: PausedEventParams): Promise<void> {
  const coreCtx = asEventsCoreContext(ctx);

  const pausedState: PausedState = {
    callFrames: params.callFrames,
    reason: params.reason,
    data: params.data,
    hitBreakpoints: params.hitBreakpoints,
    timestamp: Date.now(),
  };
  coreCtx.pausedState = pausedState;

  if (params.hitBreakpoints) {
    for (const breakpointId of params.hitBreakpoints) {
      const bp = coreCtx.breakpoints.get(breakpointId);
      if (bp) {
        bp.hitCount++;
      }
    }
  }

  logger.info('Execution paused', {
    reason: params.reason,
    location: params.callFrames[0]?.location,
    hitBreakpoints: params.hitBreakpoints,
  });

  if (
    params.hitBreakpoints &&
    params.hitBreakpoints.length > 0 &&
    coreCtx.breakpointHitCallbacks.size > 0
  ) {
    const firstHitBreakpointId = params.hitBreakpoints[0]!;
    const topFrame = params.callFrames[0]!;

    let variables: ScopeVariable[] | undefined;
    try {
      const result = await coreCtx.getScopeVariables({ skipErrors: true });
      variables = result.variables;
    } catch (error) {
      logger.debug('Failed to auto-fetch variables for breakpoint hit callback:', error);
    }

    const event: BreakpointHitEvent = {
      breakpointId: firstHitBreakpointId,
      breakpointInfo: coreCtx.breakpoints.get(firstHitBreakpointId),
      location: {
        scriptId: topFrame.location.scriptId,
        lineNumber: topFrame.location.lineNumber,
        columnNumber: topFrame.location.columnNumber,
        url: topFrame.url,
      },
      callFrames: params.callFrames,
      timestamp: Date.now(),
      variables,
      reason: params.reason,
    };

    for (const callback of coreCtx.breakpointHitCallbacks) {
      try {
        await Promise.resolve(callback(event));
      } catch (error) {
        logger.error('Breakpoint hit callback error:', error);
      }
    }
  }

  for (const resolver of coreCtx.pausedResolvers) {
    resolver(coreCtx.pausedState);
  }
  coreCtx.pausedResolvers = [];
}

export function handleResumedCore(ctx: unknown): void {
  const coreCtx = asEventsCoreContext(ctx);
  coreCtx.pausedState = null;
  logger.info('Execution resumed');
}

export function handleBreakpointResolvedCore(ctx: unknown, params: BreakpointResolvedParams): void {
  const coreCtx = asEventsCoreContext(ctx);
  const bp = coreCtx.breakpoints.get(params.breakpointId);
  if (bp) {
    logger.info('Breakpoint resolved', {
      breakpointId: params.breakpointId,
      location: params.location,
    });
  }
}
