import type { ConsoleMonitor } from '@server/domains/shared/modules/collector';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringArray,
  argStringRequired,
} from '@server/domains/shared/parse-args';
import { BOT_DETECT_LIMIT_DEFAULT } from '@src/constants';
import { toHex4, isGrease } from './fingerprint-utils';
import { computeTlsFingerprint } from './tls-fingerprint';
import { computeHttpFingerprint, normalizeObservedHttpVersion } from './http-fingerprint';
import { detectBotSignals } from './bot-detection';
import { computeJa3, computeJa4FromClientHello, parseClientHello } from './clienthello-parser';

const TLS_FINGERPRINT_MODES = new Set([
  'compute_tls',
  'compute_http',
  'analyze_request',
  'parse_client_hello',
] as const);
const TLS_PROTOCOLS = new Set(['tls', 'quic', 'dtls'] as const);

function getSecurityDetails(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

export class TlsBotHandlers {
  private consoleMonitor: ConsoleMonitor;

  constructor(deps: { consoleMonitor: ConsoleMonitor }) {
    this.consoleMonitor = deps.consoleMonitor;
  }

  async handleNetworkTlsFingerprint(args: Record<string, unknown>) {
    const modeRaw = argString(args, 'mode');
    const includeAnalysis = argBool(args, 'includeAnalysis', true);

    if (
      !modeRaw ||
      !TLS_FINGERPRINT_MODES.has(
        modeRaw as typeof TLS_FINGERPRINT_MODES extends Set<infer T> ? T : never,
      )
    ) {
      return R.fail(
        `Invalid mode: "${String(args['mode'])}". Expected one of: ${[...TLS_FINGERPRINT_MODES].join(', ')}`,
      ).json();
    }
    const mode = modeRaw;

    try {
      if (mode === 'compute_tls') {
        const tlsVersions = argStringArray(args, 'tlsVersions');
        const ciphers = argStringArray(args, 'ciphers');
        const extensions = argStringArray(args, 'extensions');
        const signatureAlgorithms = argStringArray(args, 'signatureAlgorithms');
        const protocol = argEnum(args, 'protocol', TLS_PROTOCOLS, 'tls');
        const sni = argBool(args, 'sni', true);
        const alpn = argString(args, 'alpn', '');

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
        const headers = argStringArray(args, 'httpHeaders');
        const ua = argString(args, 'userAgent', '');
        const method = argString(args, 'httpMethod', 'GET');
        const httpVersion = argString(args, 'httpVersion', '1.1');
        const cookieHeader = argString(args, 'cookieHeader', '');
        const acceptLanguage = argString(args, 'acceptLanguage', '');

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

      // mode === 'parse_client_hello': parse a raw ClientHello record (hex) and
      // compute JA3 (Salesforce MD5) + JA4 (FoxIO) fingerprints from the real
      // wire bytes — no user-supplied cipher/extension lists required. This closes
      // the gap where compute_tls only re-hashed whatever arrays the caller passed in.
      if (mode === 'parse_client_hello') {
        const clientHelloHex = argStringRequired(args, 'clientHelloHex');
        const parsed = parseClientHello(clientHelloHex);
        if (!parsed.valid) {
          return R.fail(`Failed to parse ClientHello: ${parsed.error ?? 'unknown'}`).json();
        }
        const { ja3, ja3_raw } = computeJa3(parsed);
        const { ja4, ja4_raw } = computeJa4FromClientHello(parsed);
        const result: Record<string, unknown> = {
          success: true,
          mode: 'parse_client_hello',
          ja3,
          ja3_raw,
          ja4,
          ja4_raw,
          recordVersion: parsed.recordVersion,
          legacyVersion: parsed.legacyVersion,
          negotiatedVersion: parsed.negotiatedVersion,
          hasSni: parsed.hasSni,
          alpn: parsed.alpn,
        };
        if (includeAnalysis) {
          result.analysis = {
            ciphers: parsed.ciphers,
            ciphersCount: parsed.ciphers!.length,
            extensions: parsed.extensions!.map((e) => ({
              type: e.type,
              length: e.data.length / 2,
            })),
            supportedVersions: parsed.supportedVersions,
            ellipticCurves: parsed.ellipticCurves,
            ecPointFormats: parsed.ecPointFormats,
            signatureAlgorithms: parsed.signatureAlgorithms,
            greaseCipherCount: parsed.ciphers!.filter((c) => isGrease(c)).length,
            greaseExtensionCount: parsed.extensions!.filter((e) => isGrease(e.type)).length,
          };
        }
        return R.ok().merge(result).json();
      }

      // mode === 'analyze_request' (fallthrough after compute_* early returns)
      const requestId = argStringRequired(args, 'requestId');
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

      // NetworkRequest doesn't declare securityDetails at the type level (it
      // lives on NetworkResponse), but the ConsoleMonitor/Playwright path may
      // attach it to the request object at runtime — probe reflectively and
      // let getSecurityDetails narrow it.
      const secDetails = getSecurityDetails(
        (req as unknown as Record<string, unknown>)['securityDetails'],
      );
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
    const limit = Math.max(
      1,
      Math.min(500, argNumber(args, 'limit', BOT_DETECT_LIMIT_DEFAULT) ?? BOT_DETECT_LIMIT_DEFAULT),
    );
    const includeDetails = argBool(args, 'includeDetails', false);
    // Optional TLS JA3/JA4 fingerprint (from network_tls_fingerprint
    // parse_client_hello) plus user-supplied knownBad hash lists. Zero
    // hardcoded library — the caller decides which hashes are "bot-like".
    const ja3 = argString(args, 'ja3', '');
    const ja4 = argString(args, 'ja4', '');
    const knownBadJa3 = argStringArray(args, 'knownBadJa3');
    const knownBadJa4 = argStringArray(args, 'knownBadJa4');
    const jaFingerprint =
      ja3 || ja4 || knownBadJa3.length || knownBadJa4.length
        ? {
            ja3: ja3 || undefined,
            ja4: ja4 || undefined,
            knownBadJa3: knownBadJa3.length ? knownBadJa3 : undefined,
            knownBadJa4: knownBadJa4.length ? knownBadJa4 : undefined,
          }
        : undefined;

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

      // NetworkRequest doesn't declare securityDetails at the type level (it
      // lives on NetworkResponse), but the ConsoleMonitor/Playwright path may
      // attach it to the request object at runtime — probe reflectively and
      // let getSecurityDetails narrow it.
      const secDetails = getSecurityDetails(
        (req as unknown as Record<string, unknown>)['securityDetails'],
      );
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
      const reqSignals = detectBotSignals(ua, headerNames, tlsSignalsForBot, jaFingerprint);
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
