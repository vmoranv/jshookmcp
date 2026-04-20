/**
 * Core network handlers — enable/disable/status/requests/response/stats.
 *
 * Extracted from NetworkHandlersCore (handlers.base.core.ts).
 */

import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import {
  EXCLUDED_RESOURCE_TYPES,
  TYPE_SORT_PRIORITY,
  DEFAULT_SORT_PRIORITY,
  isNetworkRequestPayload,
  isNetworkResponsePayload,
  isFiniteNumber,
  asOptionalString,
  type NetworkRequestPayload,
} from '../handlers.base.types';
import type { NetworkHandlerDeps } from './shared';
import { getDetailedDataManager, parseBooleanArg, parseNumberArg } from './shared';

export class CoreHandlers {
  private detailedDataManager = getDetailedDataManager();

  constructor(private deps: NetworkHandlerDeps) {}

  // ── Network enable/disable/status ──

  async handleNetworkMonitor(args: Record<string, unknown>): Promise<ToolResponse> {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'enable':
        return this.handleNetworkEnable(args);
      case 'disable':
        return this.handleNetworkDisable(args);
      case 'status':
        return this.handleNetworkGetStatus(args);
      default:
        return R.fail(
          `Invalid generic action parameter: ${action}. Expected enable, disable, status.`,
        ).json();
    }
  }

  async handleNetworkEnable(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const enableExceptions = parseBooleanArg(args.enableExceptions, true);

      await this.deps.consoleMonitor.enable({
        enableNetwork: true,
        enableExceptions,
      });

      const status = this.deps.consoleMonitor.getNetworkStatus();

      return R.ok()
        .merge({
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
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleNetworkDisable(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      await this.deps.consoleMonitor.disable();
      return R.ok().set('message', 'Network monitoring disabled').json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleNetworkGetStatus(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const status = this.deps.consoleMonitor.getNetworkStatus();

      if (!status.enabled) {
        return R.fail(' Network monitoring is NOT enabled')
          .merge({
            enabled: false,
            nextSteps: {
              step1: 'Call network_enable tool to start monitoring',
              step2: 'Then navigate to a page using page_navigate',
              step3: 'Finally use network_get_requests to see captured requests',
            },
            example: 'network_enable -> page_navigate -> network_get_requests',
          })
          .json();
      }

      return R.ok()
        .merge({
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
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  // ── Network requests ──

  async handleNetworkGetRequests(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const autoEnable = parseBooleanArg(args.autoEnable, true);
      const enableExceptions = parseBooleanArg(args.enableExceptions, true);
      const networkState = await this.ensureNetworkEnabled({
        autoEnable,
        enableExceptions,
      });

      if (!networkState.enabled) {
        return this.buildNotEnabledResponse(autoEnable, networkState.error);
      }

      const url = asOptionalString(args.url);
      const urlRegex = asOptionalString(args.urlRegex);
      const method = asOptionalString(args.method);
      const sinceTimestamp = isFiniteNumber(args.sinceTimestamp) ? args.sinceTimestamp : undefined;
      const sinceRequestId = asOptionalString(args.sinceRequestId);
      const tail = isFiniteNumber(args.tail) && args.tail > 0 ? Math.floor(args.tail) : undefined;
      const limit = parseNumberArg(args.limit, {
        defaultValue: 100,
        min: 1,
        max: 1000,
        integer: true,
      });
      const offset = parseNumberArg(args.offset, {
        defaultValue: 0,
        min: 0,
        integer: true,
      });

      const requests = this.deps.consoleMonitor
        .getNetworkRequests()
        .filter((req: unknown): req is NetworkRequestPayload => isNetworkRequestPayload(req))
        .map((r) => r as unknown as NetworkRequestPayload);

      if (requests.length === 0) {
        return this.buildEmptyRequestsResponse(networkState.autoEnabled);
      }

      const result = this.applyRequestFilters(requests as NetworkRequestPayload[], {
        url,
        urlRegex,
        method,
        sinceTimestamp,
        sinceRequestId,
        tail,
        limit,
        offset,
      });

      const processedResult = this.detailedDataManager.smartHandle(result.finalPayload, 25600);
      return R.ok()
        .merge(processedResult as Record<string, unknown>)
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleNetworkGetResponseBody(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const requestId = asOptionalString(args.requestId) || '';
      const maxSize = parseNumberArg(args.maxSize, {
        defaultValue: 100000,
        min: 1024,
        max: 20 * 1024 * 1024,
        integer: true,
      });
      const returnSummary = parseBooleanArg(args.returnSummary, false);
      const retries = parseNumberArg(args.retries, {
        defaultValue: 3,
        min: 0,
        max: 10,
        integer: true,
      });
      const retryIntervalMs = parseNumberArg(args.retryIntervalMs, {
        defaultValue: 500,
        min: 50,
        max: 5000,
        integer: true,
      });
      const autoEnable = parseBooleanArg(args.autoEnable, false);
      const enableExceptions = parseBooleanArg(args.enableExceptions, true);

      if (!requestId) {
        return R.fail('requestId parameter is required')
          .set('hint', 'Get requestId from network_get_requests tool')
          .json();
      }

      const networkState = await this.ensureNetworkEnabled({
        autoEnable,
        enableExceptions,
      });

      if (!networkState.enabled) {
        return R.fail('Network monitoring is not enabled')
          .merge({
            hint: autoEnable
              ? 'Auto-enable failed. Check active page and call network_enable manually.'
              : 'Use network_enable tool first, or set autoEnable=true',
            detail: networkState.error,
          })
          .json();
      }

      let body: { body: string; base64Encoded: boolean } | null = null;
      let attemptsMade = 0;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        attemptsMade = attempt + 1;
        body = await this.deps.consoleMonitor.getResponseBody(requestId);
        if (body) {
          break;
        }
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
        }
      }

      if (!body) {
        return R.fail(`No response body found for requestId: ${requestId}`)
          .merge({
            hint: 'The request may not have completed yet, or the requestId is invalid',
            attempts: attemptsMade,
            waitedMs: retries * retryIntervalMs,
            retryConfig: { retries, retryIntervalMs },
          })
          .json();
      }

      return this.buildResponseBodyResult(requestId, body, attemptsMade, maxSize, returnSummary);
    } catch (error) {
      return R.fail(error).json();
    }
  }

  async handleNetworkGetStats(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      if (!this.deps.consoleMonitor.isNetworkEnabled()) {
        return R.fail('Network monitoring is not enabled')
          .set('hint', 'Use network_enable tool first')
          .json();
      }

      const requests = this.deps.consoleMonitor
        .getNetworkRequests()
        .filter((req: unknown): req is NetworkRequestPayload => isNetworkRequestPayload(req));
      const responses = this.deps.consoleMonitor
        .getNetworkResponses()
        .filter(isNetworkResponsePayload);

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

      return R.ok()
        .set('stats', {
          totalRequests: requests.length,
          totalResponses: responses.length,
          byMethod,
          byStatus,
          byType,
          timeStats,
          monitoringEnabled: true,
        })
        .json();
    } catch (error) {
      return R.fail(error).json();
    }
  }

  // ── Private Helpers ──

  private async ensureNetworkEnabled(options: {
    autoEnable: boolean;
    enableExceptions: boolean;
  }): Promise<{ enabled: boolean; autoEnabled: boolean; error?: string }> {
    if (this.deps.consoleMonitor.isNetworkEnabled()) {
      return { enabled: true, autoEnabled: false };
    }

    if (!options.autoEnable) {
      return { enabled: false, autoEnabled: false };
    }

    try {
      await this.deps.consoleMonitor.enable({
        enableNetwork: true,
        enableExceptions: options.enableExceptions,
      });
      return {
        enabled: this.deps.consoleMonitor.isNetworkEnabled(),
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

  private buildNotEnabledResponse(autoEnable: boolean, error?: string): ToolResponse {
    if (autoEnable && error) {
      return R.fail('Failed to auto-enable network monitoring')
        .merge({
          detail: error,
          solution: {
            step1: 'Ensure browser page is active and reachable',
            step2: 'Call network_enable manually',
            step3: 'Navigate to target page: page_navigate(url)',
            step4: 'Get requests: network_get_requests',
          },
        })
        .json();
    }

    return R.fail(' Network monitoring is not enabled')
      .merge({
        requests: [],
        total: 0,
        solution: {
          step1: 'Enable network monitoring: network_enable',
          step2: 'Navigate to target page: page_navigate(url)',
          step3: 'Get requests: network_get_requests',
        },
        tip: 'Set autoEnable=true to auto-enable monitoring in this call',
      })
      .json();
  }

  private buildEmptyRequestsResponse(autoEnabled: boolean): ToolResponse {
    return R.ok()
      .merge({
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
        monitoring: { autoEnabled },
      })
      .json();
  }

  private applyRequestFilters(
    requests: NetworkRequestPayload[],
    filters: {
      url?: string;
      urlRegex?: string;
      method?: string;
      sinceTimestamp?: number;
      sinceRequestId?: string;
      tail?: number;
      limit: number;
      offset: number;
    },
  ) {
    const { url, urlRegex, method, sinceTimestamp, sinceRequestId, tail, limit, offset } = filters;
    const originalCount = requests.length;
    const allUrls = requests.map((r) => r.url);

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

    // sinceRequestId filter
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
        throw new Error('urlRegex too long (max 500 characters)');
      }
      const re = new RegExp(urlRegex, 'i');
      if (requests.length > 0) {
        const start = performance.now();
        re.test(requests[0]!.url);
        const elapsed = performance.now() - start;
        if (elapsed > 100) {
          throw new Error(
            `urlRegex pattern is too expensive (${elapsed.toFixed(0)}ms on first URL). Use a simpler pattern.`,
          );
        }
      }
      requests = requests.filter((req) => re.test(req.url));
    } else if (url) {
      const urlLower = url.toLowerCase();
      requests = requests.filter((req) => req.url.toLowerCase().includes(urlLower));
    }
    if (method && method.toUpperCase() !== 'ALL') {
      requests = requests.filter((req) => req.method.toUpperCase() === method.toUpperCase());
    }

    // tail filter
    if (tail !== undefined && requests.length > tail) {
      requests = requests.slice(-tail);
    }

    // Smart sort
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

    return {
      finalPayload: {
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
        filtered: hasAnyFilter,
        filters: { url, urlRegex, method, sinceTimestamp, sinceRequestId, tail, limit, offset },
        monitoring: {},
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
      },
    };
  }

  private buildResponseBodyResult(
    requestId: string,
    body: { body: string; base64Encoded: boolean },
    attemptsMade: number,
    maxSize: number,
    returnSummary: boolean,
  ): ToolResponse {
    const originalSize = body.body.length;
    const isTooLarge = originalSize > maxSize;

    if (returnSummary || isTooLarge) {
      const preview = body.body.substring(0, 500);

      return R.ok()
        .merge({
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
        })
        .json();
    }

    return R.ok()
      .merge({
        requestId,
        attempts: attemptsMade,
        body: body.body,
        base64Encoded: body.base64Encoded,
        size: originalSize,
        sizeKB: (originalSize / 1024).toFixed(2),
      })
      .json();
  }
}
