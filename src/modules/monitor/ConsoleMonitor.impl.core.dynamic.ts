import { logger } from '../../utils/logger.js';
import { PrerequisiteError } from '../../errors/PrerequisiteError.js';

interface RuntimeEvaluateResult<T = unknown> {
  result?: {
    value?: T;
  };
}

interface CdpSessionLike {
  send(
    method: 'Runtime.evaluate',
    params: { expression: string; returnByValue?: boolean }
  ): Promise<RuntimeEvaluateResult>;
}

interface DynamicScriptRecord {
  type?: string;
  src?: string | null;
  content?: string | null;
  timestamp?: number;
  async?: boolean;
  defer?: boolean;
  [key: string]: unknown;
}

interface DynamicCoreContext {
  ensureSession(): Promise<void>;
  cdpSession: CdpSessionLike | null;
  MAX_INJECTED_DYNAMIC_SCRIPTS: number;
}

function asDynamicCoreContext(ctx: unknown): DynamicCoreContext {
  return ctx as DynamicCoreContext;
}

export async function enableDynamicScriptMonitoringCore(ctx: unknown): Promise<void> {
  const coreCtx = asDynamicCoreContext(ctx);
  await coreCtx.ensureSession();
  if (!coreCtx.cdpSession) {
    throw new PrerequisiteError('CDP session not available after reconnect attempt');
  }

  const monitorCode = `
      (function() {
        if (window.__dynamicScriptMonitorInstalled) {
          console.log('[ScriptMonitor] Already installed');
          return;
        }
        window.__dynamicScriptMonitorInstalled = true;

        const maxRecords = ${coreCtx.MAX_INJECTED_DYNAMIC_SCRIPTS};
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

  await coreCtx.cdpSession.send('Runtime.evaluate', {
    expression: monitorCode,
  });

  logger.info('Dynamic script monitoring enabled');
}

export async function clearDynamicScriptBufferCore(
  ctx: unknown
): Promise<{ dynamicScriptsCleared: number }> {
  const coreCtx = asDynamicCoreContext(ctx);
  if (!coreCtx.cdpSession) {
    return { dynamicScriptsCleared: 0 };
  }

  try {
    const result = await coreCtx.cdpSession.send('Runtime.evaluate', {
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

    const value = result.result?.value;
    if (
      typeof value === 'object' &&
      value !== null &&
      'dynamicScriptsCleared' in value &&
      typeof (value as { dynamicScriptsCleared: unknown }).dynamicScriptsCleared === 'number'
    ) {
      return value as { dynamicScriptsCleared: number };
    }
    return { dynamicScriptsCleared: 0 };
  } catch (error) {
    logger.error('Failed to clear dynamic script buffer:', error);
    return { dynamicScriptsCleared: 0 };
  }
}

export async function resetDynamicScriptMonitoringCore(
  ctx: unknown
): Promise<{ scriptMonitorReset: boolean }> {
  const coreCtx = asDynamicCoreContext(ctx);
  if (!coreCtx.cdpSession) {
    return { scriptMonitorReset: false };
  }

  try {
    const result = await coreCtx.cdpSession.send('Runtime.evaluate', {
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

    const value = result.result?.value;
    if (
      typeof value === 'object' &&
      value !== null &&
      'scriptMonitorReset' in value &&
      typeof (value as { scriptMonitorReset: unknown }).scriptMonitorReset === 'boolean'
    ) {
      return value as { scriptMonitorReset: boolean };
    }
    return { scriptMonitorReset: false };
  } catch (error) {
    logger.error('Failed to reset dynamic script monitoring:', error);
    return { scriptMonitorReset: false };
  }
}

export async function getDynamicScriptsCore(ctx: unknown): Promise<DynamicScriptRecord[]> {
  const coreCtx = asDynamicCoreContext(ctx);
  if (!coreCtx.cdpSession) {
    throw new PrerequisiteError('CDP session not initialized');
  }

  try {
    const result = await coreCtx.cdpSession.send('Runtime.evaluate', {
      expression: 'window.__getDynamicScripts ? window.__getDynamicScripts() : []',
      returnByValue: true,
    });

    const value = result.result?.value;
    return Array.isArray(value) ? (value as DynamicScriptRecord[]) : [];
  } catch (error) {
    logger.error('Failed to get dynamic scripts:', error);
    return [];
  }
}

export async function injectFunctionTracerCore(ctx: unknown, functionName: string): Promise<void> {
  const coreCtx = asDynamicCoreContext(ctx);
  if (!coreCtx.cdpSession) {
    throw new PrerequisiteError('CDP session not initialized');
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

  await coreCtx.cdpSession.send('Runtime.evaluate', {
    expression: tracerCode,
  });

  logger.info(`Function tracer injected for: ${functionName}`);
}

export async function injectPropertyWatcherCore(
  ctx: unknown,
  objectPath: string,
  propertyName: string
): Promise<void> {
  const coreCtx = asDynamicCoreContext(ctx);
  if (!coreCtx.cdpSession) {
    throw new PrerequisiteError('CDP session not initialized');
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

  await coreCtx.cdpSession.send('Runtime.evaluate', {
    expression: watcherCode,
  });

  logger.info(`Property watcher injected for: ${objectPath}.${propertyName}`);
}
