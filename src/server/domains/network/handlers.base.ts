import { logger } from '@utils/logger';
import type { CodeCollector } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import { PerformanceMonitor } from '@server/domains/shared/modules';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { argBool } from '@server/domains/shared/parse-args';

// ============================================================================
// Helper Types and Functions (from handlers.impl.core.runtime.requests)
// ============================================================================

interface NetworkRequestPayload {
  requestId?: string;
  url: string;
  method: string;
  type?: string;
  timestamp?: number;
  [key: string]: unknown;
}

interface NetworkResponsePayload {
  status: number;
  [key: string]: unknown;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNetworkRequestPayload = (value: unknown): value is NetworkRequestPayload => {
  if (!isObjectRecord(value)) {
    return false;
  }
  return typeof value.url === 'string' && typeof value.method === 'string';
};

const isNetworkResponsePayload = (value: unknown): value is NetworkResponsePayload => {
  if (!isObjectRecord(value)) {
    return false;
  }
  return typeof value.status === 'number';
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// ============================================================================
// Helper Types and Functions (from handlers.impl.core.runtime.performance)
// ============================================================================

interface CpuProfileCallFramePayload {
  functionName?: string;
  url?: string;
  lineNumber?: number;
}

interface CpuProfileNodePayload {
  hitCount?: number;
  callFrame?: CpuProfileCallFramePayload;
}

interface CpuProfilePayload {
  nodes: CpuProfileNodePayload[];
  samples?: unknown[];
  startTime: number;
  endTime: number;
}

const asOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const asOptionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asOptionalStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.every((item) => typeof item === 'string') ? value : undefined;
};

const isCpuProfileNodePayload = (value: unknown): value is CpuProfileNodePayload => {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.hitCount !== undefined && typeof value.hitCount !== 'number') {
    return false;
  }

  if (value.callFrame !== undefined && !isObjectRecord(value.callFrame)) {
    return false;
  }
  if (isObjectRecord(value.callFrame)) {
    if (
      value.callFrame.functionName !== undefined &&
      typeof value.callFrame.functionName !== 'string'
    ) {
      return false;
    }
    if (value.callFrame.url !== undefined && typeof value.callFrame.url !== 'string') {
      return false;
    }
    if (
      value.callFrame.lineNumber !== undefined &&
      typeof value.callFrame.lineNumber !== 'number'
    ) {
      return false;
    }
  }

  return true;
};

const toCpuProfilePayload = (value: unknown): CpuProfilePayload | null => {
  if (!isObjectRecord(value)) {
    return null;
  }
  if (!Array.isArray(value.nodes)) {
    return null;
  }
  if (typeof value.startTime !== 'number' || typeof value.endTime !== 'number') {
    return null;
  }
  if (!value.nodes.every((node) => isCpuProfileNodePayload(node))) {
    return null;
  }

  return {
    nodes: value.nodes,
    samples: Array.isArray(value.samples) ? value.samples : undefined,
    startTime: value.startTime,
    endTime: value.endTime,
  };
};

// ============================================================================
// AdvancedHandlersBase - All handler methods consolidated here
// ============================================================================

export class AdvancedHandlersBase {
  protected performanceMonitor: PerformanceMonitor | null = null;
  protected detailedDataManager: DetailedDataManager;

  constructor(
    protected collector: CodeCollector,
    protected consoleMonitor: ConsoleMonitor
  ) {
    this.detailedDataManager = DetailedDataManager.getInstance();
  }

  protected getPerformanceMonitor(): PerformanceMonitor {
    if (!this.performanceMonitor) {
      this.performanceMonitor = new PerformanceMonitor(this.collector);
    }
    return this.performanceMonitor;
  }

