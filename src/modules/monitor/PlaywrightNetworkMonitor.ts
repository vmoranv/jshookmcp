import { logger } from '@utils/logger';
import type { NetworkRequest, NetworkResponse } from '@modules/monitor/NetworkMonitor';
import type { PlaywrightLikeRequest, PlaywrightLikePage } from './PlaywrightNetworkMonitor.types';
import {
  isPlaywrightLikeRequest,
  isPlaywrightLikeResponse,
} from './PlaywrightNetworkMonitor.types';
import { detectHttpVersion } from './PlaywrightNetworkMonitor.utils';
import { ResponseBodyCache, isTextMimeType } from './PlaywrightNetworkMonitor.body-cache';
import {
  NETWORK_BODY_CACHE_MAX_BODY_BYTES,
  NETWORK_BODY_CACHE_MAX_ENTRIES,
  NETWORK_BODY_CACHE_MAX_TOTAL_BYTES,
} from '@src/constants';
import {
  injectXHRInterceptor,
  injectFetchInterceptor,
  getXHRRequests,
  getFetchRequests,
  clearInjectedBuffers,
  resetInjectedInterceptors,
} from './PlaywrightNetworkMonitor.interceptors';

/**
 * Lightweight network monitor for Playwright-based browsers (Camoufox/Firefox).
 * Uses page.on('request'/'response') instead of CDP Network domain.
 */
export class PlaywrightNetworkMonitor {
  private networkEnabled = false;
  private requests: Map<string, NetworkRequest> = new Map();
  private responses: Map<string, NetworkResponse> = new Map();
  private readonly MAX_NETWORK_RECORDS = 500;
  private requestCounter = 0;

  /** LRU cache for response bodies, auto-captured on response event. */
  private responseBodyCache: ResponseBodyCache;

  // Expose for tests
  set MAX_BODY_CACHE_ENTRIES(value: number) {
    this.responseBodyCache.setMaxEntries(value);
  }

  // WeakMap to correlate requests with responses
  private requestIdMap: WeakMap<PlaywrightLikeRequest, string> = new WeakMap();

  // Stored listener references for cleanup
  private boundOnRequest: ((req: unknown) => void) | null = null;
  private boundOnResponse: ((res: unknown) => void) | null = null;

  constructor(private page: PlaywrightLikePage | null) {
    this.responseBodyCache = new ResponseBodyCache(
      NETWORK_BODY_CACHE_MAX_ENTRIES,
      NETWORK_BODY_CACHE_MAX_TOTAL_BYTES,
      NETWORK_BODY_CACHE_MAX_BODY_BYTES,
    );
  }

  setPage(page: PlaywrightLikePage | null): void {
    if (this.page === page) {
      return;
    }

    const previousPage = this.page;
    const wasEnabled = this.networkEnabled;
    const onRequest = this.boundOnRequest;
    const onResponse = this.boundOnResponse;

    if (wasEnabled && previousPage && onRequest) {
      try {
        previousPage.off('request', onRequest);
      } catch {
        // Best-effort detach when previous page is already gone.
      }
    }
    if (wasEnabled && previousPage && onResponse) {
      try {
        previousPage.off('response', onResponse);
      } catch {
        // Best-effort detach when previous page is already gone.
      }
    }

    this.page = page;

    if (!wasEnabled || !this.page) {
      if (!this.page) {
        this.networkEnabled = false;
      }
      return;
    }

    if (onRequest) {
      this.page.on('request', onRequest);
    }
    if (onResponse) {
      this.page.on('response', onResponse);
    }
  }

  private getPageOrThrow(): PlaywrightLikePage {
    if (!this.page) {
      throw new Error('Playwright page not initialized');
    }
    return this.page;
  }

  private async evaluateInPage<T>(pageFunction: string | (() => T | Promise<T>)): Promise<T> {
    const page = this.getPageOrThrow();
    if (!page.evaluate) {
      throw new Error('Playwright page.evaluate is not available');
    }
    return page.evaluate<T>(pageFunction);
  }

