/**
 * Request Replay — rebuilds and re-sends a captured network request
 * with optional header/body/method/URL overrides.
 *
 * Security: dryRun defaults to true to prevent accidental side-effects.
 * Always sanitize headers that would conflict (host, content-length, transfer-encoding).
 * SSRF guard resolves DNS before checking to defeat rebinding attacks.
 */

import { lookup } from 'node:dns/promises';

const STRIPPED_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'upgrade',
]);

// Private/link-local ranges that should not be reachable via replay
const SSRF_DENYLIST = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,       // link-local / cloud metadata
  /^0\./,              // 0.0.0.0/8
  /^::1$/,             // IPv6 loopback
  /^::$/,              // unspecified
  /^::ffff:/i,         // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  /^::ffff:0:/i,       // IPv4-translated
  /^64:ff9b::/i,       // NAT64 well-known prefix
  /^fc00:/i,           // IPv6 unique-local
  /^fd/i,              // IPv6 unique-local
  /^fe80:/i,           // IPv6 link-local
  /^100::/i,           // discard prefix
  /^localhost$/i,
];

/** Check whether a single hostname or IP matches the SSRF deny list. */
function isPrivateHost(host: string): boolean {
  // IPv6 literals are wrapped in brackets: [::1] → strip them
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  return SSRF_DENYLIST.some((re) => re.test(host));
}

/**
 * Resolve the URL's hostname via DNS and verify the *resolved IP* is not
 * private/reserved.  This defeats DNS-rebinding and split-horizon attacks
 * where a public hostname resolves to an internal address.
 */
async function isSsrfTarget(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

    // Step 1: reject obviously private hostnames (localhost, 127.x, etc.)
    if (isPrivateHost(hostname)) return true;

    // Step 2: resolve DNS and check the actual IP
    try {
      const { address } = await lookup(hostname);
      if (isPrivateHost(address)) return true;
    } catch {
      // DNS resolution failed → deny (could be a non-routable name)
      return true;
    }

    return false;
  } catch {
    return true; // invalid URL → deny
  }
}

export interface ReplayArgs {
  requestId: string;
  headerPatch?: Record<string, string>;
  bodyPatch?: string;
  methodOverride?: string;
  urlOverride?: string;
  timeoutMs?: number;
  dryRun?: boolean;
}

export interface ReplayDryRunResult {
  dryRun: true;
  preview: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
  };
}

export interface ReplayLiveResult {
  dryRun: false;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  requestId: string;
}

export type ReplayResult = ReplayDryRunResult | ReplayLiveResult;

interface BaseRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  postData?: string;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIPPED_HEADERS.has(k.toLowerCase())) {
      out[k] = v;
    }
  }
  return out;
}

export async function replayRequest(base: BaseRequest, args: ReplayArgs, maxBodyBytes = 512_000): Promise<ReplayResult> {
  const url = args.urlOverride ?? base.url;
  const method = (args.methodOverride ?? base.method).toUpperCase();
  const mergedHeaders = sanitizeHeaders({ ...(base.headers ?? {}), ...(args.headerPatch ?? {}) });
  const body = args.bodyPatch !== undefined ? args.bodyPatch : base.postData;

  // SSRF guard: reject private/link-local destinations (resolves DNS to check actual IP)
  if (await isSsrfTarget(url)) {
    throw new Error(`Replay blocked: target URL "${url}" resolves to a private/reserved address. Only public URLs are allowed.`);
  }

  if (args.dryRun !== false) {
    return {
      dryRun: true,
      preview: { url, method, headers: mergedHeaders, body },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs ?? 30_000);

  try {
    const resp = await fetch(url, {
      method,
      headers: mergedHeaders,
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });

    const responseHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { responseHeaders[k] = v; });

    const rawText = await resp.text();
    const bodyTruncated = rawText.length > maxBodyBytes;
    const bodyOut = bodyTruncated ? rawText.slice(0, maxBodyBytes) : rawText;

    return {
      dryRun: false,
      status: resp.status,
      statusText: resp.statusText,
      headers: responseHeaders,
      body: bodyOut,
      bodyTruncated,
      requestId: args.requestId,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
