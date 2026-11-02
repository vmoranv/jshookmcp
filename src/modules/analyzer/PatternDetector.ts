import type { NetworkRequest, NetworkResponse } from '@modules/monitor/ConsoleMonitor';
import type { ConsoleMessage } from '@modules/monitor/ConsoleMonitor';
import type {
  EncryptionPattern,
  SignaturePattern,
  TokenPattern,
  AntiDebugPattern,
} from '@modules/analyzer/IntelligentAnalyzer';
import {
  detectSignaturePatternsInternal,
  detectTokenPatternsInternal,
} from '@modules/analyzer/PatternDetectorAuthPatterns';
import {
  PATTERN_CONFIDENCE_ENCRYPTION_LOG,
  PATTERN_CONFIDENCE_ENCRYPTION_POST,
  PATTERN_CONFIDENCE_ENCRYPTION_URL,
  PATTERN_LOG_PRIORITY_ERROR,
  PATTERN_LOG_PRIORITY_WARN,
  PATTERN_PRIORITY_KEYWORD_WEIGHT,
  PATTERN_PRIORITY_METHOD_WEIGHT,
  PATTERN_PRIORITY_POSTDATA_WEIGHT,
  PATTERN_PRIORITY_URL_LENGTH_DIVISOR,
} from '@src/constants';

export const BLACKLIST_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.com/tr',
  'doubleclick.net',
  'googlesyndication.com',
  'clarity.ms',
  'hotjar.com',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'sentry.io',
  'bugsnag.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
];

export const WHITELIST_KEYWORDS = [
  'login',
  'auth',
  'token',
  'sign',
  'encrypt',
  'decrypt',
  'verify',
  'validate',
  'captcha',
  'api',
  'data',
  'user',
  'password',
  'secret',
  'key',
  'hash',
  'crypto',
];

export const FRAMEWORK_LOG_KEYWORDS = [
  '[HMR]',
  '[WDS]',
  '[webpack]',
  'Download the React DevTools',
  'React DevTools',
  'Vue DevTools',
  'Angular DevTools',
  '%c',
  'color:',
  'font-size:',
];

export function calculateRequestPriority(req: NetworkRequest): number {
  let score = 0;

  if (req.method === 'POST' || req.method === 'PUT') score += PATTERN_PRIORITY_METHOD_WEIGHT;

  const keywordCount = WHITELIST_KEYWORDS.filter((keyword) =>
    req.url.toLowerCase().includes(keyword),
  ).length;
  score += keywordCount * PATTERN_PRIORITY_KEYWORD_WEIGHT;

  if (req.postData) score += PATTERN_PRIORITY_POSTDATA_WEIGHT;

  score += Math.floor(req.url.length / PATTERN_PRIORITY_URL_LENGTH_DIVISOR);

  return score;
}

export function filterCriticalRequests(requests: NetworkRequest[]): NetworkRequest[] {
  return requests
    .filter((req) => {
      const isBlacklisted = BLACKLIST_DOMAINS.some((domain) => req.url.includes(domain));
      /* v8 ignore next */
      if (isBlacklisted) return false;

      const isStaticResource = /\.(png|jpg|jpeg|gif|svg|woff|woff2|ttf|css|ico)$/i.test(req.url);
      if (isStaticResource) return false;

      const hasKeyword = WHITELIST_KEYWORDS.some((keyword) =>
        req.url.toLowerCase().includes(keyword),
      );
      if (hasKeyword) return true;

      if (req.method === 'POST' || req.method === 'PUT') return true;

      if (req.method === 'GET' && req.url.includes('?')) return true;

      return false;
    })
    .toSorted((a, b) => {
      const scoreA = calculateRequestPriority(a);
      const scoreB = calculateRequestPriority(b);
      return scoreB - scoreA;
    });
}

