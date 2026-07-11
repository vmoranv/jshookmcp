import { createConsoleMonitorMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeAll, describe, expect, it } from 'vitest';

import { TlsBotHandlers } from '@server/domains/network/handlers/tls-bot-handlers';
import { detectBotSignals } from '@server/domains/network/handlers/bot-detection';
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

    it('rejects non-array TLS inputs instead of silently treating them as empty', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_tls',
        ciphers: '0x1301',
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(false);
      expect(String(json.error)).toContain('ciphers');
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

    it('rejects non-array httpHeaders values', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'compute_http',
        httpHeaders: 'Host',
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(false);
      expect(String(json.error)).toContain('httpHeaders');
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

  describe('detectBotSignals — JA3/JA4 fingerprint integration', () => {
    // Zero hardcoded feature library: ja3/ja4 are informational; only a
    // user-supplied knownBad list produces a known-bot score.
    it('exposes ja3/ja4 as informational signals without inflating score (no knownBad list)', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const headers = ['host', 'user-agent', 'accept', 'accept-language', 'accept-encoding'];
      const baseline = detectBotSignals(ua, headers);
      const withJa = detectBotSignals(ua, headers, undefined, {
        ja3: '773906b0efdefa24a7f2b8eb6985bf36',
        ja4: 't13d1516h2_8daaf6153504_6b9b2d2b4b4b',
      });
      expect(withJa.signals.some((s) => s.includes('tls-ja3: 773906b0'))).toBe(true);
      expect(withJa.signals.some((s) => s.includes('tls-ja4: t13d1516h2'))).toBe(true);
      // ja3/ja4 surface as information but must NOT inflate the score
      expect(withJa.score).toBe(baseline.score);
      expect(baseline.signals.some((s) => s.includes('tls-ja3'))).toBe(false);
    });

    it('scores known-bad ja3 match against a user-supplied list (no hardcoded library)', () => {
      const { score, signals } = detectBotSignals(
        'python-requests/2.28',
        ['host', 'user-agent'],
        undefined,
        {
          ja3: '773906b0efdefa24a7f2b8eb6985bf36',
          knownBadJa3: ['773906b0efdefa24a7f2b8eb6985bf36', 'deadbeefdeadbeefdeadbeefdeadbeef'],
        },
      );
      expect(signals.some((s) => s.includes('known-bot-ja3'))).toBe(true);
      expect(score).toBeGreaterThan(0.4);
    });

    it('does not match ja3 absent from the user knownBad list', () => {
      const { signals } = detectBotSignals(
        'Mozilla/5.0 Chrome/120',
        ['host', 'user-agent', 'accept'],
        undefined,
        {
          ja3: '773906b0efdefa24a7f2b8eb6985bf36',
          knownBadJa3: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
        },
      );
      expect(signals.some((s) => s.includes('known-bot-ja3'))).toBe(false);
    });

    it('scores known-bad ja4 match independently', () => {
      const { score, signals } = detectBotSignals('curl/8.0', ['host', 'user-agent'], undefined, {
        ja4: 't13d1516h2_8daaf6153504_6b9b2d2b4b4b',
        knownBadJa4: ['t13d1516h2_8daaf6153504_6b9b2d2b4b4b'],
      });
      expect(signals.some((s) => s.includes('known-bot-ja4'))).toBe(true);
      expect(score).toBeGreaterThan(0.4);
    });

    it('leaves score and signals unchanged when jaFingerprint is absent (regression)', () => {
      const headers = ['host', 'user-agent', 'accept', 'accept-language'];
      const baseline = detectBotSignals('Mozilla/5.0 Chrome/120', headers);
      const noJa = detectBotSignals('Mozilla/5.0 Chrome/120', headers, undefined, undefined);
      expect(noJa.score).toBe(baseline.score);
      expect(noJa.signals).toEqual(baseline.signals);
    });
  });

  describe('detectBotSignals — HTTP/2 fingerprint integration', () => {
    // Zero hardcoded feature library: the h2 hash is informational; only a
    // user-supplied knownBadH2 list produces a known-bot score. Mirrors ja3/ja4.
    const H2_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const cleanBrowserHeaders = [
      'host',
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
    ];
    const cleanBrowserUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    it('exposes h2 hash as an informational signal without inflating score (no knownBad list)', () => {
      const baseline = detectBotSignals(cleanBrowserUa, cleanBrowserHeaders);
      const withH2 = detectBotSignals(cleanBrowserUa, cleanBrowserHeaders, undefined, undefined, {
        hash: H2_HASH,
      });
      expect(withH2.signals.some((s) => s.includes('http2-fingerprint: a1b2c3d4'))).toBe(true);
      // h2 hash surfaces as information but must NOT inflate the score
      expect(withH2.score).toBe(baseline.score);
      expect(baseline.signals.some((s) => s.includes('http2-fingerprint'))).toBe(false);
    });

    it('scores known-bad h2 match against a user-supplied list (no hardcoded library)', () => {
      const { score, signals } = detectBotSignals(
        'python-requests/2.28',
        ['host', 'user-agent'],
        undefined,
        undefined,
        {
          hash: H2_HASH,
          knownBadH2: [H2_HASH, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
        },
      );
      expect(signals.some((s) => s.includes('known-bot-h2'))).toBe(true);
      expect(score).toBeGreaterThan(0.4);
    });

    it('does not match h2 hash absent from the user knownBadH2 list', () => {
      const { signals } = detectBotSignals(
        'Mozilla/5.0 Chrome/120',
        ['host', 'user-agent', 'accept'],
        undefined,
        undefined,
        {
          hash: H2_HASH,
          knownBadH2: ['0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'],
        },
      );
      expect(signals.some((s) => s.includes('known-bot-h2'))).toBe(false);
    });

    it('combines h2 and ja3 knownBad matches additively (clamped to 1.0)', () => {
      const { score } = detectBotSignals(
        'python-requests/2.28',
        ['host', 'user-agent'],
        undefined,
        {
          ja3: '773906b0efdefa24a7f2b8eb6985bf36',
          knownBadJa3: ['773906b0efdefa24a7f2b8eb6985bf36'],
        },
        {
          hash: H2_HASH,
          knownBadH2: [H2_HASH],
        },
      );
      // Both knownBad matches (0.45 + 0.45) on top of bot-ua (0.5) → clamped to 1.0
      expect(score).toBeGreaterThanOrEqual(0.9);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('leaves score and signals unchanged when h2Fingerprint is absent (regression)', () => {
      const baseline = detectBotSignals('Mozilla/5.0 Chrome/120', cleanBrowserHeaders);
      const noH2 = detectBotSignals(
        'Mozilla/5.0 Chrome/120',
        cleanBrowserHeaders,
        undefined,
        undefined,
        undefined,
      );
      expect(noH2.score).toBe(baseline.score);
      expect(noH2.signals).toEqual(baseline.signals);
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

    it('raises bot score when a captured request matches a user-supplied knownBad ja3', async () => {
      const requests = [
        {
          requestId: 'r1',
          url: TEST_URLS.root,
          method: 'GET',
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            accept: '*/*',
            'accept-language': 'en-US',
            'accept-encoding': 'gzip',
          },
        },
      ];
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({
        limit: 1,
        includeDetails: true,
        ja3: '773906b0efdefa24a7f2b8eb6985bf36',
        knownBadJa3: ['773906b0efdefa24a7f2b8eb6985bf36'],
      });
      const json = parseJson<Record<string, unknown>>(res);
      const details = json.details as Array<Record<string, unknown>>;
      expect(details).toBeDefined();
      expect(details.length).toBe(1);
      const botSignals = details[0]!.signals as string[];
      expect(botSignals.some((s) => s.includes('known-bot-ja3'))).toBe(true);
      expect(botSignals.some((s) => s.includes('tls-ja3: 773906b0'))).toBe(true);
      expect(details[0]!.botScore).toBeGreaterThan(0.4);
    });

    it('exposes ja3 informationally without scoring when no knownBad list is supplied', async () => {
      const requests = [
        {
          requestId: 'r2',
          url: TEST_URLS.root,
          method: 'GET',
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            accept: '*/*',
            'accept-language': 'en-US',
            'accept-encoding': 'gzip',
          },
        },
      ];
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({
        limit: 1,
        includeDetails: true,
        ja3: '773906b0efdefa24a7f2b8eb6985bf36',
      });
      const json = parseJson<Record<string, unknown>>(res);
      const details = json.details as Array<Record<string, unknown>>;
      const botSignals = details[0]!.signals as string[];
      expect(botSignals.some((s) => s.includes('tls-ja3: 773906b0'))).toBe(true);
      expect(botSignals.some((s) => s.includes('known-bot-ja3'))).toBe(false);
      // a clean browser request with an informational ja3 stays low-score
      expect(details[0]!.botScore).toBeLessThan(0.1);
    });

    it('raises bot score when a captured request matches a user-supplied knownBad h2 hash', async () => {
      const requests = [
        {
          requestId: 'r1',
          url: TEST_URLS.root,
          method: 'GET',
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            accept: '*/*',
            'accept-language': 'en-US',
            'accept-encoding': 'gzip',
          },
        },
      ];
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({
        limit: 1,
        includeDetails: true,
        h2Hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        knownBadH2: ['a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'],
      });
      const json = parseJson<Record<string, unknown>>(res);
      const details = json.details as Array<Record<string, unknown>>;
      expect(details).toBeDefined();
      expect(details.length).toBe(1);
      const botSignals = details[0]!.signals as string[];
      expect(botSignals.some((s) => s.includes('known-bot-h2'))).toBe(true);
      expect(botSignals.some((s) => s.includes('http2-fingerprint: a1b2c3d4'))).toBe(true);
      expect(details[0]!.botScore).toBeGreaterThan(0.4);
    });

    it('exposes h2 hash informationally without scoring when no knownBadH2 list is supplied', async () => {
      const requests = [
        {
          requestId: 'r2',
          url: TEST_URLS.root,
          method: 'GET',
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            accept: '*/*',
            'accept-language': 'en-US',
            'accept-encoding': 'gzip',
          },
        },
      ];
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });
      const res = await h.handleNetworkBotDetectAnalyze({
        limit: 1,
        includeDetails: true,
        h2Hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      });
      const json = parseJson<Record<string, unknown>>(res);
      const details = json.details as Array<Record<string, unknown>>;
      const botSignals = details[0]!.signals as string[];
      expect(botSignals.some((s) => s.includes('http2-fingerprint: a1b2c3d4'))).toBe(true);
      expect(botSignals.some((s) => s.includes('known-bot-h2'))).toBe(false);
      // a clean browser request with an informational h2 hash stays low-score
      expect(details[0]!.botScore).toBeLessThan(0.1);
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

    it('clamps limit into the supported range', async () => {
      const requests = Array.from({ length: 3 }, (_, i) => ({
        requestId: `r${i}`,
        url: withPath(TEST_URLS.root, `${i}`),
        method: 'GET',
        headers: { 'user-agent': 'Mozilla/5.0 Chrome/120', accept: '*/*' },
      }));
      const monitor = createConsoleMonitorMock({ getNetworkRequests: (() => requests) as any });
      const h = new TlsBotHandlers({ consoleMonitor: monitor as any });

      const low = parseJson<Record<string, unknown>>(
        await h.handleNetworkBotDetectAnalyze({ limit: -10 }),
      );
      const high = parseJson<Record<string, unknown>>(
        await h.handleNetworkBotDetectAnalyze({ limit: 9999 }),
      );

      expect(low.analyzed).toBe(1);
      expect(high.analyzed).toBe(3);
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

  describe('parse_client_hello', () => {
    // Pre-verified minimal ClientHello: TLS 1.3, one cipher (TLS_AES_128_GCM_SHA256=0x1301),
    // supported_versions(0304) + supported_groups(001d) + signature_algorithms(0403) + ALPN(h2).
    // Hand-assembled constant (no SNI → JA4 part A = "t13i..."); verified by the parser.
    const VALID_CH =
      '160301004f0100004b03030000000000000000000000000000000000000000000000000000000000000000000002130101000020002b0003020304000a00040002001d000d000400020403001000050003026832';

    it('parses ClientHello hex and returns JA3 + JA4', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'parse_client_hello',
        clientHelloHex: VALID_CH,
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(true);
      expect(json.mode).toBe('parse_client_hello');
      expect(json.ja3).toMatch(/^[0-9a-f]{32}$/);
      expect(typeof json.ja3_raw).toBe('string');
      expect(typeof json.ja4).toBe('string');
      expect((json.ja4 as string).startsWith('t13i0104h2')).toBe(true);
      expect(json.negotiatedVersion).toBe('0304');
      expect(json.hasSni).toBe(false);
      expect(json.alpn).toEqual(['h2']);
    });

    it('includes detailed analysis breakdown when includeAnalysis is true', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'parse_client_hello',
        clientHelloHex: VALID_CH,
        includeAnalysis: true,
      });
      const json = parseJson<Record<string, unknown>>(res);
      const analysis = json.analysis as Record<string, unknown>;
      expect(analysis).toBeDefined();
      expect(analysis.ciphers).toEqual(['1301']);
      expect(analysis.supportedVersions).toEqual(['0304']);
      expect(analysis.signatureAlgorithms).toEqual(['0403']);
    });

    it('fails when clientHelloHex is missing', async () => {
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'parse_client_hello',
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(false);
      expect(String(json.error)).toContain('clientHelloHex');
    });

    it('fails on a malformed record (wrong handshake type)', async () => {
      // 0x16 record + 0x02 handshake type = ServerHello, not ClientHello.
      const serverHelloHex = '1603010005020000020303';
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'parse_client_hello',
        clientHelloHex: serverHelloHex,
      });
      const json = parseJson<Record<string, unknown>>(res);
      expect(json.success).toBe(false);
      expect(String(json.error)).toContain('ClientHello');
    });

    it('accepts the parse_client_hello enum value at the schema layer', async () => {
      // Sanity that definitions.ts enum includes the new mode.
      const res = await handlers.handleNetworkTlsFingerprint({
        mode: 'parse_client_hello',
        clientHelloHex: 'not-hex',
      });
      const json = parseJson<Record<string, unknown>>(res);
      // Should NOT be rejected for an invalid mode — only for bad hex.
      expect(String(json.error)).not.toContain('Invalid mode');
    });
  });
});
