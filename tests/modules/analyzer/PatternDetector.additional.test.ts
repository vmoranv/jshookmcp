import { beforeEach, describe, expect, it, vi } from 'vitest';

// No external dependencies to mock for PatternDetector -
// it imports types and functions from sibling modules which we can mock.

vi.mock('@modules/analyzer/PatternDetectorAuthPatterns', () => ({
  detectSignaturePatternsInternal: vi.fn(() => []),
  detectTokenPatternsInternal: vi.fn(() => []),
}));

import {
  BLACKLIST_DOMAINS,
  WHITELIST_KEYWORDS,
  FRAMEWORK_LOG_KEYWORDS,
  calculateRequestPriority,
  filterCriticalRequests,
  filterCriticalResponses,
  calculateLogPriority,
  filterCriticalLogs,
  deduplicatePatterns,
  detectEncryptionPatterns,
  detectSignaturePatterns,
  detectTokenPatterns,
  detectAntiDebugPatterns,
  extractSuspiciousAPIs,
  extractKeyFunctions,
} from '@modules/analyzer/PatternDetector';

import {
  detectSignaturePatternsInternal,
  detectTokenPatternsInternal,
} from '@modules/analyzer/PatternDetectorAuthPatterns';

type NetworkRequest = {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: number;
};

type NetworkResponse = {
  requestId: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  mimeType: string;
  timestamp: number;
};

