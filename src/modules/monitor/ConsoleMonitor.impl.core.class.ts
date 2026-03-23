import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { logger } from '@utils/logger';
import { NetworkMonitor } from '@modules/monitor/NetworkMonitor';
import { PlaywrightNetworkMonitor } from '@modules/monitor/PlaywrightNetworkMonitor';
import { FetchInterceptor } from '@modules/monitor/FetchInterceptor';
import type { FetchInterceptRule, FetchInterceptRuleInput } from '@modules/monitor/FetchInterceptor';
import {
  clearExceptionsCore,
  clearLogsCore,
  getExceptionsCore,
  getLogsCore,
  getStatsCore,
} from '@modules/monitor/ConsoleMonitor.impl.core.logs';
import {
  clearInjectedBuffersCore,
  clearNetworkRecordsCore,
  getAllJavaScriptResponsesCore,
  getFetchRequestsCore,
  getNetworkActivityCore,
  getNetworkRequestsCore,
  getNetworkResponsesCore,
  getNetworkStatsCore,
  getNetworkStatusCore,
  getResponseBodyCore,
  getXHRRequestsCore,
  injectFetchInterceptorCore,
  injectXHRInterceptorCore,
  isNetworkEnabledCore,
  resetInjectedInterceptorsCore,
} from '@modules/monitor/ConsoleMonitor.impl.core.network';
import {
  clearObjectCacheCore,
  inspectObjectCore,
} from '@modules/monitor/ConsoleMonitor.impl.core.object-cache';
import type { InspectedObjectProperties } from '@modules/monitor/ConsoleMonitor.impl.core.object-cache';
import {
  clearDynamicScriptBufferCore,
  enableDynamicScriptMonitoringCore,
  getDynamicScriptsCore,
  injectFunctionTracerCore,
  injectPropertyWatcherCore,
  resetDynamicScriptMonitoringCore,
} from '@modules/monitor/ConsoleMonitor.impl.core.dynamic';
export type { NetworkRequest, NetworkResponse } from '@modules/monitor/NetworkMonitor';
export type { FetchInterceptRule, FetchInterceptRuleInput } from '@modules/monitor/FetchInterceptor';

type ConsoleMessageType = 'log' | 'warn' | 'error' | 'info' | 'debug' | 'trace' | 'dir' | 'table';

interface CdpRemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
}

interface CdpCallFrame {
  functionName?: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}

interface CdpStackTrace {
  callFrames?: CdpCallFrame[];
}

interface RuntimeConsoleApiCalledEvent {
  type: string;
  args: CdpRemoteObject[];
  timestamp: number;
  stackTrace?: CdpStackTrace;
}

interface ConsoleMessageAddedEvent {
  message: {
    level?: string;
    text: string;
    url?: string;
    line?: number;
    column?: number;
  };
}

interface RuntimeExceptionDetails {
  text: string;
  exceptionId: number;
  stackTrace?: CdpStackTrace;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptId?: string;
  exception?: {
    description?: string;
  };
}

interface RuntimeExceptionThrownEvent {
  exceptionDetails: RuntimeExceptionDetails;
}

interface RuntimeEvaluateResult {
  result: {
    value?: unknown;
  };
  exceptionDetails?: {
    text: string;
  };
}

interface PlaywrightConsoleMessageLike {
  type(): string;
  text(): string;
}

interface PlaywrightConsolePageLike {
  on(event: 'console', handler: (msg: PlaywrightConsoleMessageLike) => void): void;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  off(event: 'console', handler: (msg: PlaywrightConsoleMessageLike) => void): void;
  off(event: 'pageerror', handler: (error: Error) => void): void;
}

type PlaywrightNetworkMonitorPage = ConstructorParameters<typeof PlaywrightNetworkMonitor>[0];

