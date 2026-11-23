import { logger } from '@utils/logger';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import type { BreakpointInfo } from '@modules/debugger/DebuggerManager.impl.core.class';

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

/** Shared line/column validation for code-location breakpoints. */
function validateBreakpointPosition(lineNumber: number, columnNumber: number | undefined): void {
  if (lineNumber < 0) {
    throw new Error('lineNumber must be a non-negative number');
  }
  if (columnNumber !== undefined && columnNumber < 0) {
    throw new Error('columnNumber must be a non-negative number');
  }
}

/** Build the bookkeeping entry stored in the breakpoints map after a CDP set. */
function buildBreakpointInfo(params: {
  breakpointId: string;
  location: BreakpointInfo['location'];
  condition?: string;
  logMessage?: string;
}): BreakpointInfo {
  return {
    breakpointId: params.breakpointId,
    location: params.location,
    condition: params.condition,
    logMessage: params.logMessage,
    enabled: true,
    hitCount: 0,
    createdAt: Date.now(),
  };
}

async function ensureUsableSession(coreCtx: BreakpointsCoreContext): Promise<void> {
  if (coreCtx.enabled && coreCtx.cdpSession) {
    return;
  }
  try {
    await coreCtx.ensureSession();
  } catch (err) {
    logger.warn(
      `Debugger auto-reconnect failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw new PrerequisiteError(
      'Debugger is not enabled and auto-reconnect failed. ' +
        'Run browser_launch/browser_attach first if no browser session exists, then ' +
        'debugger_lifecycle(action="enable"). Retry without changes will fail again.',
    );
  }
  // ensureSession may "succeed" without restoring a session — never touch a
  // null cdpSession afterwards.
  if (!coreCtx.cdpSession) {
    throw new PrerequisiteError(
      'Debugger auto-reconnect did not restore the CDP session. ' +
        'Call debugger_lifecycle(action="enable") to re-initialise; do not retry unchanged.',
    );
  }
}

export async function setBreakpointByUrlCore(
  ctx: unknown,
  params: {
    url: string;
    lineNumber: number;
    columnNumber?: number;
    condition?: string;
    logMessage?: string;
  },
): Promise<BreakpointInfo> {
  const coreCtx = asBreakpointsCoreContext(ctx);

  await ensureUsableSession(coreCtx);

  if (!params.url) {
    throw new Error('url parameter is required');
  }

  validateBreakpointPosition(params.lineNumber, params.columnNumber);

  try {
    const result = await coreCtx.cdpSession!.send<SetBreakpointResult>(
      'Debugger.setBreakpointByUrl',
      {
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
        condition: params.condition,
        logMessage: params.logMessage,
      },
    );

    const breakpointInfo = buildBreakpointInfo({
      breakpointId: result.breakpointId,
      location: {
        url: params.url,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      logMessage: params.logMessage,
    });

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
    logMessage?: string;
  },
): Promise<BreakpointInfo> {
  const coreCtx = asBreakpointsCoreContext(ctx);

  await ensureUsableSession(coreCtx);

  if (!params.scriptId) {
    throw new Error('scriptId parameter is required');
  }

  validateBreakpointPosition(params.lineNumber, params.columnNumber);

  try {
    const result = await coreCtx.cdpSession!.send<SetBreakpointResult>('Debugger.setBreakpoint', {
      location: {
        scriptId: params.scriptId,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      logMessage: params.logMessage,
    });

    const breakpointInfo = buildBreakpointInfo({
      breakpointId: result.breakpointId,
      location: {
        scriptId: params.scriptId,
        lineNumber: params.lineNumber,
        columnNumber: params.columnNumber,
      },
      condition: params.condition,
      logMessage: params.logMessage,
    });

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

export async function setBreakpointOnFunctionCallCore(
  ctx: unknown,
  functionName: string,
): Promise<{ breakpointId: string; functionName: string }> {
  const coreCtx = asBreakpointsCoreContext(ctx);

  await ensureUsableSession(coreCtx);

  if (!functionName) {
    throw new Error('functionName parameter is required');
  }

  // `functionName` is evaluated in the page. Restrict it to a plain identifier
  // path so a caller cannot inject arbitrary script via this parameter.
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(functionName)) {
    throw new Error(
      `functionName must be a plain identifier path (e.g. "myFn" or "app.myFn"), got '${functionName}'`,
    );
  }

  const objectGroup = 'jshook-breakpoint-function';
  try {
    // Resolve the function reference via globalThis lookup. The bare name is
    // evaluated in the global context; returnByValue:false keeps the handle.
    const evalResult = await coreCtx.cdpSession!.send<{
      result?: { objectId?: string; type?: string; subtype?: string; description?: string };
      exceptionDetails?: unknown;
    }>('Runtime.evaluate', {
      expression: functionName,
      returnByValue: false,
      objectGroup,
      throwOnSideEffect: true,
    });

    if (evalResult?.exceptionDetails) {
      throw new Error(
        `Function '${functionName}' not found in global scope. Ensure the script defining it has loaded, or use type=code with a scriptId.`,
      );
    }

    const objectId = evalResult?.result?.objectId;
    const resultType = evalResult?.result?.type;
    if (!objectId || resultType !== 'function') {
      throw new Error(
        `Function '${functionName}' not found in global scope (resolved as ${
          resultType ?? 'undefined'
        }). Ensure the script defining it has loaded, or use type=code with a scriptId.`,
      );
    }

    const bpResult = await coreCtx.cdpSession!.send<SetBreakpointResult>(
      'Debugger.setBreakpointOnFunctionCall',
      { objectId },
    );

    const breakpointInfo = buildBreakpointInfo({
      breakpointId: bpResult.breakpointId,
      location: { lineNumber: 0 },
    });
    coreCtx.breakpoints.set(bpResult.breakpointId, breakpointInfo);

    logger.info(`Breakpoint set on function: ${functionName}`, {
      breakpointId: bpResult.breakpointId,
    });

    return { breakpointId: bpResult.breakpointId, functionName };
  } catch (error: unknown) {
    logger.error(`Failed to set breakpoint on function '${functionName}':`, error);
    throw error;
  } finally {
    // Release the remote object handle obtained above; the breakpoint itself
    // keeps the target function alive.
    await coreCtx.cdpSession?.send('Runtime.releaseObjectGroup', { objectGroup }).catch(() => {});
  }
}

export async function removeBreakpointCore(ctx: unknown, breakpointId: string): Promise<void> {
  const coreCtx = asBreakpointsCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError(
      'Debugger is not enabled. Call debugger_lifecycle(action="enable") first; ' +
        'retrying this remove without enabling will fail again.',
    );
  }

  if (!breakpointId) {
    throw new Error(
      'breakpointId parameter is required. Use breakpoint(action="list", type="code") to ' +
        'see active breakpoint IDs.',
    );
  }

  if (!coreCtx.breakpoints.has(breakpointId)) {
    throw new Error(
      `Breakpoint not found: ${breakpointId}. It may already have been removed. ` +
        'Call breakpoint(action="list") for active IDs — do not retry the same remove.',
    );
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

  // Best-effort: a single failed removal must not abort the sweep, or the
  // remaining breakpoints would be stuck in the local map forever.
  let failures = 0;
  for (const id of breakpointIds) {
    try {
      await coreCtx.removeBreakpoint(id);
    } catch (error) {
      failures += 1;
      logger.warn(`Failed to remove breakpoint ${id} while clearing all:`, error);
    }
  }

  if (failures > 0) {
    logger.error(
      `Failed to clear ${failures}/${breakpointIds.length} breakpoints (remaining kept for retry)`,
    );
  } else {
    logger.info(`Cleared ${breakpointIds.length} breakpoints`);
  }
}
