import { createHash } from 'node:crypto';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import { R } from '@server/domains/shared/ResponseBuilder';
import { BOT_DETECT_LIMIT_DEFAULT } from '@src/constants';

// GREASE values per draft-davidben-tls-grease-01
const GREASE_HEX = new Set([
  '0a0a',
  '1a1a',
  '2a2a',
  '3a3a',
  '4a4a',
  '5a5a',
  '6a6a',
  '7a7a',
  '8a8a',
  '9a9a',
  'aaaa',
  'baba',
  'caca',
  'dada',
  'eaea',
  'fafa',
]);

function isGrease(hex: string): boolean {
  return GREASE_HEX.has(hex.replace('0x', '').toLowerCase().padStart(4, '0'));
}

function sha256trunc12(input: string): string {
  return createHash('sha256').update(input).digest('hex').substring(0, 12);
}

function toHex4(val: string): string {
  return val.replace('0x', '').toLowerCase().padStart(4, '0');
}

const TLS_VERSION_MAP: Record<string, string> = {
  '0304': '13',
  '0303': '12',
  '0302': '11',
  '0301': '10',
  '0300': 's3',
  '0002': 's2',
  feff: 'd1',
  fefd: 'd2',
  fefc: 'd3',
};

function encodeTlsVersion(versionHex: string): string {
  return TLS_VERSION_MAP[versionHex.toLowerCase()] ?? '00';
}

function encodeAlpn(alpn: string): string {
  if (!alpn || alpn.length === 0) return '00';
  const first = alpn[0]!;
  const last = alpn[alpn.length - 1]!;
  const isFirstAlphaNum = /[0-9a-zA-Z]/.test(first);
  const isLastAlphaNum = /[0-9a-zA-Z]/.test(last);
  if (isFirstAlphaNum && isLastAlphaNum) return `${first}${last}`;
  const hex = Buffer.from(alpn, 'utf8').toString('hex');
  return `${hex[0] ?? '0'}${hex[hex.length - 1] ?? '0'}`;
}

function computeTlsFingerprint(opts: {
  protocol: 'tls' | 'quic' | 'dtls';
  tlsVersion: string;
  hasSni: boolean;
  ciphers: string[];
  extensions: string[];
  signatureAlgorithms: string[];
  alpn: string;
}): { tls: string; tls_raw: string } {
  const { protocol, tlsVersion, hasSni, ciphers, extensions, signatureAlgorithms, alpn } = opts;

  const protoChar = protocol === 'quic' ? 'q' : protocol === 'dtls' ? 'd' : 't';

  // Use highest non-GREASE TLS version — sort ascending then take last
  const filteredVersions = [tlsVersion].map(toHex4).filter((v) => !isGrease(v) && v !== '0303');
  // Also include '0303' as baseline if no other version given
  const allVersions = tlsVersion.length > 0 ? filteredVersions : ['0303'];
  const sorted = allVersions.toSorted();
  const bestVersion = sorted.length > 0 ? sorted[sorted.length - 1]! : '0303';
  const versionStr = encodeTlsVersion(bestVersion);

  const sniChar = hasSni ? 'd' : 'i';

  const filteredCiphers = ciphers.map(toHex4).filter((c) => !isGrease(c));
  const filteredExts = extensions.map(toHex4).filter((e) => !isGrease(e));

  const numCiphers = String(Math.min(filteredCiphers.length, 99)).padStart(2, '0');
  const numExts = String(Math.min(filteredExts.length, 99)).padStart(2, '0');
  const alpnStr = encodeAlpn(alpn);

  const a = `${protoChar}${versionStr}${sniChar}${numCiphers}${numExts}${alpnStr}`;

  const sortedCiphers = filteredCiphers.toSorted();
  const cipherStr = sortedCiphers.join(',');
  const cipherHash = filteredCiphers.length > 0 ? sha256trunc12(cipherStr) : '000000000000';

  const extsForHash = filteredExts.filter((e) => e !== '0000' && e !== '0010').toSorted();
  // Signature algorithms are NOT GREASE-filtered, kept in original order
  const sigHex = signatureAlgorithms.map(toHex4);
  let extInput: string;
  if (sigHex.length > 0) {
    extInput = `${extsForHash.join(',')}_${sigHex.join(',')}`;
  } else {
    extInput = extsForHash.join(',');
  }
  const extHash =
    extsForHash.length > 0 || sigHex.length > 0 ? sha256trunc12(extInput) : '000000000000';

  const tls = `${a}_${cipherHash}_${extHash}`;

  const tls_raw = `${a}_${filteredCiphers.join(',')}_${filteredExts.join(',')}_${sigHex.join(',')}`;

  return { tls, tls_raw };
}

