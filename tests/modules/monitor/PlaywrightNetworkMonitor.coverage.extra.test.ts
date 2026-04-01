import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { PlaywrightNetworkMonitor } from '@modules/monitor/PlaywrightNetworkMonitor';

function OriginalXHR() {}

function createPage(overrides: Record<string, any> = {}) {
  const handlers: Record<string, (payload: any) => void> = {};
  return {
    handlers,
    on: vi.fn((event: string, handler: (payload: any) => void) => {
      handlers[event] = handler;
    }),
    off: vi.fn((event: string) => {
      delete handlers[event];
    }),
    evaluate: vi.fn(async () => []),
    evaluateOnNewDocument: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createEvaluatingPage(windowState: Record<string, any>) {
  return createPage({
    evaluate: vi.fn(async (pageFunction: string | (() => unknown)) => {
      const previousWindow = (globalThis as any).window;
      (globalThis as any).window = windowState;
      try {
        if (typeof pageFunction === 'function') {
          await pageFunction();
        }
      } finally {
        if (previousWindow === undefined) {
          delete (globalThis as any).window;
        } else {
          (globalThis as any).window = previousWindow;
        }
      }
      return null;
    }),
  });
}

function makeRequest(url: string, method = 'GET', resourceType = 'xhr', postData?: string) {
  return {
    url: () => url,
    method: () => method,
    headers: () => ({ authorization: 'Bearer x' }),
    postData: () => postData ?? null,
    resourceType: () => resourceType,
  };
}

function makeResponse(req: any, url: string, status = 200, contentType = 'application/json') {
  return {
    request: () => req,
    url: () => url,
    status: () => status,
    statusText: () => 'OK',
    headers: () => ({ 'content-type': contentType }),
    body: async () =>
      Buffer.from(contentType.includes('javascript') ? 'console.log(1)' : '{"ok":true}'),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
});

describe('PlaywrightNetworkMonitor extra coverage', () => {
  it('throws when enabling without a page', async () => {
    const monitor = new PlaywrightNetworkMonitor(null);

    await expect(monitor.enable()).rejects.toThrow('Playwright page not initialized');
  });

  it('ignores invalid captured objects and detaches cleanly when the page is cleared', async () => {
    const page = createPage();
    const monitor = new PlaywrightNetworkMonitor(page as any);

    await monitor.enable();
    page.handlers.request?.({});
    page.handlers.response?.({ request: () => ({}) });

    expect(monitor.getRequests()).toHaveLength(0);
    expect(monitor.getResponses()).toHaveLength(0);
    expect(monitor.getRequests({ url: 'missing' })).toHaveLength(0);
    expect(monitor.getResponses({ url: 'missing' })).toHaveLength(0);

    monitor.setPage(null);

    expect(monitor.isEnabled()).toBe(false);
    expect(page.off).toHaveBeenCalledWith('request', expect.any(Function));
    expect(page.off).toHaveBeenCalledWith('response', expect.any(Function));
    expect(monitor.getStatus()).toMatchObject({
      enabled: false,
      listenerCount: 0,
    });
  });

  it('evicts oldest records when the network limit is exceeded and logs body capture failures', async () => {
    const page = createPage();
    const monitor = new PlaywrightNetworkMonitor(page as any);

    await monitor.enable();
    (monitor as any).MAX_NETWORK_RECORDS = 1;

    const req1 = makeRequest('https://api.test/first', 'GET', 'xhr');
    const req2 = makeRequest('https://api.test/second', 'POST', 'fetch');

    page.handlers.request?.(req1);
    page.handlers.response?.(makeResponse(req1, 'https://api.test/first', 200));
    page.handlers.request?.(req2);
    page.handlers.response?.(
      Object.assign(makeResponse(req2, 'https://api.test/second', 202), {
        body: async () => {
          throw new Error('boom');
        },
      }),
    );

    await vi.waitFor(() => {
      expect(loggerState.debug).toHaveBeenCalledWith(
        expect.stringContaining('Could not capture body for pw-2: boom'),
      );
    });

    expect(monitor.getRequests()).toHaveLength(1);
    expect(monitor.getResponses()).toHaveLength(1);
    expect(monitor.getRequests()[0]?.url).toContain('/second');
    expect(monitor.getResponses()[0]?.status).toBe(202);
  });

  it('throws when page evaluation APIs are unavailable', async () => {
    const page = createPage({
      evaluate: undefined,
      evaluateOnNewDocument: undefined,
    });
    const monitor = new PlaywrightNetworkMonitor(page as any);

    await expect(monitor.injectScript('void 0')).rejects.toThrow(
      'Playwright page.evaluate is not available',
    );
    await expect(monitor.injectXHRInterceptor({ persistent: true })).rejects.toThrow(
      'Playwright page.evaluateOnNewDocument is not available',
    );
    await expect(monitor.injectFetchInterceptor({ persistent: true })).rejects.toThrow(
      'Playwright page.evaluateOnNewDocument is not available',
    );
  });

  it('executes page.evaluate callbacks for buffer helpers and falls back on invalid results', async () => {
    const windowState: Record<string, any> = {
      __xhrRequests: [{ id: 'xhr-1' }],
      __fetchRequests: [{ id: 'fetch-1' }],
      __pwOriginalXMLHttpRequest: OriginalXHR,
      __pwOriginalFetch: async () => undefined,
      __xhrInterceptorInjected: true,
      __fetchInterceptorInjected: true,
    };
    const page = createEvaluatingPage(windowState);
    const monitor = new PlaywrightNetworkMonitor(page as any);

    await monitor.enable();

    expect(await monitor.getXHRRequests()).toEqual([]);
    expect(await monitor.getFetchRequests()).toEqual([]);

    delete windowState.__xhrRequests;
    delete windowState.__fetchRequests;

    expect(await monitor.getXHRRequests()).toEqual([]);
    expect(await monitor.getFetchRequests()).toEqual([]);

    windowState.__xhrRequests = [{ id: 'xhr-2' }];
    windowState.__fetchRequests = [{ id: 'fetch-2' }];

    expect(await monitor.clearInjectedBuffers()).toEqual({ xhrCleared: 0, fetchCleared: 0 });
    expect(windowState.__xhrRequests).toEqual([]);
    expect(windowState.__fetchRequests).toEqual([]);

    windowState.__xhrRequests = undefined;
    windowState.__fetchRequests = undefined;

    expect(await monitor.clearInjectedBuffers()).toEqual({ xhrCleared: 0, fetchCleared: 0 });

    windowState.__xhrRequests = [{ id: 'xhr-3' }];
    windowState.__fetchRequests = [{ id: 'fetch-3' }];

    expect(await monitor.resetInjectedInterceptors()).toEqual({
      xhrReset: false,
      fetchReset: false,
    });
    expect(windowState.XMLHttpRequest).toBe(windowState.__pwOriginalXMLHttpRequest);
    expect(windowState.fetch).toBe(windowState.__pwOriginalFetch);
    expect(windowState.__xhrRequests).toEqual([]);
    expect(windowState.__fetchRequests).toEqual([]);
    expect(windowState.__xhrInterceptorInjected).toBe(false);
    expect(windowState.__fetchInterceptorInjected).toBe(false);

    delete windowState.__pwOriginalXMLHttpRequest;
    delete windowState.__pwOriginalFetch;
    delete windowState.__xhrRequests;
    delete windowState.__fetchRequests;

    expect(await monitor.resetInjectedInterceptors()).toEqual({
      xhrReset: false,
      fetchReset: false,
    });
  });

  it('handles disable failures and evicts the oldest cached response body', async () => {
    const page = createPage({
      off: vi.fn(() => {
        throw new Error('page already closed');
      }),
    });
    const monitor = new PlaywrightNetworkMonitor(page as any);

    await monitor.enable();
    await expect(monitor.disable()).resolves.toBeUndefined();
    expect(monitor.isEnabled()).toBe(false);

    const cachingPage = createPage();
    const cachingMonitor = new PlaywrightNetworkMonitor(cachingPage as any);
    await cachingMonitor.enable();
    (cachingMonitor as any).MAX_BODY_CACHE_ENTRIES = 1;

    const req1 = makeRequest('https://api.test/a.js', 'GET', 'script');
    const req2 = makeRequest('https://api.test/b.bin', 'GET', 'fetch');
    cachingPage.handlers.request!(req1);
    cachingPage.handlers.response!(
      makeResponse(req1, 'https://api.test/a.js', 200, 'text/javascript'),
    );
    cachingPage.handlers.request!(req2);
    cachingPage.handlers.response!(
      makeResponse(req2, 'https://api.test/b.bin', 200, 'application/octet-stream'),
    );

    await vi.waitFor(async () => {
      expect(await cachingMonitor.getResponseBody('pw-2')).toMatchObject({
        base64Encoded: true,
      });
    });

    expect(await cachingMonitor.getResponseBody('pw-1')).toBeNull();
    expect(await cachingMonitor.getResponseBody('pw-2')).toMatchObject({
      base64Encoded: true,
    });
    expect(await cachingMonitor.getAllJavaScriptResponses()).toHaveLength(1);
  });

  it('supports url and status filters with activity lookup', async () => {
    const page = createPage();
    const monitor = new PlaywrightNetworkMonitor(page as any);
    await monitor.enable();

    const req = makeRequest('https://api.test/valid', 'POST', 'xhr', '{"x":1}');
    page.handlers.request!(req);
    page.handlers.response!(makeResponse(req, 'https://api.test/valid', 201));

    expect(monitor.getRequests({ method: 'POST', url: '/valid' })).toHaveLength(1);
    expect(monitor.getResponses({ status: 201, url: '/valid' })).toHaveLength(1);
    expect(monitor.getActivity('missing')).toEqual({ request: undefined, response: undefined });
  });
});