type ConsoleMessage = {
  type: string;
  text: string;
  timestamp: number;
  url?: string;
};

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    requestId: 'r1',
    url: 'https://example.com/api/data',
    method: 'GET',
    headers: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeResponse(overrides: Partial<NetworkResponse> = {}): NetworkResponse {
  return {
    requestId: 'r1',
    url: 'https://example.com/api/data',
    status: 200,
    statusText: 'OK',
    headers: {},
    mimeType: 'application/json',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeLog(overrides: Partial<ConsoleMessage> = {}): ConsoleMessage {
  return {
    type: 'log',
    text: 'some message',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('PatternDetector additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constants exports', () => {
    it('BLACKLIST_DOMAINS is an array of known analytics domains', () => {
      expect(Array.isArray(BLACKLIST_DOMAINS)).toBe(true);
      expect(BLACKLIST_DOMAINS.length).toBeGreaterThan(0);
      expect(BLACKLIST_DOMAINS).toContain('google-analytics.com');
    });

    it('WHITELIST_KEYWORDS contains security-related keywords', () => {
      expect(WHITELIST_KEYWORDS).toContain('login');
      expect(WHITELIST_KEYWORDS).toContain('auth');
      expect(WHITELIST_KEYWORDS).toContain('encrypt');
      expect(WHITELIST_KEYWORDS).toContain('token');
    });

    it('FRAMEWORK_LOG_KEYWORDS contains framework markers', () => {
      expect(FRAMEWORK_LOG_KEYWORDS).toContain('[HMR]');
      expect(FRAMEWORK_LOG_KEYWORDS).toContain('[webpack]');
    });
  });

  describe('calculateRequestPriority', () => {
    it('gives higher score to POST requests', () => {
      const postReq = makeRequest({ method: 'POST', url: 'https://example.com/submit' });
      const getReq = makeRequest({ method: 'GET', url: 'https://example.com/submit' });
      expect(calculateRequestPriority(postReq)).toBeGreaterThan(calculateRequestPriority(getReq));
    });

    it('gives higher score to PUT requests', () => {
      const putReq = makeRequest({ method: 'PUT', url: 'https://example.com/update' });
      const getReq = makeRequest({ method: 'GET', url: 'https://example.com/update' });
      expect(calculateRequestPriority(putReq)).toBeGreaterThan(calculateRequestPriority(getReq));
    });

    it('increases score for each whitelist keyword in URL', () => {
      const reqWithKeywords = makeRequest({ url: 'https://example.com/api/login/token' });
      const reqWithout = makeRequest({ url: 'https://example.com/static/image' });
      expect(calculateRequestPriority(reqWithKeywords)).toBeGreaterThan(
        calculateRequestPriority(reqWithout)
      );
    });

    it('increases score when postData is present', () => {
      const withPost = makeRequest({ url: 'https://example.com/', postData: 'data=1' });
      const withoutPost = makeRequest({ url: 'https://example.com/' });
      expect(calculateRequestPriority(withPost)).toBeGreaterThan(
        calculateRequestPriority(withoutPost)
      );
    });

    it('adds score based on URL length', () => {
      const longUrl = makeRequest({ url: 'https://example.com/' + 'a'.repeat(200) });
      const shortUrl = makeRequest({ url: 'https://example.com/' });
      expect(calculateRequestPriority(longUrl)).toBeGreaterThan(calculateRequestPriority(shortUrl));
    });
  });

  describe('filterCriticalRequests', () => {
    it('filters out blacklisted domains', () => {
      const requests = [
        makeRequest({ url: 'https://google-analytics.com/collect' }),
        makeRequest({ url: 'https://example.com/api/login' }),
      ];
      const filtered = filterCriticalRequests(requests);
      expect(filtered.some((r) => r.url.includes('google-analytics.com'))).toBe(false);
    });

    it('filters out static resources', () => {
      const requests = [
        makeRequest({ url: 'https://example.com/image.png' }),
        makeRequest({ url: 'https://example.com/style.css' }),
        makeRequest({ url: 'https://example.com/font.woff2' }),
        makeRequest({ url: 'https://example.com/api/login' }),
      ];
      const filtered = filterCriticalRequests(requests);
      expect(filtered.every((r) => !r.url.match(/\.(png|css|woff2)$/i))).toBe(true);
    });

    it('includes requests with whitelist keywords', () => {
      const requests = [makeRequest({ url: 'https://example.com/api/auth/token' })];
      const filtered = filterCriticalRequests(requests);
      expect(filtered.length).toBe(1);
    });

    it('includes POST requests even without keywords', () => {
      const requests = [makeRequest({ method: 'POST', url: 'https://example.com/submit' })];
      const filtered = filterCriticalRequests(requests);
      expect(filtered.length).toBe(1);
    });

    it('includes GET requests with query params', () => {
      const requests = [makeRequest({ url: 'https://example.com/search?q=test' })];
      const filtered = filterCriticalRequests(requests);
      expect(filtered.length).toBe(1);
    });

    it('excludes GET requests without keywords or query params', () => {
      const requests = [makeRequest({ url: 'https://example.com/about' })];
      const filtered = filterCriticalRequests(requests);
      expect(filtered.length).toBe(0);
    });

    it('sorts results by priority score descending', () => {
      const requests = [
        makeRequest({ url: 'https://example.com/search?q=test', method: 'GET' }),
        makeRequest({
          url: 'https://example.com/api/login/auth',
          method: 'POST',
          postData: 'user=test',
        }),
      ];
      const filtered = filterCriticalRequests(requests);
      expect(filtered.length).toBe(2);
      // POST with keywords should come first
      expect(filtered[0]!.method).toBe('POST');
    });
  });

  describe('filterCriticalResponses', () => {
    it('filters out blacklisted domains', () => {
      const responses = [
        makeResponse({
          url: 'https://googletagmanager.com/script.js',
          mimeType: 'text/javascript',
        }),
        makeResponse({ url: 'https://example.com/api/data', mimeType: 'application/json' }),
      ];
      const filtered = filterCriticalResponses(responses);
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.url).toContain('example.com');
    });

    it('includes JSON responses', () => {
      const responses = [makeResponse({ mimeType: 'application/json' })];
      const filtered = filterCriticalResponses(responses);
      expect(filtered.length).toBe(1);
    });

    it('includes JavaScript responses', () => {
      const responses = [makeResponse({ mimeType: 'text/javascript' })];
      const filtered = filterCriticalResponses(responses);
      expect(filtered.length).toBe(1);
    });

    it('includes responses with whitelist keyword in URL', () => {
      const responses = [
        makeResponse({ url: 'https://example.com/api/auth', mimeType: 'text/html' }),
      ];
      const filtered = filterCriticalResponses(responses);
      expect(filtered.length).toBe(1);
    });

    it('excludes responses without matching criteria', () => {
      const responses = [makeResponse({ url: 'https://example.com/about', mimeType: 'text/html' })];
      const filtered = filterCriticalResponses(responses);
      expect(filtered.length).toBe(0);
    });

    it('sorts by timestamp descending', () => {
      const responses = [
        makeResponse({
          url: 'https://example.com/api/a',
          mimeType: 'application/json',
          timestamp: 100,
        }),
        makeResponse({
          url: 'https://example.com/api/b',
          mimeType: 'application/json',
          timestamp: 200,
        }),
      ];
      const filtered = filterCriticalResponses(responses);
      expect(filtered[0]!.timestamp).toBeGreaterThanOrEqual(filtered[1]!.timestamp);
    });
  });

  describe('calculateLogPriority', () => {
    it('gives highest score to error logs', () => {
      const errorLog = makeLog({ type: 'error', text: 'something failed' });
      const infoLog = makeLog({ type: 'log', text: 'something failed' });
      expect(calculateLogPriority(errorLog)).toBeGreaterThan(calculateLogPriority(infoLog));
    });

    it('gives medium score to warn logs', () => {
      const warnLog = makeLog({ type: 'warn', text: 'something' });
      const infoLog = makeLog({ type: 'log', text: 'something' });
      expect(calculateLogPriority(warnLog)).toBeGreaterThan(calculateLogPriority(infoLog));
    });

    it('increases score for whitelist keywords in text', () => {
      const withKeyword = makeLog({ text: 'token validation failed' });
      const without = makeLog({ text: 'loaded stylesheet' });
      expect(calculateLogPriority(withKeyword)).toBeGreaterThan(calculateLogPriority(without));
    });
  });

  describe('filterCriticalLogs', () => {
    it('filters out framework logs', () => {
      const logs = [
        makeLog({ text: '[HMR] Module hot-reloaded' }),
        makeLog({ text: '[webpack] Building...', type: 'log' }),
        makeLog({ text: 'token expired', type: 'warn' }),
      ];
      const filtered = filterCriticalLogs(logs);
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.text).toContain('token');
    });

    it('filters out empty logs', () => {
      const logs = [
        makeLog({ text: '' }),
        makeLog({ text: '   ' }),
        makeLog({ text: 'auth failed', type: 'error' }),
      ];
      const filtered = filterCriticalLogs(logs);
      expect(filtered.length).toBe(1);
    });

    it('includes error and warn types', () => {
      const logs = [
        makeLog({ type: 'error', text: 'runtime error' }),
        makeLog({ type: 'warn', text: 'deprecation notice' }),
      ];
      const filtered = filterCriticalLogs(logs);
      expect(filtered.length).toBe(2);
    });

    it('includes logs with whitelist keywords even if type is log', () => {
      const logs = [makeLog({ type: 'log', text: 'User token refreshed' })];
      const filtered = filterCriticalLogs(logs);
      expect(filtered.length).toBe(1);
    });

    it('excludes info logs without keywords', () => {
      const logs = [makeLog({ type: 'log', text: 'Page loaded successfully' })];
      const filtered = filterCriticalLogs(logs);
      expect(filtered.length).toBe(0);
    });

    it('sorts by priority descending', () => {
      const logs = [
        makeLog({ type: 'log', text: 'token found' }),
        makeLog({ type: 'error', text: 'auth login failed with token' }),
      ];
      const filtered = filterCriticalLogs(logs);
      expect(filtered[0]!.type).toBe('error');
    });
  });

  describe('deduplicatePatterns', () => {
    it('removes duplicates based on type and location', () => {
      const patterns = [
        { type: 'AES', location: 'https://example.com/api' },
        { type: 'AES', location: 'https://example.com/api' },
        { type: 'RSA', location: 'https://example.com/api' },
      ];
      const deduped = deduplicatePatterns(patterns);
      expect(deduped.length).toBe(2);
    });

    it('returns empty array for empty input', () => {
      expect(deduplicatePatterns([])).toEqual([]);
    });

    it('preserves first occurrence', () => {
      const patterns = [
        { type: 'AES', location: 'loc1', confidence: 0.9 },
        { type: 'AES', location: 'loc1', confidence: 0.5 },
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const deduped = deduplicatePatterns(patterns as any);
      expect(deduped.length).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect((deduped[0] as any).confidence).toBe(0.9);
    });
  });

  describe('detectEncryptionPatterns', () => {
    it('detects AES keyword in request URL', () => {
      const requests = [makeRequest({ url: 'https://example.com/api/aes-encrypt' })];
      const patterns = detectEncryptionPatterns(requests, []);
      expect(patterns.some((p) => p.type === 'AES')).toBe(true);
    });

    it('detects crypto keywords in POST data', () => {
      const requests = [
        makeRequest({
          url: 'https://example.com/submit',
          method: 'POST',
          postData: 'cipher=aes256',
        }),
      ];
      const patterns = detectEncryptionPatterns(requests, []);
      expect(patterns.some((p) => p.type === 'AES')).toBe(true);
      expect(patterns.some((p) => p.evidence.includes('Found in POST data'))).toBe(true);
    });

    it('detects RSA keywords', () => {
      const requests = [makeRequest({ url: 'https://example.com/rsa/publickey' })];
      const patterns = detectEncryptionPatterns(requests, []);
      expect(patterns.some((p) => p.type === 'RSA')).toBe(true);
    });

    it('detects MD5 keywords', () => {
      const requests = [makeRequest({ url: 'https://example.com/hash/md5' })];
      const patterns = detectEncryptionPatterns(requests, []);
      expect(patterns.some((p) => p.type === 'MD5')).toBe(true);
    });

    it('detects SHA keywords', () => {
      const requests = [makeRequest({ url: 'https://example.com/hash/sha256' })];
      const patterns = detectEncryptionPatterns(requests, []);
      expect(patterns.some((p) => p.type === 'SHA')).toBe(true);
    });

    it('detects Base64 keywords', () => {
      const requests = [makeRequest({ url: 'https://example.com/encode/base64' })];
      const patterns = detectEncryptionPatterns(requests, []);
      expect(patterns.some((p) => p.type === 'Base64')).toBe(true);
    });

    it('detects encryption patterns in console logs', () => {
      const logs = [
        makeLog({ text: 'CryptoJS.AES.encrypt(data)', url: 'https://example.com/app.js' }),
      ];
      const patterns = detectEncryptionPatterns([], logs);
      expect(patterns.some((p) => p.type === 'AES')).toBe(true);
      expect(patterns.some((p) => p.evidence.includes('Found in console log'))).toBe(true);
    });

    it('uses console as location when log has no url', () => {
      const logs = [makeLog({ text: 'using md5 hash', url: undefined })];
      const patterns = detectEncryptionPatterns([], logs);
      expect(patterns.some((p) => p.location === 'console')).toBe(true);
    });

    it('deduplicates results', () => {
      const requests = [
        makeRequest({ url: 'https://example.com/aes' }),
        makeRequest({ url: 'https://example.com/aes' }),
      ];
      const patterns = detectEncryptionPatterns(requests, []);
      const aesPatterns = patterns.filter((p) => p.type === 'AES');
      // Should be deduplicated (same type + location)
      expect(aesPatterns.length).toBeLessThanOrEqual(1);
    });
  });

  describe('detectSignaturePatterns', () => {
    it('delegates to detectSignaturePatternsInternal', () => {
      const requests = [makeRequest()];
      const logs = [makeLog()];
      detectSignaturePatterns(requests, logs);
      expect(detectSignaturePatternsInternal).toHaveBeenCalledWith(requests);
    });
  });

  describe('detectTokenPatterns', () => {
    it('delegates to detectTokenPatternsInternal', () => {
      const requests = [makeRequest()];
      const logs = [makeLog()];
      detectTokenPatterns(requests, logs);
      expect(detectTokenPatternsInternal).toHaveBeenCalledWith(requests);
    });
  });

  describe('detectAntiDebugPatterns', () => {
    it('detects debugger keyword', () => {
      const logs = [makeLog({ text: 'debugger statement hit', url: 'https://example.com/app.js' })];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns.some((p) => p.type === 'debugger')).toBe(true);
    });

    it('detects console.log with assignment', () => {
      const logs = [
        makeLog({ text: 'console.log = function(){}', url: 'https://example.com/app.js' }),
      ];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns.some((p) => p.type === 'console.log')).toBe(true);
    });

    it('detects devtools-detect keyword', () => {
      const logs = [makeLog({ text: 'devtools is open', url: 'https://example.com/app.js' })];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns.some((p) => p.type === 'devtools-detect')).toBe(true);
    });

    it('detects firebug keyword', () => {
      const logs = [makeLog({ text: 'firebug detected', url: 'https://example.com/app.js' })];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns.some((p) => p.type === 'devtools-detect')).toBe(true);
    });

    it('detects timing-check with performance.now', () => {
      const logs = [
        makeLog({ text: 'performance.now() diff > 100', url: 'https://example.com/app.js' }),
      ];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns.some((p) => p.type === 'timing-check')).toBe(true);
    });

    it('detects timing-check with Date.now', () => {
      const logs = [makeLog({ text: 'Date.now() check', url: 'https://example.com/app.js' })];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns.some((p) => p.type === 'timing-check')).toBe(true);
    });

    it('uses unknown as location when url is missing', () => {
      const logs = [makeLog({ text: 'debugger trap', url: undefined })];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns.some((p) => p.location === 'unknown')).toBe(true);
    });

    it('truncates code to 200 characters', () => {
      const longText = 'debugger ' + 'x'.repeat(300);
      const logs = [makeLog({ text: longText, url: 'test.js' })];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns[0]!.code.length).toBeLessThanOrEqual(200);
    });

    it('returns empty for logs without anti-debug patterns', () => {
      const logs = [makeLog({ text: 'normal log message' })];
      const patterns = detectAntiDebugPatterns(logs);
      expect(patterns.length).toBe(0);
    });
  });

  describe('extractSuspiciousAPIs', () => {
    it('extracts API paths containing /api/', () => {
      const requests = [makeRequest({ url: 'https://example.com/api/users', method: 'GET' })];
      const apis = extractSuspiciousAPIs(requests);
      expect(apis.some((a) => a.includes('/api/users'))).toBe(true);
    });

    it('extracts API paths containing /v1/', () => {
      const requests = [makeRequest({ url: 'https://example.com/v1/data', method: 'POST' })];
      const apis = extractSuspiciousAPIs(requests);
      expect(apis.some((a) => a.includes('POST /v1/data'))).toBe(true);
    });

    it('extracts API paths containing /v2/', () => {
      const requests = [makeRequest({ url: 'https://example.com/v2/items', method: 'GET' })];
      const apis = extractSuspiciousAPIs(requests);
      expect(apis.some((a) => a.includes('GET /v2/items'))).toBe(true);
    });

    it('skips invalid URLs', () => {
      const requests = [makeRequest({ url: 'not-a-valid-url' })];
      const apis = extractSuspiciousAPIs(requests);
      expect(apis.length).toBe(0);
    });

    it('limits results to 20', () => {
      const requests = Array.from({ length: 30 }, (_, i) =>
        makeRequest({ url: `https://example.com/api/resource${i}`, requestId: `r${i}` })
      );
      const apis = extractSuspiciousAPIs(requests);
      expect(apis.length).toBeLessThanOrEqual(20);
    });

    it('deduplicates same method+path', () => {
      const requests = [
        makeRequest({ url: 'https://example.com/api/data', method: 'GET', requestId: 'r1' }),
        makeRequest({ url: 'https://example.com/api/data', method: 'GET', requestId: 'r2' }),
      ];
      const apis = extractSuspiciousAPIs(requests);
      expect(apis.filter((a) => a.includes('GET /api/data')).length).toBe(1);
    });
  });

  describe('extractKeyFunctions', () => {
    it('extracts function names from console logs', () => {
      const logs = [makeLog({ text: 'myFunction(arg1, arg2)' })];
      const functions = extractKeyFunctions(logs);
      expect(functions).toContain('myFunction');
    });

    it('excludes console/logging function names', () => {
      const logs = [makeLog({ text: 'console.log("test")' })];
      const functions = extractKeyFunctions(logs);
      expect(functions).not.toContain('console');
      expect(functions).not.toContain('log');
    });

    it('excludes warn, error, info, debug', () => {
      const logs = [makeLog({ text: 'warn(x) error(y) info(z) debug(w)' })];
      const functions = extractKeyFunctions(logs);
      expect(functions).not.toContain('warn');
      expect(functions).not.toContain('error');
      expect(functions).not.toContain('info');
      expect(functions).not.toContain('debug');
    });

    it('limits to 30 functions', () => {
      const text = Array.from({ length: 40 }, (_, i) => `func${i}()`).join(' ');
      const logs = [makeLog({ text })];
      const functions = extractKeyFunctions(logs);
      expect(functions.length).toBeLessThanOrEqual(30);
    });

    it('deduplicates function names', () => {
      const logs = [makeLog({ text: 'myFunc() myFunc() myFunc()' })];
      const functions = extractKeyFunctions(logs);
      expect(functions.filter((f) => f === 'myFunc').length).toBe(1);
    });

    it('returns empty for logs with no function calls', () => {
      const logs = [makeLog({ text: 'just plain text no calls' })];
      const functions = extractKeyFunctions(logs);
      expect(functions.length).toBe(0);
    });
  });
});
