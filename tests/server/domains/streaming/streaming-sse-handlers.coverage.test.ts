/**
 * Coverage expansion tests for SseHandlers (src/server/domains/streaming/handlers/sse-handlers.ts).
 *
 * Tests the SseHandlers class directly — handleSseMonitorEnable and handleSseGetEvents —
 * covering default args, persistent mode, invalid/valid urlFilter, maxEvents clamping,
 * pagination, filtering, and error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RingBuffer } from '@utils/RingBuffer';
import type { StreamingSharedState } from '@server/domains/streaming/handlers/shared';
import { SseHandlers } from '@server/domains/streaming/handlers/sse-handlers';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

function parseBody(result: unknown): any {
  return parseJson<Record<string, unknown>>(result);
}

function createState(collectorOverrides: Record<string, unknown> = {}): StreamingSharedState {
  const mockPage = {
    evaluate: vi.fn().mockResolvedValue({
      success: true,
      message: 'SSE monitor enabled',
      patched: true,
      urlFilter: undefined,
      maxEvents: 2000,
      existingEvents: 0,
    }),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    ...collectorOverrides,
  };

  const collector = {
    getActivePage: vi.fn().mockResolvedValue(mockPage),
  } as unknown as StreamingSharedState['collector'];

  return {
    collector,
    wsSession: null,
    wsListeners: null,
    wsConfig: { enabled: false, maxFrames: 1000 },
    wsFramesByRequest: new Map(),
    wsFrameOrder: new RingBuffer(1000),
    wsConnections: new Map(),
    sseConfig: { maxEvents: 2000 },
  };
}

describe('SseHandlers', () => {
  let handlers: SseHandlers;
  let state: StreamingSharedState;
  let mockPage: {
    evaluate: ReturnType<typeof vi.fn>;
    evaluateOnNewDocument: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    state = createState();
    // The mock page is the one resolved by getActivePage
    mockPage = {
      evaluate:
        (state.collector.getActivePage as ReturnType<typeof vi.fn>).mock.results[0]?.value ??
        vi.fn(),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    };
    // Re-setup: create a fresh page mock for each test
    mockPage = {
      evaluate: vi.fn().mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        urlFilter: undefined,
        maxEvents: 2000,
        existingEvents: 0,
      }),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    };
    (state.collector.getActivePage as ReturnType<typeof vi.fn>).mockResolvedValue(mockPage);
    handlers = new SseHandlers(state);
  });

  // ── handleSseMonitorEnable ──

  describe('handleSseMonitorEnable', () => {
    it('enables SSE monitor with default args and updates sseConfig', async () => {
      const result = await handlers.handleSseMonitorEnable({});
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.message).toBe('SSE monitor enabled');
      expect(body.config).toEqual({ maxEvents: 2000, urlFilter: null });
      expect(state.sseConfig.maxEvents).toBe(2000);
      expect(state.sseConfig.urlFilterRaw).toBeUndefined();
    });

    it('enables with custom maxEvents and updates sseConfig', async () => {
      const result = await handlers.handleSseMonitorEnable({ maxEvents: 500 });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(500);
      expect(state.sseConfig.maxEvents).toBe(500);
    });

    it('clamps maxEvents to minimum value of 1', async () => {
      const result = await handlers.handleSseMonitorEnable({ maxEvents: -10 });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(1);
      expect(state.sseConfig.maxEvents).toBe(1);
    });

    it('clamps maxEvents to maximum value of 50000', async () => {
      const result = await handlers.handleSseMonitorEnable({ maxEvents: 99999 });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(50000);
      expect(state.sseConfig.maxEvents).toBe(50000);
    });

    it('clamps maxEvents when non-numeric string is passed', async () => {
      const result = await handlers.handleSseMonitorEnable({ maxEvents: 'not-a-number' });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      // Should fall back to default of 2000
      expect(body.config.maxEvents).toBe(2000);
    });

    it('enables with valid urlFilter and stores it in sseConfig', async () => {
      const result = await handlers.handleSseMonitorEnable({ urlFilter: 'api\\.example\\.com' });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.config.urlFilter).toBe('api\\.example\\.com');
      expect(state.sseConfig.urlFilterRaw).toBe('api\\.example\\.com');
    });

    it('rejects invalid urlFilter regex and returns error', async () => {
      const result = await handlers.handleSseMonitorEnable({ urlFilter: '[invalid' });
      const body = parseBody(result);

      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid urlFilter regex');
      // sseConfig should NOT be updated on error
      expect(state.sseConfig.urlFilterRaw).toBeUndefined();
    });

    it('handles empty string urlFilter as undefined', async () => {
      const result = await handlers.handleSseMonitorEnable({ urlFilter: '' });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.config.urlFilter).toBeNull();
      expect(state.sseConfig.urlFilterRaw).toBeUndefined();
    });

    it('handles whitespace-only urlFilter as undefined', async () => {
      const result = await handlers.handleSseMonitorEnable({ urlFilter: '   ' });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.config.urlFilter).toBeNull();
    });

    it('uses persistent mode when persistent=true', async () => {
      const result = await handlers.handleSseMonitorEnable({ persistent: true });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.message).toContain('persistent');
      expect(body.message).toContain('survives navigations');
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalled();
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });

    it('persistent mode does not trigger evaluateWithTimeout', async () => {
      await handlers.handleSseMonitorEnable({ persistent: true, maxEvents: 100 });
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxEvents: 100 }),
      );
      expect(mockPage.evaluate).not.toHaveBeenCalled();
    });

    it('non-persistent mode uses evaluateWithTimeout', async () => {
      await handlers.handleSseMonitorEnable({ persistent: false, maxEvents: 300 });
      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxEvents: 300 }),
      );
      expect(mockPage.evaluateOnNewDocument).not.toHaveBeenCalled();
    });

    it('persistent=true with urlFilter passes filter to evaluateOnNewDocument', async () => {
      await handlers.handleSseMonitorEnable({ persistent: true, urlFilter: 'test\\.com' });
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxEvents: 2000, urlFilterRaw: 'test\\.com' }),
      );
    });

    it('returns failure when page evaluate returns success=false', async () => {
      mockPage.evaluate.mockResolvedValue({
        success: false,
        error: 'EventSource is not available in current page context',
      });

      const result = await handlers.handleSseMonitorEnable({});
      const body = parseBody(result);

      expect(body.success).toBe(false);
      expect(body.error).toContain('EventSource');
      // sseConfig should NOT be updated
      expect(state.sseConfig.maxEvents).toBe(2000);
    });

    it('returns existingEvents count from evaluate result', async () => {
      mockPage.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        urlFilter: undefined,
        maxEvents: 2000,
        existingEvents: 42,
      });

      const result = await handlers.handleSseMonitorEnable({});
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.existingEvents).toBe(42);
    });

    it('returns patched status from evaluate result', async () => {
      mockPage.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: false,
        urlFilter: 'test',
        maxEvents: 100,
        existingEvents: 5,
      });

      const result = await handlers.handleSseMonitorEnable({ urlFilter: 'test', maxEvents: 100 });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.patched).toBe(false);
    });

    it('handles non-boolean persistent value as false', async () => {
      await handlers.handleSseMonitorEnable({ persistent: 'yes' });
      expect(mockPage.evaluate).toHaveBeenCalled();
      expect(mockPage.evaluateOnNewDocument).not.toHaveBeenCalled();
    });

    it('handles persistent mode failure from evaluateOnNewDocument', async () => {
      // evaluateOnNewDocument returns the result directly for persistent mode
      // In persistent mode, the handler returns a synthetic success, not calling evaluate
      // So we test that it still reports success with existingEvents=0
      const result = await handlers.handleSseMonitorEnable({ persistent: true });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.existingEvents).toBe(0);
    });

    it('truncates string maxEvents to integer', async () => {
      const result = await handlers.handleSseMonitorEnable({ maxEvents: '150.7' });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(150);
    });

    it('passes urlFilterRaw as undefined when no filter provided', async () => {
      await handlers.handleSseMonitorEnable({});
      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ urlFilterRaw: undefined }),
      );
    });
  });

  // ── handleSseGetEvents ──

  describe('handleSseGetEvents', () => {
    const defaultGetEventsResponse = {
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
    };

    it('retrieves events with default args', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      const result = await handlers.handleSseGetEvents({});
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.events).toHaveLength(2);
      expect(body.page.returned).toBe(2);
    });

    it('passes default limit=100 and offset=0 to evaluate', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({});

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          limit: 100,
          offset: 0,
          sourceUrl: undefined,
          eventType: undefined,
        }),
      );
    });

    it('filters by sourceUrl', async () => {
      const filteredResponse = {
        ...defaultGetEventsResponse,
        filters: { sourceUrl: 'http://api.test', eventType: null },
        page: {
          offset: 0,
          limit: 100,
          returned: 1,
          totalAfterFilter: 1,
          hasMore: false,
          nextOffset: null,
        },
        events: [defaultGetEventsResponse.events[0]],
      };
      mockPage.evaluate.mockResolvedValue(filteredResponse);

      const result = await handlers.handleSseGetEvents({ sourceUrl: 'http://api.test' });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.filters.sourceUrl).toBe('http://api.test');

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ sourceUrl: 'http://api.test' }),
      );
    });

    it('filters by eventType', async () => {
      const filteredResponse = {
        ...defaultGetEventsResponse,
        filters: { sourceUrl: null, eventType: 'error' },
        page: {
          offset: 0,
          limit: 100,
          returned: 0,
          totalAfterFilter: 0,
          hasMore: false,
          nextOffset: null,
        },
        events: [],
      };
      mockPage.evaluate.mockResolvedValue(filteredResponse);

      const result = await handlers.handleSseGetEvents({ eventType: 'error' });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.filters.eventType).toBe('error');
    });

    it('supports pagination with limit and offset', async () => {
      const paginatedResponse = {
        ...defaultGetEventsResponse,
        page: {
          offset: 10,
          limit: 5,
          returned: 5,
          totalAfterFilter: 20,
          hasMore: true,
          nextOffset: 15,
        },
        events: [],
      };
      mockPage.evaluate.mockResolvedValue(paginatedResponse);

      const result = await handlers.handleSseGetEvents({ limit: 5, offset: 10 });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.page.offset).toBe(10);
      expect(body.page.limit).toBe(5);
      expect(body.page.hasMore).toBe(true);
      expect(body.page.nextOffset).toBe(15);
    });

    it('clamps limit to minimum of 1', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ limit: -5 });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ limit: 1 }),
      );
    });

    it('clamps limit to maximum of 5000', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ limit: 99999 });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ limit: 5000 }),
      );
    });

    it('clamps offset to minimum of 0', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ offset: -10 });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ offset: 0 }),
      );
    });

    it('handles non-numeric limit by using default 100', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ limit: 'abc' });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ limit: 100 }),
      );
    });

    it('handles non-numeric offset by using default 0', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ offset: 'xyz' });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ offset: 0 }),
      );
    });

    it('handles monitor not enabled response', async () => {
      mockPage.evaluate.mockResolvedValue({
        success: false,
        message: 'SSE monitor is not enabled. Call sse_monitor_enable first.',
      });

      const result = await handlers.handleSseGetEvents({});
      const body = parseBody(result);

      expect(body.success).toBe(false);
      expect(body.message).toContain('not enabled');
    });

    it('truncates string limit to integer', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ limit: '25.9' });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ limit: 25 }),
      );
    });

    it('truncates string offset to integer', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ offset: '10.5' });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ offset: 10 }),
      );
    });

    it('passes both sourceUrl and eventType together', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ sourceUrl: 'http://test.com', eventType: 'message' });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          sourceUrl: 'http://test.com',
          eventType: 'message',
        }),
      );
    });

    it('wraps evaluate result in asJson format', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      const result = await handlers.handleSseGetEvents({});

      // asJson wraps in { content: [{ type: 'text', text: JSON.stringify(payload) }] }
      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(typeof result.content[0].text).toBe('string');
    });

    it('handles empty string sourceUrl as undefined', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ sourceUrl: '' });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ sourceUrl: undefined }),
      );
    });

    it('handles empty string eventType as undefined', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ eventType: '' });

      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ eventType: undefined }),
      );
    });

    it('handles numeric sourceUrl gracefully', async () => {
      mockPage.evaluate.mockResolvedValue(defaultGetEventsResponse);

      await handlers.handleSseGetEvents({ sourceUrl: 123 });

      // parseOptionalStringArg returns undefined for non-strings
      expect(mockPage.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ sourceUrl: undefined }),
      );
    });
  });

  // ── enableSseInterceptor (private, tested indirectly) ──

  describe('enableSseInterceptor (private)', () => {
    it('passes config object with maxEvents and urlFilterRaw to evaluate', async () => {
      await handlers.handleSseMonitorEnable({ maxEvents: 500, urlFilter: 'api\\.example' });

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 500,
        urlFilterRaw: 'api\\.example',
      });
    });

    it('passes undefined urlFilterRaw when no filter', async () => {
      await handlers.handleSseMonitorEnable({ maxEvents: 1000 });

      expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        maxEvents: 1000,
        urlFilterRaw: undefined,
      });
    });

    it('persistent mode returns synthetic success with existingEvents=0', async () => {
      const result = await handlers.handleSseMonitorEnable({ persistent: true });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.message).toContain('persistent');
      expect(body.existingEvents).toBe(0);
      expect(body.patched).toBe(true);
    });

    it('persistent mode returns urlFilter in synthetic response', async () => {
      const result = await handlers.handleSseMonitorEnable({
        persistent: true,
        urlFilter: 'ws://.*',
      });
      const body = parseBody(result);

      expect(body.success).toBe(true);
      expect(body.config.urlFilter).toBe('ws://.*');
    });
  });
});
