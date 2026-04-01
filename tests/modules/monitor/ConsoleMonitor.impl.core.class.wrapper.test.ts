import { beforeEach, describe, expect, it, vi } from 'vitest';

const wrapperState = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logs: {
    clearLogsCore: vi.fn(),
    clearExceptionsCore: vi.fn(),
    getLogsCore: vi.fn(() => [{ type: 'log', text: 'hello' }]),
    getExceptionsCore: vi.fn(() => [{ text: 'boom', exceptionId: 1, timestamp: 1 }]),
    getStatsCore: vi.fn(() => ({ totalMessages: 1, byType: { log: 1 } })),
  },
  network: {
    isNetworkEnabledCore: vi.fn(() => true),
    getNetworkStatusCore: vi.fn(() => ({
      enabled: true,
      requestCount: 1,
      responseCount: 1,
      listenerCount: 2,
      cdpSessionActive: true,
    })),
    getNetworkRequestsCore: vi.fn(() => [{ requestId: 'req-1', url: 'https://api.test/a' }]),
    getNetworkResponsesCore: vi.fn(() => [{ requestId: 'req-1', status: 200 }]),
    getNetworkActivityCore: vi.fn(() => ({
      request: { requestId: 'req-1' },
      response: { requestId: 'req-1' },
    })),
    getResponseBodyCore: vi.fn(async () => ({ body: 'body', base64Encoded: false })),
    getAllJavaScriptResponsesCore: vi.fn(async () => [
      { requestId: 'js-1', mimeType: 'application/javascript' },
    ]),
    clearNetworkRecordsCore: vi.fn(),
    clearInjectedBuffersCore: vi.fn(async () => ({
      xhrCleared: 1,
      fetchCleared: 2,
      dynamicScriptsCleared: 3,
    })),
    resetInjectedInterceptorsCore: vi.fn(async () => ({
      xhrReset: true,
      fetchReset: false,
      scriptMonitorReset: true,
    })),
    getNetworkStatsCore: vi.fn(() => ({
      totalRequests: 1,
      totalResponses: 1,
      byMethod: { GET: 1 },
      byStatus: { 200: 1 },
      byType: { xhr: 1 },
    })),
    injectXHRInterceptorCore: vi.fn(async () => undefined),
    injectFetchInterceptorCore: vi.fn(async () => undefined),
    getXHRRequestsCore: vi.fn(async () => [{ id: 'xhr-1' }]),
    getFetchRequestsCore: vi.fn(async () => [{ id: 'fetch-1' }]),
  },
  objectCache: {
    inspectObjectCore: vi.fn(async () => ({ objectId: 'obj-1', properties: { value: 1 } })),
    clearObjectCacheCore: vi.fn(),
  },
  dynamic: {
    enableDynamicScriptMonitoringCore: vi.fn(async () => undefined),
    getDynamicScriptsCore: vi.fn(async () => [{ id: 'dyn-1' }]),
    injectFunctionTracerCore: vi.fn(async () => undefined),
    injectPropertyWatcherCore: vi.fn(async () => undefined),
    clearDynamicScriptBufferCore: vi.fn(async () => ({ dynamicScriptsCleared: 3 })),
    resetDynamicScriptMonitoringCore: vi.fn(async () => ({ scriptMonitorReset: true })),
  },
  fetch: {
    instances: [] as Array<{
      enable: ReturnType<typeof vi.fn>;
      disable: ReturnType<typeof vi.fn>;
      removeRule: ReturnType<typeof vi.fn>;
      isEnabled: ReturnType<typeof vi.fn>;
      listRules: ReturnType<typeof vi.fn>;
    }>,
  },
}));

vi.mock('@utils/logger', () => ({
  logger: wrapperState.logger,
}));

