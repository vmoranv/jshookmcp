/**
 * Request Replay — rebuilds and re-sends a captured network request
 * with optional header/body/method/URL overrides.
 *
 * Security: dryRun defaults to true to prevent accidental side-effects.
 * Always sanitize headers that would conflict (host, content-length, transfer-encoding).
 * SSRF guard resolves DNS before checking to defeat rebinding attacks.
 */

import {
  NETWORK_REPLAY_MAX_BODY_BYTES,
  NETWORK_REPLAY_MAX_REDIRECTS,
  NETWORK_REPLAY_TIMEOUT_MS,
} from '@src/constants';
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
import { readEnvInteger } from '@src/config/environment';

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

/** Idle duration after which a cached HTTP/2 session is closed and evicted. */
const HTTP2_SESSION_IDLE_TTL_MS = 30_000;

/** Default ceiling on concurrently cached HTTP/2 sessions (env-overridable). */
const DEFAULT_MAX_CACHED_SESSIONS = 32;

/** Resolve the concurrent-session ceiling, honoring an env override when valid. */
function maxCachedSessions(): number {
  return readEnvInteger('JSHOOK_HTTP2_MAX_SESSIONS', DEFAULT_MAX_CACHED_SESSIONS, { min: 1 });
}

interface Http2SessionCacheEntry {
  /** Composite cache key (origin + DNS pin) this entry was stored under. */
  key: string;
  session: http2.ClientHttp2Session;
  lastUsed: number;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Per-(origin, DNS pin) HTTP/2 session cache. Reusing `session.request()` across
 * replays avoids a full TCP+TLS+ALPN handshake per request; sessions are closed
 * on idle expiry (unref'd timer), when the session itself errors/closes, or when
 * the concurrent-session ceiling is exceeded (least-recently-used eviction).
 */
const http2SessionCache = new Map<string, Http2SessionCacheEntry>();

/**
 * Build the cache key for a replay. The resolved address (DNS pin) is folded in
 * so a connection established for one IP is never reused for a different pin of
 * the same origin — reuse would route the replayed request to the wrong host and
 * defeat the DNS-pinning SSRF guard. When no address was resolved the key falls
 * back to the bare origin: in that case every replay connects to the same
 * hostname, so sharing is safe.
 */
function http2SessionCacheKey(origin: string, resolvedAddress: string | null): string {
  return resolvedAddress ? `${origin}\n${resolvedAddress}` : origin;
}

function evictHttp2Session(entry: Http2SessionCacheEntry): void {
  if (http2SessionCache.get(entry.key) === entry) {
    http2SessionCache.delete(entry.key);
  }
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

/**
 * Enforce the concurrent-session ceiling by closing the least-recently-used
 * cached session (never `excludeKey`, the entry just created). Called after a
 * new session is inserted so the map never grows past the cap.
 */
function evictLeastRecentlyUsedHttp2Session(excludeKey: string): void {
  if (http2SessionCache.size <= maxCachedSessions()) return;
  let victim: Http2SessionCacheEntry | null = null;
  for (const [key, entry] of http2SessionCache) {
    if (key === excludeKey) continue;
    if (victim === null || entry.lastUsed < victim.lastUsed) victim = entry;
  }
  if (victim === null) return;
  evictHttp2Session(victim);
  victim.session.close();
}

function getOrCreateHttp2Session(
  origin: string,
  resolvedAddress: string | null,
  createConnection: () => net.Socket,
): Http2SessionCacheEntry {
  const key = http2SessionCacheKey(origin, resolvedAddress);
  const cached = http2SessionCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    if (cached.idleTimer) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = null;
    }
    return cached;
  }

  const session = http2.connect(origin, { createConnection });
  const entry: Http2SessionCacheEntry = { key, session, lastUsed: Date.now(), idleTimer: null };
  http2SessionCache.set(key, entry);

  const onBroken = () => evictHttp2Session(entry);
  session.once('error', onBroken);
  session.once('close', onBroken);
  // A GOAWAY means the server is draining this connection — new requests must
  // open a fresh session. In-flight streams still complete on their own.
  session.once('goaway', onBroken);

  // Bound the cache: evict the LRU entry (never this one) if we just crossed
  // the concurrent-session ceiling.
  evictLeastRecentlyUsedHttp2Session(key);

  return entry;
}

/** Return a completed session to the cache and (re)arm its idle reclamation timer. */
function releaseHttp2Session(entry: Http2SessionCacheEntry): void {
  entry.lastUsed = Date.now();
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
  }
  entry.idleTimer = setTimeout(() => {
    entry.idleTimer = null;
    if (http2SessionCache.get(entry.key) === entry) {
      http2SessionCache.delete(entry.key);
    }
    entry.session.close();
  }, HTTP2_SESSION_IDLE_TTL_MS);
  entry.idleTimer.unref();
}

