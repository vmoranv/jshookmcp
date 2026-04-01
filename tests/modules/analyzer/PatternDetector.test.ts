import { describe, expect, it } from 'vitest';
import type { ConsoleMessage } from '@modules/monitor/ConsoleMonitor';
import type { NetworkRequest, NetworkResponse } from '@modules/monitor/ConsoleMonitor';
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
  calculateLogPriority,
} from '@modules/analyzer/PatternDetector';

function request(overrides: Partial<NetworkRequest>): NetworkRequest {
  return {
    requestId: overrides.requestId ?? 'r1',
    url: overrides.url ?? 'https://vmoranv.github.io/jshookmcp/api/data',
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
    url: overrides.url ?? 'https://vmoranv.github.io/jshookmcp/api/data',
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
      request({
        requestId: 'r-ignored',
        url: 'https://vmoranv.github.io/jshookmcp/static/ignored.css',
      }),
      request({ requestId: 'r-static', url: 'https://vmoranv.github.io/jshookmcp/logo.png' }),
      request({
        requestId: 'r-post',
        url: 'https://vmoranv.github.io/jshookmcp/order',
        method: 'POST',
      }),
      request({
        requestId: 'r-keyword',
        url: 'https://vmoranv.github.io/jshookmcp/api/login?token=abc',
      }),
    ];

    const critical = filterCriticalRequests(requests);
    expect(critical.map((item) => item.requestId)).toEqual(['r-keyword', 'r-post']);
    expect(calculateRequestPriority(critical[0]!)).toBeGreaterThan(
      calculateRequestPriority(critical[1]!),
    );
  });

  it('filters critical requests: missing branches', () => {
    const requests = [
      request({
        requestId: 'r-get-query',
        url: 'https://example.com/items/view?q=1',
        method: 'GET',
      }),
      request({
        requestId: 'r-get-no-query',
        url: 'https://example.com/items/view', // No keyword, no query
        method: 'GET',
      }),
      request({
        requestId: 'r-head',
        url: 'https://example.com/items/view?q=1',
        method: 'HEAD',
      }),
      request({
        requestId: 'r-put-keyword',
        url: 'https://example.com/login', // Keyword 'login'
        method: 'PUT',
      }),
    ];

    const critical = filterCriticalRequests(requests);
    expect(critical.map((item) => item.requestId)).toEqual(['r-put-keyword', 'r-get-query']);
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
        url: 'https://vmoranv.github.io/jshookmcp/plain',
        mimeType: 'application/json',
        timestamp: 2,
      }),
      response({
        requestId: 'keyword',
        url: 'https://vmoranv.github.io/jshookmcp/auth/step',
        mimeType: 'text/html',
        timestamp: 3,
      }),
    ];

    const filtered = filterCriticalResponses(responses);
    expect(filtered.map((item) => item.requestId)).toEqual(['keyword', 'json']);
  });

  it('filters critical responses: missing branches', () => {
    const responses = [
      response({
        requestId: 'boring',
        url: 'https://vmoranv.github.io/jshookmcp/boring',
        mimeType: 'text/plain',
        timestamp: 1,
      }),
      response({
        requestId: 'js-mime',
        url: 'https://vmoranv.github.io/jshookmcp/app.js',
        mimeType: 'application/javascript',
        timestamp: 2, // Should be kept
      }),
    ];

    const filtered = filterCriticalResponses(responses);
    expect(filtered.map((item) => item.requestId)).toEqual(['js-mime']);
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

  it('filters critical logs: missing branches', () => {
    const logs = [
      log({ text: 'just a normal random string', type: 'info' }), // Unmatched, returns false
      log({ text: '', type: 'log' }), // Empty length 0
      log({ text: 'error happened', type: 'error' }), // Error keeping
    ];

    const critical = filterCriticalLogs(logs);
    expect(critical).toHaveLength(1);
    expect(critical[0]!.type).toBe('error');
    // Test that empty text does not crash when parsing (already partially covered but ensures empty string length=0 check)
  });

  it('detects encryption patterns and deduplicates repeated locations', () => {
    const patterns = detectEncryptionPatterns(
      [
        request({
          url: 'https://vmoranv.github.io/jshookmcp/crypto/aes/endpoint',
          postData: '{"payload":"encrypt this"}',
        }),
      ],
      [log({ text: 'CryptoJS.AES encrypt invoked', url: 'console://main' })],
    );

    const sameLocation = patterns.filter((pattern) => pattern.location.includes('/crypto/aes'));
    expect(sameLocation).toHaveLength(1);
    expect(patterns.some((pattern) => pattern.type === 'AES')).toBe(true);
  });

  it('detects signature patterns from URL params, headers and request body', () => {
    const patterns = detectSignaturePatterns(
      [
        request({
          url: 'https://vmoranv.github.io/jshookmcp/api?signature=abc&data=1',
          headers: { 'x-signature': 'a'.repeat(64), 'x-trace-id': 'trace' },
          postData: JSON.stringify({ sign: 'a'.repeat(64), payload: 'x' }),
        }),
      ],
      [],
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
          url: `https://vmoranv.github.io/jshookmcp/login?access_token=${oauthToken}`,
          headers: { Authorization: `Bearer ${jwt}` },
          postData: 'token=abc12345678901234567890',
        }),
      ],
      [],
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
      request({ method: 'GET', url: 'https://vmoranv.github.io/jshookmcp/api/user' }),
      request({ method: 'POST', url: 'https://vmoranv.github.io/jshookmcp/v1/login' }),
      request({ method: 'GET', url: 'https://vmoranv.github.io/jshookmcp/api/user' }),
    ]);
    expect(apis).toEqual(['GET /jshookmcp/api/user', 'POST /jshookmcp/v1/login']);

    const functions = extractKeyFunctions([
      log({ text: 'signPayload(data); console.log("x"); verifyToken(token);' }),
    ]);
    expect(functions).toContain('signPayload');
    expect(functions).toContain('verifyToken');
    expect(functions).not.toContain('console');
  });

  it('detectEncryptionPatterns: invalid prototype branch coverage', () => {
    // Temporarily inject an invalid property to hit the !isEncryptionPatternType(type) branches
    const originalEntries = Object.entries;
    Object.entries = (obj: any) => {
      const entries = originalEntries(obj);
      entries.push(['INVALID_TYPE', ['invalidkeyword']]);
      return entries;
    };

    try {
      const patterns = detectEncryptionPatterns(
        [
          request({
            url: 'https://vmoranv.github.io/jshookmcp/invalidkeyword',
            postData: 'invalidkeyword',
          }),
        ],
        [log({ text: 'invalidkeyword output' })],
      );

      // The invalid keyword should be ignored because of the prototype check
      expect(patterns.some((p) => (p.type as string) === 'INVALID_TYPE')).toBe(false);
    } finally {
      Object.entries = originalEntries;
    }
  });

  it('detectAntiDebugPatterns: missing branches', () => {
    const patterns = detectAntiDebugPatterns([
      // A log that doesn't trigger anything to cover the false paths:
      log({ text: 'just a normal log with no anti-debug indicators' }),
      // A log with no url:
      log({ text: 'debugger; console.log=1; devtools firebug performance.now Date.now' }),
    ]);
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.some((p) => p.location === 'unknown')).toBe(true);
  });

  it('extractSuspiciousAPIs: missing branches', () => {
    const apis = extractSuspiciousAPIs([
      request({
        requestId: 'normal',
        url: 'https://vmoranv.github.io/jshookmcp/static/image.png',
        method: 'GET',
      }),
      request({
        requestId: 'invalid-url',
        url: 'not-a-valid-url-at-all',
        method: 'GET',
      }),
    ]);
    expect(apis).toEqual([]); // Neither path includes /api/ nor is structurally matched
  });

  it('covers trivial falsy branches for full coverage', () => {
    // calculateRequestPriority falsy postData
    expect(
      calculateRequestPriority(
        request({ method: 'GET', url: 'http://example.com/', postData: '' }),
      ),
    ).toBe(0);

    // filterCriticalRequests isBlacklisted = true
    expect(
      filterCriticalRequests([
        request({ requestId: 'blacklisted', url: 'https://google-analytics.com/collect' }),
      ]).length,
    ).toBe(0);

    // calculateLogPriority falsy error/warn
    expect(calculateLogPriority(log({ text: 'normal log', type: 'info' }))).toBe(0);

    // detectEncryptionPatterns missing postData and log.url
    const result = detectEncryptionPatterns(
      [request({ method: 'GET', url: 'http://example.com/', postData: undefined })],
      [log({ text: 'base64 init', url: '' })],
    );
    expect(result.length).toBe(1);
    expect(result[0]!.location).toBe('console');
  });

  it('covers trivial truthy branches for full coverage', () => {
    // calculateRequestPriority truthy postData
    expect(
      calculateRequestPriority(
        request({ method: 'POST', url: 'http://example.com/', postData: 'truthy' }),
      ),
    ).toBe(15);

    // calculateLogPriority truthy error/warn
    expect(calculateLogPriority(log({ text: 'normal log', type: 'error' }))).toBe(20);
    expect(calculateLogPriority(log({ text: 'normal log', type: 'warn' }))).toBe(10);
  });
});
