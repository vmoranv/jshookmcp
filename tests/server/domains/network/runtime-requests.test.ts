import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: unknown) => payload,
    }),
  },
}));

vi.mock('@src/server/domains/shared/modules', () => ({
  PerformanceMonitor: vi.fn(),
  ConsoleMonitor: vi.fn(),
  CodeCollector: vi.fn(),
}));

import { AdvancedHandlersBase } from '@server/domains/network/handlers.base';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('AdvancedHandlersBase (requests)', () => {
  const collector = {} as any;
  const consoleMonitor = {
    isNetworkEnabled: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getNetworkStatus: vi.fn(),
    getNetworkRequests: vi.fn(),
    getNetworkResponses: vi.fn(),
    getResponseBody: vi.fn(),
  } as any;

  let handler: AdvancedHandlersBase;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new AdvancedHandlersBase(collector, consoleMonitor);
  });

  // ---------- handleNetworkGetRequests ----------

  describe('handleNetworkGetRequests', () => {
    it('returns failure when monitoring disabled and autoEnable is false', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      const body = parseJson(await handler.handleNetworkGetRequests({ autoEnable: false }));
      expect(body.success).toBe(false);
      expect(body.message).toContain('not enabled');
      expect(body.tip).toContain('autoEnable=true');
    });

    it('reports auto-enable failure with error detail', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      consoleMonitor.enable.mockRejectedValue(new Error('CDP error'));

      const body = parseJson(await handler.handleNetworkGetRequests({ autoEnable: true }));
      expect(body.success).toBe(false);
      expect(body.message).toContain('Failed to auto-enable');
      expect(body.detail).toBe('CDP error');
    });

    it('auto-enables and returns empty request set with hints', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
      consoleMonitor.enable.mockResolvedValue(undefined);
      consoleMonitor.getNetworkRequests.mockReturnValue([]);

      const body = parseJson(await handler.handleNetworkGetRequests({ autoEnable: true }));
      expect(body.success).toBe(true);
      expect(body.total).toBe(0);
      expect(body.possibleReasons).toBeDefined();
      expect(body.recommended_actions).toBeDefined();
      expect(body.monitoring.autoEnabled).toBe(true);
    });

    it('returns all requests when no filter is specified', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/api/a', method: 'GET' },
        { requestId: '2', url: 'https://example.com/api/b', method: 'POST' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({}));
      expect(body.success).toBe(true);
      expect(body.total).toBe(2);
      expect(body.requests).toHaveLength(2);
      expect(body.filtered).toBe(false);
    });

    it('filters requests by URL substring (case-insensitive)', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/api/users', method: 'GET' },
        { requestId: '2', url: 'https://example.com/cdn/image.png', method: 'GET' },
        { requestId: '3', url: 'https://example.com/API/orders', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ url: 'api' }));
      expect(body.success).toBe(true);
      expect(body.total).toBe(2);
      expect(body.requests.every((r: any) => r.url.toLowerCase().includes('api'))).toBe(true);
    });

    it('filters requests by URL regex', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/api/v1/users', method: 'GET' },
        { requestId: '2', url: 'https://example.com/api/v2/orders', method: 'GET' },
        { requestId: '3', url: 'https://example.com/cdn/image.png', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ urlRegex: '/api/v[12]/' }));
      expect(body.success).toBe(true);
      expect(body.total).toBe(2);
    });

    it('urlRegex takes precedence over url substring', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/api/v1/users', method: 'GET' },
        { requestId: '2', url: 'https://example.com/api/v2/orders', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ url: 'v2', urlRegex: 'v1' }));
      // urlRegex 'v1' should match only the first request
      expect(body.total).toBe(1);
      expect(body.requests[0].requestId).toBe('1');
    });

    it('returns error for invalid urlRegex pattern', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/api', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ urlRegex: '[invalid' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid urlRegex');
    });

    it('returns error for urlRegex exceeding 500 characters', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/api', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ urlRegex: 'a'.repeat(501) }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('urlRegex too long');
    });

    it('filters requests by HTTP method', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/api/a', method: 'GET' },
        { requestId: '2', url: 'https://example.com/api/b', method: 'POST' },
        { requestId: '3', url: 'https://example.com/api/c', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ method: 'post' }));
      expect(body.total).toBe(1);
      expect(body.requests[0].method).toBe('POST');
    });

    it('method=ALL does not filter by method', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/a', method: 'GET' },
        { requestId: '2', url: 'https://example.com/b', method: 'POST' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ method: 'ALL' }));
      expect(body.total).toBe(2);
    });

    it('filters by sinceRequestId (excludes up to and including the ID)', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/a', method: 'GET' },
        { requestId: '2', url: 'https://example.com/b', method: 'GET' },
        { requestId: '3', url: 'https://example.com/c', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ sinceRequestId: '1' }));
      expect(body.total).toBe(2);
      expect(body.requests[0].requestId).toBe('2');
    });

    it('sinceRequestId that does not match keeps all requests', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/a', method: 'GET' },
        { requestId: '2', url: 'https://example.com/b', method: 'GET' },
      ]);

      const body = parseJson(
        await handler.handleNetworkGetRequests({ sinceRequestId: 'nonexistent' })
      );
      expect(body.total).toBe(2);
    });

    it('filters by sinceTimestamp', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/a', method: 'GET', timestamp: 1000 },
        { requestId: '2', url: 'https://example.com/b', method: 'GET', timestamp: 2000 },
        { requestId: '3', url: 'https://example.com/c', method: 'GET', timestamp: 3000 },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ sinceTimestamp: 1500 }));
      expect(body.total).toBe(2);
      expect(body.requests[0].requestId).toBe('2');
    });

    it('applies tail filter to return only the last N results', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/a', method: 'GET' },
        { requestId: '2', url: 'https://example.com/b', method: 'GET' },
        { requestId: '3', url: 'https://example.com/c', method: 'GET' },
        { requestId: '4', url: 'https://example.com/d', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ tail: 2 }));
      expect(body.total).toBe(2);
      expect(body.requests[0].requestId).toBe('3');
      expect(body.requests[1].requestId).toBe('4');
    });

    it('paginates results with offset and limit', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/a', method: 'GET' },
        { requestId: '2', url: 'https://example.com/b', method: 'GET' },
        { requestId: '3', url: 'https://example.com/c', method: 'GET' },
        { requestId: '4', url: 'https://example.com/d', method: 'GET' },
        { requestId: '5', url: 'https://example.com/e', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ limit: 2, offset: 1 }));
      expect(body.page.returned).toBe(2);
      expect(body.page.offset).toBe(1);
      expect(body.page.hasMore).toBe(true);
      expect(body.page.nextOffset).toBe(3);
      expect(body.requests[0].requestId).toBe('2');
      expect(body.requests[1].requestId).toBe('3');
    });

    it('reports hasMore=false on last page', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/a', method: 'GET' },
        { requestId: '2', url: 'https://example.com/b', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ limit: 10, offset: 0 }));
      expect(body.page.hasMore).toBe(false);
      expect(body.page.nextOffset).toBeNull();
    });

    it('provides filterMiss hint when URL filter matches nothing', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/cdn/img.png', method: 'GET' },
        { requestId: '2', url: 'https://example.com/cdn/style.css', method: 'GET' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({ url: 'api' }));
      expect(body.success).toBe(true);
      expect(body.filterMiss).toBe(true);
      expect(body.hint).toContain('api');
      expect(body.urlSamples).toBeDefined();
    });

    it('skips non-request payloads that lack url/method', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/a', method: 'GET' },
        { broken: true },
        null,
        42,
        'string',
        { url: 'no-method' },
        { method: 'no-url' },
      ]);

      const body = parseJson(await handler.handleNetworkGetRequests({}));
      expect(body.total).toBe(1);
      expect(body.requests[0].requestId).toBe('1');
    });

    it('combines multiple filters together', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://example.com/api/v1', method: 'GET', timestamp: 100 },
        { requestId: '2', url: 'https://example.com/api/v1', method: 'POST', timestamp: 200 },
        { requestId: '3', url: 'https://example.com/api/v1', method: 'POST', timestamp: 300 },
        { requestId: '4', url: 'https://example.com/cdn/x', method: 'GET', timestamp: 400 },
      ]);

      const body = parseJson(
        await handler.handleNetworkGetRequests({
          url: 'api',
          method: 'POST',
          sinceTimestamp: 150,
        })
      );
      expect(body.total).toBe(2);
      expect(body.requests[0].requestId).toBe('2');
      expect(body.requests[1].requestId).toBe('3');
    });
  });

  // ---------- handleNetworkGetResponseBody ----------

  describe('handleNetworkGetResponseBody', () => {
    it('returns error when requestId is missing', async () => {
      const body = parseJson(await handler.handleNetworkGetResponseBody({}));
      expect(body.success).toBe(false);
      expect(body.message).toContain('requestId parameter is required');
    });

    it('returns error when requestId is empty string', async () => {
      const body = parseJson(await handler.handleNetworkGetResponseBody({ requestId: '' }));
      expect(body.success).toBe(false);
      expect(body.message).toContain('requestId parameter is required');
    });

    it('returns error when network monitoring is disabled', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      const body = parseJson(
        await handler.handleNetworkGetResponseBody({
          requestId: 'req-1',
          autoEnable: false,
        })
      );
      expect(body.success).toBe(false);
      expect(body.message).toContain('not enabled');
    });

    it('returns full body when response is found', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getResponseBody.mockResolvedValue({
        body: '{"data": "value"}',
        base64Encoded: false,
      });

      const body = parseJson(await handler.handleNetworkGetResponseBody({ requestId: 'req-1' }));
      expect(body.success).toBe(true);
      expect(body.body).toBe('{"data": "value"}');
      expect(body.base64Encoded).toBe(false);
      expect(body.requestId).toBe('req-1');
      expect(body.attempts).toBe(1);
    });

    it('retries when response body is not immediately available', async () => {
      vi.useFakeTimers();
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getResponseBody
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ body: 'data', base64Encoded: false });

      const promise = handler.handleNetworkGetResponseBody({
        requestId: 'req-1',
        retries: 3,
        retryIntervalMs: 100,
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      const body = parseJson(await promise);
      expect(body.success).toBe(true);
      expect(body.attempts).toBe(3);
      vi.useRealTimers();
    });

    it('returns failure after exhausting retries', async () => {
      vi.useFakeTimers();
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getResponseBody.mockResolvedValue(null);

      const promise = handler.handleNetworkGetResponseBody({
        requestId: 'req-1',
        retries: 2,
        retryIntervalMs: 50,
      });

      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);

      const body = parseJson(await promise);
      expect(body.success).toBe(false);
      expect(body.message).toContain('No response body found');
      expect(body.attempts).toBe(3); // 1 initial + 2 retries
      vi.useRealTimers();
    });

    it('returns summary for large responses exceeding maxSize', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      const largeBody = 'x'.repeat(200_000);
      consoleMonitor.getResponseBody.mockResolvedValue({
        body: largeBody,
        base64Encoded: false,
      });

      const body = parseJson(
        await handler.handleNetworkGetResponseBody({
          requestId: 'req-1',
          maxSize: 100_000,
        })
      );
      expect(body.success).toBe(true);
      expect(body.summary).toBeDefined();
      expect(body.summary.truncated).toBe(true);
      expect(body.summary.preview.length).toBeLessThanOrEqual(504); // 500 + '...'
      expect(body.body).toBeUndefined();
    });

    it('returns summary when returnSummary is true even for small responses', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getResponseBody.mockResolvedValue({
        body: 'small',
        base64Encoded: false,
      });

      const body = parseJson(
        await handler.handleNetworkGetResponseBody({
          requestId: 'req-1',
          returnSummary: true,
        })
      );
      expect(body.success).toBe(true);
      expect(body.summary).toBeDefined();
      expect(body.summary.truncated).toBe(false);
      expect(body.summary.reason).toContain('Summary mode');
    });

    it('clamps maxSize within bounds', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getResponseBody.mockResolvedValue({
        body: 'x'.repeat(2000),
        base64Encoded: false,
      });

      // maxSize below minimum (1024) should be clamped to 1024
      const body = parseJson(
        await handler.handleNetworkGetResponseBody({
          requestId: 'req-1',
          maxSize: 100,
        })
      );
      expect(body.success).toBe(true);
      // Response of 2000 chars > 1024 min, so it should be truncated
      expect(body.summary).toBeDefined();
      expect(body.summary.truncated).toBe(true);
    });
  });

  // ---------- handleNetworkGetStats ----------

  describe('handleNetworkGetStats', () => {
    it('returns error when network monitoring is disabled', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      const body = parseJson(await handler.handleNetworkGetStats({}));
      expect(body.success).toBe(false);
      expect(body.hint).toContain('network_enable');
    });

    it('computes method and status distribution stats', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://a.com', method: 'GET', type: 'Document' },
        { url: 'https://b.com', method: 'GET', type: 'Script' },
        { url: 'https://c.com', method: 'POST', type: 'XHR' },
      ]);
      consoleMonitor.getNetworkResponses.mockReturnValue([
        { status: 200 },
        { status: 200 },
        { status: 404 },
      ]);

      const body = parseJson(await handler.handleNetworkGetStats({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalRequests).toBe(3);
      expect(body.stats.totalResponses).toBe(3);
      expect(body.stats.byMethod).toEqual({ GET: 2, POST: 1 });
      expect(body.stats.byStatus).toEqual({ '200': 2, '404': 1 });
      expect(body.stats.byType).toEqual({ Document: 1, Script: 1, XHR: 1 });
    });

    it('handles empty request and response sets', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([]);
      consoleMonitor.getNetworkResponses.mockReturnValue([]);

      const body = parseJson(await handler.handleNetworkGetStats({}));
      expect(body.success).toBe(true);
      expect(body.stats.totalRequests).toBe(0);
      expect(body.stats.totalResponses).toBe(0);
      expect(body.stats.timeStats).toBeNull();
    });

    it('computes time stats from timestamps', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://a.com', method: 'GET', timestamp: 1000 },
        { url: 'https://b.com', method: 'GET', timestamp: 2000 },
        { url: 'https://c.com', method: 'GET', timestamp: 3000 },
      ]);
      consoleMonitor.getNetworkResponses.mockReturnValue([]);

      const body = parseJson(await handler.handleNetworkGetStats({}));
      expect(body.stats.timeStats).toEqual({
        earliest: 1000,
        latest: 3000,
        duration: 2000,
      });
    });

    it('uses "unknown" type for requests without type field', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([{ url: 'https://a.com', method: 'GET' }]);
      consoleMonitor.getNetworkResponses.mockReturnValue([]);

      const body = parseJson(await handler.handleNetworkGetStats({}));
      expect(body.stats.byType).toEqual({ unknown: 1 });
    });

    it('filters out non-request and non-response payloads', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      consoleMonitor.getNetworkRequests.mockReturnValue([
        { url: 'https://a.com', method: 'GET' },
        null,
        42,
        { broken: true },
      ]);
      consoleMonitor.getNetworkResponses.mockReturnValue([
        { status: 200 },
        null,
        { noStatus: true },
      ]);

      const body = parseJson(await handler.handleNetworkGetStats({}));
      expect(body.stats.totalRequests).toBe(1);
      expect(body.stats.totalResponses).toBe(1);
    });
  });
});
