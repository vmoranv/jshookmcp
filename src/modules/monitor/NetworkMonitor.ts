import type { CDPSession } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: number;
  type?: string;
  initiator?: any;
}

export interface NetworkResponse {
  requestId: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType: string;
  timestamp: number;
  fromCache?: boolean;
  timing?: any;
}

export class NetworkMonitor {
  private networkEnabled = false;
  private requests: Map<string, NetworkRequest> = new Map();
  private responses: Map<string, NetworkResponse> = new Map();
  private readonly MAX_NETWORK_RECORDS = 500;
  private readonly MAX_INJECTED_RECORDS = 500;

  private networkListeners: {
    requestWillBeSent?: (params: any) => void;
    responseReceived?: (params: any) => void;
    loadingFinished?: (params: any) => void;
  } = {};

  constructor(private cdpSession: CDPSession) {}

  async enable(): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    if (this.networkEnabled) {
      logger.warn('Network monitoring already enabled');
      return;
    }

    try {
      await this.cdpSession.send('Network.enable', {
        maxTotalBufferSize: 10000000,
        maxResourceBufferSize: 5000000,
        maxPostDataSize: 65536,
      });

      logger.info('Network domain enabled');

      this.networkListeners.requestWillBeSent = (params: any) => {
        const request: NetworkRequest = {
          requestId: params.requestId,
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers,
          postData: params.request.postData,
          timestamp: params.timestamp,
          type: params.type,
          initiator: params.initiator,
        };

        this.requests.set(params.requestId, request);

        if (this.requests.size > this.MAX_NETWORK_RECORDS) {
          const firstKey = this.requests.keys().next().value;
          if (firstKey) {
            this.requests.delete(firstKey);
          }
        }

        logger.debug(`Network request captured: ${params.request.method} ${params.request.url}`);
      };

      this.networkListeners.responseReceived = (params: any) => {
        const response: NetworkResponse = {
          requestId: params.requestId,
          url: params.response.url,
          status: params.response.status,
          statusText: params.response.statusText,
          headers: params.response.headers,
          mimeType: params.response.mimeType,
          timestamp: params.timestamp,
          fromCache: params.response.fromDiskCache || params.response.fromServiceWorker,
          timing: params.response.timing,
        };

        this.responses.set(params.requestId, response);

        if (this.responses.size > this.MAX_NETWORK_RECORDS) {
          const firstKey = this.responses.keys().next().value;
          if (firstKey) {
            this.responses.delete(firstKey);
          }
        }

        logger.debug(`Network response captured: ${params.response.status} ${params.response.url}`);
      };

      this.networkListeners.loadingFinished = (params: any) => {
        logger.debug(`Network loading finished: ${params.requestId}`);
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
      await this.cdpSession.send('Network.disable');
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

  getStatus(): {
    enabled: boolean;
    requestCount: number;
    responseCount: number;
    listenerCount: number;
    cdpSessionActive: boolean;
  } {
    return {
      enabled: this.networkEnabled,
      requestCount: this.requests.size,
      responseCount: this.responses.size,
      listenerCount: Object.keys(this.networkListeners).filter(
        (key) => this.networkListeners[key as keyof typeof this.networkListeners] !== undefined
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
        'Network monitoring is not enabled. Call enable() with enableNetwork: true first.'
      );
      return null;
    }

    const request = this.requests.get(requestId);
    const response = this.responses.get(requestId);

    if (!request) {
      logger.error(
        `Request not found: ${requestId}. Make sure network monitoring was enabled before the request.`
      );
      return null;
    }

    if (!response) {
      logger.warn(
        `Response not yet received for request: ${requestId}. The request may still be pending.`
      );
      return null;
    }

    try {
      const result = await this.cdpSession.send('Network.getResponseBody', {
        requestId,
      });

      logger.info(`Response body retrieved for request: ${requestId}`, {
        url: response.url,
        status: response.status,
        size: result.body.length,
        base64: result.base64Encoded,
      });

      return {
        body: result.body,
        base64Encoded: result.base64Encoded,
      };
    } catch (error: any) {
      logger.error(`Failed to get response body for ${requestId}:`, {
        url: response.url,
        status: response.status,
        error: error.message,
        hint: 'The response body may not be available for this request type (e.g., cached, redirected, or failed requests)',
      });
      return null;
    }
  }

  async getAllJavaScriptResponses(): Promise<
    Array<{
      url: string;
      content: string;
      size: number;
      requestId: string;
    }>
  > {
    const jsResponses: Array<{
      url: string;
      content: string;
      size: number;
      requestId: string;
    }> = [];

    for (const [requestId, response] of this.responses.entries()) {
      if (
        response.mimeType.includes('javascript') ||
        response.url.endsWith('.js') ||
        response.url.includes('.js?')
      ) {
        const bodyResult = await this.getResponseBody(requestId);

        if (bodyResult) {
          const content = bodyResult.base64Encoded
            ? Buffer.from(bodyResult.body, 'base64').toString('utf-8')
            : bodyResult.body;

          jsResponses.push({
            url: response.url,
            content,
            size: content.length,
            requestId,
          });
        }
      }
    }

    logger.info(`Collected ${jsResponses.length} JavaScript responses`);
    return jsResponses;
  }

  clearRecords(): void {
    this.requests.clear();
    this.responses.clear();
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

  async injectXHRInterceptor(): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    const interceptorCode = `
      (function() {
        if (window.__xhrInterceptorInstalled) {
          console.log('[XHRInterceptor] Already installed');
          return;
        }
        window.__xhrInterceptorInstalled = true;

        const maxRecords = ${this.MAX_INJECTED_RECORDS};
        const originalXHR = window.__originalXMLHttpRequestForHook || window.XMLHttpRequest;
        window.__originalXMLHttpRequestForHook = originalXHR;
        if (!window.__xhrRequests) {
          window.__xhrRequests = [];
        }
        const xhrRequests = window.__xhrRequests;

        window.XMLHttpRequest = function() {
          const xhr = new originalXHR();
          const requestInfo = {
            method: '',
            url: '',
            requestHeaders: {},
            responseHeaders: {},
            status: 0,
            response: null,
            timestamp: Date.now(),
          };

          const originalOpen = xhr.open;
          xhr.open = function(method, url, ...args) {
            requestInfo.method = method;
            requestInfo.url = url;
            console.log('[XHRInterceptor] XHR opened:', method, url);
            return originalOpen.call(xhr, method, url, ...args);
          };

          const originalSetRequestHeader = xhr.setRequestHeader;
          xhr.setRequestHeader = function(header, value) {
            requestInfo.requestHeaders[header] = value;
            return originalSetRequestHeader.call(xhr, header, value);
          };

          const originalSend = xhr.send;
          xhr.send = function(body) {
            console.log('[XHRInterceptor] XHR sent:', requestInfo.url, 'Body:', body);

            xhr.addEventListener('load', function() {
              requestInfo.status = xhr.status;
              requestInfo.response = xhr.response;
              requestInfo.responseHeaders = xhr.getAllResponseHeaders();

              xhrRequests.push(requestInfo);
              if (xhrRequests.length > maxRecords) {
                xhrRequests.splice(0, xhrRequests.length - maxRecords);
              }
              console.log('[XHRInterceptor] XHR completed:', requestInfo.url, 'Status:', xhr.status);
            });

            return originalSend.call(xhr, body);
          };

          return xhr;
        };

        window.__getXHRRequests = function() {
          return window.__xhrRequests || [];
        };

        console.log('[XHRInterceptor] XHR interceptor installed');
      })();
    `;

    await this.cdpSession.send('Runtime.evaluate', {
      expression: interceptorCode,
    });

    logger.info('XHR interceptor injected');
  }

  async injectFetchInterceptor(): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    const interceptorCode = `
      (function() {
        if (window.__fetchInterceptorInstalled) {
          console.log('[FetchInterceptor] Already installed');
          return;
        }
        window.__fetchInterceptorInstalled = true;

        const maxRecords = ${this.MAX_INJECTED_RECORDS};
        const originalFetch = window.__originalFetchForHook || window.fetch;
        window.__originalFetchForHook = originalFetch;
        if (!window.__fetchRequests) {
          window.__fetchRequests = [];
        }
        const fetchRequests = window.__fetchRequests;

        window.fetch = function(url, options = {}) {
          const requestInfo = {
            url: typeof url === 'string' ? url : url.url,
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body,
            timestamp: Date.now(),
            response: null,
            status: 0,
          };

          console.log('[FetchInterceptor] Fetch called:', requestInfo.method, requestInfo.url);

          return originalFetch.call(window, url, options).then(async (response) => {
            requestInfo.status = response.status;

            const clonedResponse = response.clone();
            try {
              requestInfo.response = await clonedResponse.text();
            } catch (e) {
              requestInfo.response = '[Unable to read response]';
            }

            fetchRequests.push(requestInfo);
            if (fetchRequests.length > maxRecords) {
              fetchRequests.splice(0, fetchRequests.length - maxRecords);
            }
            // Auto-persist compact summary to localStorage so data survives context compression
            try {
              const summary = { url: requestInfo.url, method: requestInfo.method, status: requestInfo.status, ts: requestInfo.timestamp };
              const prev = JSON.parse(localStorage.getItem('__capturedAPIs') || '[]');
              prev.push(summary);
              if (prev.length > 500) prev.splice(0, prev.length - 500);
              localStorage.setItem('__capturedAPIs', JSON.stringify(prev));
            } catch(e) {}
            console.log('[FetchInterceptor] Fetch completed:', requestInfo.url, 'Status:', response.status);

            return response;
          }).catch((error) => {
            console.error('[FetchInterceptor] Fetch failed:', requestInfo.url, error);
            throw error;
          });
        };

        window.__getFetchRequests = function() {
          return window.__fetchRequests || [];
        };

        console.log('[FetchInterceptor] Fetch interceptor installed');
      })();
    `;

    await this.cdpSession.send('Runtime.evaluate', {
      expression: interceptorCode,
    });

    logger.info('Fetch interceptor injected');
  }

  async getXHRRequests(): Promise<any[]> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    try {
      const result = await this.cdpSession.send('Runtime.evaluate', {
        expression: 'window.__getXHRRequests ? window.__getXHRRequests() : []',
        returnByValue: true,
      });

      return result.result.value || [];
    } catch (error) {
      logger.error('Failed to get XHR requests:', error);
      return [];
    }
  }

