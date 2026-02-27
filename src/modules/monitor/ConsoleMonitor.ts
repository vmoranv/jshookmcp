import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../collector/CodeCollector.js';
import { logger } from '../../utils/logger.js';
import { NetworkMonitor } from './NetworkMonitor.js';
import { PlaywrightNetworkMonitor } from './PlaywrightNetworkMonitor.js';
export type { NetworkRequest, NetworkResponse } from './NetworkMonitor.js';

export interface ConsoleMessage {
  type: 'log' | 'warn' | 'error' | 'info' | 'debug' | 'trace' | 'dir' | 'table';
  text: string;
  args?: any[];
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
  private playwrightPage: any = null;
  private playwrightConsoleHandler: ((msg: any) => void) | null = null;
  private playwrightErrorHandler: ((error: Error) => void) | null = null;

  private messages: ConsoleMessage[] = [];
  private readonly MAX_MESSAGES = 1000;

  private exceptions: ExceptionInfo[] = [];
  private readonly MAX_EXCEPTIONS = 500;
  private readonly MAX_INJECTED_DYNAMIC_SCRIPTS = 500;

  private objectCache: Map<string, any> = new Map();

  /** Stored so we can re-enable with the same config after a session drop. */
  private lastEnableOptions: { enableNetwork?: boolean; enableExceptions?: boolean } = {};

  constructor(private collector: CodeCollector) {}

  /**
   * Set a Playwright page for Camoufox/Firefox mode.
   * When set, enable() will use Playwright events instead of CDP.
   */
  setPlaywrightPage(page: any): void {
    this.playwrightPage = page;
  }

