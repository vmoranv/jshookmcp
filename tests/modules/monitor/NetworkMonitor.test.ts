import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { NetworkMonitor } from '@modules/monitor/NetworkMonitor';

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

  const emit = (event: string, payload: any) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };

  return {
    session: { send, on, off } as any,
    send,
    emit,
  };
}

describe('NetworkMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    loggerState.debug.mockReset();
    loggerState.info.mockReset();
    loggerState.warn.mockReset();
    loggerState.error.mockReset();
  });

  it('enables monitoring and captures request/response activity', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-1',
      request: {
        url: 'https://vmoranv.github.io/jshookmcp/api/users',
        method: 'GET',
        headers: {},
        postData: '',
      },
      timestamp: 1,
      type: 'XHR',
      initiator: { type: 'script' },
    });

    emit('Network.responseReceived', {
      requestId: 'req-1',
      response: {
        url: 'https://vmoranv.github.io/jshookmcp/api/users',
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: { requestTime: 1 },
      },
      timestamp: 2,
    });

    expect(monitor.isEnabled()).toBe(true);
    expect(monitor.getRequests()).toHaveLength(1);
    expect(monitor.getResponses()).toHaveLength(1);
    expect(monitor.getActivity('req-1').response?.status).toBe(200);
    expect(monitor.getStats().byMethod.GET).toBe(1);
  });

  it('returns null response body when monitor is disabled or request is incomplete', async () => {
    const { session, emit } = createMockSession();
    const monitor = new NetworkMonitor(session);

    await expect(monitor.getResponseBody('req-missing')).resolves.toBeNull();

    await monitor.enable();
    await expect(monitor.getResponseBody('req-missing')).resolves.toBeNull();

    emit('Network.requestWillBeSent', {
      requestId: 'req-pending',
      request: {
        url: 'https://vmoranv.github.io/jshookmcp/api/pending',
        method: 'GET',
        headers: {},
      },
      timestamp: 1,
      type: 'XHR',
      initiator: {},
    });

    await expect(monitor.getResponseBody('req-pending')).resolves.toBeNull();
  });

  it('retrieves response body successfully and handles CDP body errors gracefully', async () => {
    const { session, send, emit } = createMockSession();
    (send as ReturnType<typeof vi.fn>).mockImplementation(
      async (method: string, params?: { requestId: string }) => {
        if (method === 'Network.enable') return {};
        if (method === 'Network.getResponseBody' && params?.requestId === 'req-ok') {
          return { body: 'payload', base64Encoded: false };
        }
        if (method === 'Network.getResponseBody' && params?.requestId === 'req-fail') {
          throw new Error('Body unavailable');
        }
        return {};
      }
    );

    const monitor = new NetworkMonitor(session);
    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'req-ok',
      request: { url: 'https://vmoranv.github.io/jshookmcp/api/ok', method: 'GET', headers: {} },
      timestamp: 1,
      type: 'XHR',
      initiator: {},
    });
    emit('Network.responseReceived', {
      requestId: 'req-ok',
      response: {
        url: 'https://vmoranv.github.io/jshookmcp/api/ok',
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

    emit('Network.requestWillBeSent', {
      requestId: 'req-fail',
      request: { url: 'https://vmoranv.github.io/jshookmcp/api/fail', method: 'GET', headers: {} },
      timestamp: 3,
      type: 'XHR',
      initiator: {},
    });
    emit('Network.responseReceived', {
      requestId: 'req-fail',
      response: {
        url: 'https://vmoranv.github.io/jshookmcp/api/fail',
        status: 500,
        statusText: 'FAIL',
        headers: {},
        mimeType: 'application/json',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 4,
    });

    await expect(monitor.getResponseBody('req-ok')).resolves.toEqual({
      body: 'payload',
      base64Encoded: false,
    });
    await expect(monitor.getResponseBody('req-fail')).resolves.toBeNull();
  });

  it('collects JavaScript responses and decodes base64 content', async () => {
    const { session, send, emit } = createMockSession();
    (send as ReturnType<typeof vi.fn>).mockImplementation(
      async (method: string, params?: { requestId: string }) => {
        if (method === 'Network.enable') return {};
        if (method === 'Network.getResponseBody' && params?.requestId === 'js-a') {
          return {
            body: Buffer.from('console.log("A")').toString('base64'),
            base64Encoded: true,
          };
        }
        if (method === 'Network.getResponseBody' && params?.requestId === 'js-b') {
          return {
            body: 'console.log("B")',
            base64Encoded: false,
          };
        }
        return {};
      }
    );

    const monitor = new NetworkMonitor(session);
    await monitor.enable();

    emit('Network.requestWillBeSent', {
      requestId: 'js-a',
      request: {
        url: 'https://vmoranv.github.io/jshookmcp/cdn/app.js',
        method: 'GET',
        headers: {},
      },
      timestamp: 1,
      type: 'Script',
      initiator: {},
    });
    emit('Network.responseReceived', {
      requestId: 'js-a',
      response: {
        url: 'https://vmoranv.github.io/jshookmcp/cdn/app.js',
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

    emit('Network.requestWillBeSent', {
      requestId: 'js-b',
      request: {
        url: 'https://vmoranv.github.io/jshookmcp/cdn/chunk.js?v=1',
        method: 'GET',
        headers: {},
      },
      timestamp: 3,
      type: 'Script',
      initiator: {},
    });
    emit('Network.responseReceived', {
      requestId: 'js-b',
      response: {
        url: 'https://vmoranv.github.io/jshookmcp/cdn/chunk.js?v=1',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'text/plain',
        fromDiskCache: false,
        fromServiceWorker: false,
        timing: {},
      },
      timestamp: 4,
    });

    const jsResponses = await monitor.getAllJavaScriptResponses();
    expect(jsResponses).toHaveLength(2);
    expect(jsResponses[0]!.content).toContain('console.log("A")');
    expect(jsResponses[1]!.content).toContain('console.log("B")');
  });

  it('fetches JavaScript response bodies concurrently in batches', async () => {
    const pendingResolvers = new Map<string, () => void>();
    const { session, send, emit } = createMockSession();
    (send as ReturnType<typeof vi.fn>).mockImplementation(
      (method: string, params?: { requestId: string }) => {
        if (method === 'Network.enable') return Promise.resolve({});
        if (method === 'Network.getResponseBody' && params?.requestId) {
          return new Promise((resolve) => {
            pendingResolvers.set(params.requestId, () =>
              resolve({
                body: `console.log("${params.requestId}")`,
                base64Encoded: false,
              })
            );
          });
        }
        return Promise.resolve({});
      }
    );

    const monitor = new NetworkMonitor(session);
    await monitor.enable();

    for (const requestId of ['js-a', 'js-b']) {
      emit('Network.requestWillBeSent', {
        requestId,
        request: {
          url: `https://vmoranv.github.io/jshookmcp/cdn/${requestId}.js`,
          method: 'GET',
          headers: {},
        },
        timestamp: 1,
        type: 'Script',
        initiator: {},
      });
      emit('Network.responseReceived', {
        requestId,
        response: {
          url: `https://vmoranv.github.io/jshookmcp/cdn/${requestId}.js`,
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
    }

    const responsesPromise = monitor.getAllJavaScriptResponses();
    await Promise.resolve();

    expect(
      (send as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([method]) => method === 'Network.getResponseBody'
      )
    ).toHaveLength(2);

    pendingResolvers.get('js-a')?.();
    pendingResolvers.get('js-b')?.();

    const responses = await responsesPromise;
    expect(responses).toHaveLength(2);
  });

  it('clears and resets injected interceptor buffers with robust fallbacks', async () => {
    const { session, send } = createMockSession();
    (send as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        result: {
          value: {
            xhrCleared: 3,
            fetchCleared: 5,
          },
        },
      })
      .mockResolvedValueOnce({
        result: {
          value: {
            xhrReset: true,
            fetchReset: true,
          },
        },
      });

    const monitor = new NetworkMonitor(session);
    const cleared = await monitor.clearInjectedBuffers();
    const reset = await monitor.resetInjectedInterceptors();

    expect(cleared).toEqual({ xhrCleared: 3, fetchCleared: 5 });
    expect(reset).toEqual({ xhrReset: true, fetchReset: true });

    (send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('runtime failed'));
    (send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('runtime failed'));

    await expect(monitor.clearInjectedBuffers()).resolves.toEqual({
      xhrCleared: 0,
      fetchCleared: 0,
    });
    await expect(monitor.resetInjectedInterceptors()).resolves.toEqual({
      xhrReset: false,
      fetchReset: false,
    });
  });
});
