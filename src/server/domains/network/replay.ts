/**
 * Request Replay — rebuilds and re-sends a captured network request
 * with optional header/body/method/URL overrides.
 *
 * Security: dryRun defaults to true to prevent accidental side-effects.
 * Always sanitize headers that would conflict (host, content-length, transfer-encoding).
 * SSRF guard resolves DNS before checking to defeat rebinding attacks.
 */

import { NETWORK_REPLAY_MAX_REDIRECTS } from '@src/constants';
import {
  createNetworkAuthorizationPolicy,
  hasAuthorizedTargets,
  isAuthorizedNetworkTarget,
  isLocalSsrfBypassEnabled,
  isLoopbackHost,
  isNetworkAuthorizationExpired,
  isPrivateHost,
  isSsrfTarget,
  resolveNetworkTarget,
  type NetworkAuthorizationInput,
  type ResolvedNetworkTarget,
} from '@utils/network/ssrf-policy';
import * as http2 from 'node:http2';
import * as tls from 'node:tls';
import * as net from 'node:net';
import { BufferChain } from '@utils/BufferChain';

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

export { isLoopbackHost, isPrivateHost, isSsrfTarget } from '@utils/network/ssrf-policy';

import type { SessionProfile } from '@internal-types/SessionProfile';

export interface ReplayArgs {
  requestId: string;
  headerPatch?: Record<string, string>;
  sessionProfile?: SessionProfile;
  bodyPatch?: string;
  methodOverride?: string;
  urlOverride?: string;
  timeoutMs?: number;
  dryRun?: boolean;
  authorization?: NetworkAuthorizationInput;
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
  protocol?: string;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function buildCookieHeader(profile: SessionProfile): string | undefined {
  const parts: string[] = [];
  for (const cookie of profile.cookies) {
    if (!cookie.name) continue;
    parts.push(`${cookie.name}=${cookie.value}`);
  }
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out = Object.create(null) as Record<string, string>;
  for (const [k, v] of Object.entries(headers)) {
    if (!STRIPPED_HEADERS.has(k.toLowerCase()) && !DANGEROUS_KEYS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

function isHttp2Protocol(protocol?: string): boolean {
  if (!protocol) return false;
  const normalized = protocol.toLowerCase().trim();
  return normalized === 'h2' || normalized === 'h2c' || normalized === 'http/2';
}

function normalizeHttp2Headers(
  headers: Record<string, string>,
): http2.OutgoingHttpHeaders {
  const output: http2.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    // Skip pseudo-headers from captured traffic (they'll be set by http2 client)
    if (lowerName.startsWith(':')) continue;
    output[lowerName] = value;
  }
  return output;
}

function parseHttp2ResponseHeaders(headers: http2.IncomingHttpHeaders): {
  status: number;
  statusText: string;
  headers: Record<string, string>;
} {
  const responseHeaders: Record<string, string> = {};
  let status = 200;
  let statusText = 'OK';

  for (const [name, value] of Object.entries(headers)) {
    if (name === ':status') {
      status = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
      // Map status code to text (simplified)
      if (status >= 200 && status < 300) statusText = 'OK';
      else if (status >= 300 && status < 400) statusText = 'Redirect';
      else if (status >= 400 && status < 500) statusText = 'Client Error';
      else if (status >= 500) statusText = 'Server Error';
      continue;
    }
    if (name.startsWith(':')) continue; // Skip other pseudo-headers
    if (Array.isArray(value)) {
      responseHeaders[name] = value.join(', ');
    } else if (value !== undefined) {
      responseHeaders[name] = String(value);
    }
  }

  return { status, statusText, headers: responseHeaders };
}

async function replayHttp2Request(
  url: URL,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  target: ResolvedNetworkTarget,
  maxBodyBytes: number,
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
}> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.close();
      reject(new Error(`HTTP/2 request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    let session: http2.ClientHttp2Session | null = null;

    try {
      const effectivePort = Number.parseInt(
        url.port || (url.protocol === 'https:' ? '443' : '80'),
        10,
      );

      session = http2.connect(url.origin, {
        createConnection: () => {
          if (url.protocol === 'https:') {
            return tls.connect({
              host: target.resolvedAddress ?? target.hostname,
              port: effectivePort,
              servername: target.hostname,
              ALPNProtocols: ['h2'],
              rejectUnauthorized: true,
            });
          } else {
            // h2c (HTTP/2 cleartext)
            return net.connect({
              host: target.resolvedAddress ?? target.hostname,
              port: effectivePort,
            });
          }
        },
      });

      session.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      const normalizedHeaders = normalizeHttp2Headers(headers);
      normalizedHeaders[':method'] = method;
      normalizedHeaders[':path'] = url.pathname + url.search;
      normalizedHeaders[':scheme'] = url.protocol.slice(0, -1);
      normalizedHeaders[':authority'] = url.host;

      if (body && !normalizedHeaders['content-length']) {
        normalizedHeaders['content-length'] = String(Buffer.byteLength(body, 'utf8'));
      }

      const request = session.request(normalizedHeaders);
      const bodyChain = new BufferChain();
      let truncated = false;
      let responseHeaders: http2.IncomingHttpHeaders = {};

      request.on('response', (headers) => {
        responseHeaders = headers;
      });

      request.on('data', (chunk: Buffer) => {
        if (!truncated && bodyChain.length + chunk.length > maxBodyBytes) {
          truncated = true;
          const remaining = maxBodyBytes - bodyChain.length;
          if (remaining > 0) {
            bodyChain.append(chunk.subarray(0, remaining));
          }
        } else if (!truncated) {
          bodyChain.append(chunk);
        }
      });

      request.on('end', () => {
        clearTimeout(timer);
        session?.close();
        const parsed = parseHttp2ResponseHeaders(responseHeaders);
        resolve({
          status: parsed.status,
          statusText: parsed.statusText,
          headers: parsed.headers,
          body: bodyChain.toString('utf8'),
          bodyTruncated: truncated,
        });
      });

      request.on('error', (error) => {
        clearTimeout(timer);
        session?.close();
        reject(error);
      });

      if (body && method !== 'GET' && method !== 'HEAD') {
        request.write(body, 'utf8');
      }
      request.end();
    } catch (error) {
      clearTimeout(timer);
      session?.close();
      reject(error);
    }
  });
}

export async function replayRequest(
  base: BaseRequest,
  args: ReplayArgs,
  maxBodyBytes = 512_000,
): Promise<ReplayResult> {
  const url = args.urlOverride ?? base.url;
  const method = (args.methodOverride ?? base.method).toUpperCase();
  const mergedHeaders = sanitizeHeaders({ ...base.headers, ...args.headerPatch });
  const cookieHeader = args.sessionProfile ? buildCookieHeader(args.sessionProfile) : undefined;
  if (cookieHeader) {
    mergedHeaders.Cookie = cookieHeader;
  }
  if (
    args.sessionProfile?.userAgent &&
    !mergedHeaders['User-Agent'] &&
    !mergedHeaders['user-agent']
  ) {
    mergedHeaders['User-Agent'] = args.sessionProfile.userAgent;
  }
  if (
    args.sessionProfile?.acceptLanguage &&
    !mergedHeaders['Accept-Language'] &&
    !mergedHeaders['accept-language']
  ) {
    mergedHeaders['Accept-Language'] = args.sessionProfile.acceptLanguage;
  }
  if (args.sessionProfile?.referer && !mergedHeaders['Referer'] && !mergedHeaders['referer']) {
    mergedHeaders.Referer = args.sessionProfile.referer;
  }
  const body = args.bodyPatch !== undefined ? args.bodyPatch : base.postData;
  const authorizationPolicy = createNetworkAuthorizationPolicy(args.authorization);
  const allowLegacyLocalSsrf = !authorizationPolicy && isLocalSsrfBypassEnabled();

  if (
    authorizationPolicy &&
    (authorizationPolicy.allowPrivateNetwork || authorizationPolicy.allowInsecureHttp) &&
    !hasAuthorizedTargets(authorizationPolicy)
  ) {
    throw new Error(
      'Replay authorization must include at least one allowed host or CIDR when enabling private network or ' +
        'insecure HTTP access.',
    );
  }

  if (isNetworkAuthorizationExpired(authorizationPolicy)) {
    throw new Error('Replay authorization expired before the request was executed.');
  }

  const isPrivateTargetAllowed = (target: ResolvedNetworkTarget): boolean => {
    if (allowLegacyLocalSsrf) {
      return true;
    }

    return (
      authorizationPolicy?.allowPrivateNetwork === true &&
      isAuthorizedNetworkTarget(authorizationPolicy, target)
    );
  };

  const isInsecureHttpAllowed = (target: ResolvedNetworkTarget): boolean => {
    if (target.parsedUrl.protocol !== 'http:') {
      return true;
    }

    if (allowLegacyLocalSsrf) {
      return true;
    }

    if (isLoopbackHost(target.hostname)) {
      return true;
    }

    return (
      authorizationPolicy?.allowInsecureHttp === true &&
      isAuthorizedNetworkTarget(authorizationPolicy, target)
    );
  };

  // SSRF guard + DNS pinning combined: resolve once, check, and pin the IP.
  // Returns the pinned URL and original host header value.
  const resolvePinned = async (
    targetUrl: string,
  ): Promise<{ pinnedUrl: string; originalHost: string; target: ResolvedNetworkTarget }> => {
    let target: ResolvedNetworkTarget;
    try {
      target = await resolveNetworkTarget(targetUrl);
    } catch {
      throw new Error(`Replay blocked: DNS resolution failed for "${targetUrl}"`);
    }

    if (!isInsecureHttpAllowed(target)) {
      throw new Error(
        `Replay blocked: insecure HTTP is only allowed for loopback or explicitly authorized targets, got "` +
          `${targetUrl}"`,
      );
    }

    const hostnameIsPrivate = isPrivateHost(target.hostname);
    const resolvedAddressIsPrivate = isPrivateHost(target.resolvedAddress ?? '');

    if ((hostnameIsPrivate || resolvedAddressIsPrivate) && !isPrivateTargetAllowed(target)) {
      if (!hostnameIsPrivate && resolvedAddressIsPrivate && target.resolvedAddress) {
        throw new Error(
          `Replay blocked: "${targetUrl}" resolved to private IP ${target.resolvedAddress}`,
        );
      }

      throw new Error(
        `Replay blocked: target URL "${targetUrl}" resolves to a private/reserved address.`,
      );
    }

    if (target.parsedUrl.protocol === 'https:' || target.isIpLiteral) {
      return { pinnedUrl: targetUrl, originalHost: target.parsedUrl.host, target };
    }

    const originalHost = target.parsedUrl.host;
    target.parsedUrl.hostname =
      target.resolvedAddress && target.resolvedAddress.includes(':')
        ? `[${target.resolvedAddress}]`
        : (target.resolvedAddress ?? target.hostname);
    return { pinnedUrl: target.parsedUrl.toString(), originalHost, target };
  };