  async enable(options?: { enableNetwork?: boolean; enableExceptions?: boolean }): Promise<void> {
    // Playwright (Camoufox) path
    if (this.playwrightPage) {
      return this.enablePlaywright(options);
    }

    if (this.cdpSession) {
      // Already enabled — but if network monitoring is newly requested, add it
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

    // Auto-cleanup on session disconnect so ensureSession() can re-create
    this.cdpSession.on('disconnected', () => {
      logger.warn('ConsoleMonitor CDP session disconnected');
      this.cdpSession = null;
      this.networkMonitor = null;
    });

    await this.cdpSession.send('Runtime.enable');
    await this.cdpSession.send('Console.enable');

    this.cdpSession.on('Runtime.consoleAPICalled', (params: any) => {
      const stackTrace: StackFrame[] =
        params.stackTrace?.callFrames?.map((frame: any) => ({
          functionName: frame.functionName || '(anonymous)',
          url: frame.url,
          lineNumber: frame.lineNumber,
          columnNumber: frame.columnNumber,
        })) || [];

      const message: ConsoleMessage = {
        type: params.type,
        text: params.args.map((arg: any) => this.formatRemoteObject(arg)).join(' '),
        args: params.args.map((arg: any) => this.extractValue(arg)),
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

    this.cdpSession.on('Console.messageAdded', (params: any) => {
      const msg = params.message;
      const message: ConsoleMessage = {
        type: msg.level as any,
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
      this.cdpSession.on('Runtime.exceptionThrown', (params: any) => {
        const exception = params.exceptionDetails;
        const stackTrace: StackFrame[] =
          exception.stackTrace?.callFrames?.map((frame: any) => ({
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

  /** Playwright (Camoufox) mode: attach console/network listeners via Playwright page events. */
  private async enablePlaywright(options?: {
    enableNetwork?: boolean;
    enableExceptions?: boolean;
  }): Promise<void> {
    if (this.playwrightConsoleHandler) {
      // Already enabled — but if network monitoring is newly requested, add it
      if (options?.enableNetwork && !this.playwrightNetworkMonitor) {
        this.playwrightNetworkMonitor = new PlaywrightNetworkMonitor(this.playwrightPage);
        await this.playwrightNetworkMonitor.enable();
        logger.info('Network monitoring added to existing ConsoleMonitor Playwright session');
      }
      return;
    }

    const page = this.playwrightPage;

    // Console capture via Playwright page events
    this.playwrightConsoleHandler = (msg: any) => {
      const message: ConsoleMessage = {
        type: (msg.type() as any) || 'log',
        text: msg.text(),
        timestamp: Date.now(),
      };
      this.messages.push(message);
      if (this.messages.length > this.MAX_MESSAGES) {
        this.messages = this.messages.slice(-Math.floor(this.MAX_MESSAGES / 2));
      }
    };
    page.on('console', this.playwrightConsoleHandler);

    // Page-level error capture
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

    // Network capture via Playwright page events
    if (options?.enableNetwork) {
      this.playwrightNetworkMonitor = new PlaywrightNetworkMonitor(page);
      await this.playwrightNetworkMonitor.enable();
    }

    logger.info('ConsoleMonitor enabled (Playwright/camoufox mode)', {
      network: options?.enableNetwork || false,
    });
  }

  async disable(): Promise<void> {
    // Playwright mode cleanup
    if (this.playwrightPage) {
      if (this.playwrightConsoleHandler) {
        try { this.playwrightPage.off('console', this.playwrightConsoleHandler); } catch { /* ignore */ }
        this.playwrightConsoleHandler = null;
      }
      if (this.playwrightErrorHandler) {
        try { this.playwrightPage.off('pageerror', this.playwrightErrorHandler); } catch { /* ignore */ }
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
  }

  /**
   * Ensure CDP session is active, reconnect if the session was dropped.
   * Mirrors DebuggerManager.ensureSession() pattern.
   */
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
    let logs = this.messages;

    if (filter?.type) {
      logs = logs.filter((msg) => msg.type === filter.type);
    }

    if (filter?.since !== undefined) {
      logs = logs.filter((msg) => msg.timestamp >= filter.since!);
    }

    if (filter?.limit) {
      logs = logs.slice(-filter.limit);
    }

    logger.info(`getLogs: ${logs.length} messages`);
    return logs;
  }

  async execute(expression: string): Promise<any> {
    await this.ensureSession();

    try {
      const result = await this.cdpSession!.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      });

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
    this.messages = [];
    logger.info('Console logs cleared');
  }

  getStats(): {
    totalMessages: number;
    byType: Record<string, number>;
  } {
    const byType: Record<string, number> = {};

    for (const msg of this.messages) {
      byType[msg.type] = (byType[msg.type] || 0) + 1;
    }

    return {
      totalMessages: this.messages.length,
      byType,
    };
  }

  async close(): Promise<void> {
    await this.disable();
  }

  isNetworkEnabled(): boolean {
    return (this.networkMonitor?.isEnabled() ?? false) || (this.playwrightNetworkMonitor?.isEnabled() ?? false);
  }

  getNetworkStatus(): {
    enabled: boolean;
    requestCount: number;
    responseCount: number;
    listenerCount: number;
    cdpSessionActive: boolean;
  } {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getStatus();
    }
    if (!this.networkMonitor) {
      return {
        enabled: false,
        requestCount: 0,
        responseCount: 0,
        listenerCount: 0,
        cdpSessionActive: this.cdpSession !== null,
      };
    }
    return this.networkMonitor.getStatus();
  }

  getNetworkRequests(filter?: { url?: string; method?: string; limit?: number }) {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getRequests(filter);
    }
    return this.networkMonitor?.getRequests(filter) ?? [];
  }

  getNetworkResponses(filter?: { url?: string; status?: number; limit?: number }) {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getResponses(filter);
    }
    return this.networkMonitor?.getResponses(filter) ?? [];
  }

  getNetworkActivity(requestId: string) {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getActivity(requestId);
    }
    return this.networkMonitor?.getActivity(requestId) ?? {};
  }

  async getResponseBody(requestId: string): Promise<{
    body: string;
    base64Encoded: boolean;
  } | null> {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getResponseBody(requestId);
    }
    if (!this.networkMonitor) {
      logger.error(
        'Network monitoring is not enabled. Call enable() with enableNetwork: true first.'
      );
      return null;
    }
    return this.networkMonitor.getResponseBody(requestId);
  }

  async getAllJavaScriptResponses() {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getAllJavaScriptResponses();
    }
    if (!this.networkMonitor) {
      return [];
    }
    return this.networkMonitor.getAllJavaScriptResponses();
  }

  clearNetworkRecords(): void {
    this.networkMonitor?.clearRecords();
    this.playwrightNetworkMonitor?.clearRecords();
  }

  async clearInjectedBuffers(): Promise<{
    xhrCleared: number;
    fetchCleared: number;
    dynamicScriptsCleared: number;
  }> {
    if (this.playwrightNetworkMonitor) {
      const result = await this.playwrightNetworkMonitor.clearInjectedBuffers();
      return {
        ...result,
        dynamicScriptsCleared: 0,
      };
    }

    const networkResult = this.networkMonitor
      ? await this.networkMonitor.clearInjectedBuffers()
      : { xhrCleared: 0, fetchCleared: 0 };
    const dynamicResult = await this.clearDynamicScriptBuffer();

    return {
      ...networkResult,
      ...dynamicResult,
    };
  }

  async resetInjectedInterceptors(): Promise<{
    xhrReset: boolean;
    fetchReset: boolean;
    scriptMonitorReset: boolean;
  }> {
    if (this.playwrightNetworkMonitor) {
      const result = await this.playwrightNetworkMonitor.resetInjectedInterceptors();
      return {
        ...result,
        scriptMonitorReset: false,
      };
    }

    const networkResult = this.networkMonitor
      ? await this.networkMonitor.resetInjectedInterceptors()
      : { xhrReset: false, fetchReset: false };
    const scriptResult = await this.resetDynamicScriptMonitoring();

    return {
      ...networkResult,
      ...scriptResult,
    };
  }

  getNetworkStats() {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getStats();
    }
    return (
      this.networkMonitor?.getStats() ?? {
        totalRequests: 0,
        totalResponses: 0,
        byMethod: {},
        byStatus: {},
        byType: {},
      }
    );
  }

  async injectXHRInterceptor(): Promise<void> {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.injectXHRInterceptor();
    }
    if (!this.networkMonitor) {
      throw new Error(
        'Network monitoring is not enabled. Call enable() with enableNetwork: true first.'
      );
    }
    return this.networkMonitor.injectXHRInterceptor();
  }

  async injectFetchInterceptor(): Promise<void> {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.injectFetchInterceptor();
    }
    if (!this.networkMonitor) {
      throw new Error(
        'Network monitoring is not enabled. Call enable() with enableNetwork: true first.'
      );
    }
    return this.networkMonitor.injectFetchInterceptor();
  }

  async getXHRRequests(): Promise<any[]> {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getXHRRequests();
    }
    if (!this.networkMonitor) {
      return [];
    }
    return this.networkMonitor.getXHRRequests();
  }

  async getFetchRequests(): Promise<any[]> {
    if (this.playwrightNetworkMonitor) {
      return this.playwrightNetworkMonitor.getFetchRequests();
    }
    if (!this.networkMonitor) {
      return [];
    }
    return this.networkMonitor.getFetchRequests();
  }

  getExceptions(filter?: { url?: string; limit?: number; since?: number }): ExceptionInfo[] {
    let exceptions = this.exceptions;

    if (filter?.url) {
      exceptions = exceptions.filter((ex) => ex.url?.includes(filter.url!));
    }

    if (filter?.since !== undefined) {
      exceptions = exceptions.filter((ex) => ex.timestamp >= filter.since!);
    }

    if (filter?.limit) {
      exceptions = exceptions.slice(-filter.limit);
    }

    return exceptions;
  }

  clearExceptions(): void {
    this.exceptions = [];
    logger.info('Exceptions cleared');
  }

  async inspectObject(objectId: string): Promise<any> {
    await this.ensureSession();
    if (!this.cdpSession) {
      throw new Error('CDP session not available after reconnect attempt');
    }

    if (this.objectCache.has(objectId)) {
      return this.objectCache.get(objectId);
    }

    try {
      const result = await this.cdpSession.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        accessorPropertiesOnly: false,
        generatePreview: true,
      });

      const properties: Record<string, any> = {};

      for (const prop of result.result) {
        if (!prop.value) continue;

        properties[prop.name] = {
          value: this.extractValue(prop.value),
          type: prop.value.type,
          objectId: prop.value.objectId,
          description: prop.value.description,
        };
      }

      this.objectCache.set(objectId, properties);

      logger.info(`Object inspected: ${objectId}`, {
        propertyCount: Object.keys(properties).length,
      });

      return properties;
    } catch (error) {
      logger.error('Failed to inspect object:', error);
      throw error;
    }
  }

  clearObjectCache(): void {
    this.objectCache.clear();
    logger.info('Object cache cleared');
  }

  async enableDynamicScriptMonitoring(): Promise<void> {
    await this.ensureSession();
    if (!this.cdpSession) {
      throw new Error('CDP session not available after reconnect attempt');
    }

    const monitorCode = `
      (function() {
        if (window.__dynamicScriptMonitorInstalled) {
          console.log('[ScriptMonitor] Already installed');
          return;
        }
        window.__dynamicScriptMonitorInstalled = true;

        const maxRecords = ${this.MAX_INJECTED_DYNAMIC_SCRIPTS};
        if (!window.__dynamicScripts) {
          window.__dynamicScripts = [];
        }
        const dynamicScripts = window.__dynamicScripts;
        const state = window.__dynamicScriptMonitorState || {};
        if (!state.originalCreateElement) state.originalCreateElement = document.createElement;
        if (!state.originalEval) state.originalEval = window.eval;
        if (!state.originalFunction) state.originalFunction = window.Function;
        window.__dynamicScriptMonitorState = state;

        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeName === 'SCRIPT') {
                const script = node;
                const info = {
                  type: 'dynamic',
                  src: script.src || '(inline)',
                  content: script.src ? null : script.textContent,
                  timestamp: Date.now(),
                  async: script.async,
                  defer: script.defer,
                };

                dynamicScripts.push(info);
                if (dynamicScripts.length > maxRecords) {
                  dynamicScripts.splice(0, dynamicScripts.length - maxRecords);
                }
                console.log('[ScriptMonitor] Dynamic script added:', info);
              }
            });
          });
        });

        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
        state.observer = observer;

        const originalCreateElement = state.originalCreateElement;
        document.createElement = function(tagName) {
          const element = originalCreateElement.call(document, tagName);

          if (tagName.toLowerCase() === 'script') {
            console.log('[ScriptMonitor] Script element created via createElement');

            const originalSetAttribute = element.setAttribute;
            element.setAttribute = function(name, value) {
              if (name === 'src') {
                console.log('[ScriptMonitor] Script src set to:', value);
              }
              return originalSetAttribute.call(element, name, value);
            };
          }

          return element;
        };

        const originalEval = state.originalEval;
        window.eval = function(code) {
          console.log('[ScriptMonitor] eval() called with code:',
            typeof code === 'string' ? code.substring(0, 100) + '...' : code);
          return originalEval.call(window, code);
        };

        const originalFunction = state.originalFunction;
        window.Function = function(...args) {
          console.log('[ScriptMonitor] Function() constructor called with args:', args);
          return originalFunction.apply(this, args);
        };

        window.__getDynamicScripts = function() {
          return dynamicScripts;
        };

        console.log('[ScriptMonitor] Dynamic script monitoring enabled');
      })();
    `;

    await this.cdpSession.send('Runtime.evaluate', {
      expression: monitorCode,
    });

    logger.info('Dynamic script monitoring enabled');
  }

  private async clearDynamicScriptBuffer(): Promise<{ dynamicScriptsCleared: number }> {
    if (!this.cdpSession) {
      return { dynamicScriptsCleared: 0 };
    }

    try {
      const result = await this.cdpSession.send('Runtime.evaluate', {
        expression: `
          (() => {
            const store = Array.isArray(window.__dynamicScripts)
              ? window.__dynamicScripts
              : (typeof window.__getDynamicScripts === 'function'
                ? window.__getDynamicScripts()
                : null);
            const dynamicScriptsCleared = Array.isArray(store) ? store.length : 0;
            if (Array.isArray(store)) {
              store.length = 0;
            }
            return { dynamicScriptsCleared };
          })()
        `,
        returnByValue: true,
      });

      return result.result.value || { dynamicScriptsCleared: 0 };
    } catch (error) {
      logger.error('Failed to clear dynamic script buffer:', error);
      return { dynamicScriptsCleared: 0 };
    }
  }

  private async resetDynamicScriptMonitoring(): Promise<{ scriptMonitorReset: boolean }> {
    if (!this.cdpSession) {
      return { scriptMonitorReset: false };
    }

    try {
      const result = await this.cdpSession.send('Runtime.evaluate', {
        expression: `
          (() => {
            const state = window.__dynamicScriptMonitorState;
            let scriptMonitorReset = false;

            try {
              if (state && state.observer && typeof state.observer.disconnect === 'function') {
                state.observer.disconnect();
                state.observer = null;
                scriptMonitorReset = true;
              }
            } catch (_) {}

            try {
              if (state && state.originalCreateElement) {
                document.createElement = state.originalCreateElement;
                scriptMonitorReset = true;
              }
            } catch (_) {}

            try {
              if (state && state.originalEval) {
                window.eval = state.originalEval;
                scriptMonitorReset = true;
              }
            } catch (_) {}

            try {
              if (state && state.originalFunction) {
                window.Function = state.originalFunction;
                scriptMonitorReset = true;
              }
            } catch (_) {}

            if (Array.isArray(window.__dynamicScripts)) {
              window.__dynamicScripts.length = 0;
            }
            delete window.__getDynamicScripts;
            window.__dynamicScriptMonitorInstalled = false;

            return { scriptMonitorReset };
          })()
        `,
        returnByValue: true,
      });

      return result.result.value || { scriptMonitorReset: false };
    } catch (error) {
      logger.error('Failed to reset dynamic script monitoring:', error);
      return { scriptMonitorReset: false };
    }
  }

  async getDynamicScripts(): Promise<any[]> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    try {
      const result = await this.cdpSession.send('Runtime.evaluate', {
        expression: 'window.__getDynamicScripts ? window.__getDynamicScripts() : []',
        returnByValue: true,
      });

      return result.result.value || [];
    } catch (error) {
      logger.error('Failed to get dynamic scripts:', error);
      return [];
    }
  }

