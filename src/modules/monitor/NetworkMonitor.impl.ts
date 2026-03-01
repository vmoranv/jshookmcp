import type { CDPSession } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';
import type { NetworkRequest, NetworkResponse } from './NetworkMonitor.types.js';
import {
  buildFetchInterceptorCode,
  buildXHRInterceptorCode,
  CLEAR_INJECTED_BUFFERS_EXPRESSION,
  RESET_INJECTED_INTERCEPTORS_EXPRESSION,
} from './NetworkMonitor.interceptors.js';

export type { NetworkRequest, NetworkResponse } from './NetworkMonitor.types.js';

type UnknownRecord = Record<string, unknown>;

interface CDPRequestWillBeSentPayload {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers?: UnknownRecord;
    postData?: string;
  };
  timestamp: number;
  type?: string;
  initiator?: unknown;
}

interface CDPResponseReceivedPayload {
  requestId: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    headers?: UnknownRecord;
    mimeType: string;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    timing?: unknown;
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

export class NetworkMonitor {
  private networkEnabled = false;
  private requests: Map<string, NetworkRequest> = new Map();
  private responses: Map<string, NetworkResponse> = new Map();
  private readonly MAX_NETWORK_RECORDS = 500;
  private readonly MAX_INJECTED_RECORDS = 500;

  private networkListeners: {
    requestWillBeSent?: (params: unknown) => void;
    responseReceived?: (params: unknown) => void;
    loadingFinished?: (params: unknown) => void;
  } = {};

  constructor(private cdpSession: CDPSession) {
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
      await this.cdpSession.send('Network.enable', {
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

        const request: NetworkRequest = {
          requestId: params.requestId,
          url: params.request.url,
          method: params.request.method,
          headers: asStringRecord(params.request.headers),
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

      this.networkListeners.responseReceived = (params: unknown) => {
        if (!isResponseReceivedPayload(params)) {
          logger.debug('Skipping malformed Network.responseReceived payload');
          return;
        }

        const response: NetworkResponse = {
          requestId: params.requestId,
          url: params.response.url,
          status: params.response.status,
          statusText: params.response.statusText,
          headers: asStringRecord(params.response.headers),
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

      this.networkListeners.loadingFinished = (params: unknown) => {
        if (!isLoadingFinishedPayload(params)) {
          logger.debug('Skipping malformed Network.loadingFinished payload');
          return;
        }
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
      const rawResult = (await this.cdpSession.send('Network.getResponseBody', {
        requestId,
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
    const interceptorCode = buildXHRInterceptorCode(this.MAX_INJECTED_RECORDS);

    await this.cdpSession.send('Runtime.evaluate', {
      expression: interceptorCode,
    });

    logger.info('XHR interceptor injected');
  }

  async injectFetchInterceptor(): Promise<void> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }
    const interceptorCode = buildFetchInterceptorCode(this.MAX_INJECTED_RECORDS);

    await this.cdpSession.send('Runtime.evaluate', {
      expression: interceptorCode,
    });

    logger.info('Fetch interceptor injected');
  }

  async getXHRRequests(): Promise<Record<string, unknown>[]> {
    if (!this.cdpSession) {
      throw new Error('CDP session not initialized');
    }

    try {
      const rawResult = (await this.cdpSession.send('Runtime.evaluate', {
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
      const rawResult = (await this.cdpSession.send('Runtime.evaluate', {
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
      const rawResult = (await this.cdpSession.send('Runtime.evaluate', {
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
      const rawResult = (await this.cdpSession.send('Runtime.evaluate', {
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
}
