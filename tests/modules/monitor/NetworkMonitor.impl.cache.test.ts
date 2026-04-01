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
  const send = vi.fn(async (..._args: any[]) => ({}));
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

describe('NetworkMonitor.impl – response body cache and persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildXHRInterceptorCode.mockReturnValue('xhr-interceptor-code');
    mocks.buildFetchInterceptorCode.mockReturnValue('fetch-interceptor-code');
  });

  // ── responseBodyCache (via loadingFinished) ──────────────────────────
  describe('responseBodyCache auto-capture', () => {
    it('auto-caches response body on loadingFinished', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      // Simulate request+response
      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://example.com/api', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://example.com/api',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
          fromDiskCache: false,
          fromServiceWorker: false,
        },
        timestamp: 2,
      });

      // Mock the getResponseBody CDP call for auto-capture
      send.mockResolvedValueOnce({ body: '{"data":"cached"}', base64Encoded: false });

      emit('Network.loadingFinished', { requestId: 'r1' });

      // Wait for async auto-capture
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now getResponseBody should hit cache
      send.mockClear();
      const body = await monitor.getResponseBody('r1');

      expect(body).toMatchObject({ body: '{"data":"cached"}', base64Encoded: false });
      // Should NOT call CDP again due to cache hit
      const getBodyCalls = send.mock.calls.filter(
        ([method]) => method === 'Network.getResponseBody',
      );
      expect(getBodyCalls).toHaveLength(0);
    });

    it('skips caching for already-cached requestId', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://example.com/api', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://example.com/api',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
        },
        timestamp: 2,
      });

      // First auto-capture
      send.mockResolvedValueOnce({ body: 'first', base64Encoded: false });
      emit('Network.loadingFinished', { requestId: 'r1' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second loadingFinished (shouldn't trigger new fetch)
      send.mockClear();
      emit('Network.loadingFinished', { requestId: 'r1' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // No new getResponseBody call
      const getBodyCalls = send.mock.calls.filter(
        ([method]) => method === 'Network.getResponseBody',
      );
      expect(getBodyCalls).toHaveLength(0);
    });

    it('skips caching when response not found', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      // Only request, no response
      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://example.com/api', method: 'GET' },
        timestamp: 1,
      });

      send.mockClear();
      emit('Network.loadingFinished', { requestId: 'r1' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // No getResponseBody call (response not found)
      const getBodyCalls = send.mock.calls.filter(
        ([method]) => method === 'Network.getResponseBody',
      );
      expect(getBodyCalls).toHaveLength(0);
    });

    it('skips caching for fromCache responses', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://example.com/api', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://example.com/api',
          status: 304,
          statusText: 'Not Modified',
          mimeType: 'application/json',
          fromDiskCache: true, // Cached response
        },
        timestamp: 2,
      });

      send.mockClear();
      emit('Network.loadingFinished', { requestId: 'r1' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // No getResponseBody call (from cache)
      const getBodyCalls = send.mock.calls.filter(
        ([method]) => method === 'Network.getResponseBody',
      );
      expect(getBodyCalls).toHaveLength(0);
    });

    it('skips caching for oversized bodies (>1MB)', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://example.com/big', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://example.com/big',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/octet-stream',
        },
        timestamp: 2,
      });

      // Return >1MB body
      const oversizedBody = 'x'.repeat(1_100_000);
      send.mockResolvedValueOnce({ body: oversizedBody, base64Encoded: false });

      emit('Network.loadingFinished', { requestId: 'r1' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should log skip message
      expect(mocks.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[BodyCache] Skipping oversized body'),
      );

      // Verify cache is empty (no cached body)
      send.mockClear();
      send.mockResolvedValueOnce({ body: 'refetched', base64Encoded: false });
      const body = await monitor.getResponseBody('r1');
      expect(body?.body).toBe('refetched'); // Had to refetch
    });

    it('performs LRU eviction when cache exceeds capacity', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      const MAX_CACHE = (monitor as any).MAX_BODY_CACHE_ENTRIES;

      // Fill cache to capacity + 1
      for (let i = 0; i <= MAX_CACHE; i++) {
        emit('Network.requestWillBeSent', {
          requestId: `r${i}`,
          request: { url: `https://example.com/${i}`, method: 'GET' },
          timestamp: i,
        });
        emit('Network.responseReceived', {
          requestId: `r${i}`,
          response: {
            url: `https://example.com/${i}`,
            status: 200,
            statusText: 'OK',
            mimeType: 'text/plain',
          },
          timestamp: i + 0.5,
        });
        send.mockResolvedValueOnce({ body: `body${i}`, base64Encoded: false });
        emit('Network.loadingFinished', { requestId: `r${i}` });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // First entry (r0) should have been evicted
      send.mockClear();
      send.mockResolvedValueOnce({ body: 'refetched-r0', base64Encoded: false });
      const r0Body = await monitor.getResponseBody('r0');

      // Had to refetch (cache miss)
      expect(r0Body?.body).toBe('refetched-r0');
      const getBodyCalls = send.mock.calls.filter(
        ([method]) => method === 'Network.getResponseBody',
      );
      expect(getBodyCalls.length).toBeGreaterThan(0);
    });

    it('handles auto-capture CDP failure gracefully', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://example.com/api', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://example.com/api',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
        },
        timestamp: 2,
      });

      // CDP throws during auto-capture
      send.mockRejectedValueOnce(new Error('Body not available'));

      emit('Network.loadingFinished', { requestId: 'r1' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should log the error
      expect(mocks.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('[BodyCache] Could not capture body'),
      );
    });

    it('skips caching when getResponseBody returns invalid format', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      emit('Network.requestWillBeSent', {
        requestId: 'r1',
        request: { url: 'https://example.com/api', method: 'GET' },
        timestamp: 1,
      });
      emit('Network.responseReceived', {
        requestId: 'r1',
        response: {
          url: 'https://example.com/api',
          status: 200,
          statusText: 'OK',
          mimeType: 'application/json',
        },
        timestamp: 2,
      });

      // Return invalid format (missing base64Encoded)
      send.mockResolvedValueOnce({ body: 'data' });

      emit('Network.loadingFinished', { requestId: 'r1' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Cache should be empty, getResponseBody should refetch
      send.mockClear();
      send.mockResolvedValueOnce({ body: 'refetched', base64Encoded: false });
      const body = await monitor.getResponseBody('r1');
      expect(body?.body).toBe('refetched');
    });
  });

  // ── getResponseBody cache-hit path ────────────────────────────────────
  describe('getResponseBody cache behavior', () => {
    it('refreshes LRU on cache hit', async () => {
      const { session, send, emit } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      // Add two items to cache
      for (const id of ['r1', 'r2']) {
        emit('Network.requestWillBeSent', {
          requestId: id,
          request: { url: `https://example.com/${id}`, method: 'GET' },
          timestamp: 1,
        });
        emit('Network.responseReceived', {
          requestId: id,
          response: {
            url: `https://example.com/${id}`,
            status: 200,
            statusText: 'OK',
            mimeType: 'text/plain',
          },
          timestamp: 2,
        });
        send.mockResolvedValueOnce({ body: `body-${id}`, base64Encoded: false });
        emit('Network.loadingFinished', { requestId: id });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      send.mockClear();

      // Access r1 (should move it to end of LRU)
      await monitor.getResponseBody('r1');
      // Access r2
      await monitor.getResponseBody('r2');

      // No CDP calls (both from cache)
      const getBodyCalls = send.mock.calls.filter(
        ([method]) => method === 'Network.getResponseBody',
      );
      expect(getBodyCalls).toHaveLength(0);
    });
  });

  // ── persistent interceptor injection ──────────────────────────────────
  describe('persistent interceptor injection', () => {
    it('injects XHR interceptor via Page.addScriptToEvaluateOnNewDocument when persistent', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      await monitor.injectXHRInterceptor({ persistent: true });

      expect(send).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument', {
        source: 'xhr-interceptor-code',
      });
      expect(mocks.logger.info).toHaveBeenCalledWith('XHR interceptor injected (persistent)');
    });

    it('injects Fetch interceptor via Page.addScriptToEvaluateOnNewDocument when persistent', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      await monitor.injectFetchInterceptor({ persistent: true });

      expect(send).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument', {
        source: 'fetch-interceptor-code',
      });
      expect(mocks.logger.info).toHaveBeenCalledWith('Fetch interceptor injected (persistent)');
    });

    it('injects XHR interceptor via Runtime.evaluate when not persistent (default)', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      await monitor.injectXHRInterceptor();

      expect(send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'xhr-interceptor-code',
      });
      expect(mocks.logger.info).toHaveBeenCalledWith('XHR interceptor injected');
    });

    it('injects Fetch interceptor via Runtime.evaluate when not persistent (default)', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      await monitor.injectFetchInterceptor();

      expect(send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'fetch-interceptor-code',
      });
      expect(mocks.logger.info).toHaveBeenCalledWith('Fetch interceptor injected');
    });

    it('injects XHR interceptor via Runtime.evaluate when persistent=false', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      await monitor.injectXHRInterceptor({ persistent: false });

      expect(send).toHaveBeenCalledWith('Runtime.evaluate', {
        expression: 'xhr-interceptor-code',
      });
    });
  });

  // ── edge cases for injector error handling ────────────────────────────
  describe('injector throws without CDP session', () => {
    it('throws when injectXHRInterceptor called without CDP session', async () => {
      const { session } = createMockSession();
      // Simulate null session by not enabling
      const monitor = new NetworkMonitor(session);
      (monitor as any).cdpSession = null;

      await expect(monitor.injectXHRInterceptor()).rejects.toThrow('CDP session not initialized');
    });

    it('throws when injectFetchInterceptor called without CDP session', async () => {
      const { session } = createMockSession();
      const monitor = new NetworkMonitor(session);
      (monitor as any).cdpSession = null;

      await expect(monitor.injectFetchInterceptor()).rejects.toThrow('CDP session not initialized');
    });

    it('throws when getXHRRequests called without CDP session', async () => {
      const { session } = createMockSession();
      const monitor = new NetworkMonitor(session);
      (monitor as any).cdpSession = null;

      await expect(monitor.getXHRRequests()).rejects.toThrow('CDP session not initialized');
    });

    it('throws when getFetchRequests called without CDP session', async () => {
      const { session } = createMockSession();
      const monitor = new NetworkMonitor(session);
      (monitor as any).cdpSession = null;

      await expect(monitor.getFetchRequests()).rejects.toThrow('CDP session not initialized');
    });

    it('throws when clearInjectedBuffers called without CDP session', async () => {
      const { session } = createMockSession();
      const monitor = new NetworkMonitor(session);
      (monitor as any).cdpSession = null;

      await expect(monitor.clearInjectedBuffers()).rejects.toThrow('CDP session not initialized');
    });

    it('throws when resetInjectedInterceptors called without CDP session', async () => {
      const { session } = createMockSession();
      const monitor = new NetworkMonitor(session);
      (monitor as any).cdpSession = null;

      await expect(monitor.resetInjectedInterceptors()).rejects.toThrow(
        'CDP session not initialized',
      );
    });
  });

  // ── getXHR/FetchRequests filter handling ──────────────────────────────
  describe('getXHRRequests/getFetchRequests result filtering', () => {
    it('filters out non-object entries from XHR results', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({
        result: {
          value: [{ url: 'https://api.com/a' }, null, 'invalid', 123, { url: 'https://api.com/b' }],
        },
      });

      const reqs = await monitor.getXHRRequests();
      expect(reqs).toHaveLength(2);
      expect(reqs[0]).toMatchObject({ url: 'https://api.com/a' });
      expect(reqs[1]).toMatchObject({ url: 'https://api.com/b' });
    });

    it('filters out non-object entries from Fetch results', async () => {
      const { session, send } = createMockSession();
      const monitor = new NetworkMonitor(session);
      await monitor.enable();

      send.mockResolvedValueOnce({
        result: {
          value: [{ url: 'https://api.com/x' }, undefined, 42, 'str', { url: 'https://api.com/y' }],
        },
      });

      const reqs = await monitor.getFetchRequests();
      expect(reqs).toHaveLength(2);
    });
  });
});
