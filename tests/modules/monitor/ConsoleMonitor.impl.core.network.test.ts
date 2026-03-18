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

import { PrerequisiteError } from '@errors/PrerequisiteError';
import {
  clearInjectedBuffersCore,
  clearNetworkRecordsCore,
  getAllJavaScriptResponsesCore,
  getFetchRequestsCore,
  getNetworkActivityCore,
  getNetworkRequestsCore,
  getNetworkResponsesCore,
  getNetworkStatsCore,
  getNetworkStatusCore,
  getResponseBodyCore,
  getXHRRequestsCore,
  injectFetchInterceptorCore,
  injectXHRInterceptorCore,
  isNetworkEnabledCore,
  resetInjectedInterceptorsCore,
} from '@modules/monitor/ConsoleMonitor.impl.core.network';

function createMonitor(enabled = true) {
  return {
    isEnabled: vi.fn(() => enabled),
    getStatus: vi.fn(() => ({
      enabled,
      requestCount: 1,
      responseCount: 2,
      listenerCount: 3,
      cdpSessionActive: true,
    })),
    getRequests: vi.fn(() => [{ requestId: 'req-1' }]),
    getResponses: vi.fn(() => [{ requestId: 'req-1', status: 200 }]),
    getActivity: vi.fn(() => ({ request: { requestId: 'req-1' } })),
    getResponseBody: vi.fn(async () => ({ body: 'payload', base64Encoded: false })),
    getAllJavaScriptResponses: vi.fn(async () => [{ requestId: 'js-1' }]),
    clearRecords: vi.fn(),
    clearInjectedBuffers: vi.fn(async () => ({ xhrCleared: 1, fetchCleared: 2 })),
    resetInjectedInterceptors: vi.fn(async () => ({ xhrReset: true, fetchReset: true })),
    getStats: vi.fn(() => ({
      totalRequests: 1,
      totalResponses: 1,
      byMethod: { GET: 1 },
      byStatus: { 200: 1 },
      byType: { XHR: 1 },
    })),
    injectXHRInterceptor: vi.fn(async () => {}),
    injectFetchInterceptor: vi.fn(async () => {}),
    getXHRRequests: vi.fn(async () => [{ id: 'xhr' }]),
    getFetchRequests: vi.fn(async () => [{ id: 'fetch' }]),
  };
}

describe('ConsoleMonitor network core helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to inert defaults when no network monitor is configured', async () => {
    const ctx = {
      cdpSession: null,
      clearDynamicScriptBuffer: vi.fn(async () => ({ dynamicScriptsCleared: 0 })),
      resetDynamicScriptMonitoring: vi.fn(async () => ({ scriptMonitorReset: false })),
    };

    expect(isNetworkEnabledCore(ctx)).toBe(false);
    expect(getNetworkStatusCore(ctx)).toEqual({
      enabled: false,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: false,
    });
    expect(getNetworkRequestsCore(ctx)).toEqual([]);
    expect(getNetworkResponsesCore(ctx)).toEqual([]);
    expect(getNetworkActivityCore(ctx, 'req-1')).toEqual({});
    await expect(getResponseBodyCore(ctx, 'req-1')).resolves.toBeNull();
    await expect(getAllJavaScriptResponsesCore(ctx)).resolves.toEqual([]);
    await expect(getXHRRequestsCore(ctx)).resolves.toEqual([]);
    await expect(getFetchRequestsCore(ctx)).resolves.toEqual([]);
    expect(getNetworkStatsCore(ctx)).toEqual({
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {},
      byStatus: {},
      byType: {},
    });
    expect(loggerState.error).toHaveBeenCalled();
  });

  it('delegates reads and reset operations to the playwright monitor when present', async () => {
    const playwrightNetworkMonitor = createMonitor(true);
    const ctx = {
      playwrightNetworkMonitor,
      networkMonitor: createMonitor(false),
      cdpSession: {},
      clearDynamicScriptBuffer: vi.fn(async () => ({ dynamicScriptsCleared: 99 })),
      resetDynamicScriptMonitoring: vi.fn(async () => ({ scriptMonitorReset: true })),
    };

    expect(isNetworkEnabledCore(ctx)).toBe(true);
    expect(getNetworkStatusCore(ctx).requestCount).toBe(1);
    expect(getNetworkRequestsCore(ctx)).toEqual([{ requestId: 'req-1' }]);
    expect(getNetworkResponsesCore(ctx)).toEqual([{ requestId: 'req-1', status: 200 }]);
    await expect(getResponseBodyCore(ctx, 'req-1')).resolves.toEqual({
      body: 'payload',
      base64Encoded: false,
    });
    await expect(clearInjectedBuffersCore(ctx)).resolves.toEqual({
      xhrCleared: 1,
      fetchCleared: 2,
      dynamicScriptsCleared: 0,
    });
    await expect(resetInjectedInterceptorsCore(ctx)).resolves.toEqual({
      xhrReset: true,
      fetchReset: true,
      scriptMonitorReset: false,
    });
    clearNetworkRecordsCore(ctx);
    expect(playwrightNetworkMonitor.clearRecords).toHaveBeenCalled();
  });

  it('combines CDP monitor and dynamic-script results and validates interceptor prerequisites', async () => {
    const networkMonitor = createMonitor(true);
    const ctx = {
      networkMonitor,
      cdpSession: {},
      clearDynamicScriptBuffer: vi.fn(async () => ({ dynamicScriptsCleared: 4 })),
      resetDynamicScriptMonitoring: vi.fn(async () => ({ scriptMonitorReset: true })),
    };

    await expect(clearInjectedBuffersCore(ctx)).resolves.toEqual({
      xhrCleared: 1,
      fetchCleared: 2,
      dynamicScriptsCleared: 4,
    });
    await expect(resetInjectedInterceptorsCore(ctx)).resolves.toEqual({
      xhrReset: true,
      fetchReset: true,
      scriptMonitorReset: true,
    });
    await expect(injectXHRInterceptorCore(ctx)).resolves.toBeUndefined();
    await expect(injectFetchInterceptorCore(ctx)).resolves.toBeUndefined();

    await expect(
      injectXHRInterceptorCore({
        cdpSession: {},
        clearDynamicScriptBuffer: vi.fn(),
        resetDynamicScriptMonitoring: vi.fn(),
      })
    ).rejects.toBeInstanceOf(PrerequisiteError);
  });
});
