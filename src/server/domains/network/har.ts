/**
 * HAR 1.2 builder — converts NetworkMonitor captured data to standard HAR format.
 * Ref: http://www.softwareishard.com/blog/har-12-spec/
 */

import { NETWORK_HAR_BODY_CONCURRENCY, NETWORK_HAR_BODY_MAX_BYTES } from '@src/constants';

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    content: {
      size: number;
      mimeType: string;
      text?: string;
      /** HAR 1.2 content encoding — set to `'base64'` for base64-encoded bodies. */
      encoding?: 'base64';
      _bodyUnavailable?: boolean;
      _bodyTruncated?: boolean;
      _originalBodySize?: number;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, unknown>;
  timings: { send: number; wait: number; receive: number };
  _requestId?: string;
}

export interface Har {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

function headersToHar(
  headers: Record<string, string | undefined> = {},
): Array<{ name: string; value: string }> {
  return Object.entries(headers)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ({ name, value }));
}

function parseCookies(cookieHeader: string): Array<{ name: string; value: string }> {
  // http-raw joins multiple Set-Cookie headers with \n (RFC 6265: commas are
  // legal inside cookie values, so comma-joining destroys boundaries). Split
  // on \n first, then parse each cookie's attributes.
  return cookieHeader.split('\n').flatMap((line) =>
    line.split(';').map((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) return { name: part.trim(), value: '' };
      return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
    }),
  );
}

function queryStringFromUrl(url: string): Array<{ name: string; value: string }> {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/** Truncate a UTF-8 string to at most `maxBytes` bytes (may split a multi-byte char at the boundary). */
function capBodyText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
  const truncated = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  return { text: truncated, truncated: true };
}

/**
 * Truncate a base64 string to at most `maxBytes` decoded bytes.
 *
 * Base64 encodes 3 bytes into 4 characters, so `maxBytes` decoded bytes map to
 * at most `floor(maxBytes / 3)` full 3-byte groups, i.e. `floor(maxBytes / 3) * 4`
 * characters. Truncating mid-group would drop the tail bytes of the final group
 * and produce an un-decodable tail.
 */
export function capBodyBase64(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const maxChars = Math.floor(maxBytes / 3) * 4;
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/**
 * Compute the byte size of a stored body string for HAR 1.2 `content.size` /
 * `bodySize`, which are measured in bytes. Base64 bodies report the decoded
 * byte count (`3 * floor(len / 4)` — same convention as `_originalBodySize`),
 * not the base64 character count.
 */
function bodyByteSize(text: string, encoding?: 'base64'): number {
  return encoding === 'base64' ? Math.floor((text.length * 3) / 4) : text.length;
}

/**
 * Normalize CDP protocol identifier to HAR-compatible HTTP version string.
 * Maps CDP protocol values (h2, h3, http/1.1, etc.) to HAR format (HTTP/2, HTTP/3, HTTP/1.1).
 *
 * Protocol mappings:
 * - http/1.0 → HTTP/1.0
 * - http/1.1 → HTTP/1.1
 * - h2, h2c → HTTP/2
 * - h3, http/2+quic/* → HTTP/3
 * - unknown/empty → HTTP/1.1 (fallback)
 */
function normalizeProtocol(protocol: string | undefined): string {
  if (!protocol || protocol.trim() === '') {
    return 'HTTP/1.1';
  }

  const normalized = protocol.toLowerCase().trim();

  // HTTP/1.x
  if (normalized === 'http/1.0') return 'HTTP/1.0';
  if (normalized === 'http/1.1') return 'HTTP/1.1';

  // HTTP/2
  if (normalized === 'h2' || normalized === 'h2c') return 'HTTP/2';

  // HTTP/3 (includes QUIC variants)
  if (normalized === 'h3' || normalized.startsWith('http/2+quic')) return 'HTTP/3';

  // Unknown protocols: preserve as-is with uppercase HTTP prefix if it looks like http/X.Y
  if (normalized.startsWith('http/')) {
    return protocol.replace(/^http\//i, 'HTTP/');
  }

  // Complete unknown: fallback to HTTP/1.1
  return 'HTTP/1.1';
}

interface RawRequest {
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string | undefined>;
  postData?: string;
  timestamp?: number;
  resourceType?: string;
  protocol?: string;
}

interface RawResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string | undefined>;
  mimeType?: string;
  timing?: { receiveHeadersEnd?: number };
  protocol?: string;
}

export interface BuildHarParams {
  requests: RawRequest[];
  getResponse: (requestId: string) => RawResponse | undefined;
  getResponseBody: (requestId: string) => Promise<{ body: string; base64Encoded: boolean } | null>;
  includeBodies: boolean;
  creatorVersion?: string;
}

type HarBodyResult = {
  text?: string;
  encoding?: 'base64';
  _bodyUnavailable?: boolean;
  _bodyTruncated?: boolean;
  _originalBodySize?: number;
};

/** Fetch response bodies for the given requests with a bounded-concurrency
 * batch loop (avoids overwhelming CDP). Failures/unavailable bodies are
 * recorded as `_bodyUnavailable` markers. */
async function fetchHarBodies(
  requests: Array<{ requestId: string }>,
  getResponseBody: (requestId: string) => Promise<{ body: string; base64Encoded: boolean } | null>,
): Promise<Map<string, HarBodyResult>> {
  const bodyResults = new Map<string, HarBodyResult>();
  const BODY_CONCURRENCY = NETWORK_HAR_BODY_CONCURRENCY;
  for (let i = 0; i < requests.length; i += BODY_CONCURRENCY) {
    const batch = requests.slice(i, i + BODY_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (req) => {
        try {
          const bodyResult = await getResponseBody(req.requestId);
          if (bodyResult) {
            // HAR 1.2 requires content.encoding='base64' for base64-encoded
            // bodies, otherwise viewers decode the raw base64 as UTF-8 text.
            // Cap each body to the byte budget so one huge response cannot
            // inflate the retained HAR memory; mark truncation on the entry.
            // For base64 the budget is measured in decoded bytes, so convert
            // to a 4-char-aligned character budget (3 decoded bytes / 4 chars).
            const isBase64 = bodyResult.base64Encoded;
            const originalSize = isBase64
              ? Math.floor((bodyResult.body.length * 3) / 4)
              : Buffer.byteLength(bodyResult.body, 'utf8');
            const { text, truncated } = isBase64
              ? capBodyBase64(bodyResult.body, NETWORK_HAR_BODY_MAX_BYTES)
              : capBodyText(bodyResult.body, NETWORK_HAR_BODY_MAX_BYTES);
            return {
              requestId: req.requestId,
              text,
              ...(bodyResult.base64Encoded ? { encoding: 'base64' as const } : {}),
              ...(truncated
                ? { _bodyTruncated: true as const, _originalBodySize: originalSize }
                : {}),
            };
          }
          return { requestId: req.requestId, _bodyUnavailable: true as const };
        } catch {
          return { requestId: req.requestId, _bodyUnavailable: true as const };
        }
      }),
    );
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        const val = result.value;
        if ('_bodyUnavailable' in val) {
          bodyResults.set(val.requestId, { _bodyUnavailable: true });
        } else {
          bodyResults.set(val.requestId, {
            text: val.text,
            ...(val.encoding !== undefined && { encoding: val.encoding }),
            ...(val._bodyTruncated !== undefined && { _bodyTruncated: val._bodyTruncated }),
            ...(val._originalBodySize !== undefined && {
              _originalBodySize: val._originalBodySize,
            }),
          });
        }
      }
    }
  }
  return bodyResults;
}

