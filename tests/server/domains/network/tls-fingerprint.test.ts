import { createConsoleMonitorMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeAll, describe, expect, it } from 'vitest';

import { TlsBotHandlers } from '@server/domains/network/handlers/tls-bot-handlers';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('TlsBotHandlers — TLS/HTTP fingerprint/Bot behavioral tests', () => {
  let handlers: TlsBotHandlers;

  beforeAll(() => {
    const monitor = createConsoleMonitorMock();
    handlers = new TlsBotHandlers({ consoleMonitor: monitor as any });
  });

  describe('compute_tls', () => {
    it('produces deterministic TLS fingerprint for known cipher list', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_tls',
        tlsVersions: ['0x0304'],
        ciphers: ['0x1301', '0x1302', '0x1303', '0xc02b', '0xc02f'],
        extensions: ['0x0000', '0x000a', '0x0010', '0x002b', '0x0033'],
        signatureAlgorithms: ['0x0403', '0x0804'],
        alpn: 'h2',
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(true);
      expect(json.tls).toBeDefined();
      expect(json.tls_raw).toBeDefined();
      // Part A: t=TLS, 13=1.3, d=SNI, 05 ciphers, 05 extensions, h2=ALPN
      expect((json.tls as string).startsWith('t13d0505h2')).toBe(true);
    });

    it('filters GREASE values from ciphers and extensions', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_tls',
        tlsVersions: ['0x0303'],
        ciphers: ['0x0a0a', '0x1301', '0x1a1a', '0x1302'],
        extensions: ['0x2a2a', '0x000a', '0x4a4a', '0x0010'],
        signatureAlgorithms: ['0x0403'],
        alpn: '',
        sni: false,
      });
      const json = parseJson<Record<string, unknown>>(res);
      // GREASE filtered: 2 real ciphers, 2 real extensions, no SNI, no ALPN
      expect((json.tls as string).startsWith('t12i0202')).toBe(true);
    });

    it('selects highest TLS version after sorting', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_tls',
        tlsVersions: ['0x0301', '0x0303', '0x0304'],
        ciphers: ['0x1301'],
        extensions: ['0x000a'],
        signatureAlgorithms: [],
        alpn: 'h2',
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect((json.tls as string).startsWith('t13')).toBe(true);
    });

    it('fails when ciphers array is empty', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_tls',
        tlsVersions: ['0x0303'],
        ciphers: [],
        extensions: [],
        signatureAlgorithms: [],
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(false);
    });
  });

  describe('compute_http', () => {
    it('computes HTTP fingerprint with sorted headers and cookie hashes', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_http',
        httpMethod: 'GET',
        httpHeaders: [
          'Host',
          'User-Agent',
          'Accept',
          'Accept-Language',
          'Accept-Encoding',
          'Cookie',
        ],
        httpVersion: '1.1',
        cookieHeader: 'session=abc; token=xyz',
        acceptLanguage: 'en-US,en;q=0.9',
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(true);
      expect(json.http).toBeDefined();
      const httpFp = json.http as string;
      // ge=GET, 11=1.1, c=cookie, n=no-referer, 05 headers (exclude cookie/referer), enus (lowercased)
      expect(httpFp.startsWith('ge11cn05enus')).toBe(true);
      expect(httpFp.split('_')).toHaveLength(4);
    });

    it('handles unknown HTTP methods with 2-char fallback', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_http',
        httpMethod: 'PROPFIND',
        httpHeaders: ['Host'],
      });
      const json = parseJson<Record<string, unknown>>(res);
      const httpFp = json.http as string;
      expect(httpFp.startsWith('pr11')).toBe(true);
    });

    it('produces empty hashes when no cookies present', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_http',
        httpMethod: 'POST',
        httpHeaders: ['Host', 'Content-Type'],
      });
      const json = parseJson<Record<string, unknown>>(res);
      const parts = (json.http as string).split('_');
      expect(parts[2]).toBe('000000000000');
      expect(parts[3]).toBe('000000000000');
    });

    it('fails when httpHeaders is empty', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_http',
        httpHeaders: [],
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(false);
    });
  });

  describe('detectBotSignals (via analyze_request)', () => {
    it('detects headless browser UA', async () => {
      const monitor = createConsoleMonitorMock({
        getNetworkRequests: (() => [
          {
            requestId: 'req-1',
            url: TEST_URLS.root,
            method: 'GET',
            headers: { 'user-agent': 'Mozilla/5.0 (HeadlessChrome/120.0)', accept: '*/*' },
          },
        ]) as any,
      });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkTlsFingerprint({
        mode: 'analyze_request',
        requestId: 'req-1',
      });
      const json = parseJson<Record<string, unknown>>(res);
      const analysis = json.analysis as Record<string, unknown>;
      const bot = analysis.botSignals as { score: number; signals: string[] };
      expect(bot.score).toBeGreaterThan(0);
      expect(bot.signals.some((s) => s.includes('headless'))).toBe(true);
    });

    it('flags requests missing common headers', async () => {
      const monitor = createConsoleMonitorMock({
        getNetworkRequests: (() => [
          {
            requestId: 'req-2',
            url: TEST_URLS.root,
            method: 'GET',
            headers: { 'user-agent': 'python-requests/2.28' },
          },
        ]) as any,
      });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkTlsFingerprint({
        mode: 'analyze_request',
        requestId: 'req-2',
      });
      const json = parseJson<Record<string, unknown>>(res);
      const bot = (json.analysis as Record<string, unknown>).botSignals as {
        score: number;
        signals: string[];
      };
      expect(bot.score).toBeGreaterThan(0.5);
    });

    it('omits analysis when includeAnalysis is false and still returns basic fingerprint fields', async () => {
      const monitor = createConsoleMonitorMock({
        getNetworkRequests: (() => [
          {
            requestId: 'req-3',
            url: withPath(TEST_URLS.root, 'login'),
            method: 'POST',
            headers: {
              'user-agent': 'Mozilla/5.0 Chrome/123.0',
              accept: '*/*',
              cookie: 'sid=abc',
            },
          },
        ]) as any,
      });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkTlsFingerprint({
        mode: 'analyze_request',
        requestId: 'req-3',
        includeAnalysis: false,
      });
      const json = parseJson<Record<string, unknown>>(res);

      expect(json.success).toBe(true);
      expect(json.mode).toBe('analyze_request');
      expect(json.requestId).toBe('req-3');
      expect(json.url).toBe(withPath(TEST_URLS.root, 'login'));
      expect(json.method).toBe('POST');
      expect(typeof json.http).toBe('string');
      expect(json.analysis).toBeUndefined();
    });

    it('does not treat captured requests with unknown protocol as HTTP/1.1', async () => {
      const monitor = createConsoleMonitorMock({
        getNetworkRequests: (() => [
          {
            requestId: 'req-unknown',
            url: withPath(TEST_URLS.root, 'app'),
            method: 'GET',
            headers: {
              'user-agent': 'Mozilla/5.0 Chrome/123.0',
              accept: '*/*',
            },
          },
        ]) as any,
      });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkTlsFingerprint({
        mode: 'analyze_request',
        requestId: 'req-unknown',
      });
      const json = parseJson<Record<string, unknown>>(res);

      expect(json.httpVersion).toBe('unknown');
      expect((json.http as string).startsWith('ge00')).toBe(true);
      expect((json.analysis as Record<string, unknown>).httpVersion as string).toBe('unknown');
    });

    it('does not infer response security headers from request headers', async () => {
      const monitor = createConsoleMonitorMock({
        getNetworkRequests: (() => [
          {
            requestId: 'req-4',
            url: withPath(TEST_URLS.root, 'app'),
            method: 'GET',
            headers: {
              'user-agent': 'Mozilla/5.0 Chrome/123.0',
              accept: '*/*',
              'content-security-policy': "default-src 'self'",
              'strict-transport-security': 'max-age=31536000',
              'access-control-allow-origin': '*',
            },
          },
        ]) as any,
      });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkTlsFingerprint({
        mode: 'analyze_request',
        requestId: 'req-4',
      });
      const json = parseJson<Record<string, unknown>>(res);
      const analysis = json.analysis as Record<string, unknown>;
      const securityHeaders = analysis.securityHeaders as Record<string, unknown>;

      expect(securityHeaders.hasCSP).toBeUndefined();
      expect(securityHeaders.hasHSTS).toBeUndefined();
      expect(securityHeaders.hasCORS).toBeUndefined();
    });
  });

  describe('bot_detect_analyze', () => {
    it('returns diversity analysis for multiple requests', async () => {
      const requests = Array.from({ length: 10 }, (_, i) => ({
        requestId: `req-${i}`,
        url: withPath(TEST_URLS.root, `page/${i}`),
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 Chrome/120',
          accept: '*/*',
          'accept-language': 'en-US',
        },
      }));
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({ limit: 10 });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.analyzed).toBe(10);
      expect(json.httpFingerprintSummary).toBeDefined();
    });

    it('returns empty summary when no requests', async () => {
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => []) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({});
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.analyzed).toBe(0);
    });

    it('detects UA drift for same fingerprint', async () => {
      const requests = [
        {
          requestId: 'r1',
          url: withPath(TEST_URLS.root, '1'),
          method: 'GET',
          headers: { 'user-agent': 'Chrome/120', accept: '*/*', 'accept-language': 'en' },
        },
        {
          requestId: 'r2',
          url: withPath(TEST_URLS.root, '2'),
          method: 'GET',
          headers: { 'user-agent': 'Chrome/119', accept: '*/*', 'accept-language': 'en' },
        },
      ];
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({ limit: 2 });
      const json = parseJson<Record<string, unknown>>(res);
      const irc = json.interRequestConsistency as Record<string, unknown>;
      expect(irc).toBeDefined();
      expect(irc.uaDriftCount).toBeGreaterThan(0);
    });

    it('reports perfect consistency for identical requests', async () => {
      const ua = 'Mozilla/5.0 Chrome/120';
      const requests = Array.from({ length: 5 }, (_, i) => ({
        requestId: `r${i}`,
        url: withPath(TEST_URLS.root, `${i}`),
        method: 'GET',
        headers: { 'user-agent': ua, accept: '*/*', 'accept-language': 'en' },
      }));
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({ limit: 5 });
      const json = parseJson<Record<string, unknown>>(res);
      const irc = json.interRequestConsistency as Record<string, unknown>;
      expect(irc.consistencyScore).toBe(1.0);
      expect(irc.uaDriftCount).toBe(0);
      expect(irc.headerOrderDriftCount).toBe(0);
    });

    it('clamps consistencyScore to 0 when all requests drift', async () => {
      const requests = Array.from({ length: 3 }, (_, i) => ({
        requestId: `r${i}`,
        url: withPath(TEST_URLS.root, `${i}`),
        method: 'GET',
        headers: { 'user-agent': `Chrome/${120 + i}`, accept: '*/*', 'accept-language': 'en' },
      }));
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({ limit: 3 });
      const json = parseJson<Record<string, unknown>>(res);
      const irc = json.interRequestConsistency as Record<string, unknown>;
      expect(Number(irc.consistencyScore)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('mode validation', () => {
    it('rejects invalid mode', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({ mode: 'invalid_mode' });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(false);
      expect(json.error as string).toContain('Invalid mode');
    });

    it('rejects missing mode', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({});
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(false);
      expect(json.error as string).toContain('Invalid mode');
    });
  });
});
