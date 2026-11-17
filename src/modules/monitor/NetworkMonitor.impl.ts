import type { CDPSessionLike } from '@modules/browser/CDPSessionLike';
import { logger } from '@utils/logger';
import { ToolError } from '@errors/ToolError';

/**
 * Why a response body could not be read.
 *
 * Every one of these used to surface as the same `null` -> "No response body
 * found for requestId", which told the caller to retry something that could
 * never succeed. Production telemetry showed `network_get_response_body` at
 * 32% call-weighted failure on 24 installs, with a bimodal per-install shape
 * (0% or ~50%) that a generic message cannot explain.
 */
type NetworkBodyUnavailableReason =
  | 'request_evicted'
  | 'no_body_by_status'
  | 'from_cache'
  | 'body_expired';
import type {
  NetworkMonitorLike,
  NetworkRequest,
  NetworkResponse,
  NetworkStatus,
} from '@modules/monitor/NetworkMonitor.types';
import {
  buildFetchInterceptorCode,
  buildXHRInterceptorCode,
  CLEAR_INJECTED_BUFFERS_EXPRESSION,
  RESET_INJECTED_INTERCEPTORS_EXPRESSION,
} from '@modules/monitor/NetworkMonitor.interceptors';
import {
  NETWORK_BODY_CACHE_MAX_BODY_BYTES,
  NETWORK_BODY_CACHE_MAX_ENTRIES,
  NETWORK_BODY_CACHE_MAX_TOTAL_BYTES,
} from '@src/constants';

export type { NetworkRequest, NetworkResponse } from '@modules/monitor/NetworkMonitor.types';

type UnknownRecord = Record<string, unknown>;

interface CDPRequestWillBeSentPayload {
  requestId: string;
  frameId?: string;
  request: {
    url: string;
    method: string;
    headers?: UnknownRecord;
    postData?: string;
    httpVersion?: string;
  };
  timestamp: number;
  type?: string;
  initiator?: unknown;
}

interface CDPResponseReceivedPayload {
  requestId: string;
  frameId?: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    headers?: UnknownRecord;
    mimeType: string;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    timing?: unknown;
    protocol?: string;
    securityDetails?: UnknownRecord;
    remoteIPAddress?: string;
    remotePort?: number;
  };
  timestamp: number;
}

interface CDPLoadingFinishedPayload {
  requestId: string;
}

interface CDPResponseBodyPayload {
  body: string;
  base64Encoded: boolean;
}

const isObjectRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null;

const isRequestWillBeSentPayload = (value: unknown): value is CDPRequestWillBeSentPayload => {
  if (!isObjectRecord(value) || typeof value.requestId !== 'string') {
    return false;
  }
  if (!isObjectRecord(value.request)) {
    return false;
  }
  if (typeof value.request.url !== 'string' || typeof value.request.method !== 'string') {
    return false;
  }
  if (value.request.postData !== undefined && typeof value.request.postData !== 'string') {
    return false;
  }
  return typeof value.timestamp === 'number';
};

const isResponseReceivedPayload = (value: unknown): value is CDPResponseReceivedPayload => {
  if (!isObjectRecord(value) || typeof value.requestId !== 'string') {
    return false;
  }
  if (!isObjectRecord(value.response)) {
    return false;
  }
  if (
    typeof value.response.url !== 'string' ||
    typeof value.response.status !== 'number' ||
    typeof value.response.statusText !== 'string' ||
    typeof value.response.mimeType !== 'string'
  ) {
    return false;
  }
  return typeof value.timestamp === 'number';
};

const isLoadingFinishedPayload = (value: unknown): value is CDPLoadingFinishedPayload =>
  isObjectRecord(value) && typeof value.requestId === 'string';

const isResponseBodyPayload = (value: unknown): value is CDPResponseBodyPayload =>
  isObjectRecord(value) &&
  typeof value.body === 'string' &&
  typeof value.base64Encoded === 'boolean';

const asStringRecord = (value: unknown): Record<string, string> =>
  isObjectRecord(value) ? (value as Record<string, string>) : {};