vi.mock('@modules/monitor/ConsoleMonitor.impl.core.logs', () => ({
  clearExceptionsCore: wrapperState.logs.clearExceptionsCore,
  clearLogsCore: wrapperState.logs.clearLogsCore,
  getExceptionsCore: wrapperState.logs.getExceptionsCore,
  getLogsCore: wrapperState.logs.getLogsCore,
  getStatsCore: wrapperState.logs.getStatsCore,
}));

vi.mock('@modules/monitor/ConsoleMonitor.impl.core.network', () => ({
  clearInjectedBuffersCore: wrapperState.network.clearInjectedBuffersCore,
  clearNetworkRecordsCore: wrapperState.network.clearNetworkRecordsCore,
  getAllJavaScriptResponsesCore: wrapperState.network.getAllJavaScriptResponsesCore,
  getFetchRequestsCore: wrapperState.network.getFetchRequestsCore,
  getNetworkActivityCore: wrapperState.network.getNetworkActivityCore,
  getNetworkRequestsCore: wrapperState.network.getNetworkRequestsCore,
  getNetworkResponsesCore: wrapperState.network.getNetworkResponsesCore,
  getNetworkStatsCore: wrapperState.network.getNetworkStatsCore,
  getNetworkStatusCore: wrapperState.network.getNetworkStatusCore,
  getResponseBodyCore: wrapperState.network.getResponseBodyCore,
  getXHRRequestsCore: wrapperState.network.getXHRRequestsCore,
  injectFetchInterceptorCore: wrapperState.network.injectFetchInterceptorCore,
  injectXHRInterceptorCore: wrapperState.network.injectXHRInterceptorCore,
  isNetworkEnabledCore: wrapperState.network.isNetworkEnabledCore,
  resetInjectedInterceptorsCore: wrapperState.network.resetInjectedInterceptorsCore,
}));

vi.mock('@modules/monitor/ConsoleMonitor.impl.core.object-cache', () => ({
  clearObjectCacheCore: wrapperState.objectCache.clearObjectCacheCore,
  inspectObjectCore: wrapperState.objectCache.inspectObjectCore,
}));

vi.mock('@modules/monitor/ConsoleMonitor.impl.core.dynamic', () => ({
  clearDynamicScriptBufferCore: wrapperState.dynamic.clearDynamicScriptBufferCore,
  enableDynamicScriptMonitoringCore: wrapperState.dynamic.enableDynamicScriptMonitoringCore,
  getDynamicScriptsCore: wrapperState.dynamic.getDynamicScriptsCore,
  injectFunctionTracerCore: wrapperState.dynamic.injectFunctionTracerCore,
  injectPropertyWatcherCore: wrapperState.dynamic.injectPropertyWatcherCore,
  resetDynamicScriptMonitoringCore: wrapperState.dynamic.resetDynamicScriptMonitoringCore,
}));

vi.mock('@modules/monitor/FetchInterceptor', () => {
  class FetchInterceptor {
    public enable = vi.fn(async (rules: Array<{ id?: string; url?: string }>) => {
      return rules.map((rule, index) => ({
        id: rule.id ?? `rule-${index + 1}`,
        url: rule.url ?? '*',
      }));
    });

    public disable = vi.fn(async () => ({ removedRules: 1 }));
    public removeRule = vi.fn(async () => true);
    public isEnabled = vi.fn(() => false);
    public listRules = vi.fn(() => ({
      enabled: true,
      rules: [{ id: 'rule-1', url: '*' }],
      totalHits: 2,
    }));

    constructor(_session: unknown) {
      wrapperState.fetch.instances.push(this);
    }
  }

  return { FetchInterceptor };
});