function computeHttpFingerprint(
  method: string,
  headers: string[],
  httpVersion?: string,
  cookieHeader?: string,
  acceptLanguage?: string,
): { http: string } {
  // HTTP fingerprint format:
  // {method2}{version}{cookie}{referer}{headerLen}{lang}_{headersHash}_{cookieNamesHash}_{cookieValuesHash}
  const methodUpper = method.toUpperCase();
  const methodCode =
    {
      GET: 'ge',
      POST: 'po',
      PUT: 'pu',
      DELETE: 'de',
      HEAD: 'he',
      PATCH: 'pa',
      OPTIONS: 'ot',
    }[methodUpper] ??
    methodUpper.toLowerCase().substring(0, 2).padEnd(2, methodUpper.charAt(0).toLowerCase());

  // HTTP version: 10=HTTP/1.0, 11=HTTP/1.1, 20=HTTP/2, 30=HTTP/3
  const normalizedHttpVersion =
    typeof httpVersion === 'string' ? httpVersion.trim().toLowerCase() : '';
  const versionStr =
    normalizedHttpVersion === '2' ||
    normalizedHttpVersion === '2.0' ||
    normalizedHttpVersion === 'h2' ||
    normalizedHttpVersion === 'http/2'
      ? '20'
      : normalizedHttpVersion === '3' ||
          normalizedHttpVersion === '3.0' ||
          normalizedHttpVersion === 'h3' ||
          normalizedHttpVersion === 'http/3'
        ? '30'
        : normalizedHttpVersion === '1.0' || normalizedHttpVersion === 'http/1.0'
          ? '10'
          : normalizedHttpVersion === '1.1' || normalizedHttpVersion === 'http/1.1'
            ? '11'
            : '00';

  const lowerHeaders = headers.map((h) => h.toLowerCase());
  const hasCookie = lowerHeaders.includes('cookie') ? 'c' : 'n';
  const hasReferer = lowerHeaders.includes('referer') ? 'r' : 'n';

  // Header count excludes cookie and referer
  const nonCookieRefererHeaders = lowerHeaders.filter((h) => h !== 'cookie' && h !== 'referer');
  const numHeaders = String(Math.min(nonCookieRefererHeaders.length, 99)).padStart(2, '0');

  // Language: first 4 chars of accept-language, stripped of -/;, lowercased, first comma-split
  let langStr = '0000';
  if (acceptLanguage && acceptLanguage.length > 0) {
    const firstLang = acceptLanguage.split(',')[0] ?? '';
    const stripped = firstLang.replace(/[-;]/g, '').toLowerCase().trim();
    langStr = stripped.padEnd(4, '0').substring(0, 4);
  }

  const a = `${methodCode}${versionStr}${hasCookie}${hasReferer}${numHeaders}${langStr}`;

  // Headers hash: sorted header names excluding :pseudo, cookie, referer
  const sortedHeaders = nonCookieRefererHeaders.filter((h) => !h.startsWith(':')).toSorted();
  const headerHash =
    sortedHeaders.length > 0 ? sha256trunc12(sortedHeaders.join(',')) : '000000000000';

  // Cookie names hash: sorted cookie field names
  let cookieNamesHash = '000000000000';
  let cookieValuesHash = '000000000000';
  if (hasCookie === 'c' && cookieHeader) {
    const cookiePairs = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean);
    const cookieNames = cookiePairs
      .map((c) => c.split('=')[0]?.trim() ?? '')
      .filter(Boolean)
      .toSorted();
    cookieNamesHash =
      cookieNames.length > 0 ? sha256trunc12(cookieNames.join(',')) : '000000000000';

    // Cookie values hash: pairs sorted by cookie NAME, then hash the full pair strings
    const cookiePairsForSort = cookiePairs.map((c) => {
      const eqIdx = c.indexOf('=');
      const name = eqIdx >= 0 ? c.substring(0, eqIdx).trim() : c.trim();
      return { name, pair: c };
    });
    const sortedByCookieName = cookiePairsForSort.toSorted((x, y) => x.name.localeCompare(y.name));
    const sortedValues = sortedByCookieName.map((p) => p.pair);
    cookieValuesHash =
      sortedValues.length > 0 ? sha256trunc12(sortedValues.join(',')) : '000000000000';
  }

  const http = `${a}_${headerHash}_${cookieNamesHash}_${cookieValuesHash}`;
  return { http };
}

