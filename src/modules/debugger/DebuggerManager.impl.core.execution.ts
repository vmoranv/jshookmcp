import { logger } from '../../utils/logger.js';
import { PrerequisiteError } from '../../errors/PrerequisiteError.js';
import type { PausedState } from './DebuggerManager.impl.core.class.js';

type PauseOnExceptionsState = 'none' | 'uncaught' | 'all';

type CDPSessionLike = {
  send(method: string, params?: unknown): Promise<unknown>;
};

interface ExecutionCoreContext {
  enabled: boolean;
  cdpSession: CDPSessionLike | null;
  pauseOnExceptionsState: PauseOnExceptionsState;
  pausedState: PausedState | null;
  pausedResolvers: Array<(state: PausedState) => void>;
}

interface EvaluateOnCallFrameResult {
  result: {
    value?: unknown;
    [key: string]: unknown;
  };
}

export interface EvaluateOnCallFrameValue {
  value?: unknown;
  [key: string]: unknown;
}

function asExecutionCoreContext(ctx: unknown): ExecutionCoreContext {
  return ctx as ExecutionCoreContext;
}

export async function setPauseOnExceptionsCore(
  ctx: unknown,
  state: PauseOnExceptionsState
): Promise<void> {
  const coreCtx = asExecutionCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger not enabled');
  }

  try {
    await coreCtx.cdpSession.send('Debugger.setPauseOnExceptions', { state });
    coreCtx.pauseOnExceptionsState = state;
    logger.info(`Pause on exceptions set to: ${state}`);
  } catch (error) {
    logger.error('Failed to set pause on exceptions:', error);
    throw error;
  }
}

export function getPauseOnExceptionsStateCore(ctx: unknown): PauseOnExceptionsState {
  const coreCtx = asExecutionCoreContext(ctx);
  return coreCtx.pauseOnExceptionsState;
}

export async function pauseCore(ctx: unknown): Promise<void> {
  const coreCtx = asExecutionCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger not enabled');
  }

  try {
    await coreCtx.cdpSession.send('Debugger.pause');
    logger.info('Execution paused');
  } catch (error) {
    logger.error('Failed to pause execution:', error);
    throw error;
  }
}

export async function resumeCore(ctx: unknown): Promise<void> {
  const coreCtx = asExecutionCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger not enabled');
  }

  try {
    await coreCtx.cdpSession.send('Debugger.resume');
    logger.info('Execution resumed');
  } catch (error) {
    logger.error('Failed to resume execution:', error);
    throw error;
  }
}

export async function stepIntoCore(ctx: unknown): Promise<void> {
  const coreCtx = asExecutionCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger not enabled');
  }

  try {
    await coreCtx.cdpSession.send('Debugger.stepInto');
    logger.info('Step into');
  } catch (error) {
    logger.error('Failed to step into:', error);
    throw error;
  }
}

export async function stepOverCore(ctx: unknown): Promise<void> {
  const coreCtx = asExecutionCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger not enabled');
  }

  try {
    await coreCtx.cdpSession.send('Debugger.stepOver');
    logger.info('Step over');
  } catch (error) {
    logger.error('Failed to step over:', error);
    throw error;
  }
}

export async function stepOutCore(ctx: unknown): Promise<void> {
  const coreCtx = asExecutionCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger not enabled');
  }

  try {
    await coreCtx.cdpSession.send('Debugger.stepOut');
    logger.info('Step out');
  } catch (error) {
    logger.error('Failed to step out:', error);
    throw error;
  }
}

export function getPausedStateCore(ctx: unknown): PausedState | null {
  const coreCtx = asExecutionCoreContext(ctx);
  return coreCtx.pausedState;
}

export function isPausedCore(ctx: unknown): boolean {
  const coreCtx = asExecutionCoreContext(ctx);
  return coreCtx.pausedState !== null;
}

export async function waitForPausedCore(ctx: unknown, timeout = 30000): Promise<PausedState> {
  const coreCtx = asExecutionCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger is not enabled. Call init() or enable() first.');
  }

  if (coreCtx.pausedState) {
    return coreCtx.pausedState;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = coreCtx.pausedResolvers.indexOf(resolve);
      if (index > -1) {
        coreCtx.pausedResolvers.splice(index, 1);
      }
      reject(new Error('Timeout waiting for paused event'));
    }, timeout);

    coreCtx.pausedResolvers.push((state: PausedState) => {
      clearTimeout(timer);
      resolve(state);
    });
  });
}

export async function evaluateOnCallFrameCore(
  ctx: unknown,
  params: {
    callFrameId: string;
    expression: string;
    returnByValue?: boolean;
  }
): Promise<EvaluateOnCallFrameValue> {
  const coreCtx = asExecutionCoreContext(ctx);

  if (!coreCtx.enabled || !coreCtx.cdpSession) {
    throw new PrerequisiteError('Debugger not enabled');
  }

  if (!coreCtx.pausedState) {
    throw new PrerequisiteError('Not in paused state');
  }

  try {
    const result = (await coreCtx.cdpSession.send('Debugger.evaluateOnCallFrame', {
      callFrameId: params.callFrameId,
      expression: params.expression,
      returnByValue: params.returnByValue !== false,
    })) as EvaluateOnCallFrameResult;

    logger.info(`Evaluated on call frame: ${params.expression}`, {
      result: result.result.value,
    });

    return result.result as EvaluateOnCallFrameValue;
  } catch (error) {
    logger.error('Failed to evaluate on call frame:', error);
    throw error;
  }
}
