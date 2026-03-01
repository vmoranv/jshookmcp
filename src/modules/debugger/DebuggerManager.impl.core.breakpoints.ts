import { logger } from '../../utils/logger.js';
import { PrerequisiteError } from '../../errors/PrerequisiteError.js';
import type { BreakpointInfo } from './DebuggerManager.impl.core.class.js';

type CDPSessionLike = {
  send<T = unknown>(method: string, params?: unknown): Promise<T>;
};

interface BreakpointsCoreContext {
  enabled: boolean;
  cdpSession: CDPSessionLike | null;
  ensureSession(): Promise<void>;
  breakpoints: Map<string, BreakpointInfo>;
  removeBreakpoint(breakpointId: string): Promise<void>;
}

interface SetBreakpointResult {
  breakpointId: string;
}

function asBreakpointsCoreContext(ctx: unknown): BreakpointsCoreContext {
  return ctx as BreakpointsCoreContext;
}

export async function setBreakpointByUrlCore(
  ctx: unknown,
  params: {
    url: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }
): Promise<BreakpointInfo> {
  const coreCtx = asBreakpointsCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    try {
      await coreCtx.ensureSession();
    } catch {
      throw new PrerequisiteError('Debugger is not enabled and auto-reconnect failed. Call init() or enable() first.');
    }
  }

  if (!params.url) {
    throw new Error('url parameter is required');
  }

  if (params.lineNumber < 0) {
    throw new Error('lineNumber must be a non-negative number');
  }

  if (params.columnNumber !== undefined && params.columnNumber < 0) {
    throw new Error('columnNumber must be a non-negative number');
  }

  try {
    const result = await coreCtx.cdpSession!.send<SetBreakpointResult>('Debugger.setBreakpointByUrl', {
      url: params.url,
      lineNumber: params.lineNumber,
      columnNumber: params.columnNumber,
      condition: params.condition,
    });

    const breakpointInfo: BreakpointInfo = {
      breakpointId: result.breakpointId,
      location: {
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    };

    coreCtx.breakpoints.set(result.breakpointId, breakpointInfo);

    logger.info(`Breakpoint set: ${params.url}:${params.lineNumber}`, {
      breakpointId: result.breakpointId,
      condition: params.condition,
    });

    return breakpointInfo;
  } catch (error: unknown) {
    logger.error('Failed to set breakpoint:', error);
    throw error;
  }
}

export async function setBreakpointCore(
  ctx: unknown,
  params: {
    scriptId: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
  }
): Promise<BreakpointInfo> {
  const coreCtx = asBreakpointsCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    try {
      await coreCtx.ensureSession();
    } catch {
      throw new PrerequisiteError('Debugger is not enabled and auto-reconnect failed. Call init() or enable() first.');
    }
  }

  if (!params.scriptId) {
    throw new Error('scriptId parameter is required');
  }

  if (params.lineNumber < 0) {
    throw new Error('lineNumber must be a non-negative number');
  }

  if (params.columnNumber !== undefined && params.columnNumber < 0) {
    throw new Error('columnNumber must be a non-negative number');
  }

  try {
    const result = await coreCtx.cdpSession!.send<SetBreakpointResult>('Debugger.setBreakpoint', {
      location: {
        scriptId: params.scriptId,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
    });

    const breakpointInfo: BreakpointInfo = {
      breakpointId: result.breakpointId,
      location: {
        scriptId: params.scriptId,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      enabled: true,
      hitCount: 0,
      createdAt: Date.now(),
    };

    coreCtx.breakpoints.set(result.breakpointId, breakpointInfo);

    logger.info(`Breakpoint set: scriptId=${params.scriptId}:${params.lineNumber}`, {
      breakpointId: result.breakpointId,
    });

    return breakpointInfo;
  } catch (error: unknown) {
    logger.error('Failed to set breakpoint:', error);
    throw error;
  }
}

export async function removeBreakpointCore(ctx: unknown, breakpointId: string): Promise<void> {
  const coreCtx = asBreakpointsCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger is not enabled. Call init() or enable() first.');
  }

  if (!breakpointId) {
    throw new Error('breakpointId parameter is required');
  }

  if (!coreCtx.breakpoints.has(breakpointId)) {
    throw new Error(`Breakpoint not found: ${breakpointId}. Use listBreakpoints() to see active breakpoints.`);
  }

  try {
    await coreCtx.cdpSession.send('Debugger.removeBreakpoint', { breakpointId });
    coreCtx.breakpoints.delete(breakpointId);

    logger.info(`Breakpoint removed: ${breakpointId}`);
  } catch (error: unknown) {
    logger.error(`Failed to remove breakpoint ${breakpointId}:`, error);
    throw error;
  }
}

export function listBreakpointsCore(ctx: unknown): BreakpointInfo[] {
  const coreCtx = asBreakpointsCoreContext(ctx);
  return Array.from(coreCtx.breakpoints.values());
}

export function getBreakpointCore(ctx: unknown, breakpointId: string): BreakpointInfo | undefined {
  const coreCtx = asBreakpointsCoreContext(ctx);
  return coreCtx.breakpoints.get(breakpointId);
}

export async function clearAllBreakpointsCore(ctx: unknown): Promise<void> {
  const coreCtx = asBreakpointsCoreContext(ctx);
  const breakpointIds = Array.from(coreCtx.breakpoints.keys());

  for (const id of breakpointIds) {
    await coreCtx.removeBreakpoint(id);
  }

  logger.info(`Cleared ${breakpointIds.length} breakpoints`);
}
