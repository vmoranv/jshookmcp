import { logger } from '@utils/logger';
import { NetworkMonitor } from '@modules/monitor/NetworkMonitor';
import { PlaywrightNetworkMonitor } from '@modules/monitor/PlaywrightNetworkMonitor';
import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
import type { NetworkMonitorLike } from '@modules/monitor/NetworkMonitor.types';
import type {
  ConsoleMessage,
  ConsoleMessageAddedEvent,
  ExceptionInfo,
  PlaywrightConsoleMessageLike,
  PlaywrightConsolePageLike,
  RuntimeConsoleApiCalledEvent,
  RuntimeExceptionThrownEvent,
  StackFrame,
  CdpRemoteObject,
} from './ConsoleMonitor.types';

type PlaywrightNetworkMonitorPage = ConstructorParameters<typeof PlaywrightNetworkMonitor>[0];

interface SessionCoreContext {
  cdpSession: CDPSessionLike | null;
  networkMonitor: NetworkMonitorLike | null;
  playwrightNetworkMonitor: PlaywrightNetworkMonitor | null;
  playwrightPage: unknown;
  playwrightConsoleHandler: ((msg: PlaywrightConsoleMessageLike) => void) | null;
  playwrightErrorHandler: ((error: Error) => void) | null;
  usingManagedTargetSession: boolean;
  messages: ConsoleMessage[];
  exceptions: ExceptionInfo[];
  MAX_MESSAGES: number;
  MAX_EXCEPTIONS: number;
  lastEnableOptions: { enableNetwork?: boolean; enableExceptions?: boolean };
  formatRemoteObject(obj: CdpRemoteObject): string;
  extractValue(obj: CdpRemoteObject): unknown;
  // Stored so disableCore() can detach them. Re-enabling the same managed
  // target session otherwise accumulates duplicate listeners.
  cdpDisconnectedHandler?: (() => void) | null;
  cdpConsoleApiCalledHandler?: ((params: RuntimeConsoleApiCalledEvent) => void) | null;
  cdpConsoleMessageHandler?: ((params: ConsoleMessageAddedEvent) => void) | null;
  cdpExceptionHandler?: ((params: RuntimeExceptionThrownEvent) => void) | null;
}

function asSessionCtx(ctx: unknown): SessionCoreContext {
  return ctx as SessionCoreContext;
}

function detachCdpHandlers(state: SessionCoreContext, session: CDPSessionLike | null): void {
  if (!session) {
    return;
  }
  const detach = (
    event: string,
    handler: ((...args: never[]) => void) | null | undefined,
  ): void => {
    if (!handler) {
      return;
    }
    try {
      session.off(event, handler as (payload: unknown) => void);
    } catch {
      /* best-effort detach during shutdown */
    }
  };
  detach('disconnected', state.cdpDisconnectedHandler);
  detach('Runtime.consoleAPICalled', state.cdpConsoleApiCalledHandler);
  detach('Console.messageAdded', state.cdpConsoleMessageHandler);
  detach('Runtime.exceptionThrown', state.cdpExceptionHandler);
  state.cdpDisconnectedHandler = null;
  state.cdpConsoleApiCalledHandler = null;
  state.cdpConsoleMessageHandler = null;
  state.cdpExceptionHandler = null;
}

