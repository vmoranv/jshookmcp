import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  buildXHRInterceptorCode: vi.fn().mockReturnValue('xhr-interceptor-code'),
  buildFetchInterceptorCode: vi.fn().mockReturnValue('fetch-interceptor-code'),
  CLEAR_INJECTED_BUFFERS_EXPRESSION: 'clear-buffers-expression',
  RESET_INJECTED_INTERCEPTORS_EXPRESSION: 'reset-interceptors-expression',
}));

vi.mock('@utils/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@modules/monitor/NetworkMonitor.interceptors', () => ({
  buildXHRInterceptorCode: mocks.buildXHRInterceptorCode,
  buildFetchInterceptorCode: mocks.buildFetchInterceptorCode,
  CLEAR_INJECTED_BUFFERS_EXPRESSION: mocks.CLEAR_INJECTED_BUFFERS_EXPRESSION,
  RESET_INJECTED_INTERCEPTORS_EXPRESSION: mocks.RESET_INJECTED_INTERCEPTORS_EXPRESSION,
}));

import { NetworkMonitor } from '@modules/monitor/NetworkMonitor.impl';

function createMockSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  const send = vi.fn(async (..._args: unknown[]) => ({}));
  const on = vi.fn((event: string, handler: (payload: any) => void) => {
    const group = listeners.get(event) ?? new Set<(payload: any) => void>();
    group.add(handler);
    listeners.set(event, group);
  });
  const off = vi.fn((event: string, handler: (payload: any) => void) => {
    listeners.get(event)?.delete(handler);
  });
  const emit = (event: string, payload?: any) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };

  return {
    session: { send, on, off } as any,
    send,
    emit,
  };
}