/** Case-insensitive header lookup over a CDP headers record. */
const getHeaderValue = (headers: UnknownRecord | undefined, name: string): string | undefined => {
  if (!headers) return undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === 'string') {
      return value;
    }
  }
  return undefined;
};

const toRuntimeEvaluateValue = (value: unknown): unknown => {
  if (!isObjectRecord(value)) {
    return undefined;
  }
  const runtimeResult = value.result;
  if (!isObjectRecord(runtimeResult)) {
    return undefined;
  }
  return runtimeResult.value;
};

const toFiniteNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

// ── TLS / remote address normalizers ──

function normalizeSecurityDetails(value: unknown): Record<string, unknown> | undefined {
  if (!isObjectRecord(value)) return undefined;
  const d = value as Record<string, unknown>;
  return {
    protocol: typeof d.protocol === 'string' ? d.protocol : undefined,
    keyExchange: typeof d.keyExchange === 'string' ? d.keyExchange : undefined,
    cipher: typeof d.cipher === 'string' ? d.cipher : undefined,
    subjectName: typeof d.subjectName === 'string' ? d.subjectName : undefined,
    sanList: Array.isArray(d.sanList)
      ? d.sanList.filter((s): s is string => typeof s === 'string')
      : undefined,
    issuer: typeof d.issuer === 'string' ? d.issuer : undefined,
    validFrom: typeof d.validFrom === 'number' ? d.validFrom : undefined,
    validTo: typeof d.validTo === 'number' ? d.validTo : undefined,
  };
}

function normalizeRemoteAddress(ip: unknown, port: unknown): Record<string, unknown> | undefined {
  if (typeof ip !== 'string' || typeof port !== 'number' || Number.isNaN(port)) return undefined;
  return { ip, port };
}

// ── NetworkMonitor implementation ──

export class NetworkMonitor implements NetworkMonitorLike {
  private cdpSession: CDPSessionLike;
  private readonly identity: {
    sessionId?: string;
    targetId?: string;
    targetType?: string;
    requestIdPrefix?: string;
  };
  private networkEnabled = false;
  private requests: Map<string, NetworkRequest> = new Map();
  private responses: Map<string, NetworkResponse> = new Map();
  private readonly MAX_NETWORK_RECORDS = 500;
  private readonly MAX_INJECTED_RECORDS = 500;
  private readonly JS_RESPONSE_CONCURRENCY = 6;

  /** LRU cache for response bodies, auto-captured on loadingFinished. */
  private responseBodyCache = new Map<string, { body: string; base64Encoded: boolean }>();
  private responseBodyCacheBytes = 0;
  private readonly responseBodyCacheSizes = new Map<string, number>();
  private MAX_BODY_CACHE_ENTRIES = NETWORK_BODY_CACHE_MAX_ENTRIES;
  private MAX_BODY_CACHE_BYTES = NETWORK_BODY_CACHE_MAX_TOTAL_BYTES;
  private MAX_SINGLE_BODY_CACHE_BYTES = NETWORK_BODY_CACHE_MAX_BODY_BYTES;

  /** RequestIds pre-marked oversized via content-length (skip auto-capture fetch). */
  private readonly skipBodyCapture = new Set<string>();
  /** In-flight auto-capture fetches, bounded to avoid a getResponseBody flood. */
  private autoCaptureInFlight = 0;
  private readonly AUTO_CAPTURE_MAX_CONCURRENCY = 4;

  private networkListeners: {
    requestWillBeSent?: (params: unknown) => void;
    responseReceived?: (params: unknown) => void;
    loadingFinished?: (params: unknown) => void;
  } = {};

  constructor(
    cdpSession: CDPSessionLike,
    identity: {
      sessionId?: string;
      targetId?: string;
      targetType?: string;
      requestIdPrefix?: string;
    } = {},
  ) {
    this.cdpSession = cdpSession;
    this.identity = identity;
    // Mark as disabled on session drop — ConsoleMonitor will recreate us on reconnect
    this.cdpSession.on('disconnected', () => {
      logger.warn('NetworkMonitor: CDP session disconnected');
      this.networkEnabled = false;
      this.networkListeners = {};
    });
  }