/** Evict and close every cached session. Used for test isolation. */
export function clearHttp2SessionCache(): void {
  const entries = [...http2SessionCache.values()];
  http2SessionCache.clear();
  for (const entry of entries) {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.session.close();
  }
}

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

function normalizeHttp2Headers(headers: Record<string, string>): http2.OutgoingHttpHeaders {
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
    let settled = false;
    let session: http2.ClientHttp2Session | null = null;
    let cacheEntry: Http2SessionCacheEntry | null = null;
    let activeRequest: http2.ClientHttp2Stream | null = null;
    let removeSessionErrorListener: (() => void) | null = null;
    let timer: NodeJS.Timeout | null = null;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      removeSessionErrorListener?.();
      removeSessionErrorListener = null;
      fn();
    };

    timer = setTimeout(() => {
      // A hung request points at an unhealthy session. Cancel only this stream
      // (NGHTTP2_CANCEL) and evict the entry so the next replay opens a fresh
      // connection — but do NOT close the shared session: other in-flight
      // streams on it may still be healthy, and closing would let one slow
      // origin interrupt every concurrent replay to it. Re-arm the idle timer
      // so the session is still reclaimed once it goes idle (no leaked socket).
      activeRequest?.destroy();
      if (cacheEntry) {
        evictHttp2Session(cacheEntry);
        releaseHttp2Session(cacheEntry);
      }
      settle(() => reject(new Error(`HTTP/2 request timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    try {
      const effectivePort = Number.parseInt(
        url.port || (url.protocol === 'https:' ? '443' : '80'),
        10,
      );

      const entry = getOrCreateHttp2Session(url.origin, target.resolvedAddress, () => {
        if (url.protocol === 'https:') {
          return tls.connect({
            host: target.resolvedAddress ?? target.hostname,
            port: effectivePort,
            servername: target.hostname,
            ALPNProtocols: ['h2'],
            rejectUnauthorized: true,
          });
        }
        // h2c (HTTP/2 cleartext)
        return net.connect({
          host: target.resolvedAddress ?? target.hostname,
          port: effectivePort,
        });
      });
      cacheEntry = entry;
      session = entry.session;

      // Reject this request if the shared session errors mid-flight. Removed on
      // settle so a long-lived session does not accumulate stale listeners.
      const onSessionError = (error: Error): void => {
        settle(() => reject(error));
      };
      session.on('error', onSessionError);
      removeSessionErrorListener = () => session?.off('error', onSessionError);

      const normalizedHeaders = normalizeHttp2Headers(headers);
      normalizedHeaders[':method'] = method;
      normalizedHeaders[':path'] = url.pathname + url.search;
      normalizedHeaders[':scheme'] = url.protocol.slice(0, -1);
      normalizedHeaders[':authority'] = url.host;

      if (body && !normalizedHeaders['content-length']) {
        normalizedHeaders['content-length'] = String(Buffer.byteLength(body, 'utf8'));
      }

      const request = session.request(normalizedHeaders);
      activeRequest = request;
      const bodyChain = new BufferChain();
      let truncated = false;
      let responseHeaders: http2.IncomingHttpHeaders = {};

      request.on('response', (incomingHeaders) => {
        responseHeaders = incomingHeaders;
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
        settle(() => {
          releaseHttp2Session(entry);
          const parsed = parseHttp2ResponseHeaders(responseHeaders);
          resolve({
            status: parsed.status,
            statusText: parsed.statusText,
            headers: parsed.headers,
            body: bodyChain.toBuffer().toString('utf8'),
            bodyTruncated: truncated,
          });
        });
      });

      request.on('error', (error) => {
        settle(() => {
          releaseHttp2Session(entry);
          reject(error);
        });
      });

      if (body && method !== 'GET' && method !== 'HEAD') {
        request.write(body, 'utf8');
      }
      request.end();
    } catch (error) {
      settle(() => {
        // A synchronous throw from request() (invalid headers, a just-destroyed
        // session) does not prove the session is broken — hand it back to the
        // cache and let its own 'error'/'close' events evict it if it is.
        if (cacheEntry) {
          releaseHttp2Session(cacheEntry);
        }
        reject(error);
      });
    }
  });
}

export async function replayRequest(
  base: BaseRequest,
  args: ReplayArgs,
  maxBodyBytes = NETWORK_REPLAY_MAX_BODY_BYTES,
): Promise<ReplayResult> {
  const url = args.urlOverride ?? base.url;
  const method = (args.methodOverride ?? base.method).toUpperCase();
  const mergedHeaders = buildReplayHeaders(base, args);
  const body = args.bodyPatch !== undefined ? args.bodyPatch : base.postData;
  const authorizationPolicy = createNetworkAuthorizationPolicy(args.authorization);
  assertReplayAuthorizationUsable(authorizationPolicy);
  const allowLegacyLocalSsrf = !authorizationPolicy && isLocalSsrfBypassEnabled();

  const guards = createReplayTargetGuards(authorizationPolicy, allowLegacyLocalSsrf);
  const resolvePinned = createPinnedTargetResolver(guards);

  if (args.dryRun !== false) {
    await validateDryRunTarget(url, args.authorization, guards);
    return {
      dryRun: true,
      preview: { url, method, headers: mergedHeaders, body },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? NETWORK_REPLAY_TIMEOUT_MS,
  );
  const useHttp2 = isHttp2Protocol(base.protocol);
  const hopCtx = {
    url,
    method,
    body,
    mergedHeaders,
    args,
    maxBodyBytes,
    maxRedirects: NETWORK_REPLAY_MAX_REDIRECTS,
    resolvePinned,
  };

  try {
    if (useHttp2) {
      return replayHttp2WithRedirects(hopCtx);
    }
    return await replayHttp1WithRedirects({ ...hopCtx, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Merge base headers with the patch and the session-profile defaults. */
function buildReplayHeaders(base: BaseRequest, args: ReplayArgs): Record<string, string> {
  const mergedHeaders = sanitizeHeaders({ ...base.headers, ...args.headerPatch });
  const profile = args.sessionProfile;
  const cookieHeader = profile ? buildCookieHeader(profile) : undefined;
  if (cookieHeader) {
    mergedHeaders.Cookie = cookieHeader;
  }
  if (profile?.userAgent && !mergedHeaders['User-Agent'] && !mergedHeaders['user-agent']) {
    mergedHeaders['User-Agent'] = profile.userAgent;
  }
  if (
    profile?.acceptLanguage &&
    !mergedHeaders['Accept-Language'] &&
    !mergedHeaders['accept-language']
  ) {
    mergedHeaders['Accept-Language'] = profile.acceptLanguage;
  }
  if (profile?.referer && !mergedHeaders['Referer'] && !mergedHeaders['referer']) {
    mergedHeaders.Referer = profile.referer;
  }
  return mergedHeaders;
}

function assertReplayAuthorizationUsable(
  authorizationPolicy: ReturnType<typeof createNetworkAuthorizationPolicy>,
): void {
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
}

interface ReplayTargetGuards {
  isPrivateTargetAllowed: (target: ResolvedNetworkTarget) => boolean;
  isInsecureHttpAllowed: (target: ResolvedNetworkTarget) => boolean;
}

function createReplayTargetGuards(
  authorizationPolicy: ReturnType<typeof createNetworkAuthorizationPolicy>,
  allowLegacyLocalSsrf: boolean,
): ReplayTargetGuards {
  return {
    isPrivateTargetAllowed: (target) => {
      if (allowLegacyLocalSsrf) {
        return true;
      }
      return (
        authorizationPolicy?.allowPrivateNetwork === true &&
        isAuthorizedNetworkTarget(authorizationPolicy, target)
      );
    },
    isInsecureHttpAllowed: (target) => {
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
    },
  };
}

/** SSRF guard + DNS pinning combined: resolve once, check, and pin the IP.
 * Returns the pinned URL and original host header value. */
function createPinnedTargetResolver(guards: ReplayTargetGuards) {
  return async (
    targetUrl: string,
  ): Promise<{ pinnedUrl: string; originalHost: string; target: ResolvedNetworkTarget }> => {
    let target: ResolvedNetworkTarget;
    try {
      target = await resolveNetworkTarget(targetUrl);
    } catch {
      throw new Error(`Replay blocked: DNS resolution failed for "${targetUrl}"`);
    }

    if (!guards.isInsecureHttpAllowed(target)) {
      throw new Error(
        `Replay blocked: insecure HTTP is only allowed for loopback or explicitly authorized targets, got "` +
          `${targetUrl}"`,
      );
    }

    const hostnameIsPrivate = isPrivateHost(target.hostname);
    const resolvedAddressIsPrivate = isPrivateHost(target.resolvedAddress ?? '');

    if ((hostnameIsPrivate || resolvedAddressIsPrivate) && !guards.isPrivateTargetAllowed(target)) {
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
}

/** Dry runs still validate the URL against the SSRF + insecure-HTTP policy. */
async function validateDryRunTarget(
  url: string,
  authorization: ReplayArgs['authorization'],
  guards: ReplayTargetGuards,
): Promise<void> {
  if (await isSsrfTarget(url, authorization)) {
    throw new Error(`Replay blocked: target URL "${url}" resolves to a private/reserved address.`);
  }

  const dryRunTarget = await resolveNetworkTarget(url).catch(() => null);
  if (dryRunTarget && !guards.isInsecureHttpAllowed(dryRunTarget)) {
    throw new Error(
      `Replay blocked: insecure HTTP is only allowed for loopback or explicitly authorized targets, got "${url}"`,
    );
  }
}

interface ReplayHopContext {
  url: string;
  method: string;
  body: string | undefined;
  mergedHeaders: Record<string, string>;
  args: ReplayArgs;
  maxBodyBytes: number;
  maxRedirects: number;
  resolvePinned: (
    targetUrl: string,
  ) => Promise<{ pinnedUrl: string; originalHost: string; target: ResolvedNetworkTarget }>;
}

/** 301/302/303 → method becomes GET, body dropped; 307/308 → preserve. */
function applyRedirectStatus(
  status: number,
  state: { currentMethod: string; currentBody: string | undefined },
): void {
  if (status === 301 || status === 302 || status === 303) {
    state.currentMethod = 'GET';
    state.currentBody = undefined;
  }
}

/** Remove stale Host header for a new redirect destination. */
function clearHostHeader(headers: Record<string, string>): void {
  delete headers['Host'];
  delete headers['host'];
}

/** HTTP/2 path — follows redirects like the HTTP/1.1 fetch path. */
async function replayHttp2WithRedirects(hop: ReplayHopContext): Promise<ReplayResult> {
  let currentUrl = hop.url;
  const state = { currentMethod: hop.method, currentBody: hop.body };

  for (let i = 0; i < hop.maxRedirects; i++) {
    const { pinnedUrl, originalHost, target } = await hop.resolvePinned(currentUrl);
    const parsedUrl = new URL(pinnedUrl);
    const hopHeaders = { ...hop.mergedHeaders };
    if (target.parsedUrl.protocol === 'http:' && target.resolvedAddress && !target.isIpLiteral) {
      hopHeaders.Host = originalHost;
    }

    const result = await replayHttp2Request(
      parsedUrl,
      state.currentMethod,
      hopHeaders,
      state.currentMethod !== 'GET' && state.currentMethod !== 'HEAD'
        ? state.currentBody
        : undefined,
      hop.args.timeoutMs ?? NETWORK_REPLAY_TIMEOUT_MS,
      target,
      hop.maxBodyBytes,
    );

    const asResult = (): ReplayResult => ({
      dryRun: false,
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      bodyTruncated: result.bodyTruncated,
      requestId: hop.args.requestId,
    });

    if (result.status >= 300 && result.status < 400) {
      const location = result.headers['location'] ?? result.headers['Location'];
      if (!location) return asResult();
      currentUrl = new URL(location, currentUrl).toString();
      applyRedirectStatus(result.status, state);
      clearHostHeader(hop.mergedHeaders);
      continue;
    }

    return asResult();
  }

  throw new Error(`Replay blocked: too many redirects (>${hop.maxRedirects})`);
}

/** HTTP/1.1 path with fetch and manual redirect handling. */
async function replayHttp1WithRedirects(
  hop: ReplayHopContext & { signal: AbortSignal },
): Promise<ReplayResult> {
  let currentUrl = hop.url;
  const state = { currentMethod: hop.method, currentBody: hop.body };
  let resp!: Response;

  for (let i = 0; i < hop.maxRedirects; i++) {
    const { pinnedUrl, originalHost, target } = await hop.resolvePinned(currentUrl);
    const hopHeaders = { ...hop.mergedHeaders };
    if (target.parsedUrl.protocol === 'http:' && target.resolvedAddress && !target.isIpLiteral) {
      hopHeaders.Host = originalHost;
    }

    resp = await fetch(pinnedUrl, {
      method: state.currentMethod,
      headers: hopHeaders,
      body:
        state.currentMethod !== 'GET' && state.currentMethod !== 'HEAD'
          ? state.currentBody
          : undefined,
      signal: hop.signal,
      redirect: 'manual',
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) break; // no location header → treat as final response
      currentUrl = new URL(location, currentUrl).toString();
      applyRedirectStatus(resp.status, state);
      clearHostHeader(hop.mergedHeaders);
      continue;
    }

    break;
  }

  if (resp.status >= 300 && resp.status < 400) {
    throw new Error(`Replay blocked: too many redirects (>${hop.maxRedirects})`);
  }

  const responseHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });

  const rawText = await resp.text();
  const bodyTruncated = rawText.length > hop.maxBodyBytes;
  const bodyOut = bodyTruncated ? rawText.slice(0, hop.maxBodyBytes) : rawText;

  return {
    dryRun: false,
    status: resp.status,
    statusText: resp.statusText,
    headers: responseHeaders,
    body: bodyOut,
    bodyTruncated,
    requestId: hop.args.requestId,
  };
}
