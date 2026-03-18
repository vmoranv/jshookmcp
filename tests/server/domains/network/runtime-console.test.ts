import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PerformanceMonitor } from '@server/domains/shared/modules';

// ---------------------------------------------------------------------------
// Mocks — hoisted so they are available before module imports
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const consoleMonitorMock = {
    getExceptions: vi.fn(),
    enableDynamicScriptMonitoring: vi.fn(),
    injectXHRInterceptor: vi.fn(),
    injectFetchInterceptor: vi.fn(),
    clearInjectedBuffers: vi.fn(),
    resetInjectedInterceptors: vi.fn(),
    injectFunctionTracer: vi.fn(),
  };

  const performanceMonitorMock = {
    close: vi.fn(),
  };

  const collectorMock = {};

  const loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { consoleMonitorMock, performanceMonitorMock, collectorMock, loggerMock };
});

vi.mock('@utils/logger', () => ({
  logger: mocks.loggerMock,
}));

vi.mock('@server/domains/shared/modules', () => ({
  PerformanceMonitor: vi.fn(),
}));

vi.mock('@utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: vi.fn().mockReturnValue({}),
  },
}));

import { AdvancedHandlersBase } from '@server/domains/network/handlers.base';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type HandlerArgs = ConstructorParameters<typeof AdvancedHandlersBase>;
type TextToolResponse = { content: Array<{ type: string; text: string }> };
type ConsoleException = { message: string; url?: string };
type ConsoleExceptionsPayload = {
  success: boolean;
  exceptions: ConsoleException[];
  total: number;
};

class TestAdvancedHandlersBase extends AdvancedHandlersBase {
  setPerformanceMonitorForTest(monitor: PerformanceMonitor | null): void {
    this.performanceMonitor = monitor;
  }

  getPerformanceMonitorForTest(): PerformanceMonitor | null {
    return this.performanceMonitor;
  }
}

function createHandler(): TestAdvancedHandlersBase {
  return new TestAdvancedHandlersBase(
    mocks.collectorMock as unknown as HandlerArgs[0],
    mocks.consoleMonitorMock as unknown as HandlerArgs[1]
  );
}

function getTextContent(result: TextToolResponse): string {
  const first = result.content[0];
  expect(first).toBeDefined();
  expect(first?.type).toBe('text');
  if (!first || first.type !== 'text') {
    throw new Error('Expected text tool response');
  }
  return first.text;
}

function parseContent<T = Record<string, unknown>>(result: TextToolResponse): T {
  return JSON.parse(getTextContent(result)) as T;
}

