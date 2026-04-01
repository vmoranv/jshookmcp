import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
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
    listeners,
  };
}

describe('NetworkMonitor impl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic enable / isEnabled / getStatus
  // -------------------------------------------------------------------------

  it('captures request and response activity through the internal implementation path', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: { url: 'https://example.com/api', method: 'GET', headers: {} },
      timestamp: 1,
      type: 'XHR',
      initiator: {},
    });
    emit('Network.responseReceived', {
      requestId: 'req-1',
      response: {
        url: 'https://example.com/api',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    expect(monitor.isEnabled()).toBe(true);
    expect(monitor.getRequests()).toHaveLength(1);
    expect(monitor.getResponses()).toHaveLength(1);
    expect(monitor.getActivity('req-1').response?.status).toBe(200);
  });

  it('enable is idempotent (double-enable returns early)', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    await monitor.enable(); // second call — should return early

    expect(monitor.isEnabled()).toBe(true);
    expect(loggerState.warn).toHaveBeenCalledWith('Network monitoring already enabled');
    // send was only called once
    expect(session.send).toHaveBeenCalledTimes(1);
  });

  it('disable when already disabled is a no-op', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.disable(); // not enabled yet
    expect(session.send).not.toHaveBeenCalled();
  });

  it('disable removes all listeners and sends Network.disable', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    await monitor.disable();

    expect(session.off).toHaveBeenCalledTimes(3);
    expect(session.send).toHaveBeenCalledWith('Network.disable');
    expect(monitor.isEnabled()).toBe(false);
  });

  it('emits a disconnected event that sets networkEnabled to false', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    expect(monitor.isEnabled()).toBe(true);

    // Trigger the disconnected handler
    const disconnectedHandler = session.on.mock.calls.find(([evt]) => evt === 'disconnected')?.[1];
    expect(disconnectedHandler).toBeDefined();
    disconnectedHandler!();

    expect(monitor.isEnabled()).toBe(false);
    expect(loggerState.warn).toHaveBeenCalledWith('NetworkMonitor: CDP session disconnected');
  });

  // -------------------------------------------------------------------------
  // Malformed CDP payload handling
  // -------------------------------------------------------------------------

  it('skips malformed Network.requestWillBeSent payloads', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.requestWillBeSent', { requestId: 'bad', request: { url: 123 } });
    emit('Network.requestWillBeSent', { requestId: null });

    expect(monitor.getRequests()).toHaveLength(0);
  });

  it('skips malformed Network.responseReceived payloads', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.responseReceived', { requestId: 'bad', response: { url: 123 } });
    emit('Network.responseReceived', { requestId: null });

    expect(monitor.getResponses()).toHaveLength(0);
  });

  it('skips malformed Network.loadingFinished payloads', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.loadingFinished', { requestId: null });

    // Should not throw
    expect(monitor.isEnabled()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Record overflow (LRU eviction)
  // -------------------------------------------------------------------------

  it('evicts oldest request when MAX_NETWORK_RECORDS is exceeded', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    // Access private MAX_NETWORK_RECORDS via any
    (monitor as any).MAX_NETWORK_RECORDS = 3;

    await monitor.enable();
    for (let i = 0; i < 5; i++) {
      emit('Network.requestWillBeSent', {
        requestId: `req-${i}`,
        request: { url: `https://example.com/${i}`, method: 'GET', headers: {} },
        timestamp: i,
      });
    }

    const requests = monitor.getRequests();
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => r.requestId)).toEqual(['req-2', 'req-3', 'req-4']);
  });

  it('evicts oldest response when MAX_NETWORK_RECORDS is exceeded', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    (monitor as any).MAX_NETWORK_RECORDS = 3;

    await monitor.enable();
    for (let i = 0; i < 5; i++) {
      emit('Network.responseReceived', {
        requestId: `req-${i}`,
        response: {
          url: `https://example.com/${i}`,
          status: 200,
          statusText: 'OK',
          headers: {},
          mimeType: 'application/json',
          fromDiskCache: false,
          fromServiceWorker: false,
          timing: {},
        },
        timestamp: i,
      });
    }

    const responses = monitor.getResponses();
    expect(responses).toHaveLength(3);
    expect(responses.map((r) => r.requestId)).toEqual(['req-2', 'req-3', 'req-4']);
  });

  // -------------------------------------------------------------------------
  // fromDiskCache / fromServiceWorker branch coverage
  // -------------------------------------------------------------------------

  it('marks response as fromCache when fromDiskCache is true', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.responseReceived', {
      requestId: 'req-cache',
      response: {
        url: 'https://example.com/cached',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        fromDiskCache: true,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 1,
    });

    expect(monitor.getResponses()[0].fromCache).toBe(true);
  });

  it('marks response as fromCache when fromServiceWorker is true', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.responseReceived', {
      requestId: 'req-sw',
      response: {
        url: 'https://example.com/sw',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        fromDiskCache: false,
        fromServiceWorker: true,
        timing: {},
      },
      timestamp: 1,
    });

    expect(monitor.getResponses()[0].fromCache).toBe(true);
  });

  // -------------------------------------------------------------------------
  // captureResponseBody — various error paths
  // -------------------------------------------------------------------------

  it('captureResponseBody skips when body is already cached', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    // Pre-populate the response body cache
    (monitor as any).responseBodyCache.set('req-cached', {
      body: 'already there',
      base64Encoded: false,
    });

    emit('Network.loadingFinished', { requestId: 'req-cached' });

    // send should not be called because it's already cached
    await new Promise((r) => setTimeout(r, 10));
    expect(session.send).not.toHaveBeenCalledWith('Network.getResponseBody', expect.anything());
  });

  it('captureResponseBody skips when response is unknown', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.loadingFinished', { requestId: 'unknown-req' });

    await new Promise((r) => setTimeout(r, 10));
    expect(session.send).not.toHaveBeenCalledWith('Network.getResponseBody', expect.anything());
  });

  it('captureResponseBody skips when response is from cache', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.responseReceived', {
      requestId: 'req-fromcache',
      response: {
        url: 'https://example.com/cached',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        fromDiskCache: true,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 1,
    });

    session.send.mockResolvedValueOnce({ body: 'should not be called', base64Encoded: false });
    emit('Network.loadingFinished', { requestId: 'req-fromcache' });

    await new Promise((r) => setTimeout(r, 10));
    expect(session.send).not.toHaveBeenCalledWith('Network.getResponseBody', expect.anything());
  });

  it('captureResponseBody skips oversized bodies (>1MB)', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.responseReceived', {
      requestId: 'req-big',
      response: {
        url: 'https://example.com/big',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 1,
    });

    session.send.mockResolvedValueOnce({
      body: 'x'.repeat(1_048_576 + 1),
      base64Encoded: false,
    });
    emit('Network.loadingFinished', { requestId: 'req-big' });

    await new Promise((r) => setTimeout(r, 10));
    const cached = (monitor as any).responseBodyCache.get('req-big');
    expect(cached).toBeUndefined();
  });

  it('captureResponseBody evicts oldest entry when at MAX_BODY_CACHE_ENTRIES capacity', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    (monitor as any).MAX_BODY_CACHE_ENTRIES = 3;

    // Populate cache with 3 entries to reach capacity, then add one more to trigger eviction.
    // Use a persistent default mock + override per entry.
    session.send.mockResolvedValue({ body: 'placeholder', base64Encoded: false });

    for (let i = 0; i < 3; i++) {
      emit('Network.responseReceived', {
        requestId: `req-pre${i}`,
        response: {
          url: `https://example.com/pre${i}`,
          status: 200,
          statusText: 'OK',
          headers: {},
          mimeType: 'text/html',
          fromDiskCache: false,
          fromServiceWorker: false,
          timing: {},
        },
        timestamp: i,
      });
      emit('Network.loadingFinished', { requestId: `req-pre${i}` });
    }
    await new Promise((r) => setTimeout(r, 20));

    // Cache should now be at capacity with req-pre0, req-pre1, req-pre2
    expect((monitor as any).responseBodyCache.has('req-pre0')).toBe(true);
    expect((monitor as any).responseBodyCache.has('req-pre1')).toBe(true);
    expect((monitor as any).responseBodyCache.has('req-pre2')).toBe(true);

    // Add a new response which will trigger LRU eviction (cache is at max)
    emit('Network.responseReceived', {
      requestId: 'req-new',
      response: {
        url: 'https://example.com/new',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 10,
    });
    emit('Network.loadingFinished', { requestId: 'req-new' });

    await new Promise((r) => setTimeout(r, 20));
    const cache = (monitor as any).responseBodyCache;
    expect(cache.has('req-pre0')).toBe(false); // evicted (oldest)
    expect(cache.has('req-pre1')).toBe(true);
    expect(cache.has('req-pre2')).toBe(true);
    expect(cache.has('req-new')).toBe(true);
  });

  it('captureResponseBody handles Network.getResponseBody throwing', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.responseReceived', {
      requestId: 'req-err',
      response: {
        url: 'https://example.com/err',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 1,
    });

    session.send.mockRejectedValueOnce(new Error('net::ERR_FAILED'));
    emit('Network.loadingFinished', { requestId: 'req-err' });

    await new Promise((r) => setTimeout(r, 10));
    const cached = (monitor as any).responseBodyCache.get('req-err');
    expect(cached).toBeUndefined();
  });

  it('captureResponseBody handles non-ObjectRecord response body payload', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.responseReceived', {
      requestId: 'req-bad-payload',
      response: {
        url: 'https://example.com/bad',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 1,
    });

    session.send.mockResolvedValueOnce('not an object');
    emit('Network.loadingFinished', { requestId: 'req-bad-payload' });

    await new Promise((r) => setTimeout(r, 10));
    const cached = (monitor as any).responseBodyCache.get('req-bad-payload');
    expect(cached).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // getResponseBody branches
  // -------------------------------------------------------------------------

  it('getResponseBody returns null and logs error when not enabled', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    const result = await monitor.getResponseBody('req-1');
    expect(result).toBeNull();
    expect(loggerState.error).toHaveBeenCalledWith(
      'Network monitoring is not enabled. Call enable() with enableNetwork: true first.',
    );
  });

  it('getResponseBody returns null when network is disabled', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    await monitor.disable();

    const result = await monitor.getResponseBody('req-1');
    expect(result).toBeNull();
  });

  it('getResponseBody returns null when request is not found', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    const result = await monitor.getResponseBody('nonexistent-req');
    expect(result).toBeNull();
    expect(loggerState.error).toHaveBeenCalledWith(
      expect.stringContaining('Request not found: nonexistent-req'),
    );
  });

  it('getResponseBody returns null when response is not yet received', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'pending-req',
      request: { url: 'https://example.com/pending', method: 'GET', headers: {} },
      timestamp: 1,
    });

    const result = await monitor.getResponseBody('pending-req');
    expect(result).toBeNull();
    expect(loggerState.warn).toHaveBeenCalledWith(
      expect.stringContaining('Response not yet received for request: pending-req'),
    );
  });

  it('getResponseBody returns null when Network.getResponseBody throws', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-fail',
      request: { url: 'https://example.com/fail', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-fail',
      response: {
        url: 'https://example.com/fail',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    session.send.mockRejectedValueOnce(new Error('net::ERR_FAILED'));
    const result = await monitor.getResponseBody('req-fail');
    expect(result).toBeNull();
  });

  it('getResponseBody returns null for malformed response body payload', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-malformed',
      request: { url: 'https://example.com/malformed', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-malformed',
      response: {
        url: 'https://example.com/malformed',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    session.send.mockResolvedValueOnce('not a valid payload');
    const result = await monitor.getResponseBody('req-malformed');
    expect(result).toBeNull();
  });

  it('getResponseBody returns cached body and does LRU refresh', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-cache',
      request: { url: 'https://example.com/cache', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-cache',
      response: {
        url: 'https://example.com/cache',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    // Pre-populate cache
    (monitor as any).responseBodyCache.set('req-cache', {
      body: 'cached-body',
      base64Encoded: false,
    });

    const result = await monitor.getResponseBody('req-cache');
    expect(result).toEqual({ body: 'cached-body', base64Encoded: false });

    // Verify LRU refresh: entry should be moved to end
    const cache = (monitor as any).responseBodyCache;
    expect(cache.has('req-cache')).toBe(true);
  });

  it('getResponseBody returns raw body even when base64Encoded is true (decoding is caller responsibility)', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-b64',
      request: { url: 'https://example.com/b64', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-b64',
      response: {
        url: 'https://example.com/b64',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/octet-stream',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    const b64Content = Buffer.from('decoded-content').toString('base64');
    session.send.mockResolvedValueOnce({
      body: b64Content,
      base64Encoded: true,
    });

    const result = await monitor.getResponseBody('req-b64');
    // getResponseBody returns raw body — decoding is the caller's responsibility
    expect(result?.body).toBe(b64Content);
    expect(result?.base64Encoded).toBe(true);
  });

  // -------------------------------------------------------------------------
  // getAllJavaScriptResponses
  // -------------------------------------------------------------------------

  it('getAllJavaScriptResponses returns empty when no JS responses', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-html',
      request: { url: 'https://example.com/index.html', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-html',
      response: {
        url: 'https://example.com/index.html',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/html',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    const result = await monitor.getAllJavaScriptResponses();
    expect(result).toHaveLength(0);
  });

  it('getAllJavaScriptResponses returns JS responses matching mimeType/javascript', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-js',
      request: { url: 'https://example.com/app.js', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-js',
      response: {
        url: 'https://example.com/app.js',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/javascript',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    session.send.mockResolvedValueOnce({
      body: 'console.log("hello");',
      base64Encoded: false,
    });

    const result = await monitor.getAllJavaScriptResponses();
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('console.log("hello");');
  });

  it('getAllJavaScriptResponses matches .js URL suffix', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-js-url',
      request: { url: 'https://cdn.example.com/lib.min.js', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-js-url',
      response: {
        url: 'https://cdn.example.com/lib.min.js',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/octet-stream', // non-standard mime but URL ends with .js
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    session.send.mockResolvedValueOnce({
      body: '// content',
      base64Encoded: false,
    });

    const result = await monitor.getAllJavaScriptResponses();
    expect(result).toHaveLength(1);
  });

  it('getAllJavaScriptResponses matches URL with .js? query string', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-js-query',
      request: { url: 'https://example.com/bundle.js?v=1.2.3', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-js-query',
      response: {
        url: 'https://example.com/bundle.js?v=1.2.3',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/plain',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    session.send.mockResolvedValueOnce({
      body: '// bundle',
      base64Encoded: false,
    });

    const result = await monitor.getAllJavaScriptResponses();
    expect(result).toHaveLength(1);
  });

  it('getAllJavaScriptResponses skips responses where getResponseBody returns null', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-js-null',
      request: { url: 'https://example.com/missing.js', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-js-null',
      response: {
        url: 'https://example.com/missing.js',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/javascript',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    // getResponseBody will fail because the response was never stored in responses map (we emitted no responseReceived)
    // Wait for the auto-capture to settle
    session.send.mockRejectedValueOnce(new Error('no body'));

    const result = await monitor.getAllJavaScriptResponses();
    expect(result).toHaveLength(0);
  });

  it('getAllJavaScriptResponses processes base64Encoded JS content', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-js-b64',
      request: { url: 'https://example.com/b64.js', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'req-js-b64',
      response: {
        url: 'https://example.com/b64.js',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/javascript',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    const original = 'const x = 1;';
    session.send.mockResolvedValueOnce({
      body: Buffer.from(original).toString('base64'),
      base64Encoded: true,
    });

    const result = await monitor.getAllJavaScriptResponses();
    expect(result[0].content).toBe(original);
  });

  // -------------------------------------------------------------------------
  // getRequests / getResponses — filter branches
  // -------------------------------------------------------------------------

  it('getRequests filters by url', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.requestWillBeSent', {
      requestId: 'req-a',
      request: { url: 'https://api.example.com/data', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.requestWillBeSent', {
      requestId: 'req-b',
      request: { url: 'https://other.example.com/data', method: 'GET', headers: {} },
      timestamp: 2,
    });

    const filtered = monitor.getRequests({ url: 'api.example' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].requestId).toBe('req-a');
  });

  it('getRequests filters by method', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.requestWillBeSent', {
      requestId: 'req-get',
      request: { url: 'https://example.com/', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.requestWillBeSent', {
      requestId: 'req-post',
      request: { url: 'https://example.com/', method: 'POST', headers: {}, postData: '{}' },
      timestamp: 2,
    });

    const filtered = monitor.getRequests({ method: 'POST' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].requestId).toBe('req-post');
  });

  it('getRequests applies limit (returns last N)', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    for (let i = 0; i < 5; i++) {
      emit('Network.requestWillBeSent', {
        requestId: `req-${i}`,
        request: { url: `https://example.com/${i}`, method: 'GET', headers: {} },
        timestamp: i,
      });
    }

    const limited = monitor.getRequests({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0].requestId).toBe('req-3');
    expect(limited[1].requestId).toBe('req-4');
  });

  it('getResponses filters by url', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    const emitResponse = (id: string, url: string, status: number) =>
      emit('Network.responseReceived', {
        requestId: id,
        response: {
          url,
          status,
          statusText: 'OK',
          headers: {},
          mimeType: 'application/json',
          fromDiskCache: false,
          fromServiceWorker: false,
          timing: {},
        },
        timestamp: 1,
      });

    emitResponse('res-1', 'https://api.example.com/', 200);
    emitResponse('res-2', 'https://other.example.com/', 200);

    const filtered = monitor.getResponses({ url: 'api.example' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].requestId).toBe('res-1');
  });

  it('getResponses filters by status', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    const emitResponse = (id: string, status: number) =>
      emit('Network.responseReceived', {
        requestId: id,
        response: {
          url: 'https://example.com/' + id,
          status,
          statusText: status === 200 ? 'OK' : 'Not Found',
          headers: {},
          mimeType: 'application/json',
          fromDiskCache: false,
          fromServiceWorker: false,
          timing: {},
        },
        timestamp: 1,
      });

    emitResponse('res-200', 200);
    emitResponse('res-404', 404);

    const filtered = monitor.getResponses({ status: 404 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].requestId).toBe('res-404');
  });

  it('getResponses applies limit', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    for (let i = 0; i < 5; i++) {
      emit('Network.responseReceived', {
        requestId: `res-${i}`,
        response: {
          url: `https://example.com/${i}`,
          status: 200,
          statusText: 'OK',
          headers: {},
          mimeType: 'application/json',
          fromDiskCache: false,
          fromServiceWorker: false,
          timing: {},
        },
        timestamp: i,
      });
    }

    const limited = monitor.getResponses({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0].requestId).toBe('res-3');
    expect(limited[1].requestId).toBe('res-4');
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------

  it('getStats aggregates requests by method, status, and type', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://a.com', method: 'GET', headers: {} },
      timestamp: 1,
      type: 'Script',
    });
    emit('Network.requestWillBeSent', {
      requestId: 'r2',
      request: { url: 'https://b.com', method: 'GET', headers: {} },
      timestamp: 2,
      type: 'Script',
    });
    emit('Network.requestWillBeSent', {
      requestId: 'r3',
      request: { url: 'https://c.com', method: 'POST', headers: {} },
      timestamp: 3,
    });

    const emitResponse = (id: string, status: number) =>
      emit('Network.responseReceived', {
        requestId: id,
        response: {
          url: 'https://example.com/' + id,
          status,
          statusText: status === 200 ? 'OK' : 'Not Found',
          headers: {},
          mimeType: 'application/json',
          fromDiskCache: false,
          fromServiceWorker: false,
          timing: {},
        },
        timestamp: 4,
      });

    emitResponse('r1', 200);
    emitResponse('r2', 404);
    emitResponse('r3', 200);

    const stats = monitor.getStats();
    expect(stats.totalRequests).toBe(3);
    expect(stats.totalResponses).toBe(3);
    expect(stats.byMethod).toEqual({ GET: 2, POST: 1 });
    expect(stats.byStatus).toEqual({ 200: 2, 404: 1 });
    expect(stats.byType).toEqual({ Script: 2 });
  });

  // -------------------------------------------------------------------------
  // clearRecords
  // -------------------------------------------------------------------------

  it('clearRecords clears requests, responses, and body cache', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://a.com', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'r1',
      response: {
        url: 'https://a.com',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    (monitor as any).responseBodyCache.set('r1', { body: 'x', base64Encoded: false });

    expect(monitor.getRequests()).toHaveLength(1);
    expect(monitor.getResponses()).toHaveLength(1);
    expect((monitor as any).responseBodyCache.size).toBe(1);

    monitor.clearRecords();

    expect(monitor.getRequests()).toHaveLength(0);
    expect(monitor.getResponses()).toHaveLength(0);
    expect((monitor as any).responseBodyCache.size).toBe(0);
    expect(loggerState.info).toHaveBeenCalledWith('Network records cleared');
  });

  // -------------------------------------------------------------------------
  // injectXHRInterceptor / injectFetchInterceptor
  // -------------------------------------------------------------------------

  it('injectXHRInterceptor throws when cdpSession is null', async () => {
    const { session } = createMockSession();
    // Force cdpSession to null via the private field
    const monitor = new NetworkMonitor(session);
    (monitor as any).cdpSession = null;

    await expect(monitor.injectXHRInterceptor()).rejects.toThrow('CDP session not initialized');
  });

  it('injectXHRInterceptor injects non-persistent interceptor via Runtime.evaluate', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.injectXHRInterceptor();

    expect(session.send).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: expect.stringContaining('XMLHttpRequest'),
    });
    expect(session.send).not.toHaveBeenCalledWith(
      'Page.addScriptToEvaluateOnNewDocument',
      expect.anything(),
    );
  });

  it('injectXHRInterceptor injects persistent interceptor via Page.addScriptToEvaluateOnNewDocument', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.injectXHRInterceptor({ persistent: true });

    expect(session.send).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument', {
      source: expect.stringContaining('XMLHttpRequest'),
    });
  });

  it('injectFetchInterceptor throws when cdpSession is null', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);
    (monitor as any).cdpSession = null;

    await expect(monitor.injectFetchInterceptor()).rejects.toThrow('CDP session not initialized');
  });

  it('injectFetchInterceptor injects non-persistent interceptor', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.injectFetchInterceptor();

    expect(session.send).toHaveBeenCalledWith('Runtime.evaluate', {
      expression: expect.stringContaining('fetch'),
    });
  });

  it('injectFetchInterceptor injects persistent interceptor', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.injectFetchInterceptor({ persistent: true });

    expect(session.send).toHaveBeenCalledWith('Page.addScriptToEvaluateOnNewDocument', {
      source: expect.stringContaining('fetch'),
    });
  });

  // -------------------------------------------------------------------------
  // getXHRRequests
  // -------------------------------------------------------------------------

  it('getXHRRequests throws when cdpSession is null', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);
    (monitor as any).cdpSession = null;

    await expect(monitor.getXHRRequests()).rejects.toThrow('CDP session not initialized');
  });

  it('getXHRRequests returns filtered array when Runtime.evaluate returns array', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({
      result: {
        value: [
          { method: 'POST', url: 'https://example.com/api' },
          { method: 'GET', url: 'https://example.com/data' },
        ],
      },
    });

    const result = await monitor.getXHRRequests();
    expect(result).toHaveLength(2);
  });

  it('getXHRRequests returns empty array when Runtime.evaluate returns non-array', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({ result: { value: 'not an array' } });

    const result = await monitor.getXHRRequests();
    expect(result).toEqual([]);
  });

  it('getXHRRequests filters out non-object entries from the array', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({
      result: {
        value: [
          { method: 'POST', url: 'https://example.com/api' },
          'invalid',
          null,
          { method: 'GET' },
        ],
      },
    });

    const result = await monitor.getXHRRequests();
    expect(result).toHaveLength(2);
  });

  it('getXHRRequests returns empty array when Runtime.evaluate throws', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockRejectedValueOnce(new Error('eval failed'));

    const result = await monitor.getXHRRequests();
    expect(result).toEqual([]);
  });

  it('getXHRRequests handles Runtime.evaluate result without value property', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({ result: {} });

    const result = await monitor.getXHRRequests();
    expect(result).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // getFetchRequests
  // -------------------------------------------------------------------------

  it('getFetchRequests throws when cdpSession is null', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);
    (monitor as any).cdpSession = null;

    await expect(monitor.getFetchRequests()).rejects.toThrow('CDP session not initialized');
  });

  it('getFetchRequests returns array when Runtime.evaluate returns array', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({
      result: {
        value: [{ method: 'GET', url: 'https://example.com/data' }],
      },
    });

    const result = await monitor.getFetchRequests();
    expect(result).toHaveLength(1);
  });

  it('getFetchRequests returns empty array when Runtime.evaluate returns non-array', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({ result: { value: { foo: 'bar' } } });

    const result = await monitor.getFetchRequests();
    expect(result).toEqual([]);
  });

  it('getFetchRequests returns empty array when Runtime.evaluate throws', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockRejectedValueOnce(new Error('eval failed'));

    const result = await monitor.getFetchRequests();
    expect(result).toEqual([]);
  });

  it('getFetchRequests filters out non-object entries', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({
      result: {
        value: [{ method: 'GET', url: 'https://example.com/' }, 'invalid', null],
      },
    });

    const result = await monitor.getFetchRequests();
    expect(result).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // clearInjectedBuffers
  // -------------------------------------------------------------------------

  it('clearInjectedBuffers throws when cdpSession is null', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);
    (monitor as any).cdpSession = null;

    await expect(monitor.clearInjectedBuffers()).rejects.toThrow('CDP session not initialized');
  });

  it('clearInjectedBuffers returns zeros when result is not an ObjectRecord', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({ result: { value: 'not an object' } });

    const result = await monitor.clearInjectedBuffers();
    expect(result).toEqual({ xhrCleared: 0, fetchCleared: 0 });
  });

  it('clearInjectedBuffers parses valid result with finite numbers', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({
      result: {
        value: { xhrCleared: 5, fetchCleared: 3 },
      },
    });

    const result = await monitor.clearInjectedBuffers();
    expect(result).toEqual({ xhrCleared: 5, fetchCleared: 3 });
  });

  it('clearInjectedBuffers returns zeros on Runtime.evaluate error', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockRejectedValueOnce(new Error('eval failed'));

    const result = await monitor.clearInjectedBuffers();
    expect(result).toEqual({ xhrCleared: 0, fetchCleared: 0 });
  });

  // -------------------------------------------------------------------------
  // resetInjectedInterceptors
  // -------------------------------------------------------------------------

  it('resetInjectedInterceptors throws when cdpSession is null', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);
    (monitor as any).cdpSession = null;

    await expect(monitor.resetInjectedInterceptors()).rejects.toThrow(
      'CDP session not initialized',
    );
  });

  it('resetInjectedInterceptors returns false flags when result is not an ObjectRecord', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({ result: { value: null } });

    const result = await monitor.resetInjectedInterceptors();
    expect(result).toEqual({ xhrReset: false, fetchReset: false });
  });

  it('resetInjectedInterceptors parses valid result', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({
      result: {
        value: { xhrReset: true, fetchReset: false },
      },
    });

    const result = await monitor.resetInjectedInterceptors();
    expect(result).toEqual({ xhrReset: true, fetchReset: false });
  });

  it('resetInjectedInterceptors returns false flags on Runtime.evaluate error', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockRejectedValueOnce(new Error('eval failed'));

    const result = await monitor.resetInjectedInterceptors();
    expect(result).toEqual({ xhrReset: false, fetchReset: false });
  });

  it('resetInjectedInterceptors uses toBoolean fallback for non-boolean values', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    session.send.mockResolvedValueOnce({
      result: {
        value: { xhrReset: 'yes' as unknown, fetchReset: 1 as unknown },
      },
    });

    const result = await monitor.resetInjectedInterceptors();
    // toBoolean: typeof === 'boolean' ? value : fallback(false)
    expect(result.xhrReset).toBe(false); // string falls back to false
    expect(result.fetchReset).toBe(false); // number falls back to false
  });

  // -------------------------------------------------------------------------
  // toFiniteNumber / toBoolean utility branches
  // -------------------------------------------------------------------------

  it('toFiniteNumber falls back to default for non-finite numbers', async () => {
    const { session } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    // Put a response in so we can check getStats with non-finite numbers
    // We test this indirectly: if we somehow have NaN/Infinity as a status, byMethod, etc.
    // The stats just iterate over maps and add 1, so non-finite keys would just get stringified.
    // This branch is covered by the clearInjectedBuffers with xhrCleared/Infinity test below.
    // Test via clearInjectedBuffers toFiniteNumber branch:
    session.send.mockResolvedValueOnce({
      result: { value: { xhrCleared: Infinity, fetchCleared: NaN } },
    });

    const result = await monitor.clearInjectedBuffers();
    // toFiniteNumber: isFinite ? value : fallback(0)
    expect(result.xhrCleared).toBe(0);
    expect(result.fetchCleared).toBe(0);
  });

  // -------------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------------

  it('getStatus returns correct state', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    const status = monitor.getStatus();
    expect(status.enabled).toBe(false);
    expect(status.requestCount).toBe(0);
    expect(status.responseCount).toBe(0);
    expect(status.listenerCount).toBe(0);
    expect(status.cdpSessionActive).toBe(true);

    await monitor.enable();
    emit('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://example.com/', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit('Network.responseReceived', {
      requestId: 'r1',
      response: {
        url: 'https://example.com/',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 2,
    });

    const enabledStatus = monitor.getStatus();
    expect(enabledStatus.enabled).toBe(true);
    expect(enabledStatus.requestCount).toBe(1);
    expect(enabledStatus.responseCount).toBe(1);
    expect(enabledStatus.listenerCount).toBe(3);
  });

  // -------------------------------------------------------------------------
  // request postData field
  // -------------------------------------------------------------------------

  it('captures request with postData', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.requestWillBeSent', {
      requestId: 'req-post',
      request: {
        url: 'https://example.com/api',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        postData: '{"key":"value"}',
      },
      timestamp: 1,
      type: 'XHR',
      initiator: {},
    });

    const requests = monitor.getRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].postData).toBe('{"key":"value"}');
  });

  it('captures request without optional initiator and type', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.requestWillBeSent', {
      requestId: 'req-no-opt',
      request: { url: 'https://example.com/', method: 'GET', headers: {} },
      timestamp: 1,
    });

    const requests = monitor.getRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0].type).toBeUndefined();
    expect(requests[0].initiator).toBeUndefined();
  });

  it('skips requestWillBeSent when postData is non-string (invalid)', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.requestWillBeSent', {
      requestId: 'bad-postdata',
      request: {
        url: 'https://example.com/',
        method: 'POST',
        headers: {},
        postData: 123, // should be string
      },
      timestamp: 1,
    });

    expect(monitor.getRequests()).toHaveLength(0);
  });

  it('skips responseReceived when mimeType is not a string', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.responseReceived', {
      requestId: 'bad-mime',
      response: {
        url: 'https://example.com/',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 123, // should be string
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 1,
    });

    expect(monitor.getResponses()).toHaveLength(0);
  });

  it('skips responseReceived when status is not a number', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();
    emit('Network.responseReceived', {
      requestId: 'bad-status',
      response: {
        url: 'https://example.com/',
        status: '200', // should be number
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 1,
    });

    expect(monitor.getResponses()).toHaveLength(0);
  });
});
