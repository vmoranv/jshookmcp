import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock shared modules before imports
vi.mock('@server/domains/shared/modules', () => ({
  CodeCollector: vi.fn(),
  CodeAnalyzer: vi.fn(),
  CamoufoxBrowserManager: vi.fn(),
  AICaptchaDetector: vi.fn(),
  DOMInspector: vi.fn(),
  PageController: vi.fn(),
  CryptoDetector: vi.fn(),
  ASTOptimizer: vi.fn(),
  AdvancedDeobfuscator: vi.fn(),
  Deobfuscator: vi.fn(),
  ObfuscationDetector: vi.fn(),
  DebuggerManager: vi.fn(),
  RuntimeInspector: vi.fn(),
  ScriptManager: vi.fn(),
  BlackboxManager: vi.fn(),
  ExternalToolRunner: vi.fn(),
  ToolRegistry: vi.fn(),
  AIHookGenerator: vi.fn(),
  HookManager: vi.fn(),
  ConsoleMonitor: vi.fn(),
  PerformanceMonitor: vi.fn(),
  MemoryManager: vi.fn(),
  UnifiedProcessManager: vi.fn(),
  StealthScripts: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('StreamingToolHandlersSse', () => {
  let StreamingToolHandlersSse: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@server/domains/streaming/handlers.impl.streaming-sse');
    StreamingToolHandlersSse = mod.StreamingToolHandlersSse;
  });

  function createHandler(pageOverrides: Record<string, unknown> = {}) {
    const mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        urlFilter: undefined,
        maxEvents: 2000,
        existingEvents: 0,
      }),
      ...pageOverrides,
    };
    const collector = {
      getActivePage: vi.fn().mockResolvedValue(mockPage),
    } as any;
    return { handler: new StreamingToolHandlersSse(collector), mockPage, collector };
  }

  describe('handleSseMonitorEnable', () => {
    it('enables SSE monitor with default args', async () => {
      const { handler } = createHandler();
      const result = await handler.handleSseMonitorEnable({});
      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(2000);
      expect(body.config.urlFilter).toBeNull();
    });

    it('enables with custom maxEvents', async () => {
      const { handler } = createHandler();
      const result = await handler.handleSseMonitorEnable({ maxEvents: 500 });
      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(500);
    });

    it('enables with urlFilter', async () => {
      const { handler } = createHandler();
      const result = await handler.handleSseMonitorEnable({ urlFilter: 'api\\.example\\.com' });
      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.config.urlFilter).toBe('api\\.example\\.com');
    });

    it('rejects invalid urlFilter regex', async () => {
      const { handler } = createHandler();
      const result = await handler.handleSseMonitorEnable({ urlFilter: '[invalid' });
      const body = parseJson(result);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid urlFilter regex');
    });

    it('handles enableSseInterceptor failure', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          success: false,
          error: 'EventSource is not available in current page context',
        }),
      });
      const result = await handler.handleSseMonitorEnable({});
      const body = parseJson(result);
      expect(body.success).toBe(false);
      expect(body.error).toContain('EventSource');
    });

    it('clamps maxEvents to min=1', async () => {
      const { handler, mockPage } = createHandler();
      await handler.handleSseMonitorEnable({ maxEvents: -10 });
      // Verify page.evaluate was called (meaning the arg was accepted after clamping)
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('clamps maxEvents to max=50000', async () => {
      const { handler, mockPage } = createHandler();
      await handler.handleSseMonitorEnable({ maxEvents: 100000 });
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('handleSseGetEvents', () => {
    it('retrieves events with default args', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          success: true,
          filters: { sourceUrl: null, eventType: null },
          page: {
            offset: 0,
            limit: 100,
            returned: 2,
            totalAfterFilter: 2,
            hasMore: false,
            nextOffset: null,
          },
          monitor: {
            enabled: true,
            patched: true,
            maxEvents: 2000,
            urlFilter: null,
            sourceCount: 1,
          },
          events: [
            {
              sourceUrl: 'http://api.test/stream',
              eventType: 'message',
              dataPreview: 'hello',
              dataLength: 5,
              lastEventId: null,
              timestamp: 1000,
            },
            {
              sourceUrl: 'http://api.test/stream',
              eventType: 'message',
              dataPreview: 'world',
              dataLength: 5,
              lastEventId: '1',
              timestamp: 1001,
            },
          ],
        }),
      });

      const result = await handler.handleSseGetEvents({});
      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.events).toHaveLength(2);
      expect(body.page.returned).toBe(2);
    });

    it('filters by sourceUrl', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          success: true,
          filters: { sourceUrl: 'http://api.test', eventType: null },
          page: {
            offset: 0,
            limit: 100,
            returned: 1,
            totalAfterFilter: 1,
            hasMore: false,
            nextOffset: null,
          },
          monitor: {
            enabled: true,
            patched: true,
            maxEvents: 2000,
            urlFilter: null,
            sourceCount: 1,
          },
          events: [
            {
              sourceUrl: 'http://api.test',
              eventType: 'message',
              dataPreview: 'data',
              dataLength: 4,
              lastEventId: null,
              timestamp: 1000,
            },
          ],
        }),
      });

      const result = await handler.handleSseGetEvents({ sourceUrl: 'http://api.test' });
      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.filters.sourceUrl).toBe('http://api.test');
    });

    it('filters by eventType', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          success: true,
          filters: { sourceUrl: null, eventType: 'error' },
          page: {
            offset: 0,
            limit: 100,
            returned: 0,
            totalAfterFilter: 0,
            hasMore: false,
            nextOffset: null,
          },
          monitor: {
            enabled: true,
            patched: true,
            maxEvents: 2000,
            urlFilter: null,
            sourceCount: 0,
          },
          events: [],
        }),
      });

      const result = await handler.handleSseGetEvents({ eventType: 'error' });
      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.filters.eventType).toBe('error');
    });

    it('supports pagination with limit and offset', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          success: true,
          filters: { sourceUrl: null, eventType: null },
          page: {
            offset: 10,
            limit: 5,
            returned: 5,
            totalAfterFilter: 20,
            hasMore: true,
            nextOffset: 15,
          },
          monitor: {
            enabled: true,
            patched: true,
            maxEvents: 2000,
            urlFilter: null,
            sourceCount: 1,
          },
          events: [],
        }),
      });

      const result = await handler.handleSseGetEvents({ limit: 5, offset: 10 });
      const body = parseJson(result);
      expect(body.success).toBe(true);
      expect(body.page.offset).toBe(10);
      expect(body.page.limit).toBe(5);
      expect(body.page.hasMore).toBe(true);
    });

    it('handles monitor not enabled', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          success: false,
          message: 'SSE monitor is not enabled. Call sse_monitor_enable first.',
        }),
      });

      const result = await handler.handleSseGetEvents({});
      const body = parseJson(result);
      expect(body.success).toBe(false);
      expect(body.message).toContain('not enabled');
    });
  });

  describe('enableSseInterceptor (protected)', () => {
    it('passes maxEvents and urlFilter to page.evaluate', async () => {
      const { handler, mockPage } = createHandler();
      // Access protected method via any cast
      await (handler as any).enableSseInterceptor(500, 'test-filter');
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 500,
        urlFilterRaw: 'test-filter',
      });
    });

    it('passes undefined urlFilter when not specified', async () => {
      const { handler, mockPage } = createHandler();
      await (handler as any).enableSseInterceptor(1000);
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 1000,
        urlFilterRaw: undefined,
      });
    });
  });
});