export async function doEnableCdpCore(
  ctx: unknown,
  session: CDPSessionLike,
  managed: boolean,
  options?: { enableNetwork?: boolean; enableExceptions?: boolean },
): Promise<void> {
  const state = asSessionCtx(ctx);
  // Drop listeners from a previous session before replacing it.
  if (state.cdpSession && state.cdpSession !== session) {
    detachCdpHandlers(state, state.cdpSession);
  }
  state.cdpSession = session;
  state.usingManagedTargetSession = managed;
  state.lastEnableOptions = { ...options };

  const disconnectedHandler = (): void => {
    logger.warn('ConsoleMonitor CDP session disconnected');
    // Guard against a stale zombie session's late 'disconnected' event
    // clobbering a newer session installed after reinitialization.
    if (state.cdpSession === session) {
      state.cdpSession = null;
      state.networkMonitor = null;
      state.usingManagedTargetSession = false;
    }
  };
  state.cdpDisconnectedHandler = disconnectedHandler;
  session.on('disconnected', disconnectedHandler);

  await cdpSendWithTimeout(session, 'Runtime.enable', {}, 5000);
  await cdpSendWithTimeout(session, 'Console.enable', {}, 5000);

  if (state.cdpSession !== session) {
    // The session disconnected (or was replaced) while the domains were being
    // enabled. Registering listeners now would mutate a dead/stale session.
    logger.warn('ConsoleMonitor CDP session changed during enable; aborting listener setup');
    detachCdpHandlers(state, session);
    return;
  }

  const consoleApiCalledHandler = (params: RuntimeConsoleApiCalledEvent): void => {
    const stackTrace: StackFrame[] =
      params.stackTrace?.callFrames?.map((frame) => ({
        functionName: frame.functionName || '(anonymous)',
        url: frame.url,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
      })) || [];
    const message: ConsoleMessage = {
      type: params.type,
      text: params.args.map((arg) => state.formatRemoteObject(arg)).join(' '),
      args: params.args.map((arg) => state.extractValue(arg)),
      timestamp: params.timestamp,
      stackTrace,
      url: stackTrace[0]?.url,
      lineNumber: stackTrace[0]?.lineNumber,
      columnNumber: stackTrace[0]?.columnNumber,
    };
    state.messages.push(message);
    if (state.messages.length > state.MAX_MESSAGES) {
      state.messages = state.messages.slice(-Math.floor(state.MAX_MESSAGES / 2));
    }
    logger.debug(`Console ${params.type}: ${message.text}`);
  };
  state.cdpConsoleApiCalledHandler = consoleApiCalledHandler;
  session.on('Runtime.consoleAPICalled', consoleApiCalledHandler);

  const consoleMessageHandler = (params: ConsoleMessageAddedEvent): void => {
    const msg = params.message;
    const message: ConsoleMessage = {
      type: msg.level || 'log',
      text: msg.text,
      timestamp: Date.now(),
      url: msg.url,
      lineNumber: msg.line,
      columnNumber: msg.column,
    };
    state.messages.push(message);
    if (state.messages.length > state.MAX_MESSAGES) {
      state.messages = state.messages.slice(-Math.floor(state.MAX_MESSAGES / 2));
    }
  };
  state.cdpConsoleMessageHandler = consoleMessageHandler;
  session.on('Console.messageAdded', consoleMessageHandler);

  if (options?.enableExceptions !== false) {
    const exceptionHandler = (params: RuntimeExceptionThrownEvent): void => {
      const exception = params.exceptionDetails;
      const stackTrace: StackFrame[] =
        exception.stackTrace?.callFrames?.map((frame) => ({
          functionName: frame.functionName || '(anonymous)',
          url: frame.url,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
        })) || [];
      const exceptionInfo: ExceptionInfo = {
        text: exception.exception?.description || exception.text,
        exceptionId: exception.exceptionId,
        timestamp: Date.now(),
        stackTrace,
        url: exception.url,
        lineNumber: exception.lineNumber,
        columnNumber: exception.columnNumber,
        scriptId: exception.scriptId,
      };
      state.exceptions.push(exceptionInfo);
      if (state.exceptions.length > state.MAX_EXCEPTIONS) {
        state.exceptions = state.exceptions.slice(-Math.floor(state.MAX_EXCEPTIONS / 2));
      }
      logger.error(`Exception thrown: ${exceptionInfo.text}`, {
        url: exceptionInfo.url,
        line: exceptionInfo.lineNumber,
      });
    };
    state.cdpExceptionHandler = exceptionHandler;
    session.on('Runtime.exceptionThrown', exceptionHandler);
  }

  if (options?.enableNetwork) {
    const collectorWithTargets = state as SessionCoreContext & {
      getManagedTargetNetworkMonitor?: () => NetworkMonitorLike | null;
    };
    state.networkMonitor =
      collectorWithTargets.getManagedTargetNetworkMonitor?.() ?? new NetworkMonitor(session);
    await state.networkMonitor.enable();
  }

  logger.info('ConsoleMonitor enabled', {
    network: options?.enableNetwork || false,
    exceptions: options?.enableExceptions !== false,
  });
}