vi.mock('@modules/monitor/NetworkMonitor', () => {
  class NetworkMonitor {
    public enable = vi.fn(async () => undefined);
    public disable = vi.fn(async () => undefined);
    public isEnabled = vi.fn(() => true);
    public getStatus = vi.fn(() => ({
      enabled: true,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: true,
    }));
    public getRequests = vi.fn(() => []);
    public getResponses = vi.fn(() => []);
    public getActivity = vi.fn(() => ({}));
    public getResponseBody = vi.fn(async () => null);
    public getAllJavaScriptResponses = vi.fn(async () => []);
    public clearRecords = vi.fn();
    public clearInjectedBuffers = vi.fn(async () => ({ xhrCleared: 0, fetchCleared: 0 }));
    public resetInjectedInterceptors = vi.fn(async () => ({ xhrReset: true, fetchReset: true }));
    public getStats = vi.fn(() => ({
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {},
      byStatus: {},
      byType: {},
    }));
    public injectXHRInterceptor = vi.fn(async () => undefined);
    public injectFetchInterceptor = vi.fn(async () => undefined);
    public getXHRRequests = vi.fn(async () => []);
    public getFetchRequests = vi.fn(async () => []);
  }

  return { NetworkMonitor };
});

vi.mock('@modules/monitor/PlaywrightNetworkMonitor', () => {
  class PlaywrightNetworkMonitor {
    public enable = vi.fn(async () => undefined);
    public disable = vi.fn(async () => undefined);
    public isEnabled = vi.fn(() => true);
    public setPage = vi.fn();
  }

  return { PlaywrightNetworkMonitor };
});

import { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl.core.class';

function createCdpSession() {
  const listeners = new Map<string, Set<(payload: any) => void>>();

  const session = {
    send: vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') {
        return { result: { value: 1 } };
      }
      return {};
    }),
    on: vi.fn((event: string, handler: (payload: any) => void) => {
      const handlers = listeners.get(event) ?? new Set<(payload: any) => void>();
      handlers.add(handler);
      listeners.set(event, handlers);
    }),
    off: vi.fn((event: string, handler: (payload: any) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    detach: vi.fn().mockResolvedValue(undefined),
  };

  return session;
}

function createCollectorMock(session: ReturnType<typeof createCdpSession>) {
  return {
    getActivePage: vi.fn().mockResolvedValue({
      createCDPSession: vi.fn().mockResolvedValue(session),
    }),
  } as never;
}

