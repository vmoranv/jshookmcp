import * as dnsPromises from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import * as http2 from 'node:http2';
import { isIP } from 'node:net';
import * as net from 'node:net';
import * as tls from 'node:tls';

import {
  analyzeHttpResponse,
  buildHttpRequest,
  isLikelyTextHttpBody,
} from '@server/domains/network/http-raw';
import { buildHttp2Frame } from '@server/domains/network/http2-raw';
import type { Http2FrameBuildInput, Http2SettingsEntry } from '@server/domains/network/http2-raw';
import { AdvancedToolHandlersRuntime as AdvancedToolHandlersReplay } from '@server/domains/network/handlers.impl.core.runtime.replay';
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

type AuthorizedTransportTarget = {
  url: URL;
  target: ResolvedNetworkTarget;
  authorizationPolicy: ReturnType<typeof createNetworkAuthorizationPolicy>;
  allowLegacyLocalSsrf: boolean;
};

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }

  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseRawString(
  value: unknown,
  field: string,
  options: { allowEmpty?: boolean } = {},
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }

  if (value.length === 0 && !options.allowEmpty) {
    return undefined;
  }

  return value;
}

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }

  return value;
}

function parseHeaderRecord(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }

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

function parseNetworkAuthorization(
  value: unknown,
  field = 'authorization',
): NetworkAuthorizationInput | undefined {
  if (value === undefined) {
    return undefined;
  }

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

function normalizeLookupResults(
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

function normalizeTargetHost(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function getRequestMethod(requestText: string): string {
  const firstLine = requestText.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const method = firstLine.split(/\s+/, 1)[0]?.trim().toUpperCase() ?? '';
  if (!HTTP_TOKEN_RE.test(method)) {
    throw new Error('requestText must start with a valid HTTP request line');
  }
  return method;
}

function normalizeHttp2HeaderValue(
  value: string | string[] | number | undefined,
): string | string[] | null {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  return String(value);
}

function normalizeHttp2Headers(
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

function normalizeAlpnProtocol(protocol: string | false | null | undefined): string | null {
  if (!protocol) {
    return null;
  }

  const trimmed = protocol.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toHttp2RequestHeaders(
  headers: Record<string, string> | undefined,
): http2.OutgoingHttpHeaders {
  const output: http2.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    output[name.toLowerCase()] = value;
  }

  return output;
}

async function resolveAuthorizedTransportTarget(
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
    if (allowLegacyLocalSsrf) {
      return true;
    }

    return (
      authorizationPolicy?.allowPrivateNetwork === true &&
      isAuthorizedNetworkTarget(authorizationPolicy, resolvedTarget)
    );
  };

  const isInsecureHttpAllowed = (resolvedTarget: ResolvedNetworkTarget): boolean => {
    if (allowLegacyLocalSsrf) {
      return true;
    }

    if (isLoopbackHost(resolvedTarget.hostname)) {
      return true;
    }

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

  return {
    url,
    target,
    authorizationPolicy,
    allowLegacyLocalSsrf,
  };
}

type PlainHttpEndMode =
  | 'content-length'
  | 'chunked'
  | 'no-body'
  | 'socket-close'
  | 'timeout'
  | 'max-bytes';

async function exchangePlainHttp(
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
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({ rawResponse: responseBuffer, endedBy });
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }
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
      if (!analysis || !analysis.complete) {
        return;
      }

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

export class AdvancedToolHandlersRaw extends AdvancedToolHandlersReplay {
  async handleDnsResolve(args: Record<string, unknown>) {
    try {
      const hostname = parseOptionalString(args.hostname, 'hostname');
      if (!hostname) {
        throw new Error('hostname is required');
      }

      const host = normalizeTargetHost(hostname);
      const familyArg = parseOptionalString(args.family, 'family') ?? 'auto';
      const family = familyArg === 'ipv4' ? 4 : familyArg === 'ipv6' ? 6 : 0;
      if (!['auto', 'ipv4', 'ipv6'].includes(familyArg)) {
        throw new Error('family must be one of: auto, ipv4, ipv6');
      }

      const all = this.parseBooleanArg(args.all, true);
      if (isIP(host) !== 0) {
        const familyValue = isIP(host) as 4 | 6;
        const result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  hostname: host,
                  familyRequested: familyArg,
                  count: 1,
                  results: [
                    {
                      address: host,
                      family: familyValue,
                      hostname: host,
                      isPrivate: isPrivateHost(host),
                      isLoopback: isLoopbackHost(host),
                    },
                  ],
                  note: 'Input was already an IP literal, so no DNS lookup was required.',
                },
                null,
                2,
              ),
            },
          ],
        };
        this.emit('network:dns_resolved', {
          hostname: host,
          count: 1,
          timestamp: new Date().toISOString(),
        });
        return result;
      }

      const lookupResult = await dnsPromises.lookup(host, {
        family,
        all,
        verbatim: true,
      });
      const results = normalizeLookupResults(
        host,
        Array.isArray(lookupResult) ? lookupResult : [lookupResult],
      );

      const result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                hostname: host,
                familyRequested: familyArg,
                count: results.length,
                results,
              },
              null,
              2,
            ),
          },
        ],
      };
      this.emit('network:dns_resolved', {
        hostname: host,
        count: results.length,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleDnsReverse(args: Record<string, unknown>) {
    try {
      const address = parseOptionalString(args.address, 'address');
      if (!address) {
        throw new Error('address is required');
      }

      const normalized = normalizeTargetHost(address);
      if (isIP(normalized) === 0) {
        throw new Error('address must be a valid IPv4 or IPv6 literal');
      }

      try {
        const hostnames = await dnsPromises.reverse(normalized);
        const result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  address: normalized,
                  isPrivate: isPrivateHost(normalized),
                  isLoopback: isLoopbackHost(normalized),
                  count: hostnames.length,
                  hostnames: [...hostnames].toSorted((left, right) => left.localeCompare(right)),
                },
                null,
                2,
              ),
            },
          ],
        };
        this.emit('network:dns_reversed', {
          address: normalized,
          count: hostnames.length,
          timestamp: new Date().toISOString(),
        });
        return result;
      } catch (error) {
        const code =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : undefined;

        if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ENOTIMP') {
          const result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    address: normalized,
                    isPrivate: isPrivateHost(normalized),
                    isLoopback: isLoopbackHost(normalized),
                    count: 0,
                    hostnames: [],
                    note: 'No PTR records were returned for this address.',
                  },
                  null,
                  2,
                ),
              },
            ],
          };
          this.emit('network:dns_reversed', {
            address: normalized,
            count: 0,
            timestamp: new Date().toISOString(),
          });
          return result;
        }

        throw error;
      }
    } catch (error) {
      const result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
      return result;
    }
  }

  async handleHttpRequestBuild(args: Record<string, unknown>) {
    try {
      const method = parseOptionalString(args.method, 'method');
      const target = parseOptionalString(args.target, 'target');
      if (!method) {
        throw new Error('method is required');
      }
      if (!target) {
        throw new Error('target is required');
      }

      const built = buildHttpRequest({
        method,
        target,
        host: parseOptionalString(args.host, 'host'),
        headers: parseHeaderRecord(args.headers, 'headers'),
        body: parseRawString(args.body, 'body', { allowEmpty: true }),
        httpVersion:
          (parseOptionalString(args.httpVersion, 'httpVersion') as '1.0' | '1.1' | undefined) ??
          '1.1',
        addHostHeader: this.parseBooleanArg(args.addHostHeader, true),
        addContentLength: this.parseBooleanArg(args.addContentLength, true),
        addConnectionClose: this.parseBooleanArg(args.addConnectionClose, true),
      });

      const result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                ...built,
              },
              null,
              2,
            ),
          },
        ],
      };
      this.emit('network:http_request_built', {
        method: built.startLine.split(' ', 1)[0] ?? 'UNKNOWN',
        target,
        byteLength: built.requestBytes,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
      return result;
    }
  }

  async handleHttpPlainRequest(args: Record<string, unknown>) {
    try {
      const hostArg = parseOptionalString(args.host, 'host');
      const requestText = parseRawString(args.requestText, 'requestText');
      if (!hostArg) {
        throw new Error('host is required');
      }
      if (!requestText) {
        throw new Error('requestText is required');
      }

      const host = normalizeTargetHost(hostArg);
      const port = this.parseNumberArg(args.port, {
        defaultValue: 80,
        min: 1,
        max: 65_535,
        integer: true,
      });
      const timeoutMs = this.parseNumberArg(args.timeoutMs, {
        defaultValue: 30_000,
        min: 1,
        max: 120_000,
        integer: true,
      });
      const maxResponseBytes = this.parseNumberArg(args.maxResponseBytes, {
        defaultValue: 512_000,
        min: 256,
        max: 5_242_880,
        integer: true,
      });
      const requestMethod = getRequestMethod(requestText);
      const authorization = parseNetworkAuthorization(args.authorization);
      const { target } = await resolveAuthorizedTransportTarget(
        `http://${formatHostForUrl(host)}:${String(port)}/`,
        authorization,
        'HTTP request',
      );

      // Validate request-line target and Host header against authorized host
      // to prevent SSRF via absolute-form URIs or mismatched Host headers
      // that could redirect the request through a proxy/gateway to a private target.
      if (authorization) {
        const requestLine = requestText.split(/\r?\n/, 1)[0] ?? '';
        const requestTarget = requestLine.split(/\s+/)[1] ?? '';

        // Block absolute-form targets that diverge from the authorized host
        if (requestTarget.includes('://')) {
          try {
            const targetUrl = new URL(requestTarget);
            const targetHost = normalizeTargetHost(targetUrl.hostname);
            if (targetHost !== host && targetHost !== (target.resolvedAddress ?? '')) {
              throw new Error(
                `HTTP request blocked: request-line target host "${targetHost}" does not match authorized host "${host}"`,
              );
            }
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('HTTP request blocked:')) throw e;
            // Not a valid URL in request-line — origin-form is fine
          }
        }

        // Check Host header in the raw request text
        const hostHeaderMatch = requestText.match(/^Host:\s*(\S+)/im);
        const hostHeaderValue = hostHeaderMatch?.[1];
        if (hostHeaderValue) {
          const declaredHost = normalizeTargetHost(hostHeaderValue.replace(/:\d+$/, ''));
          if (declaredHost !== host && declaredHost !== (target.resolvedAddress ?? '')) {
            throw new Error(
              `HTTP request blocked: Host header "${hostHeaderValue}" does not match authorized host "${host}"`,
            );
          }
        }
      }

      const exchange = await exchangePlainHttp(
        target.resolvedAddress ?? target.hostname,
        port,
        Buffer.from(requestText, 'utf8'),
        requestMethod,
        timeoutMs,
        maxResponseBytes,
      );
      const analysis = analyzeHttpResponse(exchange.rawResponse, requestMethod);
      if (!analysis) {
        throw new Error('Received data but could not parse complete HTTP response headers.');
      }

      const contentType =
        analysis.rawHeaders.find((header) => header.name.toLowerCase() === 'content-type')?.value ??
        null;
      const bodyIsText = isLikelyTextHttpBody(contentType, analysis.bodyBuffer);
      const complete =
        analysis.complete ||
        (analysis.bodyMode === 'until-close' && exchange.endedBy === 'socket-close');

      const result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                host,
                port,
                resolvedAddress: target.resolvedAddress ?? target.hostname,
                requestBytes: Buffer.byteLength(requestText, 'utf8'),
                response: {
                  statusLine: analysis.statusLine,
                  httpVersion: analysis.httpVersion,
                  statusCode: analysis.statusCode,
                  statusText: analysis.statusText,
                  headers: analysis.headers,
                  rawHeaders: analysis.rawHeaders,
                  headerBytes: analysis.headerBytes,
                  bodyBytes: analysis.bodyBytes,
                  bodyMode: analysis.bodyMode,
                  chunkedDecoded: analysis.chunkedDecoded,
                  complete,
                  truncated: exchange.endedBy === 'max-bytes',
                  endedBy: exchange.endedBy,
                  bodyText: bodyIsText ? analysis.bodyBuffer.toString('utf8') : undefined,
                  bodyBase64: bodyIsText ? undefined : analysis.bodyBuffer.toString('base64'),
                },
              },
              null,
              2,
            ),
          },
        ],
      };
      this.emit('network:http_plain_request_completed', {
        host,
        port,
        statusCode: analysis.statusCode,
        byteLength: exchange.rawResponse.length,
        timestamp: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  async handleHttp2Probe(args: Record<string, unknown>) {
    const rawUrl = parseOptionalString(args.url, 'url');
    let eventUrl = rawUrl ?? '';
    let eventStatusCode: number | null = null;
    let eventAlpnProtocol: string | null = null;
    let eventSuccess = false;

    try {
      if (!rawUrl) {
        throw new Error('url is required');
      }

      const method = (parseOptionalString(args.method, 'method') ?? 'GET').toUpperCase();
      if (!HTTP_TOKEN_RE.test(method)) {
        throw new Error('method must be a valid HTTP token');
      }

      const timeoutMs = this.parseNumberArg(args.timeoutMs, {
        defaultValue: 30_000,
        min: 1,
        max: 120_000,
        integer: true,
      });
      const maxBodyBytes = this.parseNumberArg(args.maxBodyBytes, {
        defaultValue: 32_768,
        min: 128,
        max: 1_048_576,
        integer: true,
      });
      const bodyBuffer = Buffer.from(
        parseRawString(args.body, 'body', { allowEmpty: true }) ?? '',
        'utf8',
      );
      const alpnProtocols = parseStringArray(args.alpnProtocols, 'alpnProtocols');
      const requestHeaders = toHttp2RequestHeaders(parseHeaderRecord(args.headers, 'headers'));
      const authorization = parseNetworkAuthorization(args.authorization);
      const { url, target } = await resolveAuthorizedTransportTarget(
        rawUrl,
        authorization,
        'HTTP/2 probe',
      );
      eventUrl = url.toString();

      if (!('content-length' in requestHeaders) && bodyBuffer.length > 0) {
        requestHeaders['content-length'] = String(bodyBuffer.length);
      }

      const effectivePort = Number.parseInt(
        url.port || (url.protocol === 'https:' ? '443' : '80'),
        10,
      );
      const requestedAlpnProtocols = alpnProtocols.length > 0 ? alpnProtocols : ['h2', 'http/1.1'];
      const transportProtocol = url.protocol === 'https:' ? 'h2' : 'h2c';
      let observedAlpnProtocol: string | null = null;

      const response = await new Promise<{
        responseHeaders: http2.IncomingHttpHeaders;
        bodyBuffer: Buffer;
        truncated: boolean;
      }>((resolve, reject) => {
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
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          session.close();
          resolve({
            responseHeaders: responseHeaders ?? {},
            bodyBuffer: capturedBody,
            truncated,
          });
        };

        const fail = (error: Error) => {
          if (settled) {
            return;
          }
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
            if (truncated) {
              finish();
            }
          });
          request.once('error', (error) => {
            fail(error instanceof Error ? error : new Error(String(error)));
          });

          if (bodyBuffer.length > 0) {
            request.end(bodyBuffer);
            return;
          }

          request.end();
        });
      });

      const normalizedHeaders = normalizeHttp2Headers(response.responseHeaders);
      const rawStatus = response.responseHeaders[':status'];
      const statusCode =
        typeof rawStatus === 'number'
          ? rawStatus
          : typeof rawStatus === 'string'
            ? Number.parseInt(rawStatus, 10)
            : null;
      const contentType =
        typeof normalizedHeaders['content-type'] === 'string'
          ? normalizedHeaders['content-type']
          : Array.isArray(normalizedHeaders['content-type'])
            ? (normalizedHeaders['content-type'][0] ?? null)
            : null;
      const bodyIsText = isLikelyTextHttpBody(contentType, response.bodyBuffer);

      eventStatusCode = Number.isFinite(statusCode ?? Number.NaN) ? statusCode : null;
      eventAlpnProtocol = observedAlpnProtocol;
      eventSuccess = true;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                url: url.toString(),
                resolvedAddress: target.resolvedAddress ?? target.hostname,
                transport: {
                  scheme: url.protocol,
                  protocol: transportProtocol,
                  alpnProtocol: observedAlpnProtocol,
                  encrypted: url.protocol === 'https:',
                },
                response: {
                  statusCode,
                  headers: normalizedHeaders,
                  bodyBytes: response.bodyBuffer.length,
                  truncated: response.truncated,
                  bodyTextSnippet: bodyIsText ? response.bodyBuffer.toString('utf8') : undefined,
                  bodyBase64Snippet: bodyIsText
                    ? undefined
                    : response.bodyBuffer.toString('base64'),
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                url: rawUrl ?? undefined,
                alpnProtocol: eventAlpnProtocol,
                statusCode: eventStatusCode,
              },
              null,
              2,
            ),
          },
        ],
      };
    } finally {
      this.emit('network:http2_probe_completed', {
        url: eventUrl,
        statusCode: eventStatusCode,
        alpnProtocol: eventAlpnProtocol,
        success: eventSuccess,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async handleHttp2FrameBuild(args: Record<string, unknown>) {
    const frameTypeRaw = parseOptionalString(args.frameType, 'frameType');
    if (!frameTypeRaw) {
      throw new Error('frameType is required');
    }

    const validFrameTypes = [
      'DATA',
      'SETTINGS',
      'PING',
      'WINDOW_UPDATE',
      'RST_STREAM',
      'GOAWAY',
      'RAW',
    ];
    const frameType = frameTypeRaw.toUpperCase();
    if (!validFrameTypes.includes(frameType)) {
      throw new Error(`frameType must be one of: ${validFrameTypes.join(', ')}`);
    }

    const streamId =
      args.streamId !== undefined
        ? this.parseNumberArg(args.streamId, { defaultValue: 0, min: 0, integer: true })
        : undefined;
    const flags =
      args.flags !== undefined
        ? this.parseNumberArg(args.flags, { defaultValue: 0, min: 0, max: 255, integer: true })
        : undefined;
    const frameTypeCode =
      args.frameTypeCode !== undefined
        ? this.parseNumberArg(args.frameTypeCode, {
            defaultValue: 0,
            min: 0,
            max: 255,
            integer: true,
          })
        : undefined;
    const windowSizeIncrement =
      args.windowSizeIncrement !== undefined
        ? this.parseNumberArg(args.windowSizeIncrement, { defaultValue: 1, min: 1, integer: true })
        : undefined;
    const errorCode =
      args.errorCode !== undefined
        ? this.parseNumberArg(args.errorCode, { defaultValue: 0, min: 0, integer: true })
        : undefined;
    const lastStreamId =
      args.lastStreamId !== undefined
        ? this.parseNumberArg(args.lastStreamId, { defaultValue: 0, min: 0, integer: true })
        : undefined;

    const payloadHex = parseOptionalString(args.payloadHex, 'payloadHex');
    const payloadText = parseRawString(args.payloadText, 'payloadText', { allowEmpty: true });
    const payloadEncoding = parseOptionalString(args.payloadEncoding, 'payloadEncoding') as
      | 'utf8'
      | 'ascii'
      | undefined;
    const ack = parseOptionalBoolean(args.ack, 'ack');
    const pingOpaqueDataHex = parseOptionalString(args.pingOpaqueDataHex, 'pingOpaqueDataHex');
    const debugDataText = parseRawString(args.debugDataText, 'debugDataText', {
      allowEmpty: true,
    });
    const debugDataEncoding = parseOptionalString(args.debugDataEncoding, 'debugDataEncoding') as
      | 'utf8'
      | 'ascii'
      | undefined;

    let settings: Http2SettingsEntry[] | undefined;
    if (args.settings !== undefined) {
      if (!Array.isArray(args.settings)) {
        throw new Error('settings must be an array');
      }

      settings = (args.settings as Array<Record<string, unknown>>).map((entry, index) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          throw new Error(`settings[${String(index)}] must be an object with id and value`);
        }

        const id =
          typeof entry.id === 'number'
            ? entry.id
            : (() => {
                throw new Error(`settings[${String(index)}].id must be a number`);
              })();
        const value =
          typeof entry.value === 'number'
            ? entry.value
            : (() => {
                throw new Error(`settings[${String(index)}].value must be a number`);
              })();

        return { id, value };
      });
    }

    const input: Http2FrameBuildInput = {
      frameType: frameType as Http2FrameBuildInput['frameType'],
      ...(streamId !== undefined && { streamId }),
      ...(flags !== undefined && { flags }),
      ...(frameTypeCode !== undefined && { frameTypeCode }),
      ...(payloadHex !== undefined && { payloadHex }),
      ...(payloadText !== undefined && { payloadText }),
      ...(payloadEncoding !== undefined && { payloadEncoding }),
      ...(settings !== undefined && { settings }),
      ...(ack !== undefined && { ack }),
      ...(pingOpaqueDataHex !== undefined && { pingOpaqueDataHex }),
      ...(windowSizeIncrement !== undefined && { windowSizeIncrement }),
      ...(errorCode !== undefined && { errorCode }),
      ...(lastStreamId !== undefined && { lastStreamId }),
      ...(debugDataText !== undefined && { debugDataText }),
      ...(debugDataEncoding !== undefined && { debugDataEncoding }),
    };

    const result = buildHttp2Frame(input);

    this.emit('network:http2_frame_build_completed', {
      frameType: result.frameType,
      typeCode: result.typeCode,
      streamId: result.streamId,
      flags: result.flags,
      payloadBytes: result.payloadBytes,
      timestamp: new Date().toISOString(),
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
}