function normalizeObservedHttpVersion(httpVersion: unknown): string | undefined {
  if (typeof httpVersion !== 'string') return undefined;
  const normalized = httpVersion.trim().toLowerCase();
  if (normalized === '1.0' || normalized === 'http/1.0') return '1.0';
  if (normalized === '1.1' || normalized === 'http/1.1') return '1.1';
  if (
    normalized === '2' ||
    normalized === '2.0' ||
    normalized === 'http/2' ||
    normalized === 'h2'
  ) {
    return 'h2';
  }
  if (
    normalized === '3' ||
    normalized === '3.0' ||
    normalized === 'http/3' ||
    normalized === 'h3'
  ) {
    return 'h3';
  }
  return undefined;
}

function detectBotSignals(
  ua: string,
  headerNames: string[],
  tlsSignals?: { cipherCount: number; extensionCount: number; tlsVersion: string },
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  if (!ua || ua.length === 0) {
    signals.push('missing-user-agent');
    score += 0.3;
  } else {
    const botPatterns =
      /bot|crawler|spider|headless|selenium|puppeteer|playwright|phantom|curl|wget|python|java|go-http|httpclient|okhttp|requests\/|aiohttp|axios|node-fetch|undici/i;
    if (botPatterns.test(ua)) {
      signals.push(`bot-ua: ${ua.substring(0, 40)}`);
      score += 0.5;
    }
    if (/headless/i.test(ua)) {
      signals.push('headless-browser');
      score += 0.4;
    }
    // Real browsers have long, detailed UA strings
    if (ua.length < 30 && !/bot|curl|wget|python/i.test(ua)) {
      signals.push('suspiciously-short-ua');
      score += 0.2;
    }
  }

  const lowerHeaders = headerNames.map((h) => h.toLowerCase());
  if (!lowerHeaders.includes('accept')) {
    signals.push('missing-accept-header');
    score += 0.15;
  }
  if (!lowerHeaders.includes('accept-language')) {
    signals.push('missing-accept-language');
    score += 0.1;
  }
  if (!lowerHeaders.includes('accept-encoding')) {
    signals.push('missing-accept-encoding');
    score += 0.1;
  }

  const headerCount = headerNames.length;
  if (headerCount < 4) {
    signals.push(`suspicious-few-headers: ${headerCount}`);
    score += 0.2;
  }

  // TLS-based signals (per arxiv 2602.09606 — bot detection via TLS fingerprints)
  if (tlsSignals) {
    // Real Chrome/Firefox browsers have 5-15 cipher suites
    if (tlsSignals.cipherCount <= 2) {
      signals.push(
        `anomalous-cipher-count: ${tlsSignals.cipherCount} (real browsers typically 5-15)`,
      );
      score += 0.3;
    }
    // Real browsers have many extensions (10-25+)
    if (tlsSignals.extensionCount < 5) {
      signals.push(`few-tls-extensions: ${tlsSignals.extensionCount} (real browsers 10-25+)`);
      score += 0.2;
    }
    // TLS 1.0/1.1 is rare for modern browsers
    if (/\bTLS\s*1\.[01]\b|\b1\.0\b|\b1\.1\b|\bSSL/i.test(tlsSignals.tlsVersion)) {
      signals.push(`outdated-tls-version: ${tlsSignals.tlsVersion}`);
      score += 0.25;
    }
  }

  // Header ordering signal: real browsers send headers in consistent order
  const expectedBrowserOrder = [
    'host',
    'connection',
    'cache-control',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'upgrade-insecure-requests',
    'user-agent',
    'accept',
    'sec-fetch-site',
    'sec-fetch-mode',
    'sec-fetch-user',
    'sec-fetch-dest',
    'referer',
    'accept-encoding',
    'accept-language',
  ];
  if (lowerHeaders.length >= 5) {
    const orderMatchCount = lowerHeaders
      .slice(0, 5)
      .filter((h, i) => h === expectedBrowserOrder[i]).length;
    if (orderMatchCount === 0) {
      signals.push('header-order-does-not-match-known-browser');
      score += 0.1;
    }
  }

  return { score: Math.min(score, 1.0), signals };
}

export class TlsBotHandlers {
  private consoleMonitor: ConsoleMonitor;

