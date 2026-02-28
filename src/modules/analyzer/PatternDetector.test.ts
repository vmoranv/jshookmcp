import { describe, expect, it } from 'vitest';
import type { ConsoleMessage } from '../monitor/ConsoleMonitor.js';
import type { NetworkRequest, NetworkResponse } from '../monitor/ConsoleMonitor.js';
import {
  calculateRequestPriority,
  detectAntiDebugPatterns,
  detectEncryptionPatterns,
  detectSignaturePatterns,
  detectTokenPatterns,
  extractKeyFunctions,
  extractSuspiciousAPIs,
  filterCriticalLogs,
  filterCriticalRequests,
  filterCriticalResponses,
} from './PatternDetector.js';

function request(overrides: Partial<NetworkRequest>): NetworkRequest {
  return {
    requestId: overrides.requestId ?? 'r1',
    url: overrides.url ?? 'https://example.com/api/data',
    method: overrides.method ?? 'GET',
    headers: overrides.headers ?? {},
    postData: overrides.postData,
    timestamp: overrides.timestamp ?? Date.now(),
    type: overrides.type,
    initiator: overrides.initiator,
  };
}

function response(overrides: Partial<NetworkResponse>): NetworkResponse {
  return {
    requestId: overrides.requestId ?? 'resp-1',
    url: overrides.url ?? 'https://example.com/api/data',
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? 'OK',
    headers: overrides.headers ?? {},
    mimeType: overrides.mimeType ?? 'application/json',
    timestamp: overrides.timestamp ?? Date.now(),
    fromCache: overrides.fromCache,
    timing: overrides.timing,
  };
}

function log(overrides: Partial<ConsoleMessage>): ConsoleMessage {
  return {
    type: overrides.type ?? 'log',
    text: overrides.text ?? '',
    timestamp: overrides.timestamp ?? Date.now(),
    args: overrides.args,
    stackTrace: overrides.stackTrace,
    url: overrides.url,
    lineNumber: overrides.lineNumber,
    columnNumber: overrides.columnNumber,
  };
}

describe('PatternDetector', () => {
  it('filters critical requests and sorts by calculated priority', () => {
    const requests = [
      request({ requestId: 'r-blacklist', url: 'https://google-analytics.com/collect?token=1' }),
      request({ requestId: 'r-static', url: 'https://example.com/logo.png' }),
      request({ requestId: 'r-post', url: 'https://example.com/order', method: 'POST' }),
      request({ requestId: 'r-keyword', url: 'https://example.com/api/login?token=abc' }),
    ];

    const critical = filterCriticalRequests(requests);
    expect(critical.map((item) => item.requestId)).toEqual(['r-keyword', 'r-post']);
    expect(calculateRequestPriority(critical[0]!)).toBeGreaterThan(
      calculateRequestPriority(critical[1]!)
    );
  });

  it('filters critical responses by mime type, keyword, and timestamp order', () => {
    const responses = [
      response({
        requestId: 'blacklisted',
        url: 'https://cdn.jsdelivr.net/x.js',
        mimeType: 'application/javascript',
        timestamp: 1,
      }),
      response({
        requestId: 'json',
        url: 'https://example.com/plain',
        mimeType: 'application/json',
        timestamp: 2,
      }),
      response({
        requestId: 'keyword',
        url: 'https://example.com/auth/step',
        mimeType: 'text/html',
        timestamp: 3,
      }),
    ];

    const filtered = filterCriticalResponses(responses);
    expect(filtered.map((item) => item.requestId)).toEqual(['keyword', 'json']);
  });

  it('filters console logs and removes framework noise', () => {
    const logs = [
      log({ text: '[HMR] connected', type: 'info' }),
      log({ text: ' ', type: 'log' }),
      log({ text: 'token refresh failed', type: 'warn' }),
      log({ text: 'auth success', type: 'log' }),
    ];

    const critical = filterCriticalLogs(logs);
    expect(critical).toHaveLength(2);
    expect(critical[0]!.type).toBe('warn');
    expect(critical[1]!.text).toContain('auth');
  });

  it('detects encryption patterns and deduplicates repeated locations', () => {
    const patterns = detectEncryptionPatterns(
      [
        request({
          url: 'https://example.com/crypto/aes/endpoint',
          postData: '{"payload":"encrypt this"}',
        }),
      ],
      [log({ text: 'CryptoJS.AES encrypt invoked', url: 'console://main' })]
    );

    const sameLocation = patterns.filter((pattern) => pattern.location.includes('/crypto/aes'));
    expect(sameLocation).toHaveLength(1);
    expect(patterns.some((pattern) => pattern.type === 'AES')).toBe(true);
  });

  it('detects signature patterns from URL params, headers and request body', () => {
    const patterns = detectSignaturePatterns(
      [
        request({
          url: 'https://example.com/api?signature=abc&data=1',
          headers: { 'x-signature': 'a'.repeat(64), 'x-trace-id': 'trace' },
          postData: JSON.stringify({ sign: 'a'.repeat(64), payload: 'x' }),
        }),
      ],
      []
    );

    expect(patterns.length).toBeGreaterThanOrEqual(3);
    expect(patterns.some((item) => item.type === 'HMAC')).toBe(true);
    expect(patterns.some((item) => item.location.includes('URL params'))).toBe(true);
    expect(patterns.some((item) => item.location.includes('POST body'))).toBe(true);
  });

  it('detects token patterns across headers, URL params and fallback form data', () => {
    const jwt = 'aaa.bbb.ccc';
    const oauthToken = 'oauth_token_value_12345678901234567890';
    const patterns = detectTokenPatterns(
      [
        request({
          url: `https://example.com/login?access_token=${oauthToken}`,
          headers: { Authorization: `Bearer ${jwt}` },
          postData: 'token=abc12345678901234567890',
        }),
      ],
      []
    );

    expect(patterns.some((item) => item.type === 'JWT')).toBe(true);
    expect(patterns.some((item) => item.type === 'OAuth')).toBe(true);
    expect(patterns.some((item) => item.format.includes('POST body'))).toBe(true);
  });

  it('detects anti-debug traces and extracts key APIs/functions', () => {
    const antiDebug = detectAntiDebugPatterns([
      log({ text: 'debugger; Date.now(); console.log(x = 1); devtools check', url: 'x.js' }),
    ]);
    expect(antiDebug.map((item) => item.type)).toEqual([
      'debugger',
      'console.log',
      'devtools-detect',
      'timing-check',
    ]);

    const apis = extractSuspiciousAPIs([
      request({ method: 'GET', url: 'https://a.com/api/user' }),
      request({ method: 'POST', url: 'https://a.com/v1/login' }),
      request({ method: 'GET', url: 'https://a.com/api/user' }),
    ]);
    expect(apis).toEqual(['GET /api/user', 'POST /v1/login']);

    const functions = extractKeyFunctions([
      log({ text: 'signPayload(data); console.log("x"); verifyToken(token);' }),
    ]);
    expect(functions).toContain('signPayload');
    expect(functions).toContain('verifyToken');
    expect(functions).not.toContain('console');
  });
});
