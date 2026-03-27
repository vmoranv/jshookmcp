/**
 * AdvancedHandlersBase — top of the network domain handler chain.
 *
 * Inherits:
 *   NetworkHandlersCore       → shared utilities, network enable/disable/status/requests/response/stats
 *   NetworkHandlersPerformance → performance metrics, coverage, tracing, profiling
 *
 * This file adds: console exception/interceptor/tracer handlers.
 *
 * Split history:
 *   handlers.base.types.ts       — shared types, constants, type guards
 *   handlers.base.core.ts        — NetworkHandlersCore (base class)
 *   handlers.base.performance.ts — NetworkHandlersPerformance (extends Core)
 *   handlers.base.ts             — AdvancedHandlersBase (extends Performance) ← this file
 */

import { NetworkHandlersPerformance } from './handlers.base.performance';
import { asOptionalString } from './handlers.base.types';
import { argBool } from '@server/domains/shared/parse-args';

export class AdvancedHandlersBase extends NetworkHandlersPerformance {
  // ── Console exception / interceptor / tracer handlers ──

  async handleConsoleGetExceptions(args: Record<string, unknown>) {
    const url = asOptionalString(args.url);
    const limit = this.parseNumberArg(args.limit, {
      defaultValue: 50,
      min: 1,
      max: 1000,
      integer: true,
    });

    let exceptions = this.consoleMonitor.getExceptions();

    if (url) {
      exceptions = exceptions.filter((ex) => ex.url?.includes(url));
    }

    exceptions = exceptions.slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              exceptions,
              total: exceptions.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleConsoleInjectScriptMonitor(args: Record<string, unknown>) {
    const persistent = argBool(args, 'persistent', false);
    await this.consoleMonitor.enableDynamicScriptMonitoring({ persistent });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: persistent
                ? 'Dynamic script monitoring enabled (persistent — survives navigations)'
                : 'Dynamic script monitoring enabled',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleConsoleInjectXhrInterceptor(args: Record<string, unknown>) {
    const persistent = argBool(args, 'persistent', false);
    await this.consoleMonitor.injectXHRInterceptor({ persistent });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: persistent
                ? 'XHR interceptor injected (persistent)'
                : 'XHR interceptor injected',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleConsoleInjectFetchInterceptor(args: Record<string, unknown>) {
    const persistent = argBool(args, 'persistent', false);
    await this.consoleMonitor.injectFetchInterceptor({ persistent });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: persistent
                ? 'Fetch interceptor injected (persistent)'
                : 'Fetch interceptor injected',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleConsoleClearInjectedBuffers(_args: Record<string, unknown>) {
    const result = await this.consoleMonitor.clearInjectedBuffers();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Injected buffers cleared',
              ...result,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleConsoleResetInjectedInterceptors(_args: Record<string, unknown>) {
    const result = await this.consoleMonitor.resetInjectedInterceptors();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Injected interceptors/monitors reset',
              ...result,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handleConsoleInjectFunctionTracer(args: Record<string, unknown>) {
    const functionName = asOptionalString(args.functionName) || '';

    if (!functionName) {
      throw new Error('functionName is required');
    }

    const persistent = argBool(args, 'persistent', false);
    await this.consoleMonitor.injectFunctionTracer(functionName, { persistent });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: persistent
                ? `Function tracer injected for: ${functionName} (persistent — survives navigations)`
                : `Function tracer injected for: ${functionName}`,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
