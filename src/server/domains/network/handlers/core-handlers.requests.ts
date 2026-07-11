import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import {
  EXCLUDED_RESOURCE_TYPES,
  TYPE_SORT_PRIORITY,
  DEFAULT_SORT_PRIORITY,
  isFiniteNumber,
  asOptionalString,
  type NetworkRequestPayload,
} from '../handlers.base.types';
import { parseNumberArg, parseBooleanArg } from './shared';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_HEX_RE = /\/[0-9a-f]{16,}(?=[/?#]|$)/gi;
const NUMERIC_ID_RE = /\/\d{2,}(?=[/?#]|$)/g;

function normalizeUrlToPattern(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    let path = url.pathname;
    path = path.replace(UUID_RE, '{id}');
    path = path.replace(LONG_HEX_RE, '/{id}');
    path = path.replace(NUMERIC_ID_RE, '/{id}');
    return `${url.origin}${path}`;
  } catch {
    return rawUrl;
  }
}

/**
 * Extract the HTTP response status from a captured request payload. The merged
 * payload carries the CDP/Playwright NetworkRequest shape (response.status) via
 * its index signature; some captures also surface status at the top level.
 * Returns undefined when no response status was captured (request in flight or
 * blocked before headers arrived) — callers filtering by status exclude these.
 */
function getRequestStatus(req: NetworkRequestPayload): number | undefined {
  const response = req.response;
  if (response !== null && typeof response === 'object') {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === 'number') return status;
  }
  if (typeof req.status === 'number') return req.status;
  return undefined;
}

/**
 * Match a captured status against a statusCode filter expression.
 * - Exact: "404" → status === 404
 * - Class: "4xx" / "5xx" / "2xx" → status in [N00, N00+100)
 * Unparseable filters match nothing; undefined status never matches.
 */
function matchesStatusCode(status: number | undefined, filter: string): boolean {
  if (status === undefined) return false;
  const trimmed = filter.trim();
  const classMatch = /^(\d)xx$/i.exec(trimmed);
  if (classMatch) {
    const hundred = Number.parseInt(classMatch[1]!, 10) * 100;
    return status >= hundred && status < hundred + 100;
  }
  const exact = Number.parseInt(trimmed, 10);
  if (Number.isNaN(exact)) return false;
  return status === exact;
}

export function applyRequestFilters(
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
    autoEnabled: boolean;
    fields?: string[];
    statusCode?: string;
    deduplicateUrls?: boolean;
  },
) {
  const {
    url,
    urlRegex,
    method,
    sinceTimestamp,
    sinceRequestId,
    tail,
    limit,
    offset,
    autoEnabled,
    fields,
    statusCode,
    deduplicateUrls,
  } = filters;
  const originalCount = requests.length;
  const allUrls = requests.map((r) => r.url);

  const hasAnyFilter = !!(
    url ||
    urlRegex ||
    (method && method.toUpperCase() !== 'ALL') ||
    sinceTimestamp ||
    sinceRequestId ||
    tail ||
    statusCode
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

  // statusCode filter: exact ("404") or class ("4xx"/"5xx"). Requests without a
  // captured response status are excluded when this filter is set.
  if (statusCode) {
    requests = requests.filter((req) => matchesStatusCode(getRequestStatus(req), statusCode));
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
    beforeLimit === 0 && originalCount > 0 && !!(url || (method && method.toUpperCase() !== 'ALL'));
  const urlSamples = filterMiss ? allUrls.slice(0, 10).map((u) => u.substring(0, 120)) : undefined;

  // URL deduplication: normalize URLs to endpoint patterns
  if (deduplicateUrls) {
    const patternMap = new Map<
      string,
      { pattern: string; method: string; count: number; example: string }
    >();
    for (const req of requests) {
      const pattern = normalizeUrlToPattern(req.url);
      const key = `${req.method.toUpperCase()} ${pattern}`;
      const existing = patternMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        patternMap.set(key, {
          pattern,
          method: req.method.toUpperCase(),
          count: 1,
          example: req.url,
        });
      }
    }
    const endpoints = [...patternMap.values()].toSorted((a, b) => b.count - a.count);
    return {
      finalPayload: {
        message: ` Deduplicated ${requests.length} requests into ${endpoints.length} unique endpoint(s)`,
        endpoints,
        totalRequests: requests.length,
        uniqueEndpoints: endpoints.length,
        stats: {
          totalCaptured: originalCount,
          afterFilter: beforeLimit,
        },
        filtered: hasAnyFilter,
        monitoring: { autoEnabled },
      },
    };
  }

  // Field filtering: strip unwanted fields per request
  const finalRequests = fields
    ? requests.map((r) => {
        const picked: Record<string, unknown> = {};
        for (const f of fields) {
          if (f in r) picked[f] = r[f];
        }
        return picked;
      })
    : requests;

  return {
    finalPayload: {
      message: ` Retrieved ${requests.length} network request(s)`,
      requests: finalRequests,
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
      filters: {
        url,
        urlRegex,
        method,
        statusCode,
        sinceTimestamp,
        sinceRequestId,
        tail,
        limit,
        offset,
      },
      monitoring: {
        autoEnabled,
      },
      ...(filterMiss && {
        filterMiss: true,
        hint:
          `URL filter "${url}" matched 0 of ${originalCount} captured requests. Check urlSamples to verify the ` +
          `correct filter substring.`,
        urlSamples,
      }),
      tip:
        requests.length > 0
          ? 'Use network_get_response_body(requestId) to get response content'
          : undefined,
      ...(excludedStaticCount > 0 && {
        staticResourcesExcluded: excludedStaticCount,
        staticFilterNote:
          `${excludedStaticCount} static resources (Image/Font/Stylesheet/Media) ` +
          `excluded by default. Set any filter ` +
          `to include all types.`,
      }),
      ...(originalCount > 100 &&
        !hasAnyFilter && {
          optimizationHint: `${originalCount} requests captured. Use url/method filters to reduce payload size.`,
        }),
    },
  };
}

export function buildEmptyRequestsResponse(autoEnabled: boolean): ToolResponse {
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

export async function handleNetworkGetRequests(
  getMergedRequests: () => Promise<NetworkRequestPayload[]>,
  ensureNetworkEnabled: (options: { autoEnable: boolean; enableExceptions: boolean }) => Promise<{
    enabled: boolean;
    autoEnabled: boolean;
    error?: string;
  }>,
  buildNotEnabledResponse: (autoEnable: boolean, error?: string) => ToolResponse,
  detailedDataManager: { smartHandle: (data: unknown, threshold: number) => unknown },
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    const autoEnable = parseBooleanArg(args.autoEnable, true);
    const enableExceptions = parseBooleanArg(args.enableExceptions, true);
    const networkState = await ensureNetworkEnabled({
      autoEnable,
      enableExceptions,
    });

    if (!networkState.enabled) {
      return buildNotEnabledResponse(autoEnable, networkState.error);
    }

    const url = asOptionalString(args.url);
    const urlRegex = asOptionalString(args.urlRegex);
    const method = asOptionalString(args.method);
    const sinceTimestamp = isFiniteNumber(args.sinceTimestamp) ? args.sinceTimestamp : undefined;
    const sinceRequestId = asOptionalString(args.sinceRequestId);
    const tail = isFiniteNumber(args.tail) && args.tail > 0 ? Math.floor(args.tail) : undefined;
    const statusCode = asOptionalString(args.statusCode);
    const deduplicateUrls = parseBooleanArg(args.deduplicateUrls, false);
    const rawFields = args.fields;
    const fields: string[] | undefined =
      Array.isArray(rawFields) && rawFields.length > 0
        ? rawFields.filter((f): f is string => typeof f === 'string')
        : undefined;
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

    const requests = await getMergedRequests();

    if (requests.length === 0) {
      return buildEmptyRequestsResponse(networkState.autoEnabled);
    }

    const result = applyRequestFilters(requests as NetworkRequestPayload[], {
      url,
      urlRegex,
      method,
      statusCode,
      sinceTimestamp,
      sinceRequestId,
      tail,
      limit,
      offset,
      autoEnabled: networkState.autoEnabled,
      fields,
      deduplicateUrls,
    });

    const processedResult = detailedDataManager.smartHandle(result.finalPayload, 25600);
    return R.ok()
      .merge(processedResult as Record<string, unknown>)
      .json();
  } catch (error) {
    return R.fail(error).json();
  }
}