  async injectFunctionTracer(functionName: string): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    const tracerCode = `
      (function() {
        const originalFunc = window.${functionName};
        if (typeof originalFunc !== 'function') {
          console.error('[Tracer] ${functionName} is not a function');
          return;
        }

        window.${functionName} = new Proxy(originalFunc, {
          apply: function(target, thisArg, args) {
            console.log('[Tracer] ${functionName} called with args:', args);
            const startTime = performance.now();

            try {
              const result = target.apply(thisArg, args);
              const endTime = performance.now();
              console.log('[Tracer] ${functionName} returned:', result, 'Time:', (endTime - startTime).toFixed(2), 'ms');
              return result;
            } catch (error) {
              console.error('[Tracer] ${functionName} threw error:', error);
              throw error;
            }
          }
        });

        console.log('[Tracer] ${functionName} is now being traced');
      })();
    `;

    await this.cdpSession.send('Runtime.evaluate', {
      expression: tracerCode,
    });

    logger.info(`Function tracer injected for: ${functionName}`);
  }
  async injectPropertyWatcher(objectPath: string, propertyName: string): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    const watcherCode = `
      (function() {
        const obj = ${objectPath};
        if (!obj) {
          console.error('[Watcher] Object not found: ${objectPath}');
          return;
        }

        let value = obj.${propertyName};

        Object.defineProperty(obj, '${propertyName}', {
          get: function() {
            console.log('[Watcher] ${objectPath}.${propertyName} accessed, value:', value);
            return value;
          },
          set: function(newValue) {
            console.log('[Watcher] ${objectPath}.${propertyName} changed from', value, 'to', newValue);
            value = newValue;
          },
          enumerable: true,
          configurable: true
        });

        console.log('[Watcher] Property watcher installed for ${objectPath}.${propertyName}');
      })();
    `;

    await this.cdpSession.send('Runtime.evaluate', {
      expression: watcherCode,
    });

    logger.info(`Property watcher injected for: ${objectPath}.${propertyName}`);
  }

  private formatRemoteObject(obj: any): string {
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

  private extractValue(obj: any): any {
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
