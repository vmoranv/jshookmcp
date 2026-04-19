/**
 * Pure helper functions for raw HTTP/HTTP2/DNS/RTT handlers.
 *
 * Extracted from handlers.impl.core.runtime.raw.ts file-level utilities.
 */

import type { LookupAddress } from 'node:dns';
import * as http2 from 'node:http2';
import * as net from 'node:net';
import * as tls from 'node:tls';

import {
  analyzeHttpResponse,
  buildHttpRequest,
  isLikelyTextHttpBody,
} from '@server/domains/network/http-raw';
import { buildHttp2Frame } from '@server/domains/network/http2-raw';
import type { Http2FrameBuildInput, Http2SettingsEntry } from '@server/domains/network/http2-raw';
import {
  createNetworkAuthorizationPolicy,
  hasAuthorizedTargets,
  isAuthorizedNetworkTarget,
  isLocalSsrfBypassEnabled,
  isLoopbackHost,
  isNetworkAuthorizationExpired,
  isPrivateHost,
  resolveNetworkTarget,
  type NetworkAuthorizationInput,
  type ResolvedNetworkTarget,
} from '@server/domains/network/ssrf-policy';

const HTTP_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseRawString(
  value: unknown,
  field: string,
  options: { allowEmpty?: boolean } = {},
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (value.length === 0 && !options.allowEmpty) return undefined;
  return value;
}

