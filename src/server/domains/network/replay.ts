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
} from '@server/domains/network/ssrf-policy';

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

export { isLoopbackHost, isPrivateHost, isSsrfTarget } from '@server/domains/network/ssrf-policy';

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
      'Replay authorization must include at least one allowed host or CIDR when enabling private network or insecure HTTP access.',
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
        `Replay blocked: insecure HTTP is only allowed for loopback or explicitly authorized targets, got "${targetUrl}"`,
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

  try {
    let currentUrl = url;
    let currentMethod = method;
    let currentBody: string | undefined = body;
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