export function filterCriticalResponses(responses: NetworkResponse[]): NetworkResponse[] {
  return responses
    .filter((res) => {
      const isBlacklisted = BLACKLIST_DOMAINS.some((domain) => res.url.includes(domain));
      if (isBlacklisted) return false;

      if (res.mimeType.includes('json')) return true;

      if (res.mimeType.includes('javascript')) return true;

      const hasKeyword = WHITELIST_KEYWORDS.some((keyword) =>
        res.url.toLowerCase().includes(keyword),
      );
      if (hasKeyword) return true;

      return false;
    })
    .toSorted((a, b) => b.timestamp - a.timestamp);
}

export function calculateLogPriority(log: ConsoleMessage): number {
  let score = 0;

  if (log.type === 'error') score += PATTERN_LOG_PRIORITY_ERROR;
  /* v8 ignore next */
  if (log.type === 'warn') score += PATTERN_LOG_PRIORITY_WARN;

  const keywordCount = WHITELIST_KEYWORDS.filter((keyword) =>
    log.text.toLowerCase().includes(keyword),
  ).length;
  score += keywordCount * PATTERN_PRIORITY_KEYWORD_WEIGHT;

  return score;
}

export function filterCriticalLogs(logs: ConsoleMessage[]): ConsoleMessage[] {
  return logs
    .filter((log) => {
      const isFrameworkLog = FRAMEWORK_LOG_KEYWORDS.some((keyword) => log.text.includes(keyword));
      if (isFrameworkLog) return false;

      if (!log.text || log.text.trim().length === 0) return false;

      if (log.type === 'error' || log.type === 'warn') return true;

      const hasKeyword = WHITELIST_KEYWORDS.some((keyword) =>
        log.text.toLowerCase().includes(keyword),
      );
      if (hasKeyword) return true;

      return false;
    })
    .toSorted((a, b) => {
      const scoreA = calculateLogPriority(a);
      const scoreB = calculateLogPriority(b);
      return scoreB - scoreA;
    });
}