  async enable(): Promise<void> {
    if (this.networkEnabled) {
      logger.warn('PlaywrightNetworkMonitor already enabled');
      return;
    }

    this.boundOnRequest = (req: unknown) => {
      if (!isPlaywrightLikeRequest(req)) {
        return;
      }
      const requestId = `pw-${++this.requestCounter}`;
      this.requestIdMap.set(req, requestId);

      const request: NetworkRequest = {
        requestId,
        url: req.url(),
        method: req.method(),
        headers: req.headers() as Record<string, string>,
        postData: req.postData() ?? undefined,
        timestamp: Date.now(),
        type: req.resourceType(),
      };

      this.requests.set(requestId, request);

      if (this.requests.size > this.MAX_NETWORK_RECORDS) {
        const firstKey = this.requests.keys().next().value;
        if (firstKey) this.requests.delete(firstKey);
      }
    };

    this.boundOnResponse = (res: unknown) => {
      if (!isPlaywrightLikeResponse(res)) {
        return;
      }
      const req = res.request();
      const fallbackRequestId = `pw-res-${Date.now()}-${Math.random()}`;
      const requestId = isPlaywrightLikeRequest(req)
        ? (this.requestIdMap.get(req) ?? fallbackRequestId)
        : fallbackRequestId;
      const observedHttpVersion = detectHttpVersion(res);
      const request = this.requests.get(requestId);
      if (request && observedHttpVersion) {
        request.httpVersion = observedHttpVersion;
      }

      const response: NetworkResponse = {
        requestId,
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
        headers: res.headers() as Record<string, string>,
        mimeType: (res.headers() as Record<string, string>)['content-type'] ?? 'unknown',
        timestamp: Date.now(),
      };

      this.responses.set(requestId, response);

      if (this.responses.size > this.MAX_NETWORK_RECORDS) {
        const firstKey = this.responses.keys().next().value;
        if (firstKey) this.responses.delete(firstKey);
      }

      // Auto-capture response body (fire-and-forget)
      if (typeof res.body === 'function') {
        const captureId = requestId;
        res
          .body()
          .then((buf: Buffer) => {
            const isText = isTextMimeType(response.mimeType);
            if (isText) {
              this.responseBodyCache.set(
                captureId,
                buf.toString('utf-8'),
                false,
                response.mimeType,
                buf.length,
              );
            } else {
              this.responseBodyCache.set(
                captureId,
                buf.toString('base64'),
                true,
                response.mimeType,
                buf.length,
              );
            }
          })
          .catch((err: unknown) => {
            logger.debug(
              `[PW-BodyCache] Could not capture body for ${captureId}: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
    };

    const page = this.getPageOrThrow();
    page.on('request', this.boundOnRequest);
    page.on('response', this.boundOnResponse);
    this.networkEnabled = true;

    logger.info('PlaywrightNetworkMonitor enabled');
  }

  async disable(): Promise<void> {
    const page = this.getPageOrThrow();
    if (this.boundOnRequest) {
      try {
        page.off('request', this.boundOnRequest);
      } catch {
        /* best-effort: page may already be closed during shutdown */
      }
      this.boundOnRequest = null;
    }
    if (this.boundOnResponse) {
      try {
        page.off('response', this.boundOnResponse);
      } catch {
        /* best-effort: page may already be closed during shutdown */
      }
      this.boundOnResponse = null;
    }
    this.networkEnabled = false;
    logger.info('PlaywrightNetworkMonitor disabled');
  }

  isEnabled(): boolean {
    return this.networkEnabled;
  }

  getRequests(filter?: { url?: string; method?: string; limit?: number }): NetworkRequest[] {
    let requests = Array.from(this.requests.values());
    if (filter?.url) requests = requests.filter((r) => r.url.includes(filter.url!));
    if (filter?.method)
      requests = requests.filter((r) => r.method.toUpperCase() === filter.method!.toUpperCase());
    if (filter?.limit) requests = requests.slice(-filter.limit);
    return requests;
  }

  getResponses(filter?: { url?: string; status?: number; limit?: number }): NetworkResponse[] {
    let responses = Array.from(this.responses.values());
    if (filter?.url) responses = responses.filter((r) => r.url.includes(filter.url!));
    if (filter?.status) responses = responses.filter((r) => r.status === filter.status);
    if (filter?.limit) responses = responses.slice(-filter.limit);
    return responses;
  }

  getStatus() {
    return {
      enabled: this.networkEnabled,
      requestCount: this.requests.size,
      responseCount: this.responses.size,
      listenerCount: this.networkEnabled ? 2 : 0,
      cdpSessionActive: false,
    };
  }

  getActivity(requestId: string) {
    return {
      request: this.requests.get(requestId),
      response: this.responses.get(requestId),
    };
  }

  clearRecords(): void {
    this.requests.clear();
    this.responses.clear();
    this.responseBodyCache.clear();
  }

  getStats() {
    const requests = Array.from(this.requests.values());
    const responses = Array.from(this.responses.values());

    const byMethod: Record<string, number> = {};
    requests.forEach((r) => {
      byMethod[r.method] = (byMethod[r.method] || 0) + 1;
    });

    const byStatus: Record<string, number> = {};
    responses.forEach((r) => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    });

    const byType: Record<string, number> = {};
    requests.forEach((r) => {
      const type = r.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    });

    return {
      totalRequests: requests.length,
      totalResponses: responses.length,
      byMethod,
      byStatus,
      byType,
    };
  }

  /** Response body retrieval from LRU cache. */
  async getResponseBody(
    requestId: string,
  ): Promise<{ body: string; base64Encoded: boolean } | null> {
    return this.responseBodyCache.get(requestId);
  }

  /** Inject a script via page.evaluate (Playwright equivalent of CDP Runtime.evaluate). */
  async injectScript(script: string): Promise<void> {
    await this.evaluateInPage<void>(script);
  }

  async injectXHRInterceptor(options?: { persistent?: boolean }): Promise<void> {
    const page = this.getPageOrThrow();
    await injectXHRInterceptor(page, options);
  }

  async injectFetchInterceptor(options?: { persistent?: boolean }): Promise<void> {
    const page = this.getPageOrThrow();
    await injectFetchInterceptor(page, options);
  }

  async getXHRRequests(): Promise<unknown[]> {
    const page = this.getPageOrThrow();
    return getXHRRequests(page);
  }

  async getFetchRequests(): Promise<unknown[]> {
    const page = this.getPageOrThrow();
    return getFetchRequests(page);
  }

  async clearInjectedBuffers(): Promise<{ xhrCleared: number; fetchCleared: number }> {
    const page = this.getPageOrThrow();
    return clearInjectedBuffers(page);
  }

  async resetInjectedInterceptors(): Promise<{ xhrReset: boolean; fetchReset: boolean }> {
    const page = this.getPageOrThrow();
    return resetInjectedInterceptors(page);
  }

  async getAllJavaScriptResponses(): Promise<NetworkResponse[]> {
    return Array.from(this.responses.values()).filter((r) => r.mimeType.includes('javascript'));
  }
}