export interface ConsoleMessage {
  type: ConsoleMessageType | string;
  text: string;
  args?: unknown[];
  timestamp: number;
  stackTrace?: StackFrame[];
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}
export interface StackFrame {
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}
export interface ExceptionInfo {
  text: string;
  exceptionId: number;
  timestamp: number;
  stackTrace?: StackFrame[];
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptId?: string;
}
export class ConsoleMonitor {
  private cdpSession: CDPSession | null = null;
  private networkMonitor: NetworkMonitor | null = null;
  private fetchInterceptor: FetchInterceptor | null = null;
  private playwrightNetworkMonitor: PlaywrightNetworkMonitor | null = null;
  private playwrightPage: unknown = null;
  private playwrightConsoleHandler: ((msg: PlaywrightConsoleMessageLike) => void) | null = null;
  private playwrightErrorHandler: ((error: Error) => void) | null = null;
  private messages: ConsoleMessage[] = [];
  private readonly MAX_MESSAGES = 1000;
  private exceptions: ExceptionInfo[] = [];
  private readonly MAX_EXCEPTIONS = 500;
  private readonly MAX_INJECTED_DYNAMIC_SCRIPTS = 500;
  private readonly MAX_OBJECT_CACHE_SIZE = 1000;
  private objectCache: Map<string, InspectedObjectProperties> = new Map();
  private initPromise?: Promise<void>;
  private lastEnableOptions: { enableNetwork?: boolean; enableExceptions?: boolean } = {};
  constructor(private collector: CodeCollector) {
    this.touchSplitMembersForTypeCheck();
  }
  private touchSplitMembersForTypeCheck(): void {
    void this.MAX_INJECTED_DYNAMIC_SCRIPTS;
    void this.MAX_OBJECT_CACHE_SIZE;
    void this.clearDynamicScriptBuffer;
    void this.resetDynamicScriptMonitoring;
  }
  setPlaywrightPage(page: unknown): void {
    this.playwrightPage = page;
    this.playwrightNetworkMonitor?.setPage(page as PlaywrightNetworkMonitorPage | null);
  }
  clearPlaywrightPage(): void {
    this.playwrightPage = null;
    this.playwrightConsoleHandler = null;
    this.playwrightErrorHandler = null;
    this.playwrightNetworkMonitor?.setPage(null);
    this.playwrightNetworkMonitor = null;
  }
  async enable(options?: { enableNetwork?: boolean; enableExceptions?: boolean }): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      await this.applyPostEnableOptions(options);
      return;
    }
    this.initPromise = this.doEnable(options);
    try {
      await this.initPromise;
    } finally {
      this.initPromise = undefined;
    }
  }
  private async doEnable(options?: {
    enableNetwork?: boolean;
    enableExceptions?: boolean;
  }): Promise<void> {
    if (this.playwrightPage) {
      this.lastEnableOptions = { ...options };
      return this.enablePlaywright(options);
    }
    if (this.cdpSession) {
      if (options?.enableNetwork && !this.networkMonitor) {
        this.networkMonitor = new NetworkMonitor(this.cdpSession);
        await this.networkMonitor.enable();
        logger.info('Network monitoring added to existing ConsoleMonitor session');
      }
      return;
    }
    const page = await this.collector.getActivePage();
    // Wrap session creation so a hanging createCDPSession() cannot block.
    this.cdpSession = await Promise.race([
      page.createCDPSession() as unknown as Promise<CDPSession>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('cdp_session_timeout')), 500),
      ),
    ] as Promise<CDPSession>[]);
    this.lastEnableOptions = { ...options };
    this.cdpSession.on('disconnected', () => {
      logger.warn('ConsoleMonitor CDP session disconnected');
      this.cdpSession = null;
      this.networkMonitor = null;
      this.fetchInterceptor = null;
    });
    // Wrap enable calls so they cannot hang if the session is immediately zombie.
    await cdpSendWithTimeout(this.cdpSession, 'Runtime.enable', {}, 5000);
    await cdpSendWithTimeout(this.cdpSession, 'Console.enable', {}, 5000);
    this.cdpSession.on('Runtime.consoleAPICalled', (params: RuntimeConsoleApiCalledEvent) => {
      const stackTrace: StackFrame[] =
        params.stackTrace?.callFrames?.map((frame) => ({
          functionName: frame.functionName || '(anonymous)',
          url: frame.url,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
        })) || [];
      const message: ConsoleMessage = {
        type: params.type,
        text: params.args.map((arg) => this.formatRemoteObject(arg)).join(' '),
        args: params.args.map((arg) => this.extractValue(arg)),
        timestamp: params.timestamp,
        stackTrace,
        url: stackTrace[0]?.url,
        lineNumber: stackTrace[0]?.lineNumber,
        columnNumber: stackTrace[0]?.columnNumber,
      };
      this.messages.push(message);
      if (this.messages.length > this.MAX_MESSAGES) {
        this.messages = this.messages.slice(-Math.floor(this.MAX_MESSAGES / 2));
      }
      logger.debug(`Console ${params.type}: ${message.text}`);
    });
    this.cdpSession.on('Console.messageAdded', (params: ConsoleMessageAddedEvent) => {
      const msg = params.message;
      const message: ConsoleMessage = {
        type: msg.level || 'log',
        text: msg.text,
        timestamp: Date.now(),
        url: msg.url,
        lineNumber: msg.line,
        columnNumber: msg.column,
      };
      this.messages.push(message);
      if (this.messages.length > this.MAX_MESSAGES) {
        this.messages = this.messages.slice(-Math.floor(this.MAX_MESSAGES / 2));
      }
    });
    if (options?.enableExceptions !== false) {
      this.cdpSession.on('Runtime.exceptionThrown', (params: RuntimeExceptionThrownEvent) => {
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
        this.exceptions.push(exceptionInfo);
        if (this.exceptions.length > this.MAX_EXCEPTIONS) {
          this.exceptions = this.exceptions.slice(-Math.floor(this.MAX_EXCEPTIONS / 2));
        }
        logger.error(`Exception thrown: ${exceptionInfo.text}`, {
          url: exceptionInfo.url,
          line: exceptionInfo.lineNumber,
        });
      });
    }
    if (options?.enableNetwork) {
      this.networkMonitor = new NetworkMonitor(this.cdpSession);
      await this.networkMonitor.enable();
    }
    logger.info('ConsoleMonitor enabled', {
      network: options?.enableNetwork || false,
      exceptions: options?.enableExceptions !== false,
    });
  }
  private async applyPostEnableOptions(options?: {
    enableNetwork?: boolean;
    enableExceptions?: boolean;
  }): Promise<void> {
    if (!options?.enableNetwork) {
      return;
    }
    this.lastEnableOptions = { ...this.lastEnableOptions, ...options };
    if (this.playwrightPage && this.playwrightConsoleHandler && !this.playwrightNetworkMonitor) {
      this.playwrightNetworkMonitor = new PlaywrightNetworkMonitor(
        this.playwrightPage as PlaywrightNetworkMonitorPage
      );
      await this.playwrightNetworkMonitor.enable();
      logger.info('Network monitoring added to existing ConsoleMonitor Playwright session');
      return;
    }
    if (this.cdpSession && !this.networkMonitor) {
      this.networkMonitor = new NetworkMonitor(this.cdpSession);
      await this.networkMonitor.enable();
      logger.info('Network monitoring added to existing ConsoleMonitor session');
    }
  }
  private async enablePlaywright(options?: {
    enableNetwork?: boolean;
    enableExceptions?: boolean;
  }): Promise<void> {
    if (this.playwrightConsoleHandler) {
      if (options?.enableNetwork && !this.playwrightNetworkMonitor) {
        this.playwrightNetworkMonitor = new PlaywrightNetworkMonitor(
          this.playwrightPage as PlaywrightNetworkMonitorPage
        );
        await this.playwrightNetworkMonitor.enable();
        logger.info('Network monitoring added to existing ConsoleMonitor Playwright session');
      }
      return;
    }
    const page = this.playwrightPage as PlaywrightConsolePageLike;
    this.playwrightConsoleHandler = (msg: PlaywrightConsoleMessageLike) => {
      const message: ConsoleMessage = {
        type: msg.type() || 'log',
        text: msg.text(),
        timestamp: Date.now(),
      };
      this.messages.push(message);
      if (this.messages.length > this.MAX_MESSAGES) {
        this.messages = this.messages.slice(-Math.floor(this.MAX_MESSAGES / 2));
      }
    };
    page.on('console', this.playwrightConsoleHandler);
    if (options?.enableExceptions !== false) {
      this.playwrightErrorHandler = (error: Error) => {
        const exceptionInfo: ExceptionInfo = {
          text: error.message,
          exceptionId: Date.now(),
          timestamp: Date.now(),
        };
        this.exceptions.push(exceptionInfo);
        if (this.exceptions.length > this.MAX_EXCEPTIONS) {
          this.exceptions = this.exceptions.slice(-Math.floor(this.MAX_EXCEPTIONS / 2));
        }
      };
      page.on('pageerror', this.playwrightErrorHandler);
    }
    if (options?.enableNetwork) {
      this.playwrightNetworkMonitor = new PlaywrightNetworkMonitor(
        this.playwrightPage as PlaywrightNetworkMonitorPage
      );
      await this.playwrightNetworkMonitor.enable();
    }
    logger.info('ConsoleMonitor enabled (Playwright/camoufox mode)', {
      network: options?.enableNetwork || false,
    });
  }
  async disable(): Promise<void> {
    try {
      if (this.playwrightPage) {
        const page = this.playwrightPage as PlaywrightConsolePageLike;
        if (this.playwrightConsoleHandler) {
          try {
            page.off('console', this.playwrightConsoleHandler);
          } catch {
            /* best-effort detach during shutdown */
          }
          this.playwrightConsoleHandler = null;
        }
        if (this.playwrightErrorHandler) {
          try {
            page.off('pageerror', this.playwrightErrorHandler);
          } catch {
            /* best-effort detach during shutdown */
          }
          this.playwrightErrorHandler = null;
        }
      }
      if (this.playwrightNetworkMonitor) {
        await this.playwrightNetworkMonitor.disable();
        this.playwrightNetworkMonitor = null;
      }
      if (this.cdpSession) {
        if (this.fetchInterceptor) {
          await this.fetchInterceptor.disable();
          this.fetchInterceptor = null;
        }
        if (this.networkMonitor) {
          await this.networkMonitor.disable();
          this.networkMonitor = null;
        }
        try {
          await this.cdpSession.send('Console.disable');
        } catch (error) {
          logger.warn('Failed to disable Console domain:', error);
        }
        try {
          await this.cdpSession.send('Runtime.disable');
        } catch (error) {
          logger.warn('Failed to disable Runtime domain:', error);
        }
        try {
          await this.cdpSession.detach();
        } catch (error) {
          logger.warn('Failed to detach ConsoleMonitor CDP session:', error);
        }
        this.cdpSession = null;
        logger.info('ConsoleMonitor disabled');
      }
    } finally {
      this.initPromise = undefined;
      this.objectCache.clear();
    }
  }
  async ensureSession(): Promise<void> {
    if (!this.cdpSession && !this.playwrightPage) {
      logger.info('ConsoleMonitor CDP session lost, reinitializing...');
      await this.enable(this.lastEnableOptions);
      return;
    }

    // Pre-flight health check: verify the CDP session is actually responsive.
    // The session reference may be non-null while the underlying WebSocket is in a
    // zombie state (half-open / unresponsive) that does NOT fire the 'disconnected'
    // event. Without this check, cdpSession.send() hangs indefinitely until the
    // 30s timeout wrapper fires.
    if (this.cdpSession) {
      try {
        // Use a short 3s timeout — if Runtime.enable doesn't respond quickly,
        // the session is zombie and must be reinitialized.
        await Promise.race([
          this.cdpSession.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('session_unreachable')), 3000),
          ),
        ]);
        return; // Session is healthy
      } catch {
        logger.warn('ConsoleMonitor CDP session unresponsive (zombie), reinitializing...');
        this.cdpSession = null;
        this.networkMonitor = null;
        this.fetchInterceptor = null;
        await this.enable(this.lastEnableOptions);
      }
    }
  }
  isSessionActive(): boolean {
    return this.cdpSession !== null || this.playwrightPage !== null;
  }
  getLogs(filter?: {
    type?: 'log' | 'warn' | 'error' | 'info' | 'debug';
    limit?: number;
    since?: number;
  }): ConsoleMessage[] {
    return getLogsCore(this, filter);
  }
  async execute(expression: string): Promise<unknown> {
    await this.ensureSession();
    try {
      // Wrap with 30s timeout to avoid hanging on stale CDP sessions
      const result = (await cdpSendWithTimeout(this.cdpSession!, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
      })) as RuntimeEvaluateResult;
      if (result.exceptionDetails) {
        logger.error('Console execute error:', result.exceptionDetails);
        throw new Error(result.exceptionDetails.text);
      }
      logger.info('Console expression executed');
      return result.result.value;
    } catch (error) {
      logger.error('Console execute failed:', error);
      throw error;
    }
  }
  clearLogs(): void {
    clearLogsCore(this);
  }
  getStats(): {
    totalMessages: number;
    byType: Record<string, number>;
  } {
    return getStatsCore(this);
  }
  async close(): Promise<void> {
    try {
      await this.disable();
    } finally {
      this.initPromise = undefined;
      this.objectCache.clear();
    }
  }
  isNetworkEnabled(): boolean {
    return isNetworkEnabledCore(this);
  }
  getNetworkStatus(): {
    enabled: boolean;
    requestCount: number;
    responseCount: number;
    listenerCount: number;
    cdpSessionActive: boolean;
  } {
    return getNetworkStatusCore(this);
  }
  getNetworkRequests(filter?: { url?: string; method?: string; limit?: number }) {
    return getNetworkRequestsCore(this, filter);
  }
  getNetworkResponses(filter?: { url?: string; status?: number; limit?: number }) {
    return getNetworkResponsesCore(this, filter);
  }
  getNetworkActivity(requestId: string) {
    return getNetworkActivityCore(this, requestId);
  }
  async getResponseBody(requestId: string): Promise<{
    body: string;
    base64Encoded: boolean;
  } | null> {
    return getResponseBodyCore(this, requestId);
  }
  async getAllJavaScriptResponses() {
    return getAllJavaScriptResponsesCore(this);
  }
  clearNetworkRecords(): void {
    clearNetworkRecordsCore(this);
  }
  async clearInjectedBuffers(): Promise<{
    xhrCleared: number;
    fetchCleared: number;
    dynamicScriptsCleared: number;
  }> {
    return clearInjectedBuffersCore(this);
  }
  async resetInjectedInterceptors(): Promise<{
    xhrReset: boolean;
    fetchReset: boolean;
    scriptMonitorReset: boolean;
  }> {
    return resetInjectedInterceptorsCore(this);
  }
  getNetworkStats() {
    return getNetworkStatsCore(this);
  }
  async injectXHRInterceptor(options?: { persistent?: boolean }): Promise<void> {
    return injectXHRInterceptorCore(this, options);
  }
  async injectFetchInterceptor(options?: { persistent?: boolean }): Promise<void> {
    return injectFetchInterceptorCore(this, options);
  }
  async getXHRRequests(): Promise<unknown[]> {
    return getXHRRequestsCore(this);
  }
  async getFetchRequests(): Promise<unknown[]> {
    return getFetchRequestsCore(this);
  }
  getExceptions(filter?: { url?: string; limit?: number; since?: number }): ExceptionInfo[] {
    return getExceptionsCore(this, filter);
  }
  clearExceptions(): void {
    clearExceptionsCore(this);
  }
  async inspectObject(objectId: string): Promise<InspectedObjectProperties> {
    return inspectObjectCore(this, objectId);
  }
  clearObjectCache(): void {
    clearObjectCacheCore(this);
  }
  async enableDynamicScriptMonitoring(options?: { persistent?: boolean }): Promise<void> {
    return enableDynamicScriptMonitoringCore(this, options);
  }
  private async clearDynamicScriptBuffer(): Promise<{ dynamicScriptsCleared: number }> {
    return clearDynamicScriptBufferCore(this);
  }
  private async resetDynamicScriptMonitoring(): Promise<{ scriptMonitorReset: boolean }> {
    return resetDynamicScriptMonitoringCore(this);
  }
  async getDynamicScripts(): Promise<unknown[]> {
    return getDynamicScriptsCore(this);
  }
  async injectFunctionTracer(
    functionName: string,
    options?: { persistent?: boolean }
  ): Promise<void> {
    return injectFunctionTracerCore(this, functionName, options);
  }
  async injectPropertyWatcher(
    objectPath: string,
    propertyName: string,
    options?: { persistent?: boolean }
  ): Promise<void> {
    return injectPropertyWatcherCore(this, objectPath, propertyName, options);
  }

  // ── Fetch Interception ──

  async enableFetchIntercept(rules: FetchInterceptRuleInput[]): Promise<FetchInterceptRule[]> {
    await this.ensureSession();
    if (!this.cdpSession) {
      throw new Error('No CDP session available for Fetch interception');
    }
    if (!this.fetchInterceptor) {
      this.fetchInterceptor = new FetchInterceptor(this.cdpSession);
    }
    return this.fetchInterceptor.enable(rules);
  }

  async disableFetchIntercept(): Promise<{ removedRules: number }> {
    if (!this.fetchInterceptor) {
      return { removedRules: 0 };
    }
    const result = await this.fetchInterceptor.disable();
    this.fetchInterceptor = null;
    return result;
  }

  async removeFetchInterceptRule(ruleId: string): Promise<boolean> {
    if (!this.fetchInterceptor) {
      return false;
    }
    const removed = await this.fetchInterceptor.removeRule(ruleId);
    if (!this.fetchInterceptor.isEnabled()) {
      this.fetchInterceptor = null;
    }
    return removed;
  }

  getFetchInterceptStatus(): {
    enabled: boolean;
    rules: FetchInterceptRule[];
    totalHits: number;
  } {
    if (!this.fetchInterceptor) {
      return { enabled: false, rules: [], totalHits: 0 };
    }
    return this.fetchInterceptor.listRules();
  }
  private formatRemoteObject(obj: CdpRemoteObject): string {
    if (obj.value !== undefined) {
      return String(obj.value);
    }
    if (obj.description) {
      return obj.description;
    }
    if (obj.type === 'undefined') {
      return 'undefined';
    }
    if (obj.type === 'object' && obj.subtype === 'null') {
      return 'null';
    }
    return `[${obj.type}]`;
  }
  private extractValue(obj: CdpRemoteObject): unknown {
    if (obj.value !== undefined) {
      return obj.value;
    }
    if (obj.type === 'undefined') {
      return undefined;
    }
    if (obj.type === 'object' && obj.subtype === 'null') {
      return null;
    }
    if (obj.objectId) {
      return {
        __objectId: obj.objectId,
        __type: obj.type,
        __description: obj.description,
      };
    }
    return obj.description || `[${obj.type}]`;
  }
}

/** Wrap a CDP session.send() call with a timeout to avoid indefinite hangs on stale sessions. */
async function cdpSendWithTimeout<T>(
  session: { send(method: string, params?: Record<string, unknown>): Promise<T> },
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30000
): Promise<T> {
  return Promise.race([
    session.send(method, params),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}
