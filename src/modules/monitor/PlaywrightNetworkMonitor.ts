import { logger } from '../../utils/logger.js';
import type { NetworkRequest, NetworkResponse } from './NetworkMonitor.js';

interface PlaywrightLikeRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postData(): string | null;
  resourceType(): string;
}

interface PlaywrightLikeResponse {
  request(): unknown;
  url(): string;
  status(): number;
  statusText(): string;
  headers(): Record<string, string>;
}

interface PlaywrightLikePage {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  evaluate?<T>(pageFunction: string | (() => T | Promise<T>)): Promise<T>;
}

interface BridgeWindow extends Window {
  XMLHttpRequest: typeof XMLHttpRequest;
  __xhrRequests?: unknown[];
  __fetchRequests?: unknown[];
  __pwOriginalXMLHttpRequest?: typeof XMLHttpRequest;
  __pwOriginalFetch?: typeof fetch;
  __xhrInterceptorInjected?: boolean;
  __fetchInterceptorInjected?: boolean;
}

type ClearedBuffersResult = { xhrCleared: number; fetchCleared: number };
type ResetInterceptorsResult = { xhrReset: boolean; fetchReset: boolean };

/**
 * Lightweight network monitor for Playwright-based browsers (Camoufox/Firefox).
 * Uses page.on('request'/'response') instead of CDP Network domain.
 */
export class PlaywrightNetworkMonitor {
  private networkEnabled = false;
  private requests: Map<string, NetworkRequest> = new Map();
  private responses: Map<string, NetworkResponse> = new Map();
  private readonly MAX_NETWORK_RECORDS = 500;
  private readonly MAX_INJECTED_RECORDS = 500;
  private requestCounter = 0;

  // WeakMap to correlate requests with responses
  private requestIdMap: WeakMap<PlaywrightLikeRequest, string> = new WeakMap();

  // Stored listener references for cleanup
  private boundOnRequest: ((req: unknown) => void) | null = null;
  private boundOnResponse: ((res: unknown) => void) | null = null;

  constructor(private page: PlaywrightLikePage | null) {}

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

