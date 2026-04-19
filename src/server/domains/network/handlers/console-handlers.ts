/**
 * Console exception, interceptor, tracer, and monitoring handlers.
 *
 * Extracted from AdvancedHandlersBase (handlers.base.ts).
 */

import { asOptionalString } from '../handlers.base.types';
import { argBool } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import { parseNumberArg } from './shared';
import type { ConsoleMonitor } from '@server/domains/shared/modules';

export interface ConsoleHandlerDeps {
  consoleMonitor: ConsoleMonitor;
}

export class ConsoleHandlers {
  constructor(private deps: ConsoleHandlerDeps) {}

  async handleConsoleGetExceptions(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const url = asOptionalString(args.url);
      const limit = parseNumberArg(args.limit, {
        defaultValue: 50,
        min: 1,
        max: 1000,
        integer: true,
      });

      let exceptions = this.deps.consoleMonitor.getExceptions();

      if (url) {
        exceptions = exceptions.filter((ex) => ex.url?.includes(url));
      }

      exceptions = exceptions.slice(0, limit);

      return R.ok()
        .merge({
          exceptions,
          total: exceptions.length,
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleConsoleInjectScriptMonitor(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const persistent = argBool(args, 'persistent', false);
      await this.deps.consoleMonitor.enableDynamicScriptMonitoring({ persistent });

      return R.ok()
        .set(
          'message',
          persistent
            ? 'Dynamic script monitoring enabled (persistent — survives navigations)'
            : 'Dynamic script monitoring enabled',
        )
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleConsoleInjectXhrInterceptor(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const persistent = argBool(args, 'persistent', false);
      await this.deps.consoleMonitor.injectXHRInterceptor({ persistent });

      return R.ok()
        .set(
          'message',
          persistent ? 'XHR interceptor injected (persistent)' : 'XHR interceptor injected',
        )
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleConsoleInjectFetchInterceptor(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const persistent = argBool(args, 'persistent', false);
      await this.deps.consoleMonitor.injectFetchInterceptor({ persistent });

      return R.ok()
        .set(
          'message',
          persistent ? 'Fetch interceptor injected (persistent)' : 'Fetch interceptor injected',
        )
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleConsoleClearInjectedBuffers(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await this.deps.consoleMonitor.clearInjectedBuffers();

      return R.ok()
        .merge({
          message: 'Injected buffers cleared',
          ...result,
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleConsoleResetInjectedInterceptors(
    _args: Record<string, unknown>,
  ): Promise<ToolResponse> {
    try {
      const result = await this.deps.consoleMonitor.resetInjectedInterceptors();

      return R.ok()
        .merge({
          message: 'Injected interceptors/monitors reset',
          ...result,
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleConsoleInjectFunctionTracer(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const functionName = asOptionalString(args.functionName) || '';

      if (!functionName) {
        return R.fail('functionName is required').json();
      }

      const persistent = argBool(args, 'persistent', false);
      await this.deps.consoleMonitor.injectFunctionTracer(functionName, { persistent });

      return R.ok()
        .set(
          'message',
          persistent
            ? `Function tracer injected for: ${functionName} (persistent — survives navigations)`
            : `Function tracer injected for: ${functionName}`,
        )
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }
}