  async enable(): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    if (this.networkEnabled) {
      logger.warn('Network monitoring already enabled');
      return;
    }

    try {
      await this.sendCdp('Network.enable', {
        maxTotalBufferSize: 10000000,
        maxResourceBufferSize: 5000000,
        maxPostDataSize: 65536,
      });

      logger.info('Network domain enabled');

      this.networkListeners.requestWillBeSent = (params: unknown) => {
        if (!isRequestWillBeSentPayload(params)) {
          logger.debug('Skipping malformed Network.requestWillBeSent payload');
          return;
        }

        const scopedRequestId = this.toScopedRequestId(params.requestId);

        const request: NetworkRequest = {
          requestId: scopedRequestId,
          rawRequestId: params.requestId,
          sessionId: this.identity.sessionId,
          targetId: this.identity.targetId,
          targetType: this.identity.targetType,
          frameId: params.frameId,
          url: params.request.url,
          method: params.request.method,
          headers: asStringRecord(params.request.headers),
          postData: params.request.postData,
          timestamp: params.timestamp,
          type: params.type,
          httpVersion: params.request.httpVersion,
          initiator: params.initiator,
        };

        this.requests.set(scopedRequestId, request);

        if (this.requests.size > this.MAX_NETWORK_RECORDS) {
          const firstKey = this.requests.keys().next().value;
          if (firstKey) {
            this.requests.delete(firstKey);
          }
        }

        logger.debug(
          `Network request captured: ${params.request.method} ${params.request.url} [${scopedRequestId}]`,
        );
      };

      this.networkListeners.responseReceived = (params: unknown) => {
        if (!isResponseReceivedPayload(params)) {
          logger.debug('Skipping malformed Network.responseReceived payload');
          return;
        }

        const scopedRequestId = this.toScopedRequestId(params.requestId);

        const response: NetworkResponse = {
          requestId: scopedRequestId,
          rawRequestId: params.requestId,
          sessionId: this.identity.sessionId,
          targetId: this.identity.targetId,
          targetType: this.identity.targetType,
          frameId: params.frameId,
          url: params.response.url,
          status: params.response.status,
          statusText: params.response.statusText,
          headers: asStringRecord(params.response.headers),
          mimeType: params.response.mimeType,
          timestamp: params.timestamp,
          fromCache: params.response.fromDiskCache || params.response.fromServiceWorker,
          timing: params.response.timing,
          protocol: params.response.protocol,
          securityDetails: normalizeSecurityDetails(
            params.response.securityDetails,
          ) as NetworkResponse['securityDetails'],
          remoteAddress: normalizeRemoteAddress(
            params.response.remoteIPAddress,
            params.response.remotePort,
          ) as NetworkResponse['remoteAddress'],
        };

        // Pre-check content-length so we never fetch an oversized body into
        // memory during auto-capture (b1-06). Without content-length we keep
        // the post-fetch size check as a fallback.
        const contentLengthRaw = getHeaderValue(params.response.headers, 'content-length');
        if (contentLengthRaw !== undefined) {
          const contentLength = Number(contentLengthRaw);
          if (Number.isFinite(contentLength) && contentLength > this.MAX_SINGLE_BODY_CACHE_BYTES) {
            this.skipBodyCapture.add(scopedRequestId);
            logger.debug(
              `[BodyCache] Pre-skipping oversized body for ${scopedRequestId} (content-length=${contentLength})`,
            );
          }
        }

        this.responses.set(scopedRequestId, response);

        if (this.responses.size > this.MAX_NETWORK_RECORDS) {
          const firstKey = this.responses.keys().next().value;
          if (firstKey) {
            this.responses.delete(firstKey);
            this.skipBodyCapture.delete(firstKey);
          }
        }

        logger.debug(
          `Network response captured: ${params.response.status} ${params.response.url} [${scopedRequestId}]`,
        );
      };

      this.networkListeners.loadingFinished = (params: unknown) => {
        if (!isLoadingFinishedPayload(params)) {
          logger.debug('Skipping malformed Network.loadingFinished payload');
          return;
        }
        const scopedRequestId = this.toScopedRequestId(params.requestId);
        logger.debug(`Network loading finished: ${scopedRequestId}`);

        // Auto-capture response body into LRU cache (fire-and-forget)
        this.captureResponseBody(scopedRequestId).catch((err) => {
          logger.debug(
            `[BodyCache] Auto-capture failed for ${scopedRequestId}: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        });
      };

      this.cdpSession.on('Network.requestWillBeSent', this.networkListeners.requestWillBeSent);
      this.cdpSession.on('Network.responseReceived', this.networkListeners.responseReceived);
      this.cdpSession.on('Network.loadingFinished', this.networkListeners.loadingFinished);

      this.networkEnabled = true;

      logger.info(' Network monitoring enabled successfully', {
        requestListeners: !!this.networkListeners.requestWillBeSent,
        responseListeners: !!this.networkListeners.responseReceived,
        loadingListeners: !!this.networkListeners.loadingFinished,
      });
    } catch (error) {
      logger.error(' Failed to enable network monitoring:', error);
      this.networkEnabled = false;
      throw error;
    }
  }

  /**
   * Auto-capture a response body into the LRU cache.
   * Called from the loadingFinished listener so bodies are available
   * even after Chrome's internal buffer is reclaimed.
   */
  private async captureResponseBody(requestId: string): Promise<void> {
    // Skip if already cached
    if (this.responseBodyCache.has(requestId)) return;

    // Only cache bodies for known responses (skip preflight, redirects without bodies, etc.)
    const response = this.responses.get(requestId);
    if (!response) return;

    // Skip non-content responses
    if (response.fromCache) return;

    // Skip bodies pre-marked oversized via the content-length pre-check (b1-06).
    if (this.skipBodyCapture.has(requestId)) {
      logger.debug(
        `[BodyCache] Skipping oversized body for ${requestId} (content-length pre-check)`,
      );
      return;
    }

    // Bound concurrent auto-capture fetches so a burst of loadingFinished
    // events cannot flood the CDP connection (b1-06).
    if (this.autoCaptureInFlight >= this.AUTO_CAPTURE_MAX_CONCURRENCY) {
      logger.debug(
        `[BodyCache] Skipping auto-capture for ${requestId} (concurrency limit reached)`,
      );
      return;
    }
    this.autoCaptureInFlight++;

    try {
      const rawResult = (await this.sendCdp('Network.getResponseBody', {
        requestId: this.toRawRequestId(requestId),
      })) as unknown;

      if (!isResponseBodyPayload(rawResult)) return;

      const bodyBytes = rawResult.base64Encoded
        ? Buffer.byteLength(rawResult.body, 'base64')
        : Buffer.byteLength(rawResult.body, 'utf8');
      if (bodyBytes > this.MAX_SINGLE_BODY_CACHE_BYTES || bodyBytes > this.MAX_BODY_CACHE_BYTES) {
        logger.debug(`[BodyCache] Skipping oversized body for ${requestId} (${bodyBytes} bytes)`);
        return;
      }

      while (
        this.responseBodyCache.size > 0 &&
        (this.responseBodyCache.size >= this.MAX_BODY_CACHE_ENTRIES ||
          this.responseBodyCacheBytes + bodyBytes > this.MAX_BODY_CACHE_BYTES)
      ) {
        const oldestKey = this.responseBodyCache.keys().next().value;
        if (oldestKey) {
          this.responseBodyCache.delete(oldestKey);
          this.responseBodyCacheBytes -= this.responseBodyCacheSizes.get(oldestKey) ?? 0;
          this.responseBodyCacheSizes.delete(oldestKey);
        }
      }

      this.responseBodyCache.set(requestId, {
        body: rawResult.body,
        base64Encoded: rawResult.base64Encoded,
      });
      this.responseBodyCacheSizes.set(requestId, bodyBytes);
      this.responseBodyCacheBytes += bodyBytes;

      logger.debug(
        `[BodyCache] Cached body for ${requestId} (${rawResult.body.length} chars, url=${response.url})`,
      );
    } catch (err) {
      // Body not available (e.g., 204, redirect, streaming) — log and skip
      logger.debug(
        `[BodyCache] Could not capture body for ${requestId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.autoCaptureInFlight--;
    }
  }

  async disable(): Promise<void> {
    if (!this.networkEnabled) {
      return;
    }

    if (this.networkListeners.requestWillBeSent) {
      this.cdpSession.off('Network.requestWillBeSent', this.networkListeners.requestWillBeSent);
    }
    if (this.networkListeners.responseReceived) {
      this.cdpSession.off('Network.responseReceived', this.networkListeners.responseReceived);
    }
    if (this.networkListeners.loadingFinished) {
      this.cdpSession.off('Network.loadingFinished', this.networkListeners.loadingFinished);
    }

    try {
      await this.sendCdp('Network.disable');
    } catch (error) {
      logger.warn('Failed to disable Network domain:', error);
    }

    this.networkListeners = {};
    this.networkEnabled = false;

    logger.info('Network monitoring disabled');
  }

  isEnabled(): boolean {
    return this.networkEnabled;
  }

  getStatus(): NetworkStatus {
    return {
      enabled: this.networkEnabled,
      requestCount: this.requests.size,
      responseCount: this.responses.size,
      listenerCount: Object.keys(this.networkListeners).filter(
        (key) => this.networkListeners[key as keyof typeof this.networkListeners] !== undefined,
      ).length,
      cdpSessionActive: true,
    };
  }

  getRequests(filter?: { url?: string; method?: string; limit?: number }): NetworkRequest[] {
    let requests = Array.from(this.requests.values());

    if (filter?.url) {
      requests = requests.filter((req) => req.url.includes(filter.url!));
    }

    if (filter?.method) {
      requests = requests.filter((req) => req.method === filter.method);
    }

    if (filter?.limit) {
      requests = requests.slice(-filter.limit);
    }

    return requests;
  }

  getResponses(filter?: { url?: string; status?: number; limit?: number }): NetworkResponse[] {
    let responses = Array.from(this.responses.values());

    if (filter?.url) {
      responses = responses.filter((res) => res.url.includes(filter.url!));
    }

    if (filter?.status) {
      responses = responses.filter((res) => res.status === filter.status);
    }

    if (filter?.limit) {
      responses = responses.slice(-filter.limit);
    }

    return responses;
  }

  getActivity(requestId: string): {
    request?: NetworkRequest;
    response?: NetworkResponse;
  } {
    return {
      request: this.requests.get(requestId),
      response: this.responses.get(requestId),
    };
  }

  async getResponseBody(requestId: string): Promise<{
    body: string;
    base64Encoded: boolean;
  } | null> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    if (!this.networkEnabled) {
      logger.error(
        'Network monitoring is not enabled. Call enable() with enableNetwork: true first.',
      );
      // No `bodyUnavailable` marker: a disabled monitor is a caller mistake the
      // handler reports on its own path, and it IS retryable after enable().
      return null;
    }

    // Check LRU cache first (populated by loadingFinished auto-capture)
    const cached = this.responseBodyCache.get(requestId);
    if (cached) {
      // LRU refresh: move to end
      this.responseBodyCache.delete(requestId);
      this.responseBodyCache.set(requestId, cached);
      logger.debug(`[BodyCache] Cache hit for ${requestId}`);
      return cached;
    }

    const request = this.requests.get(requestId);
    const response = this.responses.get(requestId);

    if (!request) {
      logger.error(
        `Request not found: ${requestId}. Make sure network monitoring was enabled before the request.`,
      );
      throw this.bodyUnavailable(
        requestId,
        'request_evicted',
        'The request is no longer tracked: either network monitoring was enabled after it was sent, ' +
          `or more than ${this.MAX_NETWORK_RECORDS} requests were recorded since.`,
      );
    }

    if (!response) {
      // Not a failure of the body layer: the request never got a response (still
      // pending, blocked, or aborted). Transient, so the caller SHOULD retry.
      logger.warn(
        `Response not yet received for request: ${requestId}. The request may still be pending.`,
      );
      return null;
    }

    // Deterministic "this response cannot have a body". Throwing stops the
    // handler's retry loop, which otherwise spends retries*interval waiting for
    // something that will never arrive, and lets the caller see WHY.
    if (response.status === 204 || response.status === 304 || response.status < 200) {
      throw this.bodyUnavailable(
        requestId,
        'no_body_by_status',
        `HTTP ${response.status} responses carry no body.`,
      );
    }
    if (response.fromCache) {
      throw this.bodyUnavailable(
        requestId,
        'from_cache',
        'The response was served from the disk cache or a service worker, so Chrome did not keep ' +
          'the body. Re-run the request with the cache disabled to capture it.',
      );
    }

    // Pre-check content-length so an explicit getResponseBody doesn't pull an
    // oversized body into memory (b1-06 guarded auto-capture; this guards the
    // direct path). Reuses the skipBodyCapture set populated on responseReceived.
    // Throw (rather than return null) so the caller can distinguish a skipped
    // body from a genuinely-not-found one and stop retrying.
    if (this.skipBodyCapture.has(requestId)) {
      logger.warn(
        `Response body skipped for ${requestId}: content-length exceeds the single-body cap`,
      );
      throw new ToolError(
        'NOT_FOUND',
        `Response body skipped for ${requestId}: content-length exceeds the single-body cap`,
        {
          toolName: 'network_get_response_body',
          details: {
            skipped: true,
            reason: 'content-length over single-body cap',
            requestId,
          },
        },
      );
    }

    try {
      const rawResult = (await this.sendCdp('Network.getResponseBody', {
        requestId: this.toRawRequestId(requestId),
      })) as unknown;

      if (!isResponseBodyPayload(rawResult)) {
        logger.error(`Unexpected response body payload for ${requestId}`);
        return null;
      }

      logger.info(`Response body retrieved for request: ${requestId}`, {
        url: response.url,
        status: response.status,
        size: rawResult.body.length,
        base64: rawResult.base64Encoded,
      });

      return {
        body: rawResult.body,
        base64Encoded: rawResult.base64Encoded,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get response body for ${requestId}:`, {
        url: response.url,
        status: response.status,
        error: errorMessage,
        hint:
          'The response body may not be available for this request type (e.g., cached, redirected, or failed ' +
          'requests)',
      });
      // Chrome keeps response bodies only while the request is still in its
      // network cache. Once it evicts them, every later fetch answers
      // "No resource with given identifier found" — deterministic, not a race.
      if (/No resource with given identifier/i.test(errorMessage)) {
        throw this.bodyUnavailable(
          requestId,
          'body_expired',
          'Chrome has already discarded this response body. Read it closer to when the request ' +
            'completes, or enable auto-capture before navigating.',
          error,
        );
      }
      return null;
    }
  }

  /**
   * Build the "this response has no readable body" error.
   *
   * Carries `details.bodyUnavailable = true` so batch readers
   * (`getAllJavaScriptResponses`) can skip it exactly like they skipped `null`,
   * while the single-request handler reports the real reason instead of the
   * generic "may not have completed yet, or the requestId is invalid".
   */
  private bodyUnavailable(
    requestId: string,
    reason: NetworkBodyUnavailableReason,
    detail: string,
    cause?: unknown,
  ): ToolError {
    return new ToolError('NOT_FOUND', `Response body unavailable for ${requestId}: ${detail}`, {
      toolName: 'network_get_response_body',
      details: { bodyUnavailable: true, reason, requestId, detail },
      ...(cause instanceof Error ? { cause } : {}),
    });
  }

  async getAllJavaScriptResponses(): Promise<
    Array<{
      url: string;
      content: string;
      size: number;
      requestId: string;
    }>
  > {
    const candidates = Array.from(this.responses.entries()).filter(([, response]) => {
      return (
        response.mimeType.includes('javascript') ||
        response.url.endsWith('.js') ||
        response.url.includes('.js?')
      );
    });

    const jsResponses: Array<{
      url: string;
      content: string;
      size: number;
      requestId: string;
    }> = [];

    for (let i = 0; i < candidates.length; i += this.JS_RESPONSE_CONCURRENCY) {
      const batch = candidates.slice(i, i + this.JS_RESPONSE_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async ([requestId, response]) => {
          let bodyResult: { body: string; base64Encoded: boolean } | null = null;
          try {
            bodyResult = await this.getResponseBody(requestId);
          } catch (error) {
            // A body that cannot be read (over the cap, evicted, cached, or
            // already discarded by Chrome) is not an error for collection —
            // omit this response exactly like a missing body.
            if (
              error instanceof ToolError &&
              (error.details?.skipped === true || error.details?.bodyUnavailable === true)
            ) {
              return null;
            }
            throw error;
          }
          if (!bodyResult) {
            return null;
          }

          const content = bodyResult.base64Encoded
            ? Buffer.from(bodyResult.body, 'base64').toString('utf-8')
            : bodyResult.body;

          return {
            url: response.url,
            content,
            size: content.length,
            requestId,
          };
        }),
      );

      jsResponses.push(
        ...batchResults.filter(
          (
            value,
          ): value is {
            url: string;
            content: string;
            size: number;
            requestId: string;
          } => value !== null,
        ),
      );
    }

    logger.info(`Collected ${jsResponses.length} JavaScript responses`);
    return jsResponses;
  }

  clearRecords(): void {
    this.requests.clear();
    this.responses.clear();
    this.responseBodyCache.clear();
    this.responseBodyCacheSizes.clear();
    this.skipBodyCapture.clear();
    this.responseBodyCacheBytes = 0;
    logger.info('Network records cleared');
  }

  getStats(): {
    totalRequests: number;
    totalResponses: number;
    byMethod: Record<string, number>;
    byStatus: Record<number, number>;
    byType: Record<string, number>;
  } {
    const byMethod: Record<string, number> = {};
    const byStatus: Record<number, number> = {};
    const byType: Record<string, number> = {};

    for (const request of this.requests.values()) {
      byMethod[request.method] = (byMethod[request.method] || 0) + 1;
      if (request.type) {
        byType[request.type] = (byType[request.type] || 0) + 1;
      }
    }

    for (const response of this.responses.values()) {
      byStatus[response.status] = (byStatus[response.status] || 0) + 1;
    }

    return {
      totalRequests: this.requests.size,
      totalResponses: this.responses.size,
      byMethod,
      byStatus,
      byType,
    };
  }

  async injectXHRInterceptor(options?: { persistent?: boolean }): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }
    const interceptorCode = buildXHRInterceptorCode(this.MAX_INJECTED_RECORDS);

    if (options?.persistent) {
      await this.sendCdp('Page.addScriptToEvaluateOnNewDocument', {
        source: interceptorCode,
      });
      logger.info('XHR interceptor injected (persistent)');
    } else {
      await this.sendCdp('Runtime.evaluate', {
        expression: interceptorCode,
      });
      logger.info('XHR interceptor injected');
    }
  }

  async injectFetchInterceptor(options?: { persistent?: boolean }): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }
    const interceptorCode = buildFetchInterceptorCode(this.MAX_INJECTED_RECORDS);

    if (options?.persistent) {
      await this.sendCdp('Page.addScriptToEvaluateOnNewDocument', {
        source: interceptorCode,
      });
      logger.info('Fetch interceptor injected (persistent)');
    } else {
      await this.sendCdp('Runtime.evaluate', {
        expression: interceptorCode,
      });
      logger.info('Fetch interceptor injected');
    }
  }

  async getXHRRequests(): Promise<Record<string, unknown>[]> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    try {
      const rawResult = (await this.sendCdp('Runtime.evaluate', {
        expression: 'window.__getXHRRequests ? window.__getXHRRequests() : []',
        returnByValue: true,
      })) as unknown;
      const value = toRuntimeEvaluateValue(rawResult);

      if (!Array.isArray(value)) {
        return [];
      }
      return value.filter((entry): entry is Record<string, unknown> => isObjectRecord(entry));
    } catch (error) {
      logger.error('Failed to get XHR requests:', error);
      return [];
    }
  }

  async getFetchRequests(): Promise<Record<string, unknown>[]> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    try {
      const rawResult = (await this.sendCdp('Runtime.evaluate', {
        expression: 'window.__getFetchRequests ? window.__getFetchRequests() : []',
        returnByValue: true,
      })) as unknown;
      const value = toRuntimeEvaluateValue(rawResult);

      if (!Array.isArray(value)) {
        return [];
      }
      return value.filter((entry): entry is Record<string, unknown> => isObjectRecord(entry));
    } catch (error) {
      logger.error('Failed to get Fetch requests:', error);
      return [];
    }
  }

  async clearInjectedBuffers(): Promise<{ xhrCleared: number; fetchCleared: number }> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    try {
      const rawResult = (await this.sendCdp('Runtime.evaluate', {
        expression: CLEAR_INJECTED_BUFFERS_EXPRESSION,
        returnByValue: true,
      })) as unknown;
      const value = toRuntimeEvaluateValue(rawResult);

      if (!isObjectRecord(value)) {
        return {
          xhrCleared: 0,
          fetchCleared: 0,
        };
      }

      return {
        xhrCleared: toFiniteNumber(value.xhrCleared),
        fetchCleared: toFiniteNumber(value.fetchCleared),
      };
    } catch (error) {
      logger.error('Failed to clear injected network buffers:', error);
      return {
        xhrCleared: 0,
        fetchCleared: 0,
      };
    }
  }

  async resetInjectedInterceptors(): Promise<{ xhrReset: boolean; fetchReset: boolean }> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    try {
      const rawResult = (await this.sendCdp('Runtime.evaluate', {
        expression: RESET_INJECTED_INTERCEPTORS_EXPRESSION,
        returnByValue: true,
      })) as unknown;
      const value = toRuntimeEvaluateValue(rawResult);

      if (!isObjectRecord(value)) {
        return {
          xhrReset: false,
          fetchReset: false,
        };
      }

      return {
        xhrReset: toBoolean(value.xhrReset, false),
        fetchReset: toBoolean(value.fetchReset, false),
      };
    } catch (error) {
      logger.error('Failed to reset injected network interceptors:', error);
      return {
        xhrReset: false,
        fetchReset: false,
      };
    }
  }

  persistsAcrossContextSwitches(): boolean {
    return false;
  }

  /**
   * Send a CDP command with a timeout guard.
   *
   * Prevents zombie CDP sessions (TCP half-open but unresponsive WebSocket) from
   * hanging the MCP server indefinitely. Without this wrapper, a `send()` on a
   * zombie session returns a Promise that never settles, which blocks the
   * handler thread and cascades to all subsequent tool calls queued on the
   * same transport.
   */
  private async sendCdp<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<T> {
    return Promise.race([
      this.cdpSession!.send(method, params) as Promise<T>,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  private toScopedRequestId(rawRequestId: string): string {
    if (this.identity.requestIdPrefix && this.identity.requestIdPrefix.length > 0) {
      return `${this.identity.requestIdPrefix}:${rawRequestId}`;
    }
    if (this.identity.sessionId && this.identity.sessionId.length > 0) {
      return `${this.identity.sessionId}:${rawRequestId}`;
    }
    return rawRequestId;
  }

  private toRawRequestId(requestId: string): string {
    const prefixed = this.identity.requestIdPrefix;
    if (prefixed && requestId.startsWith(`${prefixed}:`)) {
      return requestId.slice(prefixed.length + 1);
    }

    const sessionId = this.identity.sessionId;
    if (sessionId && requestId.startsWith(`${sessionId}:`)) {
      return requestId.slice(sessionId.length + 1);
    }

    const request = this.requests.get(requestId);
    if (request?.rawRequestId) {
      return request.rawRequestId;
    }

    const response = this.responses.get(requestId);
    if (response?.rawRequestId) {
      return response.rawRequestId;
    }

    return requestId;
  }
}
