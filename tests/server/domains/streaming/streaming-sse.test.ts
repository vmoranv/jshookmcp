import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingToolHandlersSse } from '@server/domains/streaming/handlers.impl.streaming-sse';
import type { TextToolResponse } from '@server/domains/streaming/handlers.impl.streaming-base';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJson(response: TextToolResponse): any {
  return JSON.parse(response.content[0].text);
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
  const session = {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn().mockResolvedValue(undefined),
  };

  const page = {
    createCDPSession: vi.fn(async () => session),
    evaluate: vi.fn(),
  };

  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  return { session, page, collector };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamingToolHandlersSse', () => {
  let handler: StreamingToolHandlersSse;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
    handler = new StreamingToolHandlersSse(mocks.collector);
  });

  // -----------------------------------------------------------------------
  // handleSseMonitorEnable
  // -----------------------------------------------------------------------
  describe('handleSseMonitorEnable', () => {
    it('rejects invalid urlFilter regex', async () => {
      const body = parseJson(await handler.handleSseMonitorEnable({ urlFilter: '[' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid urlFilter regex');
    });

    it('rejects another malformed regex', async () => {
      const body = parseJson(await handler.handleSseMonitorEnable({ urlFilter: '(unclosed' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid urlFilter regex');
    });

    it('calls page.evaluate to enable interceptor', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({}));

      expect(mocks.page.evaluate).toHaveBeenCalledOnce();
      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(2000);
    });

    it('uses default maxEvents of 2000', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({}));
      expect(body.config.maxEvents).toBe(2000);
    });

    it('clamps maxEvents to min 1', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 1,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: -5 }));
      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(1);
    });

    it('clamps maxEvents to max 50000', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 50000,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: 999999 }));
      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(50000);
    });

    it('passes valid urlFilter to page.evaluate', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        urlFilter: '/api/stream',
        maxEvents: 2000,
        existingEvents: 0,
      });

      const body = parseJson(
        await handler.handleSseMonitorEnable({ urlFilter: '/api/stream' }),
      );

      expect(body.success).toBe(true);
      expect(body.config.urlFilter).toBe('/api/stream');
    });

    it('passes urlFilter=null when not provided', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({}));
      expect(body.config.urlFilter).toBeNull();
    });

    it('passes custom maxEvents to enableSseInterceptor', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 500,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: 500 }));
      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(500);
    });

    it('returns existingEvents from interceptor result', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 42,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({}));
      expect(body.existingEvents).toBe(42);
    });

    it('handles enableSseInterceptor returning success=false', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: false,
        error: 'EventSource is not available in current page context',
      });

      const body = parseJson(await handler.handleSseMonitorEnable({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('EventSource');
    });

    it('truncates maxEvents to integer', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 100,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: 100.9 }));
      expect(body.config.maxEvents).toBe(100);
    });

    it('parses maxEvents from string', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 300,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: '300' }));
      expect(body.config.maxEvents).toBe(300);
    });

    it('ignores empty-string urlFilter', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({ urlFilter: '' }));
      expect(body.success).toBe(true);
      expect(body.config.urlFilter).toBeNull();
    });

    it('ignores whitespace-only urlFilter', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({ urlFilter: '   ' }));
      expect(body.success).toBe(true);
      expect(body.config.urlFilter).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // handleSseGetEvents
  // -----------------------------------------------------------------------
  describe('handleSseGetEvents', () => {
    it('calls page.evaluate with default filter values', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 0, limit: 100, returned: 0, totalAfterFilter: 0, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 0 },
        events: [],
      });

      const body = parseJson(await handler.handleSseGetEvents({}));
      expect(body.success).toBe(true);
      expect(body.events).toEqual([]);
      expect(mocks.page.evaluate).toHaveBeenCalledOnce();
    });

    it('passes sourceUrl filter through', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: 'http://example.com/events', eventType: null },
        page: { offset: 0, limit: 100, returned: 0, totalAfterFilter: 0, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 1 },
        events: [],
      });

      const body = parseJson(
        await handler.handleSseGetEvents({ sourceUrl: 'http://example.com/events' }),
      );
      expect(body.filters.sourceUrl).toBe('http://example.com/events');
    });

    it('passes eventType filter through', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: 'message' },
        page: { offset: 0, limit: 100, returned: 0, totalAfterFilter: 0, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 0 },
        events: [],
      });

      const body = parseJson(
        await handler.handleSseGetEvents({ eventType: 'message' }),
      );
      expect(body.filters.eventType).toBe('message');
    });

    it('returns events from page.evaluate result', async () => {
      const mockEvents = [
        {
          sourceUrl: 'http://example.com/sse',
          eventType: 'message',
          dataPreview: 'hello world',
          dataLength: 11,
          lastEventId: null,
          timestamp: 1700000000000,
        },
      ];

      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 0, limit: 100, returned: 1, totalAfterFilter: 1, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 1 },
        events: mockEvents,
      });

      const body = parseJson(await handler.handleSseGetEvents({}));
      expect(body.events).toHaveLength(1);
      expect(body.events[0].dataPreview).toBe('hello world');
    });

    it('handles monitor-not-enabled error from page', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: false,
        message: 'SSE monitor is not enabled. Call sse_monitor_enable first.',
      });

      const body = parseJson(await handler.handleSseGetEvents({}));
      expect(body.success).toBe(false);
      expect(body.message).toContain('not enabled');
    });

    it('applies limit parameter', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 0, limit: 10, returned: 5, totalAfterFilter: 5, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 1 },
        events: new Array(5).fill({
          sourceUrl: 'http://example.com/sse',
          eventType: 'message',
          dataPreview: 'data',
          dataLength: 4,
          lastEventId: null,
          timestamp: 1700000000000,
        }),
      });

      const body = parseJson(await handler.handleSseGetEvents({ limit: 10 }));

      // Verify the evaluate call received the correct limit
      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.limit).toBe(10);
    });

    it('applies offset parameter', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 5, limit: 100, returned: 0, totalAfterFilter: 5, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 1 },
        events: [],
      });

      await handler.handleSseGetEvents({ offset: 5 });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.offset).toBe(5);
    });

    it('clamps limit to min 1', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 0, limit: 1, returned: 0, totalAfterFilter: 0, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 0 },
        events: [],
      });

      await handler.handleSseGetEvents({ limit: -5 });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.limit).toBe(1);
    });

    it('clamps limit to max 5000', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 0, limit: 5000, returned: 0, totalAfterFilter: 0, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 0 },
        events: [],
      });

      await handler.handleSseGetEvents({ limit: 99999 });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.limit).toBe(5000);
    });

    it('clamps offset to min 0', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 0, limit: 100, returned: 0, totalAfterFilter: 0, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 0 },
        events: [],
      });

      await handler.handleSseGetEvents({ offset: -10 });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.offset).toBe(0);
    });

    it('reports hasMore and nextOffset for paginated results', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 0, limit: 2, returned: 2, totalAfterFilter: 5, hasMore: true, nextOffset: 2 },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 1 },
        events: [{}, {}],
      });

      const body = parseJson(await handler.handleSseGetEvents({ limit: 2 }));
      expect(body.page.hasMore).toBe(true);
      expect(body.page.nextOffset).toBe(2);
    });

    it('ignores non-string sourceUrl', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: { offset: 0, limit: 100, returned: 0, totalAfterFilter: 0, hasMore: false, nextOffset: null },
        monitor: { enabled: true, patched: true, maxEvents: 2000, urlFilter: null, sourceCount: 0 },
        events: [],
      });

      await handler.handleSseGetEvents({ sourceUrl: 12345 });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.sourceUrl).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // enableSseInterceptor (via handleSseMonitorEnable integration)
  // -----------------------------------------------------------------------
  describe('enableSseInterceptor integration', () => {
    it('passes maxEvents and urlFilterRaw to page.evaluate', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 500,
        existingEvents: 0,
      });

      await handler.handleSseMonitorEnable({ maxEvents: 500, urlFilter: '/events' });

      expect(mocks.page.evaluate).toHaveBeenCalledOnce();
      const evalArgs = mocks.page.evaluate.mock.calls[0];
      // Second argument is the config passed to page.evaluate
      expect(evalArgs[1]).toEqual({ maxEvents: 500, urlFilterRaw: '/events' });
    });

    it('passes undefined urlFilterRaw when no filter', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      await handler.handleSseMonitorEnable({});

      const evalArgs = mocks.page.evaluate.mock.calls[0];
      expect(evalArgs[1]).toEqual({ maxEvents: 2000, urlFilterRaw: undefined });
    });

    it('propagates page.evaluate rejection', async () => {
      mocks.page.evaluate.mockRejectedValue(new Error('Page crashed'));

      await expect(handler.handleSseMonitorEnable({})).rejects.toThrow('Page crashed');
    });
  });

  // -----------------------------------------------------------------------
  // sseConfig state management
  // -----------------------------------------------------------------------
  describe('sseConfig state management', () => {
    it('updates sseConfig after successful enable', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 750,
        existingEvents: 0,
      });

      const body = parseJson(
        await handler.handleSseMonitorEnable({ maxEvents: 750, urlFilter: '/stream' }),
      );

      expect(body.success).toBe(true);
      expect(body.config.maxEvents).toBe(750);
      expect(body.config.urlFilter).toBe('/stream');
    });

    it('does not update sseConfig on enable failure', async () => {
      // First enable with valid config
      mocks.page.evaluate.mockResolvedValueOnce({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 500,
        existingEvents: 0,
      });
      await handler.handleSseMonitorEnable({ maxEvents: 500 });

      // Second enable that fails
      mocks.page.evaluate.mockResolvedValueOnce({
        success: false,
        error: 'EventSource is not available in current page context',
      });
      const body = parseJson(await handler.handleSseMonitorEnable({ maxEvents: 100 }));

      expect(body.success).toBe(false);
    });

    it('updates sseConfig on re-enable with different values', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 500,
        existingEvents: 0,
      });

      await handler.handleSseMonitorEnable({ maxEvents: 500, urlFilter: '/first' });

      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 1000,
        existingEvents: 5,
      });

      const body = parseJson(
        await handler.handleSseMonitorEnable({ maxEvents: 1000, urlFilter: '/second' }),
      );

      expect(body.config.maxEvents).toBe(1000);
      expect(body.config.urlFilter).toBe('/second');
    });
  });

  // -----------------------------------------------------------------------
  // handleSseGetEvents edge cases
  // -----------------------------------------------------------------------
  describe('handleSseGetEvents edge cases', () => {
    it('passes combined sourceUrl and eventType filters to evaluate', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: 'http://x.com/sse', eventType: 'update' },
        page: {
          offset: 0, limit: 50, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({
        sourceUrl: 'http://x.com/sse',
        eventType: 'update',
        limit: 50,
        offset: 0,
      });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs).toEqual({
        sourceUrl: 'http://x.com/sse',
        eventType: 'update',
        limit: 50,
        offset: 0,
      });
    });

    it('parses limit from string', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0, limit: 25, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({ limit: '25' });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.limit).toBe(25);
    });

    it('parses offset from string', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 10, limit: 100, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({ offset: '10' });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.offset).toBe(10);
    });

    it('ignores non-string eventType', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0, limit: 100, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({ eventType: 42 });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.eventType).toBeUndefined();
    });

    it('truncates fractional limit to integer', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0, limit: 50, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({ limit: 50.7 });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.limit).toBe(50);
    });

    it('truncates fractional offset to integer', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 3, limit: 100, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({ offset: 3.9 });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.offset).toBe(3);
    });

    it('uses default limit of 100 when not provided', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0, limit: 100, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({});

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.limit).toBe(100);
    });

    it('uses default offset of 0 when not provided', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0, limit: 100, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({});

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.offset).toBe(0);
    });

    it('returns multiple events with complete structure', async () => {
      const events = [
        {
          sourceUrl: 'http://a.com/sse',
          eventType: 'message',
          dataPreview: 'msg1',
          dataLength: 4,
          lastEventId: '1',
          timestamp: 1000,
        },
        {
          sourceUrl: 'http://a.com/sse',
          eventType: 'update',
          dataPreview: 'msg2',
          dataLength: 4,
          lastEventId: null,
          timestamp: 2000,
        },
      ];

      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0, limit: 100, returned: 2,
          totalAfterFilter: 2, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 1,
        },
        events,
      });

      const body = parseJson(await handler.handleSseGetEvents({}));

      expect(body.events).toHaveLength(2);
      expect(body.events[0].eventType).toBe('message');
      expect(body.events[0].lastEventId).toBe('1');
      expect(body.events[1].eventType).toBe('update');
      expect(body.events[1].lastEventId).toBeNull();
    });

    it('propagates page.evaluate rejection from getEvents', async () => {
      mocks.page.evaluate.mockRejectedValue(new Error('Execution context destroyed'));

      await expect(handler.handleSseGetEvents({})).rejects.toThrow(
        'Execution context destroyed',
      );
    });

    it('uses default limit for invalid (NaN) limit value', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0, limit: 100, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({ limit: 'not-a-number' });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.limit).toBe(100);
    });

    it('uses default offset for invalid offset value', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        filters: { sourceUrl: null, eventType: null },
        page: {
          offset: 0, limit: 100, returned: 0,
          totalAfterFilter: 0, hasMore: false, nextOffset: null,
        },
        monitor: {
          enabled: true, patched: true, maxEvents: 2000,
          urlFilter: null, sourceCount: 0,
        },
        events: [],
      });

      await handler.handleSseGetEvents({ offset: {} });

      const evaluateArgs = mocks.page.evaluate.mock.calls[0][1];
      expect(evaluateArgs.offset).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // handleSseMonitorEnable response structure
  // -----------------------------------------------------------------------
  describe('handleSseMonitorEnable response structure', () => {
    it('includes patched flag from interceptor result', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: false,
        maxEvents: 2000,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({}));
      expect(body.patched).toBe(false);
    });

    it('includes message from interceptor result', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      const body = parseJson(await handler.handleSseMonitorEnable({}));
      expect(body.message).toBe('SSE monitor enabled');
    });

    it('returns proper TextToolResponse shape', async () => {
      mocks.page.evaluate.mockResolvedValue({
        success: true,
        message: 'SSE monitor enabled',
        patched: true,
        maxEvents: 2000,
        existingEvents: 0,
      });

      const response = await handler.handleSseMonitorEnable({});
      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(typeof response.content[0].text).toBe('string');
      expect(() => JSON.parse(response.content[0].text)).not.toThrow();
    });
  });
});
