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
export function isPrivateHost(host: string): boolean {
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
export async function isSsrfTarget(url: string): Promise<boolean> {
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

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIPPED_HEADERS.has(k.toLowerCase()) && !DANGEROUS_KEYS.has(k)) {
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

  // SSRF guard + DNS pinning combined: resolve once, check, and pin the IP.
  // Returns the pinned URL and original host header value.
  const resolvePinned = async (targetUrl: string): Promise<{ pinnedUrl: string; originalHost: string }> => {
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

    if (isPrivateHost(hostname)) {
      throw new Error(`Replay blocked: target URL "${targetUrl}" resolves to a private/reserved address.`);
    }

    // For IP literals, no DNS needed — just verify the IP itself
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.startsWith('[')) {
      return { pinnedUrl: targetUrl, originalHost: parsed.host };
    }

    let resolvedIp: string;
    try {
      const result = await lookup(hostname);
      resolvedIp = result.address;
    } catch {
      throw new Error(`Replay blocked: DNS resolution failed for "${targetUrl}"`);
    }

    if (isPrivateHost(resolvedIp)) {
      throw new Error(`Replay blocked: "${targetUrl}" resolved to private IP ${resolvedIp}`);
    }

    const originalHost = parsed.host;
    parsed.hostname = resolvedIp.includes(':') ? `[${resolvedIp}]` : resolvedIp;
    return { pinnedUrl: parsed.toString(), originalHost };
  };

  if (args.dryRun !== false) {
    // Still validate the URL even for dry runs
    if (await isSsrfTarget(url)) {
      throw new Error(`Replay blocked: target URL "${url}" resolves to a private/reserved address.`);
    }
    return {
      dryRun: true,
      preview: { url, method, headers: mergedHeaders, body },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs ?? 30_000);
  const MAX_REDIRECTS = 5;

  try {
    let currentUrl = url;
    let currentMethod = method;
    let currentBody: string | undefined = body;
    let resp!: Response;

    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const { pinnedUrl, originalHost } = await resolvePinned(currentUrl);
      const hopHeaders = { ...mergedHeaders };
      if (!hopHeaders['host'] && !hopHeaders['Host']) {
        hopHeaders['Host'] = originalHost;
      }

      resp = await fetch(pinnedUrl, {
        method: currentMethod,
        headers: hopHeaders,
        body: currentMethod !== 'GET' && currentMethod !== 'HEAD' ? currentBody : undefined,
        signal: controller.signal,
        redirect: 'manual',
      });

      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (!location) break; // no location header → treat as final response
        currentUrl = new URL(location, currentUrl).toString();
        // 301/302/303 → method becomes GET, body dropped; 307/308 → preserve
        if (resp.status === 301 || resp.status === 302 || resp.status === 303) {
          currentMethod = 'GET';
          currentBody = undefined;
        }
        // Remove stale Host header for new destination
        delete mergedHeaders['Host'];
        delete mergedHeaders['host'];
        continue;
      }

      break;
    }

    if (resp.status >= 300 && resp.status < 400) {
      throw new Error(`Replay blocked: too many redirects (>${MAX_REDIRECTS})`);
    }

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