describe('ConsoleMonitor.impl.core.class wrapper delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wrapperState.fetch.instances.length = 0;
  });

  it('delegates monitor wrapper methods to the underlying cores', async () => {
    const session = createCdpSession();
    const monitor = new ConsoleMonitor(createCollectorMock(session));

    await monitor.enable({ enableNetwork: false, enableExceptions: false });

    expect(monitor.getLogs()).toEqual([{ type: 'log', text: 'hello' }]);
    expect(monitor.getExceptions()).toEqual([{ text: 'boom', exceptionId: 1, timestamp: 1 }]);
    expect(monitor.getStats()).toEqual({ totalMessages: 1, byType: { log: 1 } });
    expect(monitor.isNetworkEnabled()).toBe(true);
    expect(monitor.getNetworkStatus()).toMatchObject({ enabled: true, requestCount: 1 });
    expect(monitor.getNetworkRequests({ url: 'api' })).toEqual([
      { requestId: 'req-1', url: 'https://api.test/a' },
    ]);
    expect(monitor.getNetworkResponses({ status: 200 })).toEqual([
      { requestId: 'req-1', status: 200 },
    ]);
    expect(monitor.getNetworkActivity('req-1')).toEqual({
      request: { requestId: 'req-1' },
      response: { requestId: 'req-1' },
    });
    await expect(monitor.getResponseBody('req-1')).resolves.toEqual({
      body: 'body',
      base64Encoded: false,
    });
    await expect(monitor.getAllJavaScriptResponses()).resolves.toEqual([
      { requestId: 'js-1', mimeType: 'application/javascript' },
    ]);

    monitor.clearLogs();
    monitor.clearExceptions();
    monitor.clearNetworkRecords();
    expect(wrapperState.logs.clearLogsCore).toHaveBeenCalledTimes(1);
    expect(wrapperState.logs.clearExceptionsCore).toHaveBeenCalledTimes(1);
    expect(wrapperState.network.clearNetworkRecordsCore).toHaveBeenCalledTimes(1);

    await expect(monitor.clearInjectedBuffers()).resolves.toEqual({
      xhrCleared: 1,
      fetchCleared: 2,
      dynamicScriptsCleared: 3,
    });
    await expect(monitor.resetInjectedInterceptors()).resolves.toEqual({
      xhrReset: true,
      fetchReset: false,
      scriptMonitorReset: true,
    });
    expect(monitor.getNetworkStats()).toMatchObject({
      totalRequests: 1,
      totalResponses: 1,
      byMethod: { GET: 1 },
    });

    await monitor.injectXHRInterceptor({ persistent: true });
    await monitor.injectFetchInterceptor({ persistent: true });
    await expect(monitor.getXHRRequests()).resolves.toEqual([{ id: 'xhr-1' }]);
    await expect(monitor.getFetchRequests()).resolves.toEqual([{ id: 'fetch-1' }]);
    expect(wrapperState.network.injectXHRInterceptorCore).toHaveBeenCalledWith(expect.any(Object), {
      persistent: true,
    });
    expect(wrapperState.network.injectFetchInterceptorCore).toHaveBeenCalledWith(
      expect.any(Object),
      { persistent: true },
    );

    await expect(monitor.inspectObject('obj-1')).resolves.toEqual({
      objectId: 'obj-1',
      properties: { value: 1 },
    });
    monitor.clearObjectCache();
    expect(wrapperState.objectCache.clearObjectCacheCore).toHaveBeenCalledTimes(1);

    await monitor.enableDynamicScriptMonitoring({ persistent: true });
    await expect(monitor.getDynamicScripts()).resolves.toEqual([{ id: 'dyn-1' }]);
    await monitor.injectFunctionTracer('traceMe', { persistent: true });
    await monitor.injectPropertyWatcher('window.foo', 'bar', { persistent: true });
    expect(wrapperState.dynamic.enableDynamicScriptMonitoringCore).toHaveBeenCalledWith(
      expect.any(Object),
      { persistent: true },
    );
    expect(wrapperState.dynamic.injectFunctionTracerCore).toHaveBeenCalledWith(
      expect.any(Object),
      'traceMe',
      { persistent: true },
    );
    expect(wrapperState.dynamic.injectPropertyWatcherCore).toHaveBeenCalledWith(
      expect.any(Object),
      'window.foo',
      'bar',
      { persistent: true },
    );

    expect(monitor.getFetchInterceptStatus()).toEqual({ enabled: false, rules: [], totalHits: 0 });
    await expect(monitor.disableFetchIntercept()).resolves.toEqual({ removedRules: 0 });

    const enabledRules = await monitor.enableFetchIntercept([{ id: 'rule-1', url: '*' } as never]);
    expect(enabledRules).toEqual([{ id: 'rule-1', url: '*' }]);
    expect(monitor.getFetchInterceptStatus()).toEqual({
      enabled: true,
      rules: [{ id: 'rule-1', url: '*' }],
      totalHits: 2,
    });
    expect(wrapperState.fetch.instances).toHaveLength(1);

    await expect(monitor.disableFetchIntercept()).resolves.toEqual({ removedRules: 1 });
    await expect(monitor.disableFetchIntercept()).resolves.toEqual({ removedRules: 0 });

    await monitor.enableFetchIntercept([{ id: 'rule-1', url: '*' } as never]);
    await expect(monitor.removeFetchInterceptRule('rule-1')).resolves.toBe(true);
  });

  it('reports fetch intercept empty-state and missing-session branches', async () => {
    const session = createCdpSession();
    const monitor = new ConsoleMonitor(createCollectorMock(session));

    await expect(monitor.removeFetchInterceptRule('missing')).resolves.toBe(false);
    expect(monitor.getFetchInterceptStatus()).toEqual({ enabled: false, rules: [], totalHits: 0 });
  });
});