  if (args.dryRun !== false) {
    // Still validate the URL even for dry runs
    if (await isSsrfTarget(url, args.authorization)) {
      throw new Error(
        `Replay blocked: target URL "${url}" resolves to a private/reserved address.`,
      );
    }

    const dryRunTarget = await resolveNetworkTarget(url).catch(() => null);
    if (dryRunTarget && !isInsecureHttpAllowed(dryRunTarget)) {
      throw new Error(
        `Replay blocked: insecure HTTP is only allowed for loopback or explicitly authorized targets, got "${url}"`,
      );
    }

    return {
      dryRun: true,
      preview: { url, method, headers: mergedHeaders, body },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), args.timeoutMs ?? 30_000);
  const MAX_REDIRECTS = NETWORK_REPLAY_MAX_REDIRECTS;
  const useHttp2 = isHttp2Protocol(base.protocol);

  try {
    let currentUrl = url;
    let currentMethod = method;
    let currentBody: string | undefined = body;

    if (useHttp2) {
      // HTTP/2 path - no redirect handling in this version (HTTP/2 doesn't support manual redirect)
      const { pinnedUrl, originalHost, target } = await resolvePinned(currentUrl);
      const parsedUrl = new URL(pinnedUrl);
      const hopHeaders = { ...mergedHeaders };
      if (target.parsedUrl.protocol === 'http:' && target.resolvedAddress && !target.isIpLiteral) {
        hopHeaders.Host = originalHost;
      }

      const result = await replayHttp2Request(
        parsedUrl,
        currentMethod,
        hopHeaders,
        currentMethod !== 'GET' && currentMethod !== 'HEAD' ? currentBody : undefined,
        args.timeoutMs ?? 30_000,
        target,
        maxBodyBytes,
      );

      return {
        dryRun: false,
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        body: result.body,
        bodyTruncated: result.bodyTruncated,
        requestId: args.requestId,
      };
    }

    // HTTP/1.1 path with fetch
    let resp!: Response;

    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const { pinnedUrl, originalHost, target } = await resolvePinned(currentUrl);
      const hopHeaders = { ...mergedHeaders };
      if (target.parsedUrl.protocol === 'http:' && target.resolvedAddress && !target.isIpLiteral) {
        hopHeaders.Host = originalHost;
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
    resp.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

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
