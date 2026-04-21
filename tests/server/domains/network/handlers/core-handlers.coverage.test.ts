import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoreHandlers } from '@server/domains/network/handlers/core-handlers';

function parseBody(r: unknown) {
  return JSON.parse((r as { content: [{ text: string }] }).content[0]!.text);
}

function createDeps(overrides: Record<string, unknown> = {}) {
  const requests: unknown[] = [];
  const responses: unknown[] = [];
  const consoleMonitor = {
    enable: vi.fn().mockResolvedValue(undefined),
    disable: vi.fn().mockResolvedValue(undefined),
    getNetworkStatus: vi.fn().mockReturnValue({
      enabled: true,
      cdpSessionActive: true,
      listenerCount: 1,
      requestCount: 0,
      responseCount: 0,
    }),
    isNetworkEnabled: vi.fn().mockReturnValue(true),
    getNetworkRequests: vi.fn().mockReturnValue(requests),
    getNetworkResponses: vi.fn().mockReturnValue(responses),
    getResponseBody: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  return { consoleMonitor, collector: {} as never, requests };
}

describe('CoreHandlers', () => {
  let handlers: CoreHandlers;
  let deps: ReturnType<typeof createDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createDeps();
    handlers = new CoreHandlers(deps as never);
  });

  describe('handleNetworkMonitor', () => {
    it('routes to enable', async () => {
      const r = await handlers.handleNetworkMonitor({ action: 'enable' });
      expect(deps.consoleMonitor.enable).toHaveBeenCalled();
      expect(parseBody(r).enabled).toBe(true);
    });

    it('routes to disable', async () => {
      const r = await handlers.handleNetworkMonitor({ action: 'disable' });
      expect(deps.consoleMonitor.disable).toHaveBeenCalled();
      expect(parseBody(r).message).toContain('disabled');
    });

    it('routes to status when enabled', async () => {
      const r = await handlers.handleNetworkMonitor({ action: 'status' });
      expect(parseBody(r).enabled).toBe(true);
    });

    it('returns fail for status when not enabled', async () => {
      deps.consoleMonitor.getNetworkStatus.mockReturnValue({ enabled: false });
      const r = await handlers.handleNetworkMonitor({ action: 'status' });
      expect(parseBody(r).enabled).toBe(false);
    });

    it('returns fail for invalid action', async () => {
      const r = await handlers.handleNetworkMonitor({ action: 'bogus' });
      expect(parseBody(r).success).toBe(false);
    });

    it('handles enable error', async () => {
      deps.consoleMonitor.enable.mockRejectedValue(new Error('boom'));
      const r = await handlers.handleNetworkMonitor({ action: 'enable' });
      expect(parseBody(r).success).toBe(false);
    });

    it('handles disable error', async () => {
      deps.consoleMonitor.disable.mockRejectedValue(new Error('boom'));
      const r = await handlers.handleNetworkMonitor({ action: 'disable' });
      expect(parseBody(r).success).toBe(false);
    });
  });

  describe('handleNetworkGetRequests', () => {
    it('auto-enables when not enabled', async () => {
      deps.consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      deps.consoleMonitor.enable.mockImplementation(async () => {
        deps.consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      });
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://a.com', method: 'GET', type: 'XHR', timestamp: 100 },
      ]);
      const r = await handlers.handleNetworkGetRequests({ autoEnable: true });
      expect(deps.consoleMonitor.enable).toHaveBeenCalled();
      expect(parseBody(r).total).toBe(1);
    });

    it('returns empty when no requests', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([]);
      const r = await handlers.handleNetworkGetRequests({});
      expect(parseBody(r).total).toBe(0);
      expect(parseBody(r).message).toContain('No network requests');
    });

    it('returns fail when not enabled and autoEnable false', async () => {
      deps.consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      const r = await handlers.handleNetworkGetRequests({ autoEnable: false });
      expect(parseBody(r).success).toBe(false);
    });

    it('filters by url substring', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        {
          requestId: '1',
          url: 'https://api.com/data',
          method: 'GET',
          type: 'Fetch',
          timestamp: 100,
        },
        {
          requestId: '2',
          url: 'https://other.com/page',
          method: 'POST',
          type: 'XHR',
          timestamp: 200,
        },
      ]);
      const r = await handlers.handleNetworkGetRequests({ url: 'api.com' });
      const body = parseBody(r);
      expect(body.requests).toHaveLength(1);
      expect(body.requests[0].requestId).toBe('1');
    });

    it('filters by urlRegex', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://api.com/v1', method: 'GET', type: 'Fetch', timestamp: 100 },
        {
          requestId: '2',
          url: 'https://other.com/v2',
          method: 'POST',
          type: 'XHR',
          timestamp: 200,
        },
      ]);
      const r = await handlers.handleNetworkGetRequests({ urlRegex: 'v1' });
      const body = parseBody(r);
      expect(body.requests).toHaveLength(1);
    });

    it('rejects urlRegex > 500 chars', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'a', method: 'GET', type: 'Fetch', timestamp: 100 },
      ]);
      const r = await handlers.handleNetworkGetRequests({ urlRegex: 'x'.repeat(501) });
      expect(parseBody(r).success).toBe(false);
    });

    it('filters by method', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://a.com', method: 'GET', type: 'Fetch', timestamp: 100 },
        { requestId: '2', url: 'https://b.com', method: 'POST', type: 'XHR', timestamp: 200 },
      ]);
      const r = await handlers.handleNetworkGetRequests({ method: 'POST' });
      const body = parseBody(r);
      expect(body.requests).toHaveLength(1);
      expect(body.requests[0].method).toBe('POST');
    });

    it('method=ALL returns all', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://a.com', method: 'GET', type: 'Fetch', timestamp: 100 },
        { requestId: '2', url: 'https://b.com', method: 'POST', type: 'XHR', timestamp: 200 },
      ]);
      const r = await handlers.handleNetworkGetRequests({ method: 'ALL' });
      expect(parseBody(r).requests).toHaveLength(2);
    });

    it('filters by sinceTimestamp', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'a', method: 'GET', type: 'Fetch', timestamp: 100 },
        { requestId: '2', url: 'b', method: 'GET', type: 'Fetch', timestamp: 200 },
      ]);
      const r = await handlers.handleNetworkGetRequests({ sinceTimestamp: 150 });
      expect(parseBody(r).requests).toHaveLength(1);
    });

    it('filters by sinceRequestId', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'a', method: 'GET', type: 'Fetch', timestamp: 100 },
        { requestId: '2', url: 'b', method: 'GET', type: 'Fetch', timestamp: 200 },
        { requestId: '3', url: 'c', method: 'GET', type: 'Fetch', timestamp: 300 },
      ]);
      const r = await handlers.handleNetworkGetRequests({ sinceRequestId: '1' });
      const body = parseBody(r);
      expect(body.requests).toHaveLength(2);
    });

    it('applies tail filter', async () => {
      const reqs = Array.from({ length: 10 }, (_, i) => ({
        requestId: String(i),
        url: `https://a.com/${i}`,
        method: 'GET',
        type: 'Fetch',
        timestamp: i,
      }));
      deps.consoleMonitor.getNetworkRequests.mockReturnValue(reqs);
      const r = await handlers.handleNetworkGetRequests({ tail: 3 });
      const body = parseBody(r);
      expect(body.requests).toHaveLength(3);
    });

    it('applies limit and offset', async () => {
      const reqs = Array.from({ length: 10 }, (_, i) => ({
        requestId: String(i),
        url: `https://a.com/${i}`,
        method: 'GET',
        type: 'Fetch',
        timestamp: i,
      }));
      deps.consoleMonitor.getNetworkRequests.mockReturnValue(reqs);
      const r = await handlers.handleNetworkGetRequests({ limit: 3, offset: 2 });
      const body = parseBody(r);
      expect(body.requests).toHaveLength(3);
      expect(body.page.hasMore).toBe(true);
      expect(body.page.offset).toBe(2);
    });

    it('excludes static resources when no filters', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'a.png', method: 'GET', type: 'Image', timestamp: 100 },
        { requestId: '2', url: 'b.css', method: 'GET', type: 'Stylesheet', timestamp: 100 },
        { requestId: '3', url: 'c.woff2', method: 'GET', type: 'Font', timestamp: 100 },
        { requestId: '4', url: 'd.json', method: 'GET', type: 'Fetch', timestamp: 100 },
      ]);
      const r = await handlers.handleNetworkGetRequests({});
      const body = parseBody(r);
      expect(body.requests).toHaveLength(1);
      expect(body.requests[0].requestId).toBe('4');
      expect(body.staticResourcesExcluded).toBe(3);
    });

    it('shows filterMiss hint when filters match nothing', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'https://a.com', method: 'GET', type: 'Fetch', timestamp: 100 },
      ]);
      const r = await handlers.handleNetworkGetRequests({ url: 'nonexistent' });
      expect(parseBody(r).filterMiss).toBe(true);
      expect(parseBody(r).urlSamples).toBeDefined();
    });

    it('shows optimization hint for >100 unfiltered requests', async () => {
      const reqs = Array.from({ length: 101 }, (_, i) => ({
        requestId: String(i),
        url: `https://a.com/${i}`,
        method: 'GET',
        type: 'Fetch',
        timestamp: i,
      }));
      deps.consoleMonitor.getNetworkRequests.mockReturnValue(reqs);
      const r = await handlers.handleNetworkGetRequests({});
      expect(parseBody(r).optimizationHint).toBeDefined();
    });
  });

  describe('handleNetworkGetResponseBody', () => {
    it('fails without requestId', async () => {
      const r = await handlers.handleNetworkGetResponseBody({});
      expect(parseBody(r).success).toBe(false);
      expect(parseBody(r).hint).toBeDefined();
    });

    it('fails when not enabled', async () => {
      deps.consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      const r = await handlers.handleNetworkGetResponseBody({ requestId: 'r1' });
      expect(parseBody(r).success).toBe(false);
    });

    it('retries until body found', async () => {
      deps.consoleMonitor.getResponseBody
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ body: 'hello', base64Encoded: false });
      const r = await handlers.handleNetworkGetResponseBody({
        requestId: 'r1',
        retries: 3,
        retryIntervalMs: 1,
      });
      const body = parseBody(r);
      expect(body.body).toBe('hello');
      expect(body.attempts).toBe(2);
    });

    it('returns fail after all retries exhausted', async () => {
      deps.consoleMonitor.getResponseBody.mockResolvedValue(null);
      const r = await handlers.handleNetworkGetResponseBody({
        requestId: 'r1',
        retries: 2,
        retryIntervalMs: 1,
      });
      expect(parseBody(r).success).toBe(false);
      expect(parseBody(r).attempts).toBe(3);
    });

    it('returns summary when returnSummary=true', async () => {
      deps.consoleMonitor.getResponseBody.mockResolvedValue({
        body: 'x'.repeat(100),
        base64Encoded: false,
      });
      const r = await handlers.handleNetworkGetResponseBody({
        requestId: 'r1',
        returnSummary: true,
      });
      const body = parseBody(r);
      expect(body.summary).toBeDefined();
      expect(body.body).toBeUndefined();
    });

    it('returns summary when body too large', async () => {
      deps.consoleMonitor.getResponseBody.mockResolvedValue({
        body: 'x'.repeat(2000),
        base64Encoded: false,
      });
      const r = await handlers.handleNetworkGetResponseBody({
        requestId: 'r1',
        maxSize: 1024,
      });
      const body = parseBody(r);
      expect(body.summary).toBeDefined();
      expect(body.summary.truncated).toBe(true);
    });

    it('returns full body when within maxSize', async () => {
      deps.consoleMonitor.getResponseBody.mockResolvedValue({
        body: 'short',
        base64Encoded: false,
      });
      const r = await handlers.handleNetworkGetResponseBody({ requestId: 'r1' });
      const body = parseBody(r);
      expect(body.body).toBe('short');
      expect(body.size).toBe(5);
    });

    it('handles error', async () => {
      deps.consoleMonitor.getResponseBody.mockRejectedValue(new Error('fail'));
      const r = await handlers.handleNetworkGetResponseBody({ requestId: 'r1' });
      expect(parseBody(r).success).toBe(false);
    });
  });

  describe('handleNetworkGetStats', () => {
    it('fails when not enabled', async () => {
      deps.consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      const r = await handlers.handleNetworkGetStats({});
      expect(parseBody(r).success).toBe(false);
    });

    it('returns stats with requests and responses', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([
        { requestId: '1', url: 'a', method: 'GET', type: 'XHR', timestamp: 100 },
        { requestId: '2', url: 'b', method: 'POST', type: 'Fetch', timestamp: 200 },
      ]);
      deps.consoleMonitor.getNetworkResponses.mockReturnValue([
        { requestId: '1', status: 200 },
        { requestId: '2', status: 404 },
      ]);
      const r = await handlers.handleNetworkGetStats({});
      const body = parseBody(r);
      expect(body.stats.totalRequests).toBe(2);
      expect(body.stats.totalResponses).toBe(2);
      expect(body.stats.byMethod.GET).toBe(1);
      expect(body.stats.byStatus[200]).toBe(1);
      expect(body.stats.timeStats).toBeDefined();
    });

    it('returns null timeStats for empty requests', async () => {
      deps.consoleMonitor.getNetworkRequests.mockReturnValue([]);
      deps.consoleMonitor.getNetworkResponses.mockReturnValue([]);
      const r = await handlers.handleNetworkGetStats({});
      expect(parseBody(r).stats.timeStats).toBeNull();
    });

    it('handles error', async () => {
      deps.consoleMonitor.getNetworkRequests.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await handlers.handleNetworkGetStats({});
      expect(parseBody(r).success).toBe(false);
    });
  });
});