  async getFetchRequests(): Promise<any[]> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    try {
      const result = await this.cdpSession.send('Runtime.evaluate', {
        expression: 'window.__getFetchRequests ? window.__getFetchRequests() : []',
        returnByValue: true,
      });

      return result.result.value || [];
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
      const result = await this.cdpSession.send('Runtime.evaluate', {
        expression: `
          (() => {
            const xhrStore = Array.isArray(window.__xhrRequests)
              ? window.__xhrRequests
              : (typeof window.__getXHRRequests === 'function' ? window.__getXHRRequests() : null);
            const fetchStore = Array.isArray(window.__fetchRequests)
              ? window.__fetchRequests
              : (typeof window.__getFetchRequests === 'function' ? window.__getFetchRequests() : null);

            const xhrCleared = Array.isArray(xhrStore) ? xhrStore.length : 0;
            const fetchCleared = Array.isArray(fetchStore) ? fetchStore.length : 0;

            if (Array.isArray(xhrStore)) xhrStore.length = 0;
            if (Array.isArray(fetchStore)) fetchStore.length = 0;

            return { xhrCleared, fetchCleared };
          })()
        `,
        returnByValue: true,
      });

      return (
        result.result.value || {
          xhrCleared: 0,
          fetchCleared: 0,
        }
      );
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
      const result = await this.cdpSession.send('Runtime.evaluate', {
        expression: `
          (() => {
            let xhrReset = false;
            let fetchReset = false;

            if (window.__originalXMLHttpRequestForHook) {
              window.XMLHttpRequest = window.__originalXMLHttpRequestForHook;
              xhrReset = true;
            }

            if (window.__originalFetchForHook) {
              window.fetch = window.__originalFetchForHook;
              fetchReset = true;
            }

            if (Array.isArray(window.__xhrRequests)) window.__xhrRequests.length = 0;
            if (Array.isArray(window.__fetchRequests)) window.__fetchRequests.length = 0;

            window.__xhrInterceptorInstalled = false;
            window.__fetchInterceptorInstalled = false;
            delete window.__getXHRRequests;
            delete window.__getFetchRequests;

            return { xhrReset, fetchReset };
          })()
        `,
        returnByValue: true,
      });

      return (
        result.result.value || {
          xhrReset: false,
          fetchReset: false,
        }
      );
    } catch (error) {
      logger.error('Failed to reset injected network interceptors:', error);
      return {
        xhrReset: false,
        fetchReset: false,
      };
    }
  }
}
