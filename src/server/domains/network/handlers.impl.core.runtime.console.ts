import { logger } from '../../../utils/logger.js';
import { AdvancedToolHandlersPerformance } from './handlers.impl.core.runtime.performance.js';

export class AdvancedToolHandlersConsole extends AdvancedToolHandlersPerformance {
  async handleConsoleGetExceptions(args: Record<string, unknown>) {
    const url = args.url as string | undefined;
    const limit = (args.limit as number) || 50;

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
            2
          ),
        },
      ],
    };
  }

  async handleConsoleInjectScriptMonitor(_args: Record<string, unknown>) {
    await this.consoleMonitor.enableDynamicScriptMonitoring();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Dynamic script monitoring enabled',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleInjectXhrInterceptor(_args: Record<string, unknown>) {
    await this.consoleMonitor.injectXHRInterceptor();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'XHR interceptor injected',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleInjectFetchInterceptor(_args: Record<string, unknown>) {
    await this.consoleMonitor.injectFetchInterceptor();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Fetch interceptor injected',
            },
            null,
            2
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
            2
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
            2
          ),
        },
      ],
    };
  }

  async handleConsoleInjectFunctionTracer(args: Record<string, unknown>) {
    const functionName = args.functionName as string;

    if (!functionName) {
      throw new Error('functionName is required');
    }

    await this.consoleMonitor.injectFunctionTracer(functionName);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Function tracer injected for: ${functionName}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async cleanup() {
    if (this.performanceMonitor) {
      await this.performanceMonitor.close();
      this.performanceMonitor = null;
    }
    logger.info('AdvancedToolHandlers cleaned up');
  }
}