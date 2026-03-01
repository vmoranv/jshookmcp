import { logger } from '../../utils/logger.js';
import { PrerequisiteError } from '../../errors/PrerequisiteError.js';
import type { NetworkRequest, NetworkResponse } from './NetworkMonitor.js';

type NetworkRequestFilter = { url?: string; method?: string; limit?: number };
type NetworkResponseFilter = { url?: string; status?: number; limit?: number };
type NetworkActivity = {
  request?: NetworkRequest;
  response?: NetworkResponse;
};
type NetworkRecord = Record<string, unknown>;

interface NetworkStatus {
  enabled: boolean;
  requestCount: number;
  responseCount: number;
  listenerCount: number;
  cdpSessionActive: boolean;
}

export interface NetworkStats extends Record<string, unknown> {
  totalRequests: number;
  totalResponses: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

interface InjectedBufferResult {
  xhrCleared: number;
  fetchCleared: number;
}

interface ResetInjectedInterceptorsResult {
  xhrReset: boolean;
  fetchReset: boolean;
}

interface NetworkResponseBody {
  body: string;
  base64Encoded: boolean;
}

interface NetworkMonitorLike {
  isEnabled(): boolean;
  getStatus(): NetworkStatus;
  getRequests(filter?: NetworkRequestFilter): NetworkRequest[];
  getResponses(filter?: NetworkResponseFilter): NetworkResponse[];
  getActivity(requestId: string): NetworkActivity;
  getResponseBody(requestId: string): Promise<NetworkResponseBody | null>;
  getAllJavaScriptResponses(): Promise<NetworkRecord[]>;
  clearRecords(): void;
  clearInjectedBuffers(): Promise<InjectedBufferResult>;
  resetInjectedInterceptors(): Promise<ResetInjectedInterceptorsResult>;
  getStats(): NetworkStats;
  injectXHRInterceptor(): Promise<void>;
  injectFetchInterceptor(): Promise<void>;
  getXHRRequests(): Promise<NetworkRecord[]>;
  getFetchRequests(): Promise<NetworkRecord[]>;
}

interface NetworkCoreContext {
  networkMonitor?: NetworkMonitorLike | null;
  playwrightNetworkMonitor?: NetworkMonitorLike | null;
  cdpSession: unknown | null;
  clearDynamicScriptBuffer(): Promise<{ dynamicScriptsCleared: number }>;
  resetDynamicScriptMonitoring(): Promise<{ scriptMonitorReset: boolean }>;
}

function asNetworkCoreContext(ctx: unknown): NetworkCoreContext {
  return ctx as NetworkCoreContext;
}

export function isNetworkEnabledCore(ctx: unknown): boolean {
  const coreCtx = asNetworkCoreContext(ctx);
  return (
    (coreCtx.networkMonitor?.isEnabled() ?? false) ||
    (coreCtx.playwrightNetworkMonitor?.isEnabled() ?? false)
  );
}

export function getNetworkStatusCore(ctx: unknown): NetworkStatus {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getStatus();
  }
  if (!coreCtx.networkMonitor) {
    return {
      enabled: false,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: coreCtx.cdpSession !== null,
    };
  }
  return coreCtx.networkMonitor.getStatus();
}

export function getNetworkRequestsCore(
  ctx: unknown,
  filter?: NetworkRequestFilter
): NetworkRequest[] {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getRequests(filter);
  }
  return coreCtx.networkMonitor?.getRequests(filter) ?? [];
}

export function getNetworkResponsesCore(
  ctx: unknown,
  filter?: NetworkResponseFilter
): NetworkResponse[] {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getResponses(filter);
  }
  return coreCtx.networkMonitor?.getResponses(filter) ?? [];
}

export function getNetworkActivityCore(ctx: unknown, requestId: string): NetworkActivity {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getActivity(requestId);
  }
  return coreCtx.networkMonitor?.getActivity(requestId) ?? {};
}