  constructor(deps: { consoleMonitor: ConsoleMonitor }) {
    this.consoleMonitor = deps.consoleMonitor;
  }

  async handleNetworkTlsFingerprint(args: Record<string, unknown>) {
    const mode = args['mode'] as string;
    const includeAnalysis = args['includeAnalysis'] !== false;

    const validModes = ['compute_tls', 'compute_http', 'analyze_request'];
    if (!mode || !validModes.includes(mode)) {
      return R.fail(`Invalid mode: "${mode}". Expected one of: ${validModes.join(', ')}`).json();
    }

    try {
      if (mode === 'compute_tls') {
        const tlsVersions = (args['tlsVersions'] as string[]) || [];
        const ciphers = (args['ciphers'] as string[]) || [];
        const extensions = (args['extensions'] as string[]) || [];
        const signatureAlgorithms = (args['signatureAlgorithms'] as string[]) || [];
        const protocol =
          (args['protocol'] as string) === 'quic'
            ? 'quic'
            : (args['protocol'] as string) === 'dtls'
              ? 'dtls'
              : 'tls';
        const sni = args['sni'] !== false;
        const alpn = (args['alpn'] as string) || '';

        if (ciphers.length === 0) {
          return R.fail('ciphers array is required for compute_tls mode').json();
        }

        // Use highest non-GREASE TLS version from the list
        const versionHexes = tlsVersions.map(toHex4);
        const nonGreaseVersions = versionHexes.filter((v) => !isGrease(v));
        const sortedVersions = nonGreaseVersions.toSorted();
        const tlsVersion =
          sortedVersions.length > 0 ? sortedVersions[sortedVersions.length - 1]! : '0303';

        const { tls, tls_raw } = computeTlsFingerprint({
          protocol,
          tlsVersion,
          hasSni: sni,
          ciphers,
          extensions,
          signatureAlgorithms,
          alpn,
        });

        const result: Record<string, unknown> = { success: true, mode: 'tls', tls, tls_raw };

        if (includeAnalysis) {
          const filteredCiphers = ciphers.map(toHex4).filter((c) => !isGrease(c));
          const filteredExts = extensions.map(toHex4).filter((e) => !isGrease(e));
          result.analysis = {
            protocol: protocol.toUpperCase(),
            tlsVersion,
            sni,
            cipherCount: filteredCiphers.length,
            extensionCount: filteredExts.length,
            signatureAlgorithmCount: signatureAlgorithms.length,
            alpn: alpn || '(none)',
            sortedCiphers: filteredCiphers.toSorted(),
            sortedExtensions: filteredExts.filter((e) => e !== '0000' && e !== '0010').toSorted(),
          };
        }
        return R.ok().merge(result).json();
      }

      if (mode === 'compute_http') {
        const headers = (args['httpHeaders'] as string[]) || [];
        const ua = (args['userAgent'] as string) || '';
        const method = (args['httpMethod'] as string) || 'GET';
        const httpVersion = (args['httpVersion'] as string) || '1.1';
        const cookieHeader = (args['cookieHeader'] as string) || '';
        const acceptLanguage = (args['acceptLanguage'] as string) || '';

        if (headers.length === 0) {
          return R.fail('httpHeaders array is required for compute_http mode').json();
        }

        const { http } = computeHttpFingerprint(
          method,
          headers,
          httpVersion,
          cookieHeader,
          acceptLanguage,
        );
        const result: Record<string, unknown> = { success: true, mode: 'http', http };

        if (includeAnalysis) {
          const lowerHeaders = headers.map((h) => h.toLowerCase());
          result.analysis = {
            method,
            httpVersion,
            headerCount: headers.length,
            nonCookieRefererHeaders: lowerHeaders.filter((h) => h !== 'cookie' && h !== 'referer')
              .length,
            hasCookie: lowerHeaders.includes('cookie'),
            hasAcceptLanguage: lowerHeaders.includes('accept-language'),
            sortedHeaders: lowerHeaders
              .filter((h) => h !== 'cookie' && h !== 'referer' && !h.startsWith(':'))
              .toSorted(),
            userAgentLength: ua.length,
          };
        }
        return R.ok().merge(result).json();
      }

      // mode === 'analyze_request' (fallthrough after compute_* early returns)
      const requestId = args['requestId'] as string;
      if (!requestId) {
        return R.fail('requestId is required for analyze_request mode').json();
      }
      const requests = this.consoleMonitor.getNetworkRequests();
      const req = requests.find((r: { requestId?: string }) => r.requestId === requestId);
      if (!req) {
        return R.fail(`Request ${requestId} not found`).json();
      }
      const headers = req.headers || {};
      const headerNames = Object.keys(headers);
      const ua = headers['user-agent'] || headers['User-Agent'] || '';
      const method = req.method || 'GET';
      const cookieHeader = headers['cookie'] || headers['Cookie'] || '';
      const acceptLanguage = headers['accept-language'] || headers['Accept-Language'] || '';
      const httpVersion = normalizeObservedHttpVersion(req.httpVersion);
      const { http } = computeHttpFingerprint(
        method,
        headerNames,
        httpVersion,
        cookieHeader,
        acceptLanguage,
      );

      const secDetails = (req as unknown as Record<string, unknown>)['securityDetails'] as
        | Record<string, unknown>
        | undefined;
      const tlsSignalsForBot =
        secDetails && typeof secDetails === 'object'
          ? {
              cipherCount:
                typeof secDetails['cipherCount'] === 'number' ? secDetails['cipherCount'] : 5,
              extensionCount:
                typeof secDetails['extensionCount'] === 'number'
                  ? secDetails['extensionCount']
                  : 10,
              tlsVersion: typeof secDetails['protocol'] === 'string' ? secDetails['protocol'] : '',
            }
          : undefined;
      const result: Record<string, unknown> = {
        success: true,
        mode: 'analyze_request',
        requestId,
        url: req.url,
        method,
        httpVersion: httpVersion ?? 'unknown',
        http,
      };
      const analysis: Record<string, unknown> = {
        requestId,
        url: req.url,
        method,
        httpVersion: httpVersion ?? 'unknown',
        http,
        headerCount: headerNames.length,
        headerOrder: headerNames.join(', '),
        userAgent: ua.length > 80 ? ua.substring(0, 80) + '...' : ua,
        // Response-only headers stay undefined in request analysis.
        securityHeaders: {
          hasCSP: undefined,
          hasHSTS: undefined,
          hasCORS: undefined,
        },
        botSignals: detectBotSignals(ua, headerNames, tlsSignalsForBot),
      };

      if (includeAnalysis) {
        result.analysis = analysis;
      }

      return R.ok().merge(result).json();
    } catch (error) {
      return R.fail(error instanceof Error ? error.message : String(error)).json();
    }
  }