export async function buildHar(params: BuildHarParams): Promise<Har> {
  const {
    requests,
    getResponse,
    getResponseBody,
    includeBodies,
    creatorVersion = 'unknown',
  } = params;
  const entries: HarEntry[] = [];

  const bodyResults = includeBodies
    ? await fetchHarBodies(requests, getResponseBody)
    : new Map<string, HarBodyResult>();

  for (const req of requests) {
    const res = getResponse(req.requestId);
    const startedDateTime = req.timestamp
      ? new Date(req.timestamp * 1000).toISOString()
      : new Date().toISOString();
    const bodyContent = includeBodies
      ? (bodyResults.get(req.requestId) ?? { _bodyUnavailable: true })
      : {};

    const postData = req.postData
      ? {
          mimeType: req.headers?.['content-type'] ?? 'application/octet-stream',
          text: req.postData,
        }
      : undefined;

    const reqCookieHeader = req.headers?.['cookie'] ?? '';
    const resCookieHeader = res?.headers?.['set-cookie'] ?? '';

    // HAR 1.2 size/bodySize are byte counts; base64 bodies must report decoded
    // bytes, not the base64 character count.
    const storedBodySize = bodyContent.text
      ? bodyByteSize(bodyContent.text, bodyContent.encoding)
      : -1;

    const entry: HarEntry = {
      startedDateTime,
      time: res?.timing?.receiveHeadersEnd ?? 0,
      request: {
        method: req.method,
        url: req.url,
        httpVersion: normalizeProtocol(req.protocol),
        headers: headersToHar(req.headers),
        queryString: queryStringFromUrl(req.url),
        cookies: reqCookieHeader ? parseCookies(reqCookieHeader) : [],
        headersSize: -1,
        bodySize: req.postData ? req.postData.length : 0,
        ...(postData ? { postData } : {}),
      },
      response: {
        status: res?.status ?? 0,
        statusText: res?.statusText ?? '',
        httpVersion: normalizeProtocol(res?.protocol),
        headers: headersToHar(res?.headers),
        cookies: resCookieHeader ? parseCookies(resCookieHeader) : [],
        content: {
          size: storedBodySize,
          mimeType: res?.mimeType ?? 'application/octet-stream',
          ...bodyContent,
        },
        redirectURL: res?.headers?.['location'] ?? '',
        headersSize: -1,
        bodySize: storedBodySize,
      },
      cache: {},
      timings: { send: 0, wait: res?.timing?.receiveHeadersEnd ?? 0, receive: 0 },
      _requestId: req.requestId,
    };

    entries.push(entry);
  }

  return {
    log: {
      version: '1.2',
      creator: { name: 'jshookmcp', version: creatorVersion },
      entries,
    },
  };
}