  protected parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
      return defaultValue;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return defaultValue;
  }

  protected parseNumberArg(
    value: unknown,
    options: { defaultValue: number; min?: number; max?: number; integer?: boolean }
  ): number {
    let parsed: number | undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const n = Number(trimmed);
        if (Number.isFinite(n)) {
          parsed = n;
        }
      }
    }
    if (parsed === undefined) {
      parsed = options.defaultValue;
    }
    if (options.integer) {
      parsed = Math.trunc(parsed);
    }
    if (typeof options.min === 'number') {
      parsed = Math.max(options.min, parsed);
    }
    if (typeof options.max === 'number') {
      parsed = Math.min(options.max, parsed);
    }
    return parsed;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected async ensureNetworkEnabled(options: {
    autoEnable: boolean;
    enableExceptions: boolean;
  }): Promise<{ enabled: boolean; autoEnabled: boolean; error?: string }> {
    if (this.consoleMonitor.isNetworkEnabled()) {
      return { enabled: true, autoEnabled: false };
    }

    if (!options.autoEnable) {
      return { enabled: false, autoEnabled: false };
    }

    try {
      await this.consoleMonitor.enable({
        enableNetwork: true,
        enableExceptions: options.enableExceptions,
      });
      return {
        enabled: this.consoleMonitor.isNetworkEnabled(),
        autoEnabled: true,
      };
    } catch (error) {
      return {
        enabled: false,
        autoEnabled: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ========================================================================
  // Handler methods from handlers.impl.core.runtime.base.ts
  // ========================================================================

  async handleNetworkEnable(args: Record<string, unknown>) {
    const enableExceptions = this.parseBooleanArg(args.enableExceptions, true);

    await this.consoleMonitor.enable({
      enableNetwork: true,
      enableExceptions,
    });

    const status = this.consoleMonitor.getNetworkStatus();

    const result = {
      success: true,
      message: ' Network monitoring enabled successfully',
      enabled: status.enabled,
      cdpSessionActive: status.cdpSessionActive,
      listenerCount: status.listenerCount,
      usage: {
        step1: 'Network monitoring is now active',
        step2: 'Navigate to a page using page_navigate tool',
        step3: 'Use network_get_requests to retrieve captured requests',
        step4: 'Use network_get_response_body to get response content',
      },
      important: 'Network monitoring must be enabled BEFORE navigating to capture requests',
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async handleNetworkDisable(_args: Record<string, unknown>) {
    await this.consoleMonitor.disable();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Network monitoring disabled',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleNetworkGetStatus(_args: Record<string, unknown>) {
    const status = this.consoleMonitor.getNetworkStatus();

    type NetworkStatusResult =
      | {
          success: false;
          enabled: false;
          message: string;
          requestCount: number;
          responseCount: number;
          nextSteps: {
            step1: string;
            step2: string;
            step3: string;
          };
          example: string;
        }
      | {
          success: true;
          enabled: true;
          message: string;
          requestCount: number;
          responseCount: number;
          listenerCount: number;
          cdpSessionActive: boolean;
          nextSteps:
            | {
                hint: string;
                action: string;
              }
            | {
                hint: string;
                action: string;
              };
        };

    let result: NetworkStatusResult;

    if (!status.enabled) {
      result = {
        success: false,
        enabled: false,
        message: ' Network monitoring is NOT enabled',
        requestCount: 0,
        responseCount: 0,
        nextSteps: {
          step1: 'Call network_enable tool to start monitoring',
          step2: 'Then navigate to a page using page_navigate',
          step3: 'Finally use network_get_requests to see captured requests',
        },
        example: 'network_enable -> page_navigate -> network_get_requests',
      };
    } else {
      result = {
        success: true,
        enabled: true,
        message: ` Network monitoring is active. Captured ${status.requestCount} requests and ${status.responseCount} responses.`,
        requestCount: status.requestCount,
        responseCount: status.responseCount,
        listenerCount: status.listenerCount,
        cdpSessionActive: status.cdpSessionActive,
        nextSteps:
          status.requestCount === 0
            ? {
                hint: 'No requests captured yet',
                action: 'Navigate to a page using page_navigate to capture network traffic',
              }
            : {
                hint: `${status.requestCount} requests captured`,
                action: 'Use network_get_requests to retrieve them',
              },
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  // ========================================================================
  // Handler methods from handlers.impl.core.runtime.requests.ts
  // ========================================================================

  async handleNetworkGetRequests(args: Record<string, unknown>) {
    let result: Record<string, unknown>;
    const autoEnable = this.parseBooleanArg(args.autoEnable, true);
    const enableExceptions = this.parseBooleanArg(args.enableExceptions, true);
    const networkState = await this.ensureNetworkEnabled({
      autoEnable,
      enableExceptions,
    });

    if (!networkState.enabled) {
      if (autoEnable && networkState.error) {
        result = {
          success: false,
          message: 'Failed to auto-enable network monitoring',
          detail: networkState.error,
          solution: {
            step1: 'Ensure browser page is active and reachable',
            step2: 'Call network_enable manually',
            step3: 'Navigate to target page: page_navigate(url)',
            step4: 'Get requests: network_get_requests',
          },
        };
      } else {
        result = {
          success: false,
          message: ' Network monitoring is not enabled',
          requests: [],
          total: 0,
          solution: {
            step1: 'Enable network monitoring: network_enable',
            step2: 'Navigate to target page: page_navigate(url)',
            step3: 'Get requests: network_get_requests',
          },
          tip: 'Set autoEnable=true to auto-enable monitoring in this call',
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    const url = asOptionalString(args.url);
    const urlRegex = asOptionalString(args.urlRegex);
    const method = asOptionalString(args.method);
    const sinceTimestamp = isFiniteNumber(args.sinceTimestamp) ? args.sinceTimestamp : undefined;
    const sinceRequestId = asOptionalString(args.sinceRequestId);
    const tail = isFiniteNumber(args.tail) && args.tail > 0 ? Math.floor(args.tail) : undefined;
    const limit = this.parseNumberArg(args.limit, {
      defaultValue: 100,
      min: 1,
      max: 1000,
      integer: true,
    });
    const offset = this.parseNumberArg(args.offset, {
      defaultValue: 0,
      min: 0,
      integer: true,
    });

    let requests = this.consoleMonitor
      .getNetworkRequests()
      .filter((req: unknown): req is NetworkRequestPayload => isNetworkRequestPayload(req));

    if (requests.length === 0) {
      result = {
        success: true,
        message: 'No network requests captured yet',
        requests: [],
        total: 0,
        hint: 'Network monitoring is enabled, but no requests have been captured',
        possibleReasons: [
          "1. You haven't navigated to any page yet (use page_navigate)",
          '2. The page has already loaded before network monitoring was enabled',
          "3. The page doesn't make any network requests",
          '4. The page uses frontend-wrapped fetch/XHR not captured by CDP',
        ],
        recommended_actions: [
          'console_inject_fetch_interceptor() — capture frontend-wrapped fetch calls (SPAs, React, Vue)',
          'console_inject_xhr_interceptor() — capture XMLHttpRequest calls',
          'page_navigate(url, enableNetworkMonitoring=true) — re-navigate with monitoring enabled',
        ],
        nextAction:
          'Call console_inject_fetch_interceptor(), then re-navigate or trigger the target action',
        monitoring: {
          autoEnabled: networkState.autoEnabled,
        },
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    const originalCount = requests.length;
    const allUrls = requests.map((r) => r.url);

    // sinceRequestId filter: skip all requests up to and including the given requestId
    if (sinceRequestId) {
      const idx = requests.findIndex((r) => r.requestId === sinceRequestId);
      if (idx >= 0) {
        requests = requests.slice(idx + 1);
      }
    }

    // sinceTimestamp filter
    if (sinceTimestamp !== undefined) {
      requests = requests.filter((r) => (r.timestamp ?? 0) > sinceTimestamp);
    }

    // URL filter: regex takes precedence over substring
    if (urlRegex) {
      if (urlRegex.length > 500) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: 'urlRegex too long (max 500 characters)',
                },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const re = new RegExp(urlRegex, 'i');
        requests = requests.filter((req) => re.test(req.url));
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: `Invalid urlRegex pattern: ${urlRegex}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    } else if (url) {
      const urlLower = url.toLowerCase();
      requests = requests.filter((req) => req.url.toLowerCase().includes(urlLower));
    }
    if (method && method.toUpperCase() !== 'ALL') {
      requests = requests.filter((req) => req.method.toUpperCase() === method.toUpperCase());
    }

    // tail filter: return only the last N results after all other filters
    if (tail !== undefined && requests.length > tail) {
      requests = requests.slice(-tail);
    }

    const beforeLimit = requests.length;
    requests = requests.slice(offset, offset + limit);
    const hasMore = offset + requests.length < beforeLimit;

    const filterMiss =
      beforeLimit === 0 &&
      originalCount > 0 &&
      !!(url || (method && method.toUpperCase() !== 'ALL'));
    const urlSamples = filterMiss
      ? allUrls.slice(0, 10).map((u) => u.substring(0, 120))
      : undefined;

    result = {
      success: true,
      message: ` Retrieved ${requests.length} network request(s)`,
      requests,
      total: requests.length,
      page: {
        offset,
        limit,
        returned: requests.length,
        totalAfterFilter: beforeLimit,
        hasMore,
        nextOffset: hasMore ? offset + requests.length : null,
      },
      stats: {
        totalCaptured: originalCount,
        afterFilter: beforeLimit,
        returned: requests.length,
        truncated: beforeLimit > offset + limit,
      },
      filtered: !!(
        url ||
        urlRegex ||
        (method && method.toUpperCase() !== 'ALL') ||
        sinceTimestamp ||
        sinceRequestId ||
        tail
      ),
      filters: { url, urlRegex, method, sinceTimestamp, sinceRequestId, tail, limit, offset },
      monitoring: {
        autoEnabled: networkState.autoEnabled,
      },
      ...(filterMiss && {
        filterMiss: true,
        hint: `URL filter "${url}" matched 0 of ${originalCount} captured requests. Check urlSamples to verify the correct filter substring.`,
        urlSamples,
      }),
      tip:
        requests.length > 0
          ? 'Use network_get_response_body(requestId) to get response content'
          : undefined,
    };

    const processedResult = this.detailedDataManager.smartHandle(result, 51200);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(processedResult, null, 2),
        },
      ],
    };
  }

  async handleNetworkGetResponseBody(args: Record<string, unknown>) {
    const requestId = asOptionalString(args.requestId) || '';
    const maxSize = this.parseNumberArg(args.maxSize, {
      defaultValue: 100000,
      min: 1024,
      max: 20 * 1024 * 1024,
      integer: true,
    });
    const returnSummary = this.parseBooleanArg(args.returnSummary, false);
    const retries = this.parseNumberArg(args.retries, {
      defaultValue: 3,
      min: 0,
      max: 10,
      integer: true,
    });
    const retryIntervalMs = this.parseNumberArg(args.retryIntervalMs, {
      defaultValue: 500,
      min: 50,
      max: 5000,
      integer: true,
    });
    const autoEnable = this.parseBooleanArg(args.autoEnable, false);
    const enableExceptions = this.parseBooleanArg(args.enableExceptions, true);
    let result: Record<string, unknown>;

    if (!requestId) {
      result = {
        success: false,
        message: 'requestId parameter is required',
        hint: 'Get requestId from network_get_requests tool',
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    const networkState = await this.ensureNetworkEnabled({
      autoEnable,
      enableExceptions,
    });

    if (!networkState.enabled) {
      result = {
        success: false,
        message: 'Network monitoring is not enabled',
        hint: autoEnable
          ? 'Auto-enable failed. Check active page and call network_enable manually.'
          : 'Use network_enable tool first, or set autoEnable=true',
        detail: networkState.error,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    let body: { body: string; base64Encoded: boolean } | null = null;
    let attemptsMade = 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      attemptsMade = attempt + 1;
      body = await this.consoleMonitor.getResponseBody(requestId);
      if (body) {
        break;
      }
      if (attempt < retries) {
        await this.sleep(retryIntervalMs);
      }
    }

    if (!body) {
      result = {
        success: false,
        message: `No response body found for requestId: ${requestId}`,
        hint: 'The request may not have completed yet, or the requestId is invalid',
        attempts: attemptsMade,
        waitedMs: retries * retryIntervalMs,
        retryConfig: {
          retries,
          retryIntervalMs,
        },
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    const originalSize = body.body.length;
    const isTooLarge = originalSize > maxSize;

    if (returnSummary || isTooLarge) {
      const preview = body.body.substring(0, 500);

      result = {
        success: true,
        requestId,
        attempts: attemptsMade,
        summary: {
          size: originalSize,
          sizeKB: (originalSize / 1024).toFixed(2),
          base64Encoded: body.base64Encoded,
          preview: preview + (originalSize > 500 ? '...' : ''),
          truncated: isTooLarge,
          reason: isTooLarge
            ? `Response too large (${(originalSize / 1024).toFixed(2)} KB > ${(maxSize / 1024).toFixed(2)} KB)`
            : 'Summary mode enabled',
        },
        tip: isTooLarge
          ? 'Use collect_code tool to collect and compress this script, or increase maxSize parameter'
          : 'Set returnSummary=false to get full body',
      };
    } else {
      result = {
        success: true,
        requestId,
        attempts: attemptsMade,
        body: body.body,
        base64Encoded: body.base64Encoded,
        size: originalSize,
        sizeKB: (originalSize / 1024).toFixed(2),
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async handleNetworkGetStats(_args: Record<string, unknown>) {
    if (!this.consoleMonitor.isNetworkEnabled()) {
      const result = {
        success: false,
        message: 'Network monitoring is not enabled',
        hint: 'Use network_enable tool first',
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    const requests = this.consoleMonitor
      .getNetworkRequests()
      .filter((req: unknown): req is NetworkRequestPayload => isNetworkRequestPayload(req));
    const responses = this.consoleMonitor
      .getNetworkResponses()
      .filter((res: unknown): res is NetworkResponsePayload => isNetworkResponsePayload(res));

    const byMethod: Record<string, number> = {};
    requests.forEach((req) => {
      byMethod[req.method] = (byMethod[req.method] || 0) + 1;
    });

    const byStatus: Record<number, number> = {};
    responses.forEach((res) => {
      byStatus[res.status] = (byStatus[res.status] || 0) + 1;
    });

    const byType: Record<string, number> = {};
    requests.forEach((req) => {
      const type = req.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    });

    const timestamps = requests
      .map((r) => r.timestamp)
      .filter((t): t is number => isFiniteNumber(t));
    const timeStats =
      timestamps.length > 0
        ? {
            earliest: Math.min(...timestamps),
            latest: Math.max(...timestamps),
            duration: Math.max(...timestamps) - Math.min(...timestamps),
          }
        : null;

    const result = {
      success: true,
      stats: {
        totalRequests: requests.length,
        totalResponses: responses.length,
        byMethod,
        byStatus,
        byType,
        timeStats,
        monitoringEnabled: true,
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  // ========================================================================
  // Handler methods from handlers.impl.core.runtime.performance.ts
  // ========================================================================

  async handlePerformanceGetMetrics(args: Record<string, unknown>) {
    const includeTimeline = args.includeTimeline === true;
    const monitor = this.getPerformanceMonitor();

    const metrics = await monitor.getPerformanceMetrics();

    const result: Record<string, unknown> = {
      success: true,
      metrics,
    };

    if (includeTimeline) {
      result.timeline = await monitor.getPerformanceTimeline();
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async handlePerformanceStartCoverage(_args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    await monitor.startCoverage();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Code coverage collection started',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePerformanceStopCoverage(_args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const coverage = await monitor.stopCoverage();
    const avgCoverage =
      coverage.length > 0
        ? coverage.reduce((sum, info) => sum + info.coveragePercentage, 0) / coverage.length
        : 0;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              coverage,
              totalScripts: coverage.length,
              avgCoverage,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePerformanceTakeHeapSnapshot(_args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const snapshot = await monitor.takeHeapSnapshot();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              snapshotSize: snapshot.length,
              message: 'Heap snapshot taken (data too large to return, saved internally)',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePerformanceTraceStart(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const categories = asOptionalStringArray(args.categories);
    const screenshots = asOptionalBoolean(args.screenshots);

    await monitor.startTracing({ categories, screenshots });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Performance tracing started. Call performance_trace_stop to save the trace.',
          }),
        },
      ],
    };
  }

  async handlePerformanceTraceStop(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const artifactPath = asOptionalString(args.artifactPath);

    const result = await monitor.stopTracing({ artifactPath });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: result.artifactPath,
              eventCount: result.eventCount,
              sizeBytes: result.sizeBytes,
              sizeKB: (result.sizeBytes / 1024).toFixed(1),
              hint: 'Open the trace file in Chrome DevTools → Performance tab → Load profile',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleProfilerCpuStart(_args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    await monitor.startCPUProfiling();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'CPU profiling started. Call profiler_cpu_stop to save the profile.',
          }),
        },
      ],
    };
  }

  async handleProfilerCpuStop(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const profileRaw = await monitor.stopCPUProfiling();
    const profile = toCpuProfilePayload(profileRaw) || (profileRaw as CpuProfilePayload);

    const { writeFile } = await import('node:fs/promises');
    const { resolveArtifactPath } = await import('@utils/artifacts');
    const artifactPath = asOptionalString(args.artifactPath);

    const profileJson = JSON.stringify(profile, null, 2);
    let savedPath: string;

    if (artifactPath) {
      await writeFile(artifactPath, profileJson, 'utf-8');
      savedPath = artifactPath;
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'profiles',
        toolName: 'cpu-profile',
        ext: 'cpuprofile',
      });
      await writeFile(absolutePath, profileJson, 'utf-8');
      savedPath = displayPath;
    }

    const hotFunctions = profile.nodes
      .filter((n) => (n.hitCount || 0) > 0)
      .sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
      .slice(0, 20)
      .map((n) => ({
        functionName: n.callFrame?.functionName || '(anonymous)',
        url: n.callFrame?.url,
        line: n.callFrame?.lineNumber,
        hitCount: n.hitCount,
      }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: savedPath,
              totalNodes: profile.nodes.length,
              totalSamples: profile.samples?.length || 0,
              durationMs: profile.endTime - profile.startTime,
              hotFunctions,
              hint: 'Open the .cpuprofile file in Chrome DevTools → Performance tab',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleProfilerHeapSamplingStart(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const samplingInterval = asOptionalNumber(args.samplingInterval);

    await monitor.startHeapSampling({ samplingInterval });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: 'Heap sampling started. Call profiler_heap_sampling_stop to save the report.',
          }),
        },
      ],
    };
  }

  async handleProfilerHeapSamplingStop(args: Record<string, unknown>) {
    const monitor = this.getPerformanceMonitor();
    const artifactPath = asOptionalString(args.artifactPath);
    const topN = asOptionalNumber(args.topN);

    const result = await monitor.stopHeapSampling({ artifactPath, topN });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              artifactPath: result.artifactPath,
              sampleCount: result.sampleCount,
              topAllocations: result.topAllocations,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // ========================================================================
  // Handler methods from handlers.impl.core.runtime.console.ts
  // ========================================================================

  async handleConsoleGetExceptions(args: Record<string, unknown>) {
    const url = asOptionalString(args.url);
    const limit = this.parseNumberArg(args.limit, {
      defaultValue: 50,
      min: 1,
      max: 1000,
      integer: true,
    });

    let exceptions = this.consoleMonitor.getExceptions();

    if (url) {
      exceptions = exceptions.filter((ex) => ex.url?.includes(url));
    }

    exceptions = exceptions.slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              exceptions,
              total: exceptions.length,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleInjectScriptMonitor(args: Record<string, unknown>) {
    const persistent = argBool(args, 'persistent', false);
    await this.consoleMonitor.enableDynamicScriptMonitoring({ persistent });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: persistent
                ? 'Dynamic script monitoring enabled (persistent — survives navigations)'
                : 'Dynamic script monitoring enabled',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleInjectXhrInterceptor(args: Record<string, unknown>) {
    const persistent = argBool(args, 'persistent', false);
    await this.consoleMonitor.injectXHRInterceptor({ persistent });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: persistent
                ? 'XHR interceptor injected (persistent)'
                : 'XHR interceptor injected',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleInjectFetchInterceptor(args: Record<string, unknown>) {
    const persistent = argBool(args, 'persistent', false);
    await this.consoleMonitor.injectFetchInterceptor({ persistent });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: persistent
                ? 'Fetch interceptor injected (persistent)'
                : 'Fetch interceptor injected',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleClearInjectedBuffers(_args: Record<string, unknown>) {
    const result = await this.consoleMonitor.clearInjectedBuffers();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Injected buffers cleared',
              ...result,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleResetInjectedInterceptors(_args: Record<string, unknown>) {
    const result = await this.consoleMonitor.resetInjectedInterceptors();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Injected interceptors/monitors reset',
              ...result,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleConsoleInjectFunctionTracer(args: Record<string, unknown>) {
    const functionName = asOptionalString(args.functionName) || '';

    if (!functionName) {
      throw new Error('functionName is required');
    }

    const persistent = argBool(args, 'persistent', false);
    await this.consoleMonitor.injectFunctionTracer(functionName, { persistent });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: persistent
                ? `Function tracer injected for: ${functionName} (persistent — survives navigations)`
                : `Function tracer injected for: ${functionName}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async cleanup() {
    if (this.performanceMonitor) {
      await this.performanceMonitor.close();
      this.performanceMonitor = null;
    }
    logger.info('AdvancedHandlersBase cleaned up');
  }
}
