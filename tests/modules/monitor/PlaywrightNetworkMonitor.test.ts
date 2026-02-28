import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

import { PlaywrightNetworkMonitor } from '../../../src/modules/monitor/PlaywrightNetworkMonitor.js';

function createPage() {
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

function makeResponse(req: any, url: string, status = 200) {
  return {
    request: () => req,
    url: () => url,
    status: () => status,
    statusText: () => 'OK',
    headers: () => ({ 'content-type': 'application/json' }),
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
    page.handlers.request(req);
    page.handlers.response(makeResponse(req, 'https://api.test/user?id=1', 201));

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
    page.handlers.request(req1);
    page.handlers.request(req2);
    page.handlers.response(makeResponse(req1, 'https://api.test/a', 200));
    page.handlers.response(makeResponse(req2, 'https://api.test/b', 404));

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
    page.handlers.request(req);
    page.handlers.response(makeResponse(req, 'https://api.test/a', 200));

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
    page.evaluate
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
    page.evaluate.mockRejectedValue(new Error('page gone'));
    const monitor = new PlaywrightNetworkMonitor(page as any);

    expect(await monitor.getXHRRequests()).toEqual([]);
    expect(await monitor.getFetchRequests()).toEqual([]);
    expect(await monitor.clearInjectedBuffers()).toEqual({ xhrCleared: 0, fetchCleared: 0 });
    expect(await monitor.resetInjectedInterceptors()).toEqual({
      xhrReset: false,
      fetchReset: false,
    });
  });
});