export function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`);
  return value;
}

export function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

export function parseHeaderRecord(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (!HTTP_TOKEN_RE.test(name)) {
      throw new Error(`${field} contains an invalid HTTP header name: ${name}`);
    }
    if (typeof headerValue !== 'string') {
      throw new Error(`${field}.${name} must be a string`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

export function parseNetworkAuthorization(
  value: unknown,
  field = 'authorization',
): NetworkAuthorizationInput | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }

  const record = value as Record<string, unknown>;
  const allowedHosts = parseStringArray(record.allowedHosts, `${field}.allowedHosts`);
  const allowedCidrs = parseStringArray(record.allowedCidrs, `${field}.allowedCidrs`);
  const allowPrivateNetwork = parseOptionalBoolean(
    record.allowPrivateNetwork,
    `${field}.allowPrivateNetwork`,
  );
  const allowInsecureHttp = parseOptionalBoolean(
    record.allowInsecureHttp,
    `${field}.allowInsecureHttp`,
  );
  const expiresAt = parseOptionalString(record.expiresAt, `${field}.expiresAt`);
  const reason = parseOptionalString(record.reason, `${field}.reason`);

  const authorization: NetworkAuthorizationInput = {};
  if (allowedHosts.length > 0) authorization.allowedHosts = allowedHosts;
  if (allowedCidrs.length > 0) authorization.allowedCidrs = allowedCidrs;
  if (allowPrivateNetwork !== undefined) authorization.allowPrivateNetwork = allowPrivateNetwork;
  if (allowInsecureHttp !== undefined) authorization.allowInsecureHttp = allowInsecureHttp;
  if (expiresAt !== undefined) authorization.expiresAt = expiresAt;
  if (reason !== undefined) authorization.reason = reason;

  return authorization;
}

export { HTTP_TOKEN_RE };
export { analyzeHttpResponse, buildHttpRequest, isLikelyTextHttpBody, buildHttp2Frame };
export type { Http2FrameBuildInput, Http2SettingsEntry };
export {
  createNetworkAuthorizationPolicy,
  hasAuthorizedTargets,
  isAuthorizedNetworkTarget,
  isLocalSsrfBypassEnabled,
  isLoopbackHost,
  isNetworkAuthorizationExpired,
  isPrivateHost,
  resolveNetworkTarget,
};
export type { NetworkAuthorizationInput, ResolvedNetworkTarget };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function roundMs(ms: number): number {
  return Math.round(ms * 100) / 100;
}

export function computeRttStats(samples: number[]) {
  const sorted = [...samples].toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    count: sorted.length,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    avgMs: roundMs(sorted.reduce((s, v) => s + v, 0) / sorted.length),
    p50Ms: sorted[Math.floor(sorted.length * 0.5)]!,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)]!,
  };
}

export type AuthorizedTransportTarget = {
  url: URL;
  target: ResolvedNetworkTarget;
  authorizationPolicy: ReturnType<typeof createNetworkAuthorizationPolicy>;
  allowLegacyLocalSsrf: boolean;
};

export async function resolveAuthorizedTransportTarget(
  rawUrl: string,
  authorization: NetworkAuthorizationInput | undefined,
  operationLabel: string,
): Promise<AuthorizedTransportTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('url must be an absolute http:// or https:// URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('url must use the http:// or https:// scheme');
  }

  const authorizationPolicy = createNetworkAuthorizationPolicy(authorization);
  const allowLegacyLocalSsrf = !authorizationPolicy && isLocalSsrfBypassEnabled();

  if (
    authorizationPolicy &&
    (authorizationPolicy.allowPrivateNetwork || authorizationPolicy.allowInsecureHttp) &&
    !hasAuthorizedTargets(authorizationPolicy)
  ) {
    throw new Error(
      'authorization must include at least one allowed host or CIDR when enabling private network or insecure HTTP access.',
    );
  }

  if (isNetworkAuthorizationExpired(authorizationPolicy)) {
    throw new Error('authorization expired before the request was executed.');
  }

  let target: ResolvedNetworkTarget;
  try {
    target = await resolveNetworkTarget(url.toString());
  } catch {
    throw new Error(`${operationLabel} blocked: DNS resolution failed for "${url.toString()}"`);
  }

  const isPrivateTargetAllowed = (resolvedTarget: ResolvedNetworkTarget): boolean => {
    if (allowLegacyLocalSsrf) return true;
    return (
      authorizationPolicy?.allowPrivateNetwork === true &&
      isAuthorizedNetworkTarget(authorizationPolicy, resolvedTarget)
    );
  };

  const isInsecureHttpAllowed = (resolvedTarget: ResolvedNetworkTarget): boolean => {
    if (allowLegacyLocalSsrf) return true;
    if (isLoopbackHost(resolvedTarget.hostname)) return true;
    return (
      authorizationPolicy?.allowInsecureHttp === true &&
      isAuthorizedNetworkTarget(authorizationPolicy, resolvedTarget)
    );
  };

  const effectivePort = Number.parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'), 10);
  if (url.protocol === 'http:' && !isInsecureHttpAllowed(target)) {
    throw new Error(
      `${operationLabel} blocked: insecure HTTP is only allowed for loopback or explicitly authorized targets, got "${target.hostname}:${String(effectivePort)}"`,
    );
  }

  const hostnameIsPrivate = isPrivateHost(target.hostname);
  const resolvedAddressIsPrivate = isPrivateHost(target.resolvedAddress ?? '');
  const loopbackTarget =
    isLoopbackHost(target.hostname) || isLoopbackHost(target.resolvedAddress ?? '');
  if (
    (hostnameIsPrivate || resolvedAddressIsPrivate) &&
    !loopbackTarget &&
    !isPrivateTargetAllowed(target)
  ) {
    if (!hostnameIsPrivate && resolvedAddressIsPrivate && target.resolvedAddress) {
      throw new Error(
        `${operationLabel} blocked: "${target.hostname}:${String(effectivePort)}" resolved to private IP ${target.resolvedAddress}`,
      );
    }
    throw new Error(
      `${operationLabel} blocked: target "${target.hostname}:${String(effectivePort)}" resolves to a private or reserved address.`,
    );
  }

  return { url, target, authorizationPolicy, allowLegacyLocalSsrf };
}

export function normalizeTargetHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function getRequestMethod(requestText: string): string {
  const firstLine = requestText.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const method = firstLine.split(/\s+/, 1)[0]?.trim().toUpperCase() ?? '';
  if (!HTTP_TOKEN_RE.test(method)) {
    throw new Error('requestText must start with a valid HTTP request line');
  }
  return method;
}

type PlainHttpEndMode =
  | 'content-length'
  | 'chunked'
  | 'no-body'
  | 'socket-close'
  | 'timeout'
  | 'max-bytes';

export async function exchangePlainHttp(
  host: string,
  port: number,
  requestBuffer: Buffer,
  requestMethod: string,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<{ rawResponse: Buffer; endedBy: PlainHttpEndMode }> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    let sawData = false;
    let responseBuffer = Buffer.alloc(0);

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    const finalize = (endedBy: PlainHttpEndMode) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ rawResponse: responseBuffer, endedBy });
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.end(requestBuffer);
    });

    socket.on('data', (chunk: Buffer) => {
      sawData = true;
      responseBuffer = Buffer.concat([responseBuffer, chunk], responseBuffer.length + chunk.length);

      if (responseBuffer.length > maxResponseBytes) {
        responseBuffer = responseBuffer.subarray(0, maxResponseBytes);
        finalize('max-bytes');
        return;
      }

      const analysis = analyzeHttpResponse(responseBuffer, requestMethod);
      if (!analysis || !analysis.complete) return;

      if (analysis.bodyMode === 'none') {
        responseBuffer = responseBuffer.subarray(
          0,
          analysis.expectedRawBytes ?? responseBuffer.length,
        );
        finalize('no-body');
        return;
      }

      if (analysis.bodyMode === 'content-length') {
        responseBuffer = responseBuffer.subarray(
          0,
          analysis.expectedRawBytes ?? responseBuffer.length,
        );
        finalize('content-length');
        return;
      }

      if (analysis.bodyMode === 'chunked') {
        responseBuffer = responseBuffer.subarray(
          0,
          analysis.expectedRawBytes ?? responseBuffer.length,
        );
        finalize('chunked');
      }
    });

    socket.once('timeout', () => {
      if (!sawData) {
        fail(new Error(`Timed out waiting for HTTP response from ${host}:${String(port)}`));
        return;
      }
      finalize('timeout');
    });

    socket.once('end', () => {
      finalize('socket-close');
    });

    socket.once('error', (error) => {
      fail(error);
    });
  });
}

export function normalizeLookupResults(
  hostname: string,
  results: LookupAddress[],
): Array<{
  address: string;
  family: 4 | 6;
  hostname: string;
  isPrivate: boolean;
  isLoopback: boolean;
}> {
  return [...results]
    .toSorted((left, right) => {
      if (left.family !== right.family) {
        return left.family - right.family;
      }
      return left.address.localeCompare(right.address);
    })
    .map((result) => ({
      address: result.address,
      family: result.family as 4 | 6,
      hostname,
      isPrivate: isPrivateHost(result.address),
      isLoopback: isLoopbackHost(result.address),
    }));
}

export function normalizeHttp2HeaderValue(
  value: string | string[] | number | undefined,
): string | string[] | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return String(value);
}

export function normalizeHttp2Headers(
  headers: http2.IncomingHttpHeaders,
): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedValue = normalizeHttp2HeaderValue(value);
    if (normalizedValue !== null) {
      normalized[name] = normalizedValue;
    }
  }
  return normalized;
}

export function normalizeAlpnProtocol(protocol: string | false | null | undefined): string | null {
  if (!protocol) return null;
  const trimmed = protocol.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toHttp2RequestHeaders(
  headers: Record<string, string> | undefined,
): http2.OutgoingHttpHeaders {
  const output: http2.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    output[name.toLowerCase()] = value;
  }
  return output;
}

export function performHttp2ProbeInternal(options: {
  url: URL;
  target: ResolvedNetworkTarget;
  method: string;
  requestHeaders: http2.OutgoingHttpHeaders;
  bodyBuffer: Buffer;
  timeoutMs: number;
  maxBodyBytes: number;
  effectivePort: number;
  requestedAlpnProtocols: string[];
}): Promise<{
  responseHeaders: http2.IncomingHttpHeaders;
  bodyBuffer: Buffer;
  truncated: boolean;
  alpnProtocol: string | null;
}> {
  const {
    url,
    target,
    method,
    requestHeaders,
    bodyBuffer,
    timeoutMs,
    maxBodyBytes,
    effectivePort,
    requestedAlpnProtocols,
  } = options;
  let observedAlpnProtocol: string | null = null;

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseHeaders: http2.IncomingHttpHeaders | undefined;
    let capturedBody = Buffer.alloc(0);
    let truncated = false;
    let request: http2.ClientHttp2Stream | null = null;
    let connectedSocket: net.Socket | tls.TLSSocket | null = null;

    const session = http2.connect(url.origin, {
      createConnection: () => {
        if (url.protocol === 'https:') {
          const socket = tls.connect({
            host: target.resolvedAddress ?? target.hostname,
            port: effectivePort,
            servername: target.hostname,
            ALPNProtocols: requestedAlpnProtocols,
            rejectUnauthorized: true,
          });
          socket.setTimeout(timeoutMs, () => {
            socket.destroy(new Error(`Timed out probing HTTP/2 endpoint ${url.toString()}`));
          });
          socket.once('secureConnect', () => {
            observedAlpnProtocol = normalizeAlpnProtocol(socket.alpnProtocol);
          });
          connectedSocket = socket;
          return socket;
        }

        const socket = net.connect({
          host: target.resolvedAddress ?? target.hostname,
          port: effectivePort,
        });
        socket.setTimeout(timeoutMs, () => {
          socket.destroy(new Error(`Timed out probing HTTP/2 endpoint ${url.toString()}`));
        });
        connectedSocket = socket;
        return socket;
      },
    });

    const cleanup = () => {
      request?.removeAllListeners();
      session.removeAllListeners();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      session.close();
      resolve({
        responseHeaders: responseHeaders ?? {},
        bodyBuffer: capturedBody,
        truncated,
        alpnProtocol: observedAlpnProtocol,
      });
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      session.destroy(error);
      reject(error);
    };

    session.once('error', (error) => {
      if (connectedSocket instanceof tls.TLSSocket) {
        observedAlpnProtocol = normalizeAlpnProtocol(connectedSocket.alpnProtocol);
      }
      fail(error instanceof Error ? error : new Error(String(error)));
    });

    session.once('connect', () => {
      if (connectedSocket instanceof tls.TLSSocket) {
        observedAlpnProtocol = normalizeAlpnProtocol(connectedSocket.alpnProtocol);
      }

      request = session.request({
        ':method': method,
        ':path': `${url.pathname}${url.search}`,
        ':scheme': url.protocol.slice(0, -1),
        ':authority': url.host,
        ...requestHeaders,
      });
      request.once('response', (headers) => {
        responseHeaders = headers;
      });
      request.on('data', (chunk: string | Buffer) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
        const remaining = maxBodyBytes - capturedBody.length;
        if (remaining > 0) {
          capturedBody = Buffer.concat(
            [capturedBody, buffer.subarray(0, remaining)],
            capturedBody.length + Math.min(buffer.length, remaining),
          );
        }

        if (buffer.length > remaining && !truncated) {
          truncated = true;
          request?.close(http2.constants.NGHTTP2_CANCEL);
        }
      });
      request.once('end', finish);
      request.once('close', () => {
        if (truncated) finish();
      });
      request.once('error', (error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });

      if (bodyBuffer.length > 0) {
        request.end(bodyBuffer);
      } else {
        request.end();
      }
    });
  });
}
