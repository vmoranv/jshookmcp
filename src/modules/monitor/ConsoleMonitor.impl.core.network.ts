import { logger } from '@utils/logger';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import type {
  NetworkActivity,
  NetworkMonitorLike,
  NetworkRequest,
  NetworkResponse,
  NetworkResponseBody,
  NetworkStats,
  NetworkStatus,
} from '@modules/monitor/NetworkMonitor.types';

type NetworkRequestFilter = { url?: string; method?: string; limit?: number };
type NetworkResponseFilter = { url?: string; status?: number; limit?: number };
type NetworkRecord = Record<string, unknown>;

interface NetworkCoreContext {
  contextSwitchPending?: boolean;
  networkMonitor?: NetworkMonitorLike | null;
  playwrightNetworkMonitor?: NetworkMonitorLike | null;
  cdpSession: unknown | null;
  clearDynamicScriptBuffer(): Promise<{ dynamicScriptsCleared: number }>;
  resetDynamicScriptMonitoring(): Promise<{ scriptMonitorReset: boolean }>;
}

function asNetworkCoreContext(ctx: unknown): NetworkCoreContext {
  return ctx as NetworkCoreContext;
}

function hasStaleContext(ctx: NetworkCoreContext): boolean {
  return ctx.contextSwitchPending === true;
}

/**
 * Pick the monitor that actually backs the current session. Presence alone is
 * not enough: a disabled Playwright monitor can remain attached while the CDP
 * monitor is the enabled one (or vice versa), and `isNetworkEnabledCore`
 * already reports "enabled if either is enabled".
 */
function selectNetworkMonitor(ctx: NetworkCoreContext): NetworkMonitorLike | null {
  if (ctx.playwrightNetworkMonitor?.isEnabled()) {
    return ctx.playwrightNetworkMonitor;
  }
  if (ctx.networkMonitor?.isEnabled()) {
    return ctx.networkMonitor;
  }
  return ctx.playwrightNetworkMonitor ?? ctx.networkMonitor ?? null;
}

export function isNetworkEnabledCore(ctx: unknown): boolean {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return false;
  }
  return (
    (coreCtx.networkMonitor?.isEnabled() ?? false) ||
    (coreCtx.playwrightNetworkMonitor?.isEnabled() ?? false)
  );
}

export function getNetworkStatusCore(ctx: unknown): NetworkStatus {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return {
      enabled: false,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: false,
    };
  }
  const monitor = selectNetworkMonitor(coreCtx);
  if (!monitor) {
    return {
      enabled: false,
      requestCount: 0,
      responseCount: 0,
      listenerCount: 0,
      cdpSessionActive: coreCtx.cdpSession !== null,
    };
  }
  return monitor.getStatus();
}

export function getNetworkRequestsCore(
  ctx: unknown,
  filter?: NetworkRequestFilter,
): NetworkRequest[] {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return [];
  }
  return selectNetworkMonitor(coreCtx)?.getRequests(filter) ?? [];
}

export function getNetworkResponsesCore(
  ctx: unknown,
  filter?: NetworkResponseFilter,
): NetworkResponse[] {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return [];
  }
  return selectNetworkMonitor(coreCtx)?.getResponses(filter) ?? [];
}

export function getNetworkActivityCore(ctx: unknown, requestId: string): NetworkActivity {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return {};
  }
  return selectNetworkMonitor(coreCtx)?.getActivity(requestId) ?? {};
}

export async function getResponseBodyCore(
  ctx: unknown,
  requestId: string,
): Promise<NetworkResponseBody | null> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return null;
  }
  const monitor = selectNetworkMonitor(coreCtx);
  if (!monitor) {
    logger.error(
      'Network monitoring is not enabled. Call enable() with enableNetwork: true first.',
    );
    return null;
  }
  return monitor.getResponseBody(requestId);
}

export async function getAllJavaScriptResponsesCore(ctx: unknown): Promise<NetworkRecord[]> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return [];
  }
  return selectNetworkMonitor(coreCtx)?.getAllJavaScriptResponses() ?? [];
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
  const monitor = selectNetworkMonitor(coreCtx);
  const networkResult = monitor
    ? await monitor.clearInjectedBuffers()
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
  const monitor = selectNetworkMonitor(coreCtx);
  const networkResult = monitor
    ? await monitor.resetInjectedInterceptors()
    : { xhrReset: false, fetchReset: false };
  const scriptResult = await coreCtx.resetDynamicScriptMonitoring();

  return {
    ...networkResult,
    ...scriptResult,
  };
}

export function getNetworkStatsCore(ctx: unknown): NetworkStats {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return {
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {},
      byStatus: {},
      byType: {},
    };
  }
  return (
    selectNetworkMonitor(coreCtx)?.getStats() ?? {
      totalRequests: 0,
      totalResponses: 0,
      byMethod: {},
      byStatus: {},
      byType: {},
    }
  );
}

export async function injectXHRInterceptorCore(
  ctx: unknown,
  options?: { persistent?: boolean },
): Promise<void> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    throw new PrerequisiteError(
      'Network monitoring is not enabled. Call enable() with enableNetwork: true first.',
    );
  }
  const monitor = selectNetworkMonitor(coreCtx);
  if (!monitor) {
    throw new PrerequisiteError(
      'Network monitoring is not enabled. Call enable() with enableNetwork: true first.',
    );
  }
  return monitor.injectXHRInterceptor(options);
}

export async function injectFetchInterceptorCore(
  ctx: unknown,
  options?: { persistent?: boolean },
): Promise<void> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    throw new PrerequisiteError(
      'Network monitoring is not enabled. Call enable() with enableNetwork: true first.',
    );
  }
  const monitor = selectNetworkMonitor(coreCtx);
  if (!monitor) {
    throw new PrerequisiteError(
      'Network monitoring is not enabled. Call enable() with enableNetwork: true first.',
    );
  }
  return monitor.injectFetchInterceptor(options);
}

export async function getXHRRequestsCore(ctx: unknown): Promise<NetworkRecord[]> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return [];
  }
  return selectNetworkMonitor(coreCtx)?.getXHRRequests() ?? [];
}

export async function getFetchRequestsCore(ctx: unknown): Promise<NetworkRecord[]> {
  const coreCtx = asNetworkCoreContext(ctx);
  if (hasStaleContext(coreCtx)) {
    return [];
  }
  return selectNetworkMonitor(coreCtx)?.getFetchRequests() ?? [];
}