  async handleNetworkBotDetectAnalyze(args: Record<string, unknown>) {
    const limit = typeof args['limit'] === 'number' ? args['limit'] : BOT_DETECT_LIMIT_DEFAULT;
    const includeDetails = args['includeDetails'] === true;

    const requests = this.consoleMonitor.getNetworkRequests();
    const sample = requests.slice(0, limit);

    if (sample.length === 0) {
      return R.ok()
        .merge({
          analyzed: 0,
          summary: 'No captured requests to analyze. Enable network monitoring first.',
        })
        .json();
    }

    const signals: string[] = [];
    const details: Array<Record<string, unknown>> = [];
    let totalBotScore = 0;

    // Track unique HTTP fingerprints for anomaly detection
    const httpFingerprints = new Map<string, number>();

    // Inter-request consistency tracking
    let uaDriftCount = 0;
    let headerOrderDriftCount = 0;
    const seenUserAgents = new Map<string, string>(); // httpFingerprint → UA
    let headerOrderBaseline: string | null = null;

    for (const req of sample) {
      const headers = req.headers || {};
      const headerNames = Object.keys(headers);
      const ua = headers['user-agent'] || headers['User-Agent'] || '';
      const url = req.url || '';
      const method = req.method || 'GET';
      const cookieHeader = headers['cookie'] || headers['Cookie'] || '';
      const acceptLanguage = headers['accept-language'] || headers['Accept-Language'] || '';
      const httpVersion = normalizeObservedHttpVersion(req.httpVersion);

      const secDetails = (req as unknown as Record<string, unknown>)['securityDetails'] as
        | Record<string, unknown>
        | undefined;
      const tlsSignalsForBot =
        secDetails && typeof secDetails === 'object'
          ? {
              cipherCount:
                typeof secDetails['cipherCount'] === 'number' ? secDetails['cipherCount'] : 5,
              extensionCount:
                typeof secDetails['extensionCount'] === 'number'
                  ? secDetails['extensionCount']
                  : 10,
              tlsVersion: typeof secDetails['protocol'] === 'string' ? secDetails['protocol'] : '',
            }
          : undefined;
      const reqSignals = detectBotSignals(ua, headerNames, tlsSignalsForBot);
      const isApiRequest = /\/api\/|\/v\d+\/|\/graphql/i.test(url);

      const { http } = computeHttpFingerprint(
        method,
        headerNames,
        httpVersion,
        cookieHeader,
        acceptLanguage,
      );
      httpFingerprints.set(http, (httpFingerprints.get(http) ?? 0) + 1);

      // Inter-request consistency: same HTTP fingerprint but different UA
      if (seenUserAgents.has(http)) {
        if (seenUserAgents.get(http) !== ua) {
          uaDriftCount++;
        }
      } else {
        seenUserAgents.set(http, ua);
      }
      // Header order consistency: first request sets baseline
      if (headerOrderBaseline === null) {
        headerOrderBaseline = headerNames.join(',');
      } else if (headerNames.join(',') !== headerOrderBaseline) {
        headerOrderDriftCount++;
      }

      const reqDetail: Record<string, unknown> = {
        requestId: req.requestId,
        url: url.length > 100 ? url.substring(0, 100) + '...' : url,
        method,
        http,
        botScore: reqSignals.score,
        signals: reqSignals.signals,
      };

      totalBotScore += reqSignals.score;

      if (reqSignals.score > 0.5) {
        signals.push(`Request ${req.requestId}: ${reqSignals.signals.join(', ')}`);
      }

      if (isApiRequest) {
        reqDetail.apiPattern = true;
      }

      if (includeDetails) {
        details.push(reqDetail);
      }
    }

    const avgBotScore = sample.length > 0 ? totalBotScore / sample.length : 0;

    // Fingerprint diversity analysis
    const uniqueFingerprints = httpFingerprints.size;
    const fingerprintDiversity = uniqueFingerprints / sample.length;

    const diversitySignals: string[] = [];
    if (fingerprintDiversity > 0.8) {
      diversitySignals.push(
        `High fingerprint diversity (${uniqueFingerprints} unique HTTP fingerprints in ${sample.length} requests) — ` +
          `may indicate multiple clients or rotation`,
      );
    }
    if (fingerprintDiversity === 1 && sample.length > 5) {
      diversitySignals.push(
        `Every request has a unique HTTP fingerprint — likely automated tool rotating headers`,
      );
    }

    // Inter-request consistency summary
    const interRequestSignals: string[] = [];
    if (uaDriftCount > 0) {
      interRequestSignals.push(
        `${uaDriftCount} request(s) with different UA for same HTTP fingerprint — UA drift detected`,
      );
    }
    if (headerOrderDriftCount > 0) {
      interRequestSignals.push(
        `${headerOrderDriftCount} request(s) with different header order — header rotation detected`,
      );
    }
    const consistencyScore =
      sample.length > 1
        ? Math.max(0, 1 - (uaDriftCount + headerOrderDriftCount) / (sample.length * 2))
        : 1.0;

    return R.ok()
      .merge({
        analyzed: sample.length,
        totalRequests: requests.length,
        averageBotScore: Math.round(avgBotScore * 100) / 100,
        suspiciousRequests: signals.length,
        httpFingerprintSummary: {
          uniqueFingerprints,
          diversity: Math.round(fingerprintDiversity * 100) / 100,
          topFingerprints: [...httpFingerprints.entries()]
            .toSorted((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([fp, count]) => ({ http_fingerprint: fp, count })),
        },
        signals: signals.slice(0, 20),
        ...(diversitySignals.length > 0 ? { diversitySignals } : {}),
        interRequestConsistency: {
          consistencyScore: Math.round(consistencyScore * 100) / 100,
          uaDriftCount,
          headerOrderDriftCount,
          ...(interRequestSignals.length > 0 ? { signals: interRequestSignals } : {}),
        },
        details: includeDetails ? details : undefined,
        recommendations:
          avgBotScore > 0.5
            ? [
                'High bot-like signal detected. Consider TLS fingerprint rotation.',
                'Review User-Agent consistency across requests.',
                'Check header ordering matches real browser behavior.',
                'HTTP fingerprint diversity can distinguish botnets from real users.',
              ]
            : fingerprintDiversity > 0.8
              ? ['Traffic appears human but fingerprint diversity is high — investigate further.']
              : ['Traffic appears to follow normal browser patterns.'],
      })
      .json();
  }
}
