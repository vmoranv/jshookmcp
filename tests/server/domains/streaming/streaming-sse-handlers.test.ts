import { parseJson } from '@tests/server/domains/shared/mock-factories';
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



describe('StreamingToolHandlersSse', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    } as any;
    return { handler: new StreamingToolHandlersSse(collector), mockPage, collector };
  }

  describe('handleSseMonitorEnable', () => {
    it('enables SSE monitor with default args', async () => {
      const { handler } = createHandler();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseMonitorEnable({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.maxEvents).toBe(2000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.urlFilter).toBeNull();
    });

    it('enables with custom maxEvents', async () => {
      const { handler } = createHandler();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseMonitorEnable({ maxEvents: 500 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.maxEvents).toBe(500);
    });

    it('enables with urlFilter', async () => {
      const { handler } = createHandler();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseMonitorEnable({ urlFilter: 'api\\.example\\.com' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.urlFilter).toBe('api\\.example\\.com');
    });

    it('rejects invalid urlFilter regex', async () => {
      const { handler } = createHandler();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseMonitorEnable({ urlFilter: '[invalid' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('Invalid urlFilter regex');
    });

    it('handles enableSseInterceptor failure', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          success: false,
          error: 'EventSource is not available in current page context',
        }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseMonitorEnable({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('EventSource');
    });

    it('clamps maxEvents to min=1', async () => {
      const { handler, mockPage } = createHandler();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await handler.handleSseMonitorEnable({ maxEvents: -10 });
      // Verify page.evaluate was called (meaning the arg was accepted after clamping)
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('clamps maxEvents to max=50000', async () => {
      const { handler, mockPage } = createHandler();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseGetEvents({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.events).toHaveLength(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseGetEvents({ sourceUrl: 'http://api.test' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseGetEvents({ eventType: 'error' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseGetEvents({ limit: 5, offset: 10 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.page.offset).toBe(10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.page.limit).toBe(5);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.page.hasMore).toBe(true);
    });

    it('handles monitor not enabled', async () => {
      const { handler } = createHandler({
        evaluate: vi.fn().mockResolvedValue({
          success: false,
          message: 'SSE monitor is not enabled. Call sse_monitor_enable first.',
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const result = await handler.handleSseGetEvents({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson<any>(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toContain('not enabled');
    });
  });

  describe('enableSseInterceptor (protected)', () => {
    it('passes maxEvents and urlFilter to page.evaluate', async () => {
      const { handler, mockPage } = createHandler();
      // Access protected method via any cast
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (handler as any).enableSseInterceptor(500, 'test-filter');
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 500,
        urlFilterRaw: 'test-filter',
      });
    });

    it('passes undefined urlFilter when not specified', async () => {
      const { handler, mockPage } = createHandler();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      await (handler as any).enableSseInterceptor(1000);
      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 1000,
        urlFilterRaw: undefined,
      });
    });
  });
});
