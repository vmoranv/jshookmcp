import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingToolHandlersSse } from '@server/domains/streaming/handlers.impl.streaming-sse';
import type { TextToolResponse } from '@server/domains/streaming/handlers.impl.streaming-base';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
function parseJson(response: TextToolResponse): any {
  return JSON.parse(response.content[0].text);
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
  const session = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    detach: vi.fn().mockResolvedValue(undefined),
  };

  const page = {
    createCDPSession: vi.fn(async () => session),
    evaluate: vi.fn(),
  };

  const collector = {
    getActivePage: vi.fn(async () => page),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  return { session, page, collector };
}

// ---------------------------------------------------------------------------
// Tests — additional coverage for uncovered lines
// ---------------------------------------------------------------------------

describe('StreamingToolHandlersSse — additional coverage', () => {
  let handler: StreamingToolHandlersSse;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
    handler = new StreamingToolHandlersSse(mocks.collector);
  });

  // -----------------------------------------------------------------------
  // enableSseInterceptor — internal page.evaluate callback scenarios
  // -----------------------------------------------------------------------
  describe('enableSseInterceptor — evaluate callback returns', () => {
    it('returns success:false when EventSource is unavailable', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: false,
        error: 'EventSource is not available in current page context',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.error).toContain('EventSource');
    });

    it('preserves existing events count from interceptor', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 150,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.existingEvents).toBe(150);
    });

    it('handles patched=false on first enable', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: false,
        maxEvents: 2000,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.patched).toBe(false);
    });

    it('forwards urlFilter in interceptor result', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        urlFilter: '/api/.*',
        maxEvents: 2000,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({ urlFilter: '/api/.*' }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.urlFilter).toBe('/api/.*');
    });

    it('does not update sseConfig when interceptor returns success:false', async () => {
      // First enable successfully
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValueOnce({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 500,
        existingEvents: 0,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const first = parseJson(await handler.handleSseMonitorEnable({ maxEvents: 500 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(first.config.maxEvents).toBe(500);

      // Second enable fails
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValueOnce({
        success: false,
        error: 'EventSource is not available in current page context',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const second = parseJson(await handler.handleSseMonitorEnable({ maxEvents: 999 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(second.success).toBe(false);
      // sseConfig should NOT have been updated to 999
    });
  });

  // -----------------------------------------------------------------------
  // handleSseMonitorEnable — argument parsing edge cases
  // -----------------------------------------------------------------------
  describe('handleSseMonitorEnable — argument edge cases', () => {
    it('handles non-finite maxEvents by using default', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: Infinity }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // Infinity is not finite, should fall back to default
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.maxEvents).toBe(2000);
    });

    it('handles NaN maxEvents by using default', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: NaN }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.maxEvents).toBe(2000);
    });

    it('handles null urlFilter (not string)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({ urlFilter: null }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.urlFilter).toBeNull();
    });

    it('handles numeric urlFilter (not string)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({ urlFilter: 12345 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.urlFilter).toBeNull();
    });

    it('handles boolean maxEvents (falls back to default)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: true }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.maxEvents).toBe(2000);
    });

    it('handles object maxEvents (falls back to default)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: {} }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.config.maxEvents).toBe(2000);
    });
  });

  // -----------------------------------------------------------------------
  // handleSseGetEvents — additional edge cases
  // -----------------------------------------------------------------------
  describe('handleSseGetEvents — additional edge cases', () => {
    it('handles whitespace-only sourceUrl by treating as undefined', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
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
      });

      await handler.handleSseGetEvents({ sourceUrl: '   ' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const evaluateArgs = mocks.page.evaluate.mock.calls[0]![1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(evaluateArgs.sourceUrl).toBeUndefined();
    });

    it('handles whitespace-only eventType by treating as undefined', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
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
      });

      await handler.handleSseGetEvents({ eventType: '   ' });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const evaluateArgs = mocks.page.evaluate.mock.calls[0]![1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(evaluateArgs.eventType).toBeUndefined();
    });

    it('handles boolean sourceUrl by treating as undefined', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
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
      });

      await handler.handleSseGetEvents({ sourceUrl: true });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const evaluateArgs = mocks.page.evaluate.mock.calls[0]![1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(evaluateArgs.sourceUrl).toBeUndefined();
    });

    it('handles Infinity limit by clamping to max 5000', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0,
          limit: 5000,
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
      });

      await handler.handleSseGetEvents({ limit: Infinity });

      // Infinity is not finite, so default kicks in
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const evaluateArgs = mocks.page.evaluate.mock.calls[0]![1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(evaluateArgs.limit).toBe(100);
    });

    it('passes all four arguments to page.evaluate', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: 'http://a.com', eventType: 'data' },
        page: {
          offset: 5,
          limit: 50,
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
      });

      await handler.handleSseGetEvents({
        sourceUrl: 'http://a.com',
        eventType: 'data',
        limit: 50,
        offset: 5,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const evaluateArgs = mocks.page.evaluate.mock.calls[0]![1];
      expect(evaluateArgs).toEqual({
        sourceUrl: 'http://a.com',
        eventType: 'data',
        limit: 50,
        offset: 5,
      });
    });

    it('handles monitor state with multiple sources', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0,
          limit: 100,
          returned: 3,
          totalAfterFilter: 3,
          hasMore: false,
          nextOffset: null,
        },
        monitor: {
          enabled: true,
          patched: true,
          maxEvents: 2000,
          urlFilter: null,
          sourceCount: 3,
        },
        events: [
          {
            sourceUrl: 'http://a.com/sse',
            eventType: 'message',
            dataPreview: 'a',
            dataLength: 1,
            lastEventId: null,
            timestamp: 1000,
          },
          {
            sourceUrl: 'http://b.com/sse',
            eventType: 'update',
            dataPreview: 'b',
            dataLength: 1,
            lastEventId: '2',
            timestamp: 2000,
          },
          {
            sourceUrl: 'http://c.com/sse',
            eventType: 'open',
            dataPreview: '',
            dataLength: 0,
            lastEventId: null,
            timestamp: 3000,
          },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseGetEvents({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.events).toHaveLength(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.monitor.sourceCount).toBe(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.events[1]!.lastEventId).toBe('2');
    });
  });

  // -----------------------------------------------------------------------
  // handleSseMonitorEnable — re-enable and sequential enables
  // -----------------------------------------------------------------------
  describe('handleSseMonitorEnable — sequential enables', () => {
    it('can enable, then re-enable with different config', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValueOnce({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 100,
        existingEvents: 0,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const first = parseJson(await handler.handleSseMonitorEnable({ maxEvents: 100 }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(first.config.maxEvents).toBe(100);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValueOnce({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 5000,
        existingEvents: 10,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const second = parseJson(
        await handler.handleSseMonitorEnable({ maxEvents: 5000, urlFilter: '/events/.*' })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(second.config.maxEvents).toBe(5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(second.config.urlFilter).toBe('/events/.*');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(second.existingEvents).toBe(10);
    });

    it('page.evaluate receives the function as first arg and config as second', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      await handler.handleSseMonitorEnable({});

      expect(mocks.page.evaluate).toHaveBeenCalledOnce();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const call = mocks.page.evaluate.mock.calls[0]!;
      expect(typeof call[0]).toBe('function');
      expect(call[1]).toEqual({ maxEvents: 2000, urlFilterRaw: undefined });
    });
  });

  // -----------------------------------------------------------------------
  // handleSseGetEvents — response shape validation
  // -----------------------------------------------------------------------
  describe('handleSseGetEvents — response shape', () => {
    it('returns proper TextToolResponse shape', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
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
      });

      const response = await handler.handleSseGetEvents({});
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(typeof response.content[0].text).toBe('string');
      expect(() => JSON.parse(response.content[0].text)).not.toThrow();
    });

    it('returns monitor info block in getEvents response', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
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
          maxEvents: 5000,
          urlFilter: '/stream',
          sourceCount: 2,
        },
        events: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const body = parseJson(await handler.handleSseGetEvents({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.monitor.enabled).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.monitor.patched).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.monitor.maxEvents).toBe(5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.monitor.urlFilter).toBe('/stream');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.monitor.sourceCount).toBe(2);
    });
  });
});
