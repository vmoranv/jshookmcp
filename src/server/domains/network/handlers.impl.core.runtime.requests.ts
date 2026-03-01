import { AdvancedToolHandlersBase } from './handlers.impl.core.runtime.base.js';

interface NetworkRequestPayload {
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

export class AdvancedToolHandlersRequests extends AdvancedToolHandlersBase {
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
    const method = asOptionalString(args.method);
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
        nextAction: 'Call console_inject_fetch_interceptor(), then re-navigate or trigger the target action',
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

    if (url) {
      const urlLower = url.toLowerCase();
      requests = requests.filter((req) => req.url.toLowerCase().includes(urlLower));
    }
    if (method && method.toUpperCase() !== 'ALL') {
      requests = requests.filter((req) => req.method.toUpperCase() === method.toUpperCase());
    }

    const beforeLimit = requests.length;
    requests = requests.slice(offset, offset + limit);
    const hasMore = offset + requests.length < beforeLimit;

    const filterMiss =
      beforeLimit === 0 && originalCount > 0 && !!(url || (method && method.toUpperCase() !== 'ALL'));
    const urlSamples = filterMiss ? allUrls.slice(0, 10).map((u) => u.substring(0, 120)) : undefined;

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
      filtered: !!(url || (method && method.toUpperCase() !== 'ALL')),
      filters: { url, method, limit, offset },
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

    const timestamps = requests.map((r) => r.timestamp).filter((t): t is number => isFiniteNumber(t));
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
}