describe('AdvancedHandlersBase (console)', () => {
  let handler: TestAdvancedHandlersBase;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = createHandler();
  });

  // -----------------------------------------------------------------------
  // handleConsoleGetExceptions
  // -----------------------------------------------------------------------
  describe('handleConsoleGetExceptions', () => {
    it('returns all exceptions when no URL filter is provided', async () => {
      const exceptions = [
        { message: 'Error 1', url: 'https://a.com/script.js' },
        { message: 'Error 2', url: 'https://b.com/app.js' },
      ];
      mocks.consoleMonitorMock.getExceptions.mockReturnValue(exceptions);

      const result = await handler.handleConsoleGetExceptions({});
      const parsed = parseContent<ConsoleExceptionsPayload>(result);

      expect(parsed.success).toBe(true);
      expect(parsed.exceptions).toEqual(exceptions);
      expect(parsed.total).toBe(2);
    });

    it('filters exceptions by URL substring', async () => {
      const exceptions = [
        { message: 'Error 1', url: 'https://a.com/script.js' },
        { message: 'Error 2', url: 'https://b.com/app.js' },
        { message: 'Error 3', url: 'https://a.com/other.js' },
      ];
      mocks.consoleMonitorMock.getExceptions.mockReturnValue(exceptions);

      const result = await handler.handleConsoleGetExceptions({ url: 'a.com' });
      const parsed = parseContent<ConsoleExceptionsPayload>(result);

      expect(parsed.total).toBe(2);
      expect(
        parsed.exceptions.every((exception) => exception.url?.includes('a.com') === true)
      ).toBe(true);
    });

    it('applies default limit of 50', async () => {
      const exceptions = Array.from({ length: 60 }, (_, i) => ({
        message: `Error ${i}`,
        url: `https://example.com/${i}.js`,
      }));
      mocks.consoleMonitorMock.getExceptions.mockReturnValue(exceptions);

      const result = await handler.handleConsoleGetExceptions({});
      const parsed = parseContent(result);

      expect(parsed.total).toBe(50);
    });

    it('applies custom limit', async () => {
      const exceptions = Array.from({ length: 20 }, (_, i) => ({
        message: `Error ${i}`,
        url: `https://example.com/${i}.js`,
      }));
      mocks.consoleMonitorMock.getExceptions.mockReturnValue(exceptions);

      const result = await handler.handleConsoleGetExceptions({ limit: 5 });
      const parsed = parseContent(result);

      expect(parsed.total).toBe(5);
    });

    it('applies URL filter before limit', async () => {
      const exceptions = Array.from({ length: 10 }, (_, i) => ({
        message: `Error ${i}`,
        url: i < 3 ? 'https://target.com/script.js' : `https://other.com/${i}.js`,
      }));
      mocks.consoleMonitorMock.getExceptions.mockReturnValue(exceptions);

      const result = await handler.handleConsoleGetExceptions({ url: 'target.com', limit: 2 });
      const parsed = parseContent(result);

      expect(parsed.total).toBe(2);
    });

    it('returns empty array when no exceptions exist', async () => {
      mocks.consoleMonitorMock.getExceptions.mockReturnValue([]);

      const result = await handler.handleConsoleGetExceptions({});
      const parsed = parseContent(result);

      expect(parsed.success).toBe(true);
      expect(parsed.exceptions).toEqual([]);
      expect(parsed.total).toBe(0);
    });

    it('handles exceptions with undefined url during filtering', async () => {
      const exceptions = [
        { message: 'Error 1', url: undefined },
        { message: 'Error 2', url: 'https://a.com/script.js' },
      ];
      mocks.consoleMonitorMock.getExceptions.mockReturnValue(exceptions);

      const result = await handler.handleConsoleGetExceptions({ url: 'a.com' });
      const parsed = parseContent(result);

      // undefined url does not include 'a.com', so only the second exception matches
      expect(parsed.total).toBe(1);
    });

    it('returns content with correct MCP text format', async () => {
      mocks.consoleMonitorMock.getExceptions.mockReturnValue([]);

      const result = await handler.handleConsoleGetExceptions({});

      expect(result.content).toHaveLength(1);
      expect(() => JSON.parse(getTextContent(result))).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // handleConsoleInjectScriptMonitor
  // -----------------------------------------------------------------------
  describe('handleConsoleInjectScriptMonitor', () => {
    it('calls enableDynamicScriptMonitoring and returns success', async () => {
      mocks.consoleMonitorMock.enableDynamicScriptMonitoring.mockResolvedValue(undefined);

      const result = await handler.handleConsoleInjectScriptMonitor({});
      const parsed = parseContent(result);

      expect(mocks.consoleMonitorMock.enableDynamicScriptMonitoring).toHaveBeenCalledOnce();
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Dynamic script monitoring enabled');
    });

    it('propagates errors from enableDynamicScriptMonitoring', async () => {
      mocks.consoleMonitorMock.enableDynamicScriptMonitoring.mockRejectedValue(
        new Error('CDP session closed')
      );

      await expect(handler.handleConsoleInjectScriptMonitor({})).rejects.toThrow(
        'CDP session closed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // handleConsoleInjectXhrInterceptor
  // -----------------------------------------------------------------------
  describe('handleConsoleInjectXhrInterceptor', () => {
    it('calls injectXHRInterceptor and returns success', async () => {
      mocks.consoleMonitorMock.injectXHRInterceptor.mockResolvedValue(undefined);

      const result = await handler.handleConsoleInjectXhrInterceptor({});
      const parsed = parseContent(result);

      expect(mocks.consoleMonitorMock.injectXHRInterceptor).toHaveBeenCalledOnce();
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('XHR interceptor injected');
    });

    it('propagates errors from injectXHRInterceptor', async () => {
      mocks.consoleMonitorMock.injectXHRInterceptor.mockRejectedValue(
        new Error('Injection failed')
      );

      await expect(handler.handleConsoleInjectXhrInterceptor({})).rejects.toThrow(
        'Injection failed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // handleConsoleInjectFetchInterceptor
  // -----------------------------------------------------------------------
  describe('handleConsoleInjectFetchInterceptor', () => {
    it('calls injectFetchInterceptor and returns success', async () => {
      mocks.consoleMonitorMock.injectFetchInterceptor.mockResolvedValue(undefined);

      const result = await handler.handleConsoleInjectFetchInterceptor({});
      const parsed = parseContent(result);

      expect(mocks.consoleMonitorMock.injectFetchInterceptor).toHaveBeenCalledOnce();
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Fetch interceptor injected');
    });

    it('propagates errors from injectFetchInterceptor', async () => {
      mocks.consoleMonitorMock.injectFetchInterceptor.mockRejectedValue(
        new Error('Page not available')
      );

      await expect(handler.handleConsoleInjectFetchInterceptor({})).rejects.toThrow(
        'Page not available'
      );
    });
  });

  // -----------------------------------------------------------------------
  // handleConsoleClearInjectedBuffers
  // -----------------------------------------------------------------------
  describe('handleConsoleClearInjectedBuffers', () => {
    it('calls clearInjectedBuffers and returns merged result', async () => {
      mocks.consoleMonitorMock.clearInjectedBuffers.mockResolvedValue({
        buffersCleared: 3,
        totalEntries: 150,
      });

      const result = await handler.handleConsoleClearInjectedBuffers({});
      const parsed = parseContent(result);

      expect(mocks.consoleMonitorMock.clearInjectedBuffers).toHaveBeenCalledOnce();
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Injected buffers cleared');
      expect(parsed.buffersCleared).toBe(3);
      expect(parsed.totalEntries).toBe(150);
    });

    it('returns success with empty result from clearInjectedBuffers', async () => {
      mocks.consoleMonitorMock.clearInjectedBuffers.mockResolvedValue({});

      const result = await handler.handleConsoleClearInjectedBuffers({});
      const parsed = parseContent(result);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Injected buffers cleared');
    });

    it('propagates errors from clearInjectedBuffers', async () => {
      mocks.consoleMonitorMock.clearInjectedBuffers.mockRejectedValue(new Error('Clear failed'));

      await expect(handler.handleConsoleClearInjectedBuffers({})).rejects.toThrow('Clear failed');
    });
  });

  // -----------------------------------------------------------------------
  // handleConsoleResetInjectedInterceptors
  // -----------------------------------------------------------------------
  describe('handleConsoleResetInjectedInterceptors', () => {
    it('calls resetInjectedInterceptors and returns merged result', async () => {
      mocks.consoleMonitorMock.resetInjectedInterceptors.mockResolvedValue({
        interceptorsReset: 2,
      });

      const result = await handler.handleConsoleResetInjectedInterceptors({});
      const parsed = parseContent(result);

      expect(mocks.consoleMonitorMock.resetInjectedInterceptors).toHaveBeenCalledOnce();
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Injected interceptors/monitors reset');
      expect(parsed.interceptorsReset).toBe(2);
    });

    it('propagates errors from resetInjectedInterceptors', async () => {
      mocks.consoleMonitorMock.resetInjectedInterceptors.mockRejectedValue(
        new Error('Reset failed')
      );

      await expect(handler.handleConsoleResetInjectedInterceptors({})).rejects.toThrow(
        'Reset failed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // handleConsoleInjectFunctionTracer
  // -----------------------------------------------------------------------
  describe('handleConsoleInjectFunctionTracer', () => {
    it('injects function tracer for the given function name', async () => {
      mocks.consoleMonitorMock.injectFunctionTracer.mockResolvedValue(undefined);

      const result = await handler.handleConsoleInjectFunctionTracer({ functionName: 'myFunc' });
      const parsed = parseContent(result);

      expect(mocks.consoleMonitorMock.injectFunctionTracer).toHaveBeenCalledWith('myFunc', {
        persistent: false,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Function tracer injected for: myFunc');
    });

    it('throws when functionName is not provided', async () => {
      await expect(handler.handleConsoleInjectFunctionTracer({})).rejects.toThrow(
        'functionName is required'
      );
      expect(mocks.consoleMonitorMock.injectFunctionTracer).not.toHaveBeenCalled();
    });

    it('throws when functionName is empty string', async () => {
      await expect(handler.handleConsoleInjectFunctionTracer({ functionName: '' })).rejects.toThrow(
        'functionName is required'
      );
    });

    it('handles dot-notation function names', async () => {
      mocks.consoleMonitorMock.injectFunctionTracer.mockResolvedValue(undefined);

      const result = await handler.handleConsoleInjectFunctionTracer({
        functionName: 'window.crypto.getRandomValues',
      });
      const parsed = parseContent(result);

      expect(mocks.consoleMonitorMock.injectFunctionTracer).toHaveBeenCalledWith(
        'window.crypto.getRandomValues',
        { persistent: false }
      );
      expect(parsed.message).toBe('Function tracer injected for: window.crypto.getRandomValues');
    });

    it('propagates errors from injectFunctionTracer', async () => {
      mocks.consoleMonitorMock.injectFunctionTracer.mockRejectedValue(
        new Error('Function not found')
      );

      await expect(
        handler.handleConsoleInjectFunctionTracer({ functionName: 'nonexistent' })
      ).rejects.toThrow('Function not found');
    });
  });

  // -----------------------------------------------------------------------
  // cleanup
  // -----------------------------------------------------------------------
  describe('cleanup', () => {
    it('closes performanceMonitor when it exists and nullifies it', async () => {
      // Simulate an initialized performanceMonitor by accessing the protected property
      handler.setPerformanceMonitorForTest(
        mocks.performanceMonitorMock as unknown as PerformanceMonitor
      );
      mocks.performanceMonitorMock.close.mockResolvedValue(undefined);

      await handler.cleanup();

      expect(mocks.performanceMonitorMock.close).toHaveBeenCalledOnce();
      expect(handler.getPerformanceMonitorForTest()).toBeNull();
    });

    it('logs cleanup message', async () => {
      await handler.cleanup();

      expect(mocks.loggerMock.info).toHaveBeenCalledWith('AdvancedHandlersBase cleaned up');
    });

    it('does not throw when performanceMonitor is null', async () => {
      handler.setPerformanceMonitorForTest(null);

      await expect(handler.cleanup()).resolves.not.toThrow();
      expect(mocks.performanceMonitorMock.close).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Response format consistency
  // -----------------------------------------------------------------------
  describe('response format', () => {
    it('all handlers return content array with single text entry', async () => {
      mocks.consoleMonitorMock.getExceptions.mockReturnValue([]);
      mocks.consoleMonitorMock.enableDynamicScriptMonitoring.mockResolvedValue(undefined);
      mocks.consoleMonitorMock.injectXHRInterceptor.mockResolvedValue(undefined);
      mocks.consoleMonitorMock.injectFetchInterceptor.mockResolvedValue(undefined);
      mocks.consoleMonitorMock.clearInjectedBuffers.mockResolvedValue({});
      mocks.consoleMonitorMock.resetInjectedInterceptors.mockResolvedValue({});
      mocks.consoleMonitorMock.injectFunctionTracer.mockResolvedValue(undefined);

      const methods = [
        () => handler.handleConsoleGetExceptions({}),
        () => handler.handleConsoleInjectScriptMonitor({}),
        () => handler.handleConsoleInjectXhrInterceptor({}),
        () => handler.handleConsoleInjectFetchInterceptor({}),
        () => handler.handleConsoleClearInjectedBuffers({}),
        () => handler.handleConsoleResetInjectedInterceptors({}),
        () => handler.handleConsoleInjectFunctionTracer({ functionName: 'test' }),
      ];

      for (const method of methods) {
        const result = await method();
        expect(result.content).toHaveLength(1);
        const parsed = JSON.parse(getTextContent(result));
        expect(parsed.success).toBe(true);
      }
    });
  });
});
