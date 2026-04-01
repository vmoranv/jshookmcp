import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { PlaywrightNetworkMonitor } from '@modules/monitor/PlaywrightNetworkMonitor';

function createPage() {
  const handlers: Record<string, (payload: any) => void> = {};
  const evaluateMock = vi.fn(async () => []);
  const evaluateOnNewDocumentMock = vi.fn(async () => undefined);
  return {
    handlers,
    on: vi.fn((event: string, handler: (payload: any) => void) => {
      handlers[event] = handler;
    }),
    off: vi.fn((event: string) => {
      delete handlers[event];
    }),
    evaluate: evaluateMock,
    evaluateOnNewDocument: evaluateOnNewDocumentMock,
  };
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

function makeBinaryResponse(req: any, url: string, status = 200) {
  return {
    request: () => req,
    url: () => url,
    status: () => status,
    statusText: () => 'OK',
    headers: () => ({ 'content-type': 'application/octet-stream' }),
    body: async () => Buffer.from([1, 2, 3, 4]),
  };
}

describe('PlaywrightNetworkMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('enables listeners and captures correlated request/response records', async () => {
    const page = createPage();
    const monitor = new PlaywrightNetworkMonitor(page as any);

    await monitor.enable();
    const req = makeRequest('https://api.test/user?id=1', 'POST', 'xhr', '{"x":1}');
    page.handlers['request']!(req);
    page.handlers['response']!(makeResponse(req, 'https://api.test/user?id=1', 201));

    const requests = monitor.getRequests();
    const responses = monitor.getResponses();

    expect(monitor.isEnabled()).toBe(true);
    expect(requests).toHaveLength(1);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.requestId).toBe(requests[0]!.requestId);
  });

  it('supports request/response filtering and activity lookup', async () => {
    const page = createPage();
    const monitor = new PlaywrightNetworkMonitor(page as any);
    await monitor.enable();

    const req1 = makeRequest('https://api.test/a', 'GET', 'xhr');
    const req2 = makeRequest('https://api.test/b', 'PUT', 'fetch');
    page.handlers['request']!(req1);
    page.handlers['request']!(req2);
    page.handlers['response']!(makeResponse(req1, 'https://api.test/a', 200));
    page.handlers['response']!(makeResponse(req2, 'https://api.test/b', 404));

    const onlyPut = monitor.getRequests({ method: 'PUT' });
    const only404 = monitor.getResponses({ status: 404 });
    const activity = monitor.getActivity(onlyPut[0]!.requestId);

    expect(onlyPut).toHaveLength(1);
    expect(only404).toHaveLength(1);
    expect(activity.request?.method).toBe('PUT');
    expect(activity.response?.status).toBe(404);
  });

  it('computes method/status/type statistics', async () => {
    const page = createPage();
    const monitor = new PlaywrightNetworkMonitor(page as any);
    await monitor.enable();

    const req = makeRequest('https://api.test/a', 'GET', 'script');
    page.handlers['request']!(req);
    page.handlers['response']!(makeResponse(req, 'https://api.test/a', 200));

    const stats = monitor.getStats();
    expect(stats.byMethod.GET).toBe(1);
    expect(stats.byStatus[200]).toBe(1);
    expect(stats.byType.script).toBe(1);
  });

  it('disables listeners and clears state', async () => {
    const page = createPage();
    const monitor = new PlaywrightNetworkMonitor(page as any);
    await monitor.enable();
    await monitor.disable();
    monitor.clearRecords();

    expect(monitor.isEnabled()).toBe(false);
    expect(page.off).toHaveBeenCalledTimes(2);
    expect(monitor.getStatus().requestCount).toBe(0);
  });

  it('injects fetch/xhr interceptors and reads injected buffers', async () => {
    const page = createPage();
    (page.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 'xhr-1' }])
      .mockResolvedValueOnce([{ id: 'fetch-1' }])
      .mockResolvedValueOnce({ xhrCleared: 2, fetchCleared: 3 })
      .mockResolvedValueOnce({ xhrReset: true, fetchReset: true });

    const monitor = new PlaywrightNetworkMonitor(page as any);

    await monitor.injectXHRInterceptor();
    await monitor.injectFetchInterceptor();
    const xhr = await monitor.getXHRRequests();
    const fetch = await monitor.getFetchRequests();
    const cleared = await monitor.clearInjectedBuffers();
    const reset = await monitor.resetInjectedInterceptors();

    expect(page.evaluate).toHaveBeenCalledTimes(6);
    expect(xhr).toEqual([{ id: 'xhr-1' }]);
    expect(fetch).toEqual([{ id: 'fetch-1' }]);
    expect(cleared).toEqual({ xhrCleared: 2, fetchCleared: 3 });
    expect(reset).toEqual({ xhrReset: true, fetchReset: true });
  });

  it('returns safe defaults when injected buffer operations fail', async () => {
    const page = createPage();
    (page.evaluate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('page gone'));
    const monitor = new PlaywrightNetworkMonitor(page as any);

    expect(await monitor.getXHRRequests()).toEqual([]);
    expect(await monitor.getFetchRequests()).toEqual([]);
    expect(await monitor.clearInjectedBuffers()).toEqual({ xhrCleared: 0, fetchCleared: 0 });
    expect(await monitor.resetInjectedInterceptors()).toEqual({
      xhrReset: false,
      fetchReset: false,
    });
  });

  it('rebinds listeners when switching pages and caches response bodies', async () => {
    const page1 = createPage();
    const page2 = createPage();
    const monitor = new PlaywrightNetworkMonitor(page1 as any);

    await monitor.enable();
    monitor.setPage(page2 as any);

    const req1 = makeRequest('https://api.test/text.js', 'GET', 'script');
    const req2 = makeRequest('https://api.test/bin', 'GET', 'fetch');
    page2.handlers['request']!(req1);
    page2.handlers['response']!(
      makeResponse(req1, 'https://api.test/text.js', 200, 'text/javascript'),
    );
    page2.handlers['request']!(req2);
    page2.handlers['response']!(makeBinaryResponse(req2, 'https://api.test/bin', 200));

    await vi.waitFor(async () => {
      expect(await monitor.getResponseBody('pw-1')).toMatchObject({ base64Encoded: false });
    });
    await vi.waitFor(async () => {
      expect(await monitor.getResponseBody('pw-2')).toMatchObject({ base64Encoded: true });
    });

    const textBody = await monitor.getResponseBody('pw-1');
    const binaryBody = await monitor.getResponseBody('pw-2');

    expect(page1.off).toHaveBeenCalledWith('request', expect.any(Function));
    expect(page1.off).toHaveBeenCalledWith('response', expect.any(Function));
    expect(page2.on).toHaveBeenCalledWith('request', expect.any(Function));
    expect(page2.on).toHaveBeenCalledWith('response', expect.any(Function));
    expect(textBody).toMatchObject({ base64Encoded: false });
    expect(binaryBody).toMatchObject({ base64Encoded: true });
    expect(await monitor.getAllJavaScriptResponses()).toHaveLength(1);
    expect(await monitor.getResponseBody('missing')).toBeNull();
  });

  it('handles repeated enable calls, page rebind failures, and limit filters', async () => {
    const page1 = createPage();
    page1.off.mockImplementation(() => {
      throw new Error('page already closed');
    });
    const page2 = createPage();
    const monitor = new PlaywrightNetworkMonitor(page1 as any);

    await monitor.enable();
    await monitor.enable();

    expect(loggerState.warn).toHaveBeenCalledWith('PlaywrightNetworkMonitor already enabled');

    monitor.setPage(page2 as any);
    monitor.setPage(page2 as any);

    const req1 = makeRequest('https://api.test/a', 'GET', 'xhr');
    const req2 = makeRequest('https://api.test/b', 'POST', 'fetch');
    page2.handlers['request']!(req1);
    page2.handlers['request']!(req2);
    page2.handlers['response']!(makeResponse(req1, 'https://api.test/a', 200));
    page2.handlers['response']!(makeResponse(req2, 'https://api.test/b', 201));

    const limitedRequests = monitor.getRequests({ limit: 1 });
    const limitedResponses = monitor.getResponses({ limit: 1 });

    expect(page2.on).toHaveBeenCalledWith('request', expect.any(Function));
    expect(page2.on).toHaveBeenCalledWith('response', expect.any(Function));
    expect(page1.off).toHaveBeenCalledWith('request', expect.any(Function));
    expect(page1.off).toHaveBeenCalledWith('response', expect.any(Function));
    expect(limitedRequests).toHaveLength(1);
    expect(limitedRequests[0]?.url).toContain('/b');
    expect(limitedResponses).toHaveLength(1);
    expect(limitedResponses[0]?.status).toBe(201);
  });

  it('supports persistent interceptor injection, oversized bodies, and validation fallbacks', async () => {
    const page = createPage();
    const monitor = new PlaywrightNetworkMonitor(page as any);

    await monitor.enable();
    await monitor.injectXHRInterceptor({ persistent: true });
    await monitor.injectFetchInterceptor({ persistent: true });

    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(2);

    (page.evaluate as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ not: 'array' })
      .mockResolvedValueOnce('still not an array')
      .mockResolvedValueOnce({ xhrCleared: 'bad', fetchCleared: 2 })
      .mockResolvedValueOnce({ xhrReset: 'nope', fetchReset: false });

    expect(await monitor.getXHRRequests()).toEqual([]);
    expect(await monitor.getFetchRequests()).toEqual([]);
    expect(await monitor.clearInjectedBuffers()).toEqual({ xhrCleared: 0, fetchCleared: 0 });
    expect(await monitor.resetInjectedInterceptors()).toEqual({
      xhrReset: false,
      fetchReset: false,
    });

    const req = makeRequest('https://api.test/huge.js', 'GET', 'script');
    page.handlers['request']!(req);
    page.handlers['response']!(
      Object.assign(makeResponse(req, 'https://api.test/huge.js', 200, 'text/javascript'), {
        body: async () => Buffer.alloc(1_048_577, 1),
      }),
    );

    await vi.waitFor(() => {
      expect(loggerState.debug).toHaveBeenCalledWith(
        expect.stringContaining('Skipping oversized body'),
      );
    });

    expect(await monitor.getResponseBody('pw-1')).toBeNull();
  });
});
