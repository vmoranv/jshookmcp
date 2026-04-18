import { logger } from '@utils/logger';
import { NetworkMonitor } from '@modules/monitor/NetworkMonitor';
import { PlaywrightNetworkMonitor } from '@modules/monitor/PlaywrightNetworkMonitor';
import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
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
  networkMonitor: NetworkMonitor | null;
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
}

function asSessionCtx(ctx: unknown): SessionCoreContext {
  return ctx as SessionCoreContext;
}

export async function doEnableCdpCore(
  ctx: unknown,
  session: CDPSessionLike,
  managed: boolean,
  options?: { enableNetwork?: boolean; enableExceptions?: boolean },
): Promise<void> {
  const state = asSessionCtx(ctx);
  state.cdpSession = session;
  state.usingManagedTargetSession = managed;
  state.lastEnableOptions = { ...options };

  state.cdpSession.on('disconnected', () => {
    logger.warn('ConsoleMonitor CDP session disconnected');
    state.cdpSession = null;
    state.networkMonitor = null;
    state.usingManagedTargetSession = false;
  });

  await cdpSendWithTimeout(state.cdpSession, 'Runtime.enable', {}, 5000);
  await cdpSendWithTimeout(state.cdpSession, 'Console.enable', {}, 5000);

  state.cdpSession.on('Runtime.consoleAPICalled', (params: RuntimeConsoleApiCalledEvent) => {
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
  });

  state.cdpSession.on('Console.messageAdded', (params: ConsoleMessageAddedEvent) => {
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
  });

  if (options?.enableExceptions !== false) {
    state.cdpSession.on('Runtime.exceptionThrown', (params: RuntimeExceptionThrownEvent) => {
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
    });
  }

  if (options?.enableNetwork) {
    state.networkMonitor = new NetworkMonitor(state.cdpSession);
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
    await state.playwrightNetworkMonitor.disable();
    state.playwrightNetworkMonitor = null;
  }

  if (state.cdpSession) {
    if (state.networkMonitor) {
      await state.networkMonitor.disable();
      state.networkMonitor = null;
    }
    try {
      await state.cdpSession.send('Console.disable');
    } catch (error) {
      logger.warn('Failed to disable Console domain:', error);
    }
    try {
      await state.cdpSession.send('Runtime.disable');
    } catch (error) {
      logger.warn('Failed to disable Runtime domain:', error);
    }
    if (!state.usingManagedTargetSession) {
      try {
        await state.cdpSession.detach();
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
  params: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<T> {
  return Promise.race([
    session.send(method, params),
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}
