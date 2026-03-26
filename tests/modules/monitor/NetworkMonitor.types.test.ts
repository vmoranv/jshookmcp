import { describe, expect, it } from 'vitest';

import type {
  NetworkInitiator,
  NetworkRequest,
  NetworkResponse,
  NetworkTiming,
} from '@modules/monitor/NetworkMonitor.types';

describe('NetworkMonitor.types.ts', () => {
  it('defines NetworkRequest with required fields', () => {
    const request: NetworkRequest = {
      requestId: 'req-1',
      url: 'https://example.com/api',
      method: 'GET',
      headers: { 'content-type': 'application/json' },
      timestamp: Date.now(),
    };

    expect(request.requestId).toBe('req-1');
    expect(request.url).toBe('https://example.com/api');
    expect(request.method).toBe('GET');
    expect(request.headers).toEqual({ 'content-type': 'application/json' });
    expect(typeof request.timestamp).toBe('number');
  });

  it('defines NetworkRequest with optional fields', () => {
    const request: NetworkRequest = {
      requestId: 'req-2',
      url: 'https://example.com/submit',
      method: 'POST',
      headers: {},
      postData: '{"key":"value"}',
      timestamp: 1000,
      type: 'XHR',
      initiator: { type: 'script' } as NetworkInitiator,
    };

    expect(request.postData).toBe('{"key":"value"}');
    expect(request.type).toBe('XHR');
    expect(request.initiator).toEqual({ type: 'script' });
  });

  it('defines NetworkResponse with required fields', () => {
    const response: NetworkResponse = {
      requestId: 'req-1',
      url: 'https://example.com/api',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      mimeType: 'application/json',
      timestamp: Date.now(),
    };

    expect(response.requestId).toBe('req-1');
    expect(response.status).toBe(200);
    expect(response.statusText).toBe('OK');
    expect(response.mimeType).toBe('application/json');
    expect(typeof response.timestamp).toBe('number');
  });

  it('defines NetworkResponse with optional fields', () => {
    const response: NetworkResponse = {
      requestId: 'req-3',
      url: 'https://example.com/cached',
      status: 304,
      statusText: 'Not Modified',
      headers: {},
      mimeType: 'text/html',
      timestamp: 2000,
      fromCache: true,
      timing: { requestTime: 100 } as NetworkTiming,
    };

    expect(response.fromCache).toBe(true);
    expect(response.timing).toEqual({ requestTime: 100 });
  });

  it('treats NetworkInitiator and NetworkTiming as opaque unknown types', () => {
    const initiator: NetworkInitiator = { type: 'parser', url: 'https://example.com' };
    const timing: NetworkTiming = { requestTime: 1, proxyStart: -1 };

    // These are typed as `unknown`, so they accept any shape
    expect(initiator).toBeDefined();
    expect(timing).toBeDefined();
  });
});