describe('NetworkMonitor.impl – additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildXHRInterceptorCode.mockReturnValue('xhr-interceptor-code');
    mocks.buildFetchInterceptorCode.mockReturnValue('fetch-interceptor-code');
  });

  // ── enable / disable lifecycle ────────────────────────────────────
  describe('enable', () => {
    it('sends Network.enable with buffer sizes', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      expect(send).toHaveBeenCalledWith(
        'Network.enable',
        expect.objectContaining({
          maxTotalBufferSize: 10000000,
          maxResourceBufferSize: 5000000,
        })
      );
      expect(monitor.isEnabled()).toBe(true);
    });

    it('skips enabling when already enabled', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockClear();
      await monitor.enable();

      expect(send).not.toHaveBeenCalledWith('Network.enable', expect.anything());
    });

    it('throws and marks disabled when Network.enable fails', async () => {
      const { session, send } = createMockSession();
      send.mockRejectedValueOnce(new Error('CDP error'));

      const monitor = new NetworkMonitor(session);
      await expect(monitor.enable()).rejects.toThrow('CDP error');
      expect(monitor.isEnabled()).toBe(false);
    });
  });

  describe('disable', () => {
    it('removes listeners and sends Network.disable', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      await monitor.disable();

      expect(send).toHaveBeenCalledWith('Network.disable');
      expect(monitor.isEnabled()).toBe(false);
    });

    it('skips when not enabled', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);

      await monitor.disable();
      expect(send).not.toHaveBeenCalledWith('Network.disable');
    });

    it('handles Network.disable failure gracefully', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockRejectedValueOnce(new Error('already detached'));
      await expect(monitor.disable()).resolves.toBeUndefined();
    });
  });

  // ── disconnected event ────────────────────────────────────────────
  describe('disconnected event', () => {
    it('marks network as disabled on CDP session disconnect', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('disconnected');
      expect(monitor.isEnabled()).toBe(false);
    });
  });

  // ── request/response capture ──────────────────────────────────────
  describe('request/response capture', () => {
    it('skips malformed requestWillBeSent payloads', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', { invalid: true });
      expect(monitor.getRequests()).toHaveLength(0);
    });

    it('skips malformed responseReceived payloads', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.responseReceived', { bad: 'data' });
      expect(monitor.getResponses()).toHaveLength(0);
    });

    it('skips malformed loadingFinished payloads', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.loadingFinished', { noRequestId: true });
      // Should not throw, just skip silently
    });

    it('captures request with postData', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: {
          url: 'https://api.example.com/submit',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          postData: '{"key":"value"}',
        },
        timestamp: 1,
        type: 'Fetch',
        initiator: { type: 'script' },
      });

      const reqs = monitor.getRequests();
      expect(reqs).toHaveLength(1);
      expect(reqs[0]).toMatchObject({
        method: 'POST',
        postData: '{"key":"value"}',
        type: 'Fetch',
      });
    });

    it('captures response with cache/timing metadata', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://cdn.example.com/lib.js',
          status: 304,
          statusText: 'Not Modified',
          headers: {},
          mimeType: 'application/javascript',
          fromDiskCache: true,
          fromServiceWorker: false,
          timing: { sendStart: 10 },
        },
        timestamp: 2,
      });

      const responses = monitor.getResponses();
      expect(responses).toHaveLength(1);
      expect(responses[0]).toMatchObject({
        status: 304,
        fromCache: true,
      });
    });

    it('evicts oldest request when exceeding MAX_NETWORK_RECORDS', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      const MAX = (monitor as any).MAX_NETWORK_RECORDS;
      for (let i = 0; i <= MAX; i++) {
        emit('Network.requestWillBeSent', {
          requestId: `r-${i}`,
          request: { url: `https://site.com/${i}`, method: 'GET' },
          timestamp: i,
        });
      }

      expect(monitor.getRequests().length).toBeLessThanOrEqual(MAX);
    });

    it('evicts oldest response when exceeding MAX_NETWORK_RECORDS', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      const MAX = (monitor as any).MAX_NETWORK_RECORDS;
      for (let i = 0; i <= MAX; i++) {
        emit('Network.responseReceived', {
          requestId: `r-${i}`,
          response: {
            url: `https://site.com/${i}`,
            status: 200,
            statusText: 'OK',
            mimeType: 'text/html',
          },
          timestamp: i,
        });
      }

      expect(monitor.getResponses().length).toBeLessThanOrEqual(MAX);
    });
  });

  // ── filtering ─────────────────────────────────────────────────────
  describe('getRequests filtering', () => {
    it('filters by url substring', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://api.example.com/users', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.requestWillBeSent', {
        requestId: 'r2',
        request: { url: 'https://cdn.example.com/lib.js', method: 'GET' },
        timestamp: 2,
      });

      const filtered = monitor.getRequests({ url: 'api.example' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.url).toContain('api.example');
    });

    it('filters by method', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/a', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.requestWillBeSent', {
        requestId: 'r2',
        request: { url: 'https://site.com/b', method: 'POST' },
        timestamp: 2,
      });

      const filtered = monitor.getRequests({ method: 'POST' });
      expect(filtered).toHaveLength(1);
    });

    it('applies limit', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      for (let i = 0; i < 5; i++) {
        emit('Network.requestWillBeSent', {
          requestId: `r-${i}`,
          request: { url: `https://site.com/${i}`, method: 'GET' },
          timestamp: i,
        });
      }

      const filtered = monitor.getRequests({ limit: 2 });
      expect(filtered).toHaveLength(2);
    });
  });

  describe('getResponses filtering', () => {
    it('filters by status code', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/ok',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/html',
        },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r2',
        response: {
          url: 'https://site.com/err',
          status: 500,
          statusText: 'Error',
          mimeType: 'text/html',
        },
        timestamp: 2,
      });

      const filtered = monitor.getResponses({ status: 500 });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.status).toBe(500);
    });

    it('filters by url and applies limit', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      for (let i = 0; i < 5; i++) {
        emit('Network.responseReceived', {
          requestId: `r-${i}`,
          response: {
            url: `https://api.site.com/${i}`,
            status: 200,
            statusText: 'OK',
            mimeType: 'application/json',
          },
          timestamp: i,
        });
      }

      const filtered = monitor.getResponses({ url: 'api.site', limit: 2 });
      expect(filtered).toHaveLength(2);
    });
  });

  // ── getActivity ───────────────────────────────────────────────────
  describe('getActivity', () => {
    it('returns both request and response for a requestId', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/api', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/api',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
        },
        timestamp: 2,
      });

      const activity = monitor.getActivity('r1');
      expect(activity.request?.url).toBe('https://site.com/api');
      expect(activity.response?.status).toBe(200);
    });

    it('returns undefined for unknown requestId', async () => {
      const { session } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      const activity = monitor.getActivity('nonexistent');
      expect(activity.request).toBeUndefined();
      expect(activity.response).toBeUndefined();
    });
  });

  // ── getStatus ─────────────────────────────────────────────────────
  describe('getStatus', () => {
    it('reports enabled status with correct counts', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/a', method: 'GET' },
        timestamp: 1,
      });

      const status = monitor.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.requestCount).toBe(1);
      expect(status.responseCount).toBe(0);
      expect(status.listenerCount).toBe(3); // request, response, loading
      expect(status.cdpSessionActive).toBe(true);
    });
  });

  // ── getStats ──────────────────────────────────────────────────────
  describe('getStats', () => {
    it('aggregates stats by method, status, and type', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/a', method: 'GET' },
        timestamp: 1,
        type: 'Document',
      });
      emit('Network.requestWillBeSent', {
        requestId: 'r2',
        request: { url: 'https://site.com/b', method: 'POST' },
        timestamp: 2,
        type: 'XHR',
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/a',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/html',
        },
        timestamp: 3,
      });
      emit('Network.responseReceived', {
        requestId: 'r2',
        response: {
          url: 'https://site.com/b',
          status: 404,
          statusText: 'Not Found',
          mimeType: 'text/html',
        },
        timestamp: 4,
      });

      const stats = monitor.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalResponses).toBe(2);
      expect(stats.byMethod.GET).toBe(1);
      expect(stats.byMethod.POST).toBe(1);
      expect(stats.byStatus[200]).toBe(1);
      expect(stats.byStatus[404]).toBe(1);
      expect(stats.byType.Document).toBe(1);
      expect(stats.byType.XHR).toBe(1);
    });
  });

  // ── clearRecords ──────────────────────────────────────────────────
  describe('clearRecords', () => {
    it('clears all stored records', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/a', method: 'GET' },
        timestamp: 1,
      });

      monitor.clearRecords();
      expect(monitor.getRequests()).toHaveLength(0);
      expect(monitor.getResponses()).toHaveLength(0);
    });
  });

  // ── getResponseBody ───────────────────────────────────────────────
  describe('getResponseBody', () => {
    it('returns null when network is not enabled', async () => {
      const { session } = createMockSession();
      const monitor = new NetworkMonitor(session);

      const body = await monitor.getResponseBody('r1');
      expect(body).toBeNull();
    });

    it('returns null when request not found', async () => {
      const { session } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      const body = await monitor.getResponseBody('nonexistent');
      expect(body).toBeNull();
    });

    it('returns null when response not yet received', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/a', method: 'GET' },
        timestamp: 1,
      });

      const body = await monitor.getResponseBody('r1');
      expect(body).toBeNull();
    });

    it('retrieves body from CDP when not in cache', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/script.js', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/script.js',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/javascript',
        },
        timestamp: 2,
      });

      send.mockResolvedValueOnce({ body: 'console.log("hello")', base64Encoded: false });

      const body = await monitor.getResponseBody('r1');
      expect(body).toMatchObject({
        body: 'console.log("hello")',
        base64Encoded: false,
      });
    });

    it('returns null on unexpected response body format', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/a', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/a',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/html',
        },
        timestamp: 2,
      });

      send.mockResolvedValueOnce({ unexpected: 'format' });

      const body = await monitor.getResponseBody('r1');
      expect(body).toBeNull();
    });

    it('returns null when CDP throws', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/a', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/a',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/html',
        },
        timestamp: 2,
      });

      send.mockRejectedValueOnce(new Error('No resource with given identifier found'));

      const body = await monitor.getResponseBody('r1');
      expect(body).toBeNull();
    });
  });

  // ── getAllJavaScriptResponses ──────────────────────────────────────
  describe('getAllJavaScriptResponses', () => {
    it('collects JS responses based on mimeType and URL', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/app.js', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/app.js',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/javascript',
        },
        timestamp: 2,
      });

      send.mockResolvedValueOnce({ body: 'var x = 1;', base64Encoded: false });

      const jsResponses = await monitor.getAllJavaScriptResponses();
      expect(jsResponses).toHaveLength(1);
      expect(jsResponses[0]).toMatchObject({
        url: 'https://site.com/app.js',
        content: 'var x = 1;',
        size: 10,
      });
    });

    it('skips non-JS responses', async () => {
      const { session, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/style.css',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/css',
        },
        timestamp: 1,
      });

      const jsResponses = await monitor.getAllJavaScriptResponses();
      expect(jsResponses).toHaveLength(0);
    });

    it('detects JS by .js extension in URL', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://site.com/bundle.js?v=123', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://site.com/bundle.js?v=123',
          status: 200,
          statusText: 'OK',
          mimeType: 'text/plain',
        },
        timestamp: 2,
      });

      send.mockResolvedValueOnce({ body: 'function(){}', base64Encoded: false });

      const jsResponses = await monitor.getAllJavaScriptResponses();
      expect(jsResponses).toHaveLength(1);
    });
  });

  // ── interceptor injection ─────────────────────────────────────────
  describe('injectXHRInterceptor', () => {
    it('sends XHR interceptor code via Runtime.evaluate', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      await monitor.injectXHRInterceptor();

      expect(send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'xhr-interceptor-code',
      });
    });
  });

  describe('injectFetchInterceptor', () => {
    it('sends Fetch interceptor code via Runtime.evaluate', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      await monitor.injectFetchInterceptor();

      expect(send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'fetch-interceptor-code',
      });
    });
  });

  // ── getXHRRequests / getFetchRequests ─────────────────────────────
  describe('getXHRRequests', () => {
    it('returns parsed XHR requests from Runtime.evaluate', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({
        result: { value: [{ url: 'https://api.com/data', method: 'GET' }] },
      });

      const reqs = await monitor.getXHRRequests();
      expect(reqs).toHaveLength(1);
      expect(reqs[0]).toMatchObject({ url: 'https://api.com/data' });
    });

    it('returns empty array when value is not an array', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({ result: { value: null } });

      const reqs = await monitor.getXHRRequests();
      expect(reqs).toEqual([]);
    });

    it('returns empty array on evaluation error', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockRejectedValueOnce(new Error('eval failed'));

      const reqs = await monitor.getXHRRequests();
      expect(reqs).toEqual([]);
    });
  });

  describe('getFetchRequests', () => {
    it('returns parsed Fetch requests', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({
        result: { value: [{ url: 'https://api.com/fetch', method: 'POST' }] },
      });

      const reqs = await monitor.getFetchRequests();
      expect(reqs).toHaveLength(1);
    });

    it('returns empty array on error', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockRejectedValueOnce(new Error('eval failed'));

      const reqs = await monitor.getFetchRequests();
      expect(reqs).toEqual([]);
    });
  });

  // ── clearInjectedBuffers ──────────────────────────────────────────
  describe('clearInjectedBuffers', () => {
    it('returns counts from Runtime.evaluate', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({
        result: { value: { xhrCleared: 3, fetchCleared: 5 } },
      });

      const result = await monitor.clearInjectedBuffers();
      expect(result).toEqual({ xhrCleared: 3, fetchCleared: 5 });
    });

    it('returns zeros on unexpected format', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({ result: { value: null } });

      const result = await monitor.clearInjectedBuffers();
      expect(result).toEqual({ xhrCleared: 0, fetchCleared: 0 });
    });

    it('returns zeros on error', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockRejectedValueOnce(new Error('failed'));

      const result = await monitor.clearInjectedBuffers();
      expect(result).toEqual({ xhrCleared: 0, fetchCleared: 0 });
    });
  });

  // ── resetInjectedInterceptors ─────────────────────────────────────
  describe('resetInjectedInterceptors', () => {
    it('returns reset results from Runtime.evaluate', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({
        result: { value: { xhrReset: true, fetchReset: true } },
      });

      const result = await monitor.resetInjectedInterceptors();
      expect(result).toEqual({ xhrReset: true, fetchReset: true });
    });

    it('returns false on unexpected format', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({ result: { value: 'not-object' } });

      const result = await monitor.resetInjectedInterceptors();
      expect(result).toEqual({ xhrReset: false, fetchReset: false });
    });

    it('returns false on error', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockRejectedValueOnce(new Error('failed'));

      const result = await monitor.resetInjectedInterceptors();
      expect(result).toEqual({ xhrReset: false, fetchReset: false });
    });
  });
});