export async function enablePlaywrightCore(
  ctx: unknown,
  options?: { enableNetwork?: boolean; enableExceptions?: boolean },
): Promise<void> {
  const state = asSessionCtx(ctx);

  if (state.playwrightConsoleHandler) {
    if (options?.enableNetwork && !state.playwrightNetworkMonitor) {
      state.playwrightNetworkMonitor = new PlaywrightNetworkMonitor(
        state.playwrightPage as PlaywrightNetworkMonitorPage,
      );
      await state.playwrightNetworkMonitor.enable();
      logger.info('Network monitoring added to existing ConsoleMonitor Playwright session');
    }
    return;
  }

  const page = state.playwrightPage as PlaywrightConsolePageLike;
  state.playwrightConsoleHandler = (msg: PlaywrightConsoleMessageLike) => {
    const message: ConsoleMessage = {
      type: msg.type() || 'log',
      text: msg.text(),
      timestamp: Date.now(),
    };
    state.messages.push(message);
    if (state.messages.length > state.MAX_MESSAGES) {
      state.messages = state.messages.slice(-Math.floor(state.MAX_MESSAGES / 2));
    }
  };
  page.on('console', state.playwrightConsoleHandler);

  if (options?.enableExceptions !== false) {
    state.playwrightErrorHandler = (error: Error) => {
      const exceptionInfo: ExceptionInfo = {
        text: error.message,
        exceptionId: Date.now(),
        timestamp: Date.now(),
      };
      state.exceptions.push(exceptionInfo);
      if (state.exceptions.length > state.MAX_EXCEPTIONS) {
        state.exceptions = state.exceptions.slice(-Math.floor(state.MAX_EXCEPTIONS / 2));
      }
    };
    page.on('pageerror', state.playwrightErrorHandler);
  }

  if (options?.enableNetwork) {
    state.playwrightNetworkMonitor = new PlaywrightNetworkMonitor(
      state.playwrightPage as PlaywrightNetworkMonitorPage,
    );
    await state.playwrightNetworkMonitor.enable();
  }

  logger.info('ConsoleMonitor enabled (Playwright/camoufox mode)', {
    network: options?.enableNetwork || false,
  });
}

export async function disableCore(ctx: unknown): Promise<void> {
  const state = asSessionCtx(ctx);

  if (state.playwrightPage) {
    const page = state.playwrightPage as PlaywrightConsolePageLike;
    if (state.playwrightConsoleHandler) {
      try {
        page.off('console', state.playwrightConsoleHandler);
      } catch {
        /* best-effort detach during shutdown */
      }
      state.playwrightConsoleHandler = null;
    }
    if (state.playwrightErrorHandler) {
      try {
        page.off('pageerror', state.playwrightErrorHandler);
      } catch {
        /* best-effort detach during shutdown */
      }
      state.playwrightErrorHandler = null;
    }
  }

  if (state.playwrightNetworkMonitor) {
    try {
      await state.playwrightNetworkMonitor.disable();
    } catch (error) {
      logger.warn('Failed to disable Playwright network monitor:', error);
    }
    state.playwrightNetworkMonitor = null;
  }

  if (state.cdpSession) {
    const session = state.cdpSession;
    if (state.networkMonitor) {
      try {
        await state.networkMonitor.disable();
      } catch (error) {
        logger.warn('Failed to disable network monitor:', error);
      }
      state.networkMonitor = null;
    }
    try {
      // A zombie session never answers; bound each cleanup step so disable()
      // (including the enable() rollback path) always terminates.
      await cdpSendWithTimeout(session, 'Console.disable', undefined, 5000);
    } catch (error) {
      logger.warn('Failed to disable Console domain:', error);
    }
    try {
      // A zombie session never answers; bound each cleanup step so disable()
      // (including the enable() rollback path) always terminates.
      await cdpSendWithTimeout(session, 'Runtime.disable', undefined, 5000);
    } catch (error) {
      logger.warn('Failed to disable Runtime domain:', error);
    }
    // Detach listeners regardless of whether the domain disables succeeded,
    // otherwise a reused managed target session accumulates duplicates.
    detachCdpHandlers(state, session);
    if (!state.usingManagedTargetSession) {
      try {
        await session.detach();
      } catch (error) {
        logger.warn('Failed to detach ConsoleMonitor CDP session:', error);
      }
    } else {
      logger.debug('ConsoleMonitor released managed target session without detaching target');
    }
    state.cdpSession = null;
    state.usingManagedTargetSession = false;
    logger.info('ConsoleMonitor disabled');
  }
}

export async function cdpSendWithTimeout<T>(
  session: { send(method: string, params?: Record<string, unknown>): Promise<T> },
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<T> {
  return Promise.race([
    params === undefined ? session.send(method) : session.send(method, params),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}