export async function getResponseBodyCore(
  ctx: unknown,
  requestId: string
): Promise<NetworkResponseBody | null> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getResponseBody(requestId);
  }
  if (!coreCtx.networkMonitor) {
    logger.error('Network monitoring is not enabled. Call enable() with enableNetwork: true first.');
    return null;
  }
  return coreCtx.networkMonitor.getResponseBody(requestId);
}

export async function getAllJavaScriptResponsesCore(ctx: unknown): Promise<NetworkRecord[]> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getAllJavaScriptResponses();
  }
  if (!coreCtx.networkMonitor) {
    return [];
  }
  return coreCtx.networkMonitor.getAllJavaScriptResponses();
}

export function clearNetworkRecordsCore(ctx: unknown): void {
  const coreCtx = asNetworkCoreContext(ctx);
  coreCtx.networkMonitor?.clearRecords();
  coreCtx.playwrightNetworkMonitor?.clearRecords();
}

export async function clearInjectedBuffersCore(ctx: unknown): Promise<{
  xhrCleared: number;
  fetchCleared: number;
  dynamicScriptsCleared: number;
}> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    const result = await coreCtx.playwrightNetworkMonitor.clearInjectedBuffers();
    return {
      ...result,
      dynamicScriptsCleared: 0,
    };
  }

  const networkResult = coreCtx.networkMonitor
    ? await coreCtx.networkMonitor.clearInjectedBuffers()
    : { xhrCleared: 0, fetchCleared: 0 };
  const dynamicResult = await coreCtx.clearDynamicScriptBuffer();

  return {
    ...networkResult,
    ...dynamicResult,
  };
}

export async function resetInjectedInterceptorsCore(ctx: unknown): Promise<{
  xhrReset: boolean;
  fetchReset: boolean;
  scriptMonitorReset: boolean;
}> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    const result = await coreCtx.playwrightNetworkMonitor.resetInjectedInterceptors();
    return {
      ...result,
      scriptMonitorReset: false,
    };
  }

  const networkResult = coreCtx.networkMonitor
    ? await coreCtx.networkMonitor.resetInjectedInterceptors()
    : { xhrReset: false, fetchReset: false };
  const scriptResult = await coreCtx.resetDynamicScriptMonitoring();

  return {
    ...networkResult,
    ...scriptResult,
  };
}

export function getNetworkStatsCore(ctx: unknown): NetworkStats {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getStats();
  }
  return (
    coreCtx.networkMonitor?.getStats() ?? {
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {},
      byStatus: {},
      byType: {},
    }
  );
}

export async function injectXHRInterceptorCore(ctx: unknown): Promise<void> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.injectXHRInterceptor();
  }
  if (!coreCtx.networkMonitor) {
    throw new PrerequisiteError('Network monitoring is not enabled. Call enable() with enableNetwork: true first.');
  }
  return coreCtx.networkMonitor.injectXHRInterceptor();
}

export async function injectFetchInterceptorCore(ctx: unknown): Promise<void> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.injectFetchInterceptor();
  }
  if (!coreCtx.networkMonitor) {
    throw new PrerequisiteError('Network monitoring is not enabled. Call enable() with enableNetwork: true first.');
  }
  return coreCtx.networkMonitor.injectFetchInterceptor();
}

export async function getXHRRequestsCore(ctx: unknown): Promise<NetworkRecord[]> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getXHRRequests();
  }
  if (!coreCtx.networkMonitor) {
    return [];
  }
  return coreCtx.networkMonitor.getXHRRequests();
}

export async function getFetchRequestsCore(ctx: unknown): Promise<NetworkRecord[]> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (coreCtx.playwrightNetworkMonitor) {
    return coreCtx.playwrightNetworkMonitor.getFetchRequests();
  }
  if (!coreCtx.networkMonitor) {
    return [];
  }
  return coreCtx.networkMonitor.getFetchRequests();
}