export function deduplicatePatterns<T extends { location: string; type: string }>(
  patterns: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const pattern of patterns) {
    const key = `${pattern.type}-${pattern.location}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(pattern);
    }
  }

  return result;
}

/** Keyword groups per crypto family, as matched in URLs, POST bodies and logs. */
const CRYPTO_KEYWORDS = {
  AES: ['aes', 'cipher', 'encrypt', 'decrypt', 'CryptoJS.AES'],
  RSA: ['rsa', 'publickey', 'privatekey', 'RSA.encrypt'],
  MD5: ['md5', 'MD5', 'CryptoJS.MD5'],
  SHA: ['sha', 'sha1', 'sha256', 'sha512', 'CryptoJS.SHA'],
  Base64: ['base64', 'btoa', 'atob', 'Base64.encode'],
} as const;

function isEncryptionPatternType(value: string): value is EncryptionPattern['type'] {
  return Object.prototype.hasOwnProperty.call(CRYPTO_KEYWORDS, value);
}

/** Per-channel parameters for {@link collectCryptoMatches}. */
interface CryptoChannel {
  /** Already lower-cased text to search. */
  text: string;
  /** Report location for every hit. */
  location: string;
  confidence: number;
  /** Evidence suffix describing where the hit was found. */
  sourceLabel: string;
  /** Optional extra evidence appended after the label. */
  extraEvidence?: string;
}

/**
 * Scan one lower-cased text for every crypto keyword group.
 *
 * Each channel (URL / POST body / console log) differs only in its location,
 * confidence and evidence wording, so the keyword walk itself is shared.
 */
function collectCryptoMatches(channel: CryptoChannel): EncryptionPattern[] {
  const patterns: EncryptionPattern[] = [];
  for (const [type, keywords] of Object.entries(CRYPTO_KEYWORDS)) {
    if (!isEncryptionPatternType(type)) continue;
    for (const keyword of keywords) {
      if (!channel.text.includes(keyword.toLowerCase())) continue;
      const evidence: string[] = [keyword, channel.sourceLabel];
      if (channel.extraEvidence !== undefined) {
        evidence.push(channel.extraEvidence);
      }
      patterns.push({
        type,
        location: channel.location,
        confidence: channel.confidence,
        evidence,
      });
    }
  }
  return patterns;
}

export function detectEncryptionPatterns(
  requests: NetworkRequest[],
  logs: ConsoleMessage[],
): EncryptionPattern[] {
  const patterns: EncryptionPattern[] = [];

  for (const req of requests) {
    patterns.push(
      ...collectCryptoMatches({
        text: req.url.toLowerCase(),
        location: req.url,
        confidence: PATTERN_CONFIDENCE_ENCRYPTION_URL,
        sourceLabel: 'Found in URL',
      }),
    );

    /* v8 ignore next */
    if (req.postData) {
      patterns.push(
        ...collectCryptoMatches({
          text: req.postData.toLowerCase(),
          location: req.url,
          confidence: PATTERN_CONFIDENCE_ENCRYPTION_POST,
          sourceLabel: 'Found in POST data',
        }),
      );
    }
  }

  for (const log of logs) {
    patterns.push(
      ...collectCryptoMatches({
        text: log.text.toLowerCase(),
        location: /* v8 ignore next */ log.url || 'console',
        confidence: PATTERN_CONFIDENCE_ENCRYPTION_LOG,
        sourceLabel: 'Found in console log',
        extraEvidence: log.text.substring(0, 100),
      }),
    );
  }

  return deduplicatePatterns(patterns);
}

export function detectSignaturePatterns(
  requests: NetworkRequest[],
  _logs: ConsoleMessage[],
): SignaturePattern[] {
  return detectSignaturePatternsInternal(requests);
}

export function detectTokenPatterns(
  requests: NetworkRequest[],
  _logs: ConsoleMessage[],
): TokenPattern[] {
  return detectTokenPatternsInternal(requests);
}

export function detectAntiDebugPatterns(logs: ConsoleMessage[]): AntiDebugPattern[] {
  const patterns: AntiDebugPattern[] = [];

  for (const log of logs) {
    const text = log.text;

    if (text.includes('debugger')) {
      patterns.push({
        type: 'debugger',
        location: log.url || 'unknown',
        code: text.substring(0, 200),
      });
    }

    if (text.includes('console.log') && text.includes('=')) {
      patterns.push({
        type: 'console.log',
        location: log.url || 'unknown',
        code: text.substring(0, 200),
      });
    }

    if (text.includes('devtools') || text.includes('firebug')) {
      patterns.push({
        type: 'devtools-detect',
        location: log.url || 'unknown',
        code: text.substring(0, 200),
      });
    }

    if (text.includes('performance.now') || text.includes('Date.now')) {
      patterns.push({
        type: 'timing-check',
        location: log.url || 'unknown',
        code: text.substring(0, 200),
      });
    }
  }

  return patterns;
}

export function extractSuspiciousAPIs(requests: NetworkRequest[]): string[] {
  const apis = new Set<string>();

  for (const req of requests) {
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path.includes('/api/') || path.includes('/v1/') || path.includes('/v2/')) {
        apis.add(`${req.method} ${path}`);
      }
    } catch {
      /* URL parse failed — skip non-standard URLs during API extraction */
    }
  }

  return Array.from(apis).slice(0, 20);
}

export function extractKeyFunctions(logs: ConsoleMessage[]): string[] {
  const functions = new Set<string>();

  const functionRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;

  for (const log of logs) {
    const matches = log.text.matchAll(functionRegex);
    for (const match of matches) {
      const funcName = match[1];

      if (funcName && !['console', 'log', 'warn', 'error', 'info', 'debug'].includes(funcName)) {
        functions.add(funcName);
      }
    }
  }

  return Array.from(functions).slice(0, 30);
}
