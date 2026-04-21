import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleHandlers } from '@server/domains/network/handlers/console-handlers';

function parseBody(r: unknown) {
  return JSON.parse((r as { content: [{ text: string }] }).content[0]!.text);
}

function createDeps() {
  return {
    consoleMonitor: {
      getExceptions: vi.fn().mockReturnValue([]),
      enableDynamicScriptMonitoring: vi.fn().mockResolvedValue(undefined),
      injectXHRInterceptor: vi.fn().mockResolvedValue(undefined),
      injectFetchInterceptor: vi.fn().mockResolvedValue(undefined),
      clearInjectedBuffers: vi.fn().mockResolvedValue({ fetch: 0, xhr: 0 }),
      resetInjectedInterceptors: vi.fn().mockResolvedValue({ reset: true }),
      injectFunctionTracer: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('ConsoleHandlers', () => {
  let handlers: ConsoleHandlers;
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    handlers = new ConsoleHandlers(deps as never);
  });

  describe('handleConsoleGetExceptions', () => {
    it('returns empty exceptions', async () => {
      const r = await handlers.handleConsoleGetExceptions({});
      expect(parseBody(r).exceptions).toEqual([]);
      expect(parseBody(r).total).toBe(0);
    });

    it('filters by url', async () => {
      deps.consoleMonitor.getExceptions.mockReturnValue([
        { url: 'https://a.com/page.js', message: 'err1' },
        { url: 'https://b.com/other.js', message: 'err2' },
      ]);
      const r = await handlers.handleConsoleGetExceptions({ url: 'a.com' });
      expect(parseBody(r).exceptions).toHaveLength(1);
    });

    it('respects limit', async () => {
      deps.consoleMonitor.getExceptions.mockReturnValue(
        Array.from({ length: 20 }, (_, i) => ({ url: `u${i}`, message: `m${i}` })),
      );
      const r = await handlers.handleConsoleGetExceptions({ limit: 5 });
      expect(parseBody(r).exceptions).toHaveLength(5);
    });

    it('handles error', async () => {
      deps.consoleMonitor.getExceptions.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await handlers.handleConsoleGetExceptions({});
      expect(parseBody(r).success).toBe(false);
    });
  });

  describe('handleConsoleInjectScriptMonitor', () => {
    it('enables non-persistent', async () => {
      const r = await handlers.handleConsoleInjectScriptMonitor({});
      expect(parseBody(r).message).not.toContain('persistent');
    });

    it('enables persistent', async () => {
      const r = await handlers.handleConsoleInjectScriptMonitor({ persistent: true });
      expect(parseBody(r).message).toContain('persistent');
    });

    it('handles error', async () => {
      deps.consoleMonitor.enableDynamicScriptMonitoring.mockRejectedValue(new Error('fail'));
      const r = await handlers.handleConsoleInjectScriptMonitor({});
      expect(parseBody(r).success).toBe(false);
    });
  });

  describe('handleConsoleInjectXhrInterceptor', () => {
    it('injects non-persistent', async () => {
      const r = await handlers.handleConsoleInjectXhrInterceptor({});
      expect(parseBody(r).message).toContain('XHR');
    });

    it('injects persistent', async () => {
      const r = await handlers.handleConsoleInjectXhrInterceptor({ persistent: true });
      expect(parseBody(r).message).toContain('persistent');
    });
  });

  describe('handleConsoleInjectFetchInterceptor', () => {
    it('injects non-persistent', async () => {
      const r = await handlers.handleConsoleInjectFetchInterceptor({});
      expect(parseBody(r).message).toContain('Fetch');
    });
  });

  describe('handleConsoleClearInjectedBuffers', () => {
    it('clears and returns result', async () => {
      const r = await handlers.handleConsoleClearInjectedBuffers({});
      expect(parseBody(r).message).toContain('cleared');
      expect(parseBody(r).fetch).toBe(0);
    });
  });

  describe('handleConsoleResetInjectedInterceptors', () => {
    it('resets and returns result', async () => {
      const r = await handlers.handleConsoleResetInjectedInterceptors({});
      expect(parseBody(r).message).toContain('reset');
    });
  });

  describe('handleConsoleInjectFunctionTracer', () => {
    it('fails without functionName', async () => {
      const r = await handlers.handleConsoleInjectFunctionTracer({});
      expect(parseBody(r).success).toBe(false);
    });

    it('injects tracer non-persistent', async () => {
      const r = await handlers.handleConsoleInjectFunctionTracer({ functionName: 'myFunc' });
      expect(parseBody(r).message).toContain('myFunc');
      expect(parseBody(r).message).not.toContain('persistent');
    });

    it('injects tracer persistent', async () => {
      const r = await handlers.handleConsoleInjectFunctionTracer({
        functionName: 'myFunc',
        persistent: true,
      });
      expect(parseBody(r).message).toContain('persistent');
    });

    it('handles error', async () => {
      deps.consoleMonitor.injectFunctionTracer.mockRejectedValue(new Error('fail'));
      const r = await handlers.handleConsoleInjectFunctionTracer({ functionName: 'fn' });
      expect(parseBody(r).success).toBe(false);
    });
  });
});
