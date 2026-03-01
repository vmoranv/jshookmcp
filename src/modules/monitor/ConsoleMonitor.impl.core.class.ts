import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../collector/CodeCollector.js';
import { logger } from '../../utils/logger.js';
import { NetworkMonitor } from './NetworkMonitor.js';
import { PlaywrightNetworkMonitor } from './PlaywrightNetworkMonitor.js';
import {
  clearExceptionsCore,
  clearLogsCore,
  getExceptionsCore,
  getLogsCore,
  getStatsCore,
} from './ConsoleMonitor.impl.core.logs.js';
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
} from './ConsoleMonitor.impl.core.network.js';
import {
  clearObjectCacheCore,
  inspectObjectCore,
} from './ConsoleMonitor.impl.core.object-cache.js';
import type { InspectedObjectProperties } from './ConsoleMonitor.impl.core.object-cache.js';
import {
  clearDynamicScriptBufferCore,
  enableDynamicScriptMonitoringCore,
  getDynamicScriptsCore,
  injectFunctionTracerCore,
  injectPropertyWatcherCore,
  resetDynamicScriptMonitoringCore,
} from './ConsoleMonitor.impl.core.dynamic.js';
export type { NetworkRequest, NetworkResponse } from './NetworkMonitor.js';

type ConsoleMessageType =
  | 'log'
  | 'warn'
  | 'error'
  | 'info'
  | 'debug'
  | 'trace'
  | 'dir'
  | 'table';

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
    this.cdpSession = await page.createCDPSession();
    this.lastEnableOptions = { ...options };
    this.cdpSession.on('disconnected', () => {
      logger.warn('ConsoleMonitor CDP session disconnected');
      this.cdpSession = null;
      this.networkMonitor = null;
    });
    await this.cdpSession.send('Runtime.enable');
    await this.cdpSession.send('Console.enable');
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
          try { page.off('console', this.playwrightConsoleHandler); } catch { /* ignore */ }
          this.playwrightConsoleHandler = null;
        }
        if (this.playwrightErrorHandler) {
          try { page.off('pageerror', this.playwrightErrorHandler); } catch { /* ignore */ }
          this.playwrightErrorHandler = null;
        }
      }
      if (this.playwrightNetworkMonitor) {
        await this.playwrightNetworkMonitor.disable();
        this.playwrightNetworkMonitor = null;
      }
      if (this.cdpSession) {
        if (this.networkMonitor) {
          await this.networkMonitor.disable();
          this.networkMonitor = null;
        }
        await this.cdpSession.send('Console.disable');
        await this.cdpSession.send('Runtime.disable');
        await this.cdpSession.detach();
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
      const result = (await this.cdpSession!.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      })) as RuntimeEvaluateResult;
      if (result.exceptionDetails) {
        logger.error('Console execute error:', result.exceptionDetails);
        throw new Error(result.exceptionDetails.text);
      }
      logger.info(`Console executed: ${expression.substring(0, 50)}...`);
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
  async injectXHRInterceptor(): Promise<void> {
    return injectXHRInterceptorCore(this);
  }
  async injectFetchInterceptor(): Promise<void> {
    return injectFetchInterceptorCore(this);
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
  async enableDynamicScriptMonitoring(): Promise<void> {
    return enableDynamicScriptMonitoringCore(this);
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
  async injectFunctionTracer(functionName: string): Promise<void> {
    return injectFunctionTracerCore(this, functionName);
  }
  async injectPropertyWatcher(objectPath: string, propertyName: string): Promise<void> {
    return injectPropertyWatcherCore(this, objectPath, propertyName);
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