  private isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
  }

  private isClearedBuffersResult(value: unknown): value is ClearedBuffersResult {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.xhrCleared === 'number' && typeof candidate.fetchCleared === 'number';
  }

  private isResetInterceptorsResult(value: unknown): value is ResetInterceptorsResult {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.xhrReset === 'boolean' && typeof candidate.fetchReset === 'boolean';
  }

  private isPlaywrightLikeRequest(value: unknown): value is PlaywrightLikeRequest {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PlaywrightLikeRequest>;
    return (
      typeof candidate.url === 'function' &&
      typeof candidate.method === 'function' &&
      typeof candidate.headers === 'function' &&
      typeof candidate.postData === 'function' &&
      typeof candidate.resourceType === 'function'
    );
  }

  private isPlaywrightLikeResponse(value: unknown): value is PlaywrightLikeResponse {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PlaywrightLikeResponse>;
    return (
      typeof candidate.request === 'function' &&
      typeof candidate.url === 'function' &&
      typeof candidate.status === 'function' &&
      typeof candidate.statusText === 'function' &&
      typeof candidate.headers === 'function'
    );
  }

  async enable(): Promise<void> {
    if (this.networkEnabled) {
      logger.warn('PlaywrightNetworkMonitor already enabled');
      return;
    }

    this.boundOnRequest = (req: unknown) => {
      if (!this.isPlaywrightLikeRequest(req)) {
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
      if (!this.isPlaywrightLikeResponse(res)) {
        return;
      }
      const req = res.request();
      const fallbackRequestId = `pw-res-${Date.now()}-${Math.random()}`;
      const requestId = this.isPlaywrightLikeRequest(req)
        ? this.requestIdMap.get(req) ?? fallbackRequestId
        : fallbackRequestId;

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
      } catch {}
      this.boundOnRequest = null;
    }
    if (this.boundOnResponse) {
      try {
        page.off('response', this.boundOnResponse);
      } catch {}
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
      requests = requests.filter(
        (r) => r.method.toUpperCase() === filter.method!.toUpperCase()
      );
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

  /** Response body retrieval is not supported in Playwright mode without async interception. */
  async getResponseBody(_requestId: string): Promise<{ body: string; base64Encoded: boolean } | null> {
    logger.warn('getResponseBody is not supported in Playwright/camoufox mode');
    return null;
  }

  /** Inject a script via page.evaluate (Playwright equivalent of CDP Runtime.evaluate). */
  async injectScript(script: string): Promise<void> {
    await this.evaluateInPage<void>(script);
  }

  async injectXHRInterceptor(): Promise<void> {
    await this.evaluateInPage<void>(`
      (function() {
        if (window.__xhrInterceptorInjected) return;
        window.__xhrInterceptorInjected = true;
        const maxRecords = ${this.MAX_INJECTED_RECORDS};
        const OrigXHR = window.__pwOriginalXMLHttpRequest || window.XMLHttpRequest;
        window.__pwOriginalXMLHttpRequest = OrigXHR;
        if (!window.__xhrRequests) window.__xhrRequests = [];
        window.XMLHttpRequest = function() {
          const xhr = new OrigXHR();
          const origOpen = xhr.open.bind(xhr);
          const origSend = xhr.send.bind(xhr);
          xhr.open = function(method, url, ...rest) {
            xhr.__hookMeta = { method, url, timestamp: Date.now() };
            return origOpen(method, url, ...rest);
          };
          xhr.send = function(body) {
            xhr.addEventListener('load', function() {
              window.__xhrRequests.push({
                ...xhr.__hookMeta, body: body ? String(body).slice(0, 2048) : null,
                status: xhr.status, response: xhr.responseText.slice(0, 2048),
              });
              if (window.__xhrRequests.length > maxRecords) {
                window.__xhrRequests.splice(0, window.__xhrRequests.length - maxRecords);
              }
            });
            return origSend(body);
          };
          return xhr;
        };
        console.log('[PlaywrightXHR] XHR interceptor injected');
      })();
    `);
  }

  async injectFetchInterceptor(): Promise<void> {
    await this.evaluateInPage<void>(`
      (function() {
        if (window.__fetchInterceptorInjected) return;
        window.__fetchInterceptorInjected = true;
        const maxRecords = ${this.MAX_INJECTED_RECORDS};
        const origFetch = window.__pwOriginalFetch || window.fetch;
        window.__pwOriginalFetch = origFetch;
        if (!window.__fetchRequests) window.__fetchRequests = [];
        window.fetch = function(...args) {
          const [url, opts] = args;
          const entry = { url: String(url), method: opts?.method || 'GET', timestamp: Date.now() };
          return origFetch.apply(this, args).then(res => {
            entry.status = res.status;
            window.__fetchRequests.push(entry);
            if (window.__fetchRequests.length > maxRecords) {
              window.__fetchRequests.splice(0, window.__fetchRequests.length - maxRecords);
            }
            // Auto-persist compact summary so data survives context compression
            try {
              const s = { url: entry.url, method: entry.method, status: entry.status, ts: entry.timestamp };
              const prev = JSON.parse(localStorage.getItem('__capturedAPIs') || '[]');
              prev.push(s);
              if (prev.length > 500) prev.splice(0, prev.length - 500);
              localStorage.setItem('__capturedAPIs', JSON.stringify(prev));
            } catch(e) {}
            return res;
          });
        };
        console.log('[PlaywrightFetch] Fetch interceptor injected');
      })();
    `);
  }

  async getXHRRequests(): Promise<unknown[]> {
    try {
      const result: unknown = await this.evaluateInPage(() => {
        const bridgeWindow = window as BridgeWindow;
        return bridgeWindow.__xhrRequests ?? [];
      });
      return this.isUnknownArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  async getFetchRequests(): Promise<unknown[]> {
    try {
      const result: unknown = await this.evaluateInPage(() => {
        const bridgeWindow = window as BridgeWindow;
        return bridgeWindow.__fetchRequests ?? [];
      });
      return this.isUnknownArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  async clearInjectedBuffers(): Promise<{ xhrCleared: number; fetchCleared: number }> {
    try {
      const result: unknown = await this.evaluateInPage(() => {
        const bridgeWindow = window as BridgeWindow;
        const xhrRequests = bridgeWindow.__xhrRequests;
        const fetchRequests = bridgeWindow.__fetchRequests;

        const xhrCleared = Array.isArray(xhrRequests) ? xhrRequests.length : 0;
        const fetchCleared = Array.isArray(fetchRequests) ? fetchRequests.length : 0;

        if (Array.isArray(xhrRequests)) {
          xhrRequests.length = 0;
        }
        if (Array.isArray(fetchRequests)) {
          fetchRequests.length = 0;
        }

        return { xhrCleared, fetchCleared };
      });
      return this.isClearedBuffersResult(result)
        ? result
        : { xhrCleared: 0, fetchCleared: 0 };
    } catch {
      return { xhrCleared: 0, fetchCleared: 0 };
    }
  }

  async resetInjectedInterceptors(): Promise<{ xhrReset: boolean; fetchReset: boolean }> {
    try {
      const result: unknown = await this.evaluateInPage(() => {
        const bridgeWindow = window as BridgeWindow;
        let xhrReset = false;
        let fetchReset = false;

        if (bridgeWindow.__pwOriginalXMLHttpRequest) {
          bridgeWindow.XMLHttpRequest = bridgeWindow.__pwOriginalXMLHttpRequest;
          xhrReset = true;
        }

        if (bridgeWindow.__pwOriginalFetch) {
          bridgeWindow.fetch = bridgeWindow.__pwOriginalFetch;
          fetchReset = true;
        }

        if (Array.isArray(bridgeWindow.__xhrRequests)) {
          bridgeWindow.__xhrRequests.length = 0;
        }
        if (Array.isArray(bridgeWindow.__fetchRequests)) {
          bridgeWindow.__fetchRequests.length = 0;
        }

        bridgeWindow.__xhrInterceptorInjected = false;
        bridgeWindow.__fetchInterceptorInjected = false;

        return { xhrReset, fetchReset };
      });
      return this.isResetInterceptorsResult(result) ? result : { xhrReset: false, fetchReset: false };
    } catch {
      return { xhrReset: false, fetchReset: false };
    }
  }

  async getAllJavaScriptResponses(): Promise<NetworkResponse[]> {
    return Array.from(this.responses.values()).filter((r) =>
      r.mimeType.includes('javascript')
    );
  }
}
