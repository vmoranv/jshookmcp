/**
 * Network Handlers Core — base class with shared utilities and network-specific handlers.
 *
 * Covers: construction, utility methods, network enable/disable/status,
 * request listing & filtering, response body retrieval, and network stats.
 */

import { logger } from '@utils/logger';
import type { CodeCollector } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import { PerformanceMonitor } from '@server/domains/shared/modules';
import {
  EXCLUDED_RESOURCE_TYPES,
  TYPE_SORT_PRIORITY,
  DEFAULT_SORT_PRIORITY,
  getDetailedDataManager,
  isNetworkRequestPayload,
  isNetworkResponsePayload,
  isFiniteNumber,
  asOptionalString,
  type NetworkRequestPayload,
} from './handlers.base.types';

export class NetworkHandlersCore {
  protected performanceMonitor: PerformanceMonitor | null = null;
  protected detailedDataManager = getDetailedDataManager();

  constructor(
    protected collector: CodeCollector,
    protected consoleMonitor: ConsoleMonitor,
  ) {}

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
    options: { defaultValue: number; min?: number; max?: number; integer?: boolean },
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

  // ── Network enable/disable/status ──

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
            2,
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

  // ── Network requests ──

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

    // Determine if any explicit filter is set
    const hasAnyFilter = !!(
      url ||
      urlRegex ||
      (method && method.toUpperCase() !== 'ALL') ||
      sinceTimestamp ||
      sinceRequestId ||
      tail
    );

    // Default type filtering: exclude static resources when no explicit filters are set
    let excludedStaticCount = 0;
    if (!hasAnyFilter) {
      const beforeTypeFilter = requests.length;
      requests = requests.filter((r) => !r.type || !EXCLUDED_RESOURCE_TYPES.has(r.type));
      excludedStaticCount = beforeTypeFilter - requests.length;
    }

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
                2,
              ),
            },
          ],
        };
      }
      try {
        const re = new RegExp(urlRegex, 'i');
        // SECURITY: Guard against ReDoS by testing with a time limit.
        // If the first URL takes >100ms, the pattern is catastrophically backtracking.
        if (requests.length > 0) {
          const start = performance.now();
          re.test(requests[0]!.url);
          const elapsed = performance.now() - start;
          if (elapsed > 100) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      success: false,
                      error: `urlRegex pattern is too expensive (${elapsed.toFixed(0)}ms on first URL). Use a simpler pattern.`,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
        }
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
                2,
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

    // Smart sort: prioritize XHR/Fetch/Document over Script/Other
    requests.sort(
      (a, b) =>
        (TYPE_SORT_PRIORITY[a.type ?? ''] ?? DEFAULT_SORT_PRIORITY) -
        (TYPE_SORT_PRIORITY[b.type ?? ''] ?? DEFAULT_SORT_PRIORITY),
    );

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
      ...(excludedStaticCount > 0 && {
        staticResourcesExcluded: excludedStaticCount,
        staticFilterNote: `${excludedStaticCount} static resources (Image/Font/Stylesheet/Media) excluded by default. Set any filter to include all types.`,
      }),
      ...(originalCount > 100 &&
        !hasAnyFilter && {
          optimizationHint: `${originalCount} requests captured. Use url/method filters to reduce payload size.`,
        }),
    };

    const processedResult = this.detailedDataManager.smartHandle(result, 25600);

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
    const responses = this.consoleMonitor.getNetworkResponses().filter(isNetworkResponsePayload);

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

  async cleanup() {
    if (this.performanceMonitor) {
      await this.performanceMonitor.close();
      this.performanceMonitor = null;
    }
    logger.info('AdvancedHandlersBase cleaned up');
  }
}
