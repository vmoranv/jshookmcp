import * as dns from 'node:dns/promises';
import type { AnyRecord, MxRecord, SoaRecord, SrvRecord } from 'node:dns';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  parseOptionalString,
  parseRawString,
  parseHeaderRecord,
  parseNetworkAuthorization,
  parseStringArray,
  normalizeTargetHost,
  formatHostForUrl,
  getRequestMethod,
  resolveAuthorizedTransportTarget,
  exchangePlainHttp,
} from './raw-helpers';
import {
  buildHttpRequest,
  isLikelyTextHttpBody,
  analyzeHttpResponse,
} from '@server/domains/network/http-raw';
import { emitEvent, parseBooleanArg, parseNumberArg } from './shared';

const DNS_RR_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR', 'SRV', 'ANY'] as const;
type DnsRecords = string[] | string[][] | MxRecord[] | SrvRecord[] | SoaRecord | AnyRecord[];

interface DnsClient {
  resolve(hostname: string, rrType: string): Promise<DnsRecords>;
  reverse(ip: string): Promise<string[]>;
}

function classifyDnsStatus(code: string | undefined): string {
  if (!code) return 'ERROR';
  if (code === 'ENOTFOUND') return 'NXDOMAIN';
  if (code === 'ENODATA') return 'NODATA';
  if (code === 'ESERVFAIL') return 'SERVFAIL';
  if (code === 'ETIMEOUT') return 'TIMEOUT';
  if (code === 'ECONNREFUSED') return 'CONNREFUSED';
  if (code === 'EREFUSED') return 'REFUSED';
  return 'ERROR';
}

function roundTiming(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

function createDnsClient(server: string | undefined): DnsClient {
  if (!server) {
    return dns;
  }
  const resolver = new dns.Resolver();
  resolver.setServers([server]);
  return resolver;
}

export class RawDnsHttpHandlers {
  constructor(private readonly eventBus?: EventBus<ServerEventMap>) {}

  async handleDnsResolve(args: Record<string, unknown>) {
    try {
      const hostname = parseOptionalString(args.hostname, 'hostname');
      if (!hostname) {
        return R.text('hostname is required', true);
      }
      const rrType = parseOptionalString(args.rrType, 'rrType') ?? 'A';
      if (!DNS_RR_TYPES.includes(rrType as (typeof DNS_RR_TYPES)[number])) {
        return R.text(
          `Invalid rrType: "${rrType}". Expected one of: ${DNS_RR_TYPES.join(', ')}`,
          true,
        );
      }
      const server = parseOptionalString(args.server, 'server');
      const resolver = createDnsClient(server);
      const start = performance.now();
      const records = await resolver.resolve(hostname, rrType);
      const timing = roundTiming(start);
      return R.ok().json({ hostname, rrType, records, timing, ...(server ? { server } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`DNS resolve failed: ${message}`).json();
    }
  }

  async handleDnsReverse(args: Record<string, unknown>) {
    try {
      const ip = parseOptionalString(args.ip, 'ip');
      if (!ip) {
        return R.text('ip is required', true);
      }
      const server = parseOptionalString(args.server, 'server');
      const resolver = createDnsClient(server);
      const start = performance.now();
      const hostnames = await resolver.reverse(ip);
      const timing = roundTiming(start);
      return R.ok().json({ ip, hostnames, timing, ...(server ? { server } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`DNS reverse lookup failed: ${message}`).json();
    }
  }

  async handleDnsProbe(args: Record<string, unknown>) {
    try {
      const hostname = parseOptionalString(args.hostname, 'hostname');
      if (!hostname) {
        return R.text('hostname is required', true);
      }
      const rrType = parseOptionalString(args.rrType, 'rrType') ?? 'A';
      if (!DNS_RR_TYPES.includes(rrType as (typeof DNS_RR_TYPES)[number])) {
        return R.text(
          `Invalid rrType: "${rrType}". Expected one of: ${DNS_RR_TYPES.join(', ')}`,
          true,
        );
      }
      const server = parseOptionalString(args.server, 'server');
      const resolver = createDnsClient(server);
      const start = performance.now();
      try {
        const records = await resolver.resolve(hostname, rrType);
        const timing = roundTiming(start);
        return R.ok().json({
          hostname,
          rrType,
          status: 'NOERROR',
          records,
          timing,
          ...(server ? { server } : {}),
        });
      } catch (dnsErr: unknown) {
        const timing = roundTiming(start);
        const code =
          dnsErr instanceof Error && 'code' in dnsErr
            ? (dnsErr as NodeJS.ErrnoException).code
            : undefined;
        const status = classifyDnsStatus(code);
        return R.ok().json({
          hostname,
          rrType,
          status,
          records: [],
          timing,
          errorCode: code ?? null,
          ...(server ? { server } : {}),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`DNS probe failed: ${message}`).json();
    }
  }

  async handleDnsCnameChain(args: Record<string, unknown>) {
    try {
      const hostname = parseOptionalString(args.hostname, 'hostname');
      if (!hostname) {
        return R.text('hostname is required', true);
      }
      const maxDepth = parseNumberArg(args.maxDepth, {
        defaultValue: 10,
        min: 1,
        max: 30,
        integer: true,
      });
      const server = parseOptionalString(args.server, 'server');
      const resolver = createDnsClient(server);

      const chain: Array<{
        host: string;
        target: string | null;
        status: string;
        depth: number;
        timing: number;
      }> = [];
      let current = hostname;

      for (let depth = 0; depth < maxDepth; depth++) {
        const start = performance.now();
        try {
          const records = (await resolver.resolve(current, 'CNAME')) as string[];
          const timing = roundTiming(start);
          const target = records[0] ?? null;
          chain.push({ host: current, target, status: 'CNAME', depth, timing });
          if (target) {
            current = target;
          } else {
            break;
          }
        } catch (dnsErr: unknown) {
          const timing = roundTiming(start);
          const code =
            dnsErr instanceof Error && 'code' in dnsErr
              ? (dnsErr as NodeJS.ErrnoException).code
              : undefined;
          const status =
            code === 'ENOTFOUND' || code === 'ENODATA' ? 'TERMINAL' : classifyDnsStatus(code);
          chain.push({ host: current, target: null, status, depth, timing });
          break;
        }
      }

      return R.ok().json({ hostname, chain, depth: chain.length, ...(server ? { server } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`CNAME chain trace failed: ${message}`).json();
    }
  }

  async handleDnsBulkResolve(args: Record<string, unknown>) {
    try {
      const hostnamesArr = parseStringArray(args.hostnames, 'hostnames');
      if (hostnamesArr.length === 0) {
        return R.text('hostnames must be a non-empty array', true);
      }
      if (hostnamesArr.length > 1000) {
        return R.text('hostnames array too large (max 1000)', true);
      }
      const rrType = parseOptionalString(args.rrType, 'rrType') ?? 'A';
      if (!DNS_RR_TYPES.includes(rrType as (typeof DNS_RR_TYPES)[number])) {
        return R.text(
          `Invalid rrType: "${rrType}". Expected one of: ${DNS_RR_TYPES.join(', ')}`,
          true,
        );
      }
      const concurrency = parseNumberArg(args.concurrency, {
        defaultValue: 10,
        min: 1,
        max: 50,
        integer: true,
      });
      const server = parseOptionalString(args.server, 'server');
      const resolver = createDnsClient(server);

      const results: Array<{
        hostname: string;
        status: string;
        records: DnsRecords | [];
        timing: number;
      }> = [];

      for (let i = 0; i < hostnamesArr.length; i += concurrency) {
        const batch = hostnamesArr.slice(i, i + concurrency);
        const batchResults = await Promise.all(
          batch.map(async (host) => {
            const start = performance.now();
            try {
              const records = await resolver.resolve(host, rrType);
              const timing = roundTiming(start);
              return { hostname: host, status: 'NOERROR', records, timing };
            } catch (dnsErr: unknown) {
              const timing = roundTiming(start);
              const code =
                dnsErr instanceof Error && 'code' in dnsErr
                  ? (dnsErr as NodeJS.ErrnoException).code
                  : undefined;
              return {
                hostname: host,
                status: classifyDnsStatus(code),
                records: [],
                timing,
              };
            }
          }),
        );
        results.push(...batchResults);
      }

      const errorCount = results.filter((r) => r.status !== 'NOERROR').length;
      return R.ok().json({
        results,
        total: results.length,
        errors: errorCount,
        rrType,
        ...(server ? { server } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`Bulk DNS resolve failed: ${message}`).json();
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
        addHostHeader: parseBooleanArg(args.addHostHeader, true),
        addContentLength: parseBooleanArg(args.addContentLength, true),
        addConnectionClose: parseBooleanArg(args.addConnectionClose, true),
      });

      emitEvent(this.eventBus, 'network:http_request_built', {
        method: built.startLine.split(' ', 1)[0] ?? 'UNKNOWN',
        target,
        byteLength: built.requestBytes,
        timestamp: new Date().toISOString(),
      });

      return R.ok()
        .merge(built as unknown as Record<string, unknown>)
        .json();
    } catch (error) {
      return R.fail(error instanceof Error ? error.message : String(error)).json();
    }
  }

  async handleHttpPlainRequest(args: Record<string, unknown>) {
    try {
      const hostArg = parseOptionalString(args.host, 'host');
      const requestText = parseRawString(args.requestText, 'requestText');
      if (!hostArg) throw new Error('host is required');
      if (!requestText) throw new Error('requestText is required');

      const host = normalizeTargetHost(hostArg);
      const port = parseNumberArg(args.port, {
        defaultValue: 80,
        min: 1,
        max: 65_535,
        integer: true,
      });
      const timeoutMs = parseNumberArg(args.timeoutMs, {
        defaultValue: 30_000,
        min: 1,
        max: 120_000,
        integer: true,
      });
      const maxResponseBytes = parseNumberArg(args.maxResponseBytes, {
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

      if (authorization) {
        const requestLine = requestText.split(/\r?\n/, 1)[0] ?? '';
        const requestTarget = requestLine.split(/\s+/)[1] ?? '';
        if (requestTarget.includes('://')) {
          try {
            const targetUrl = new URL(requestTarget);
            const targetHost = normalizeTargetHost(targetUrl.hostname);
            if (targetHost !== host && targetHost !== (target.resolvedAddress ?? '')) {
              throw new Error(
                `HTTP request blocked: request-line target host "${targetHost}" does not match authorized host "` +
                  `${host}"`,
              );
            }
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('HTTP request blocked:')) throw e;
          }
        }

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

      emitEvent(this.eventBus, 'network:http_plain_request_completed', {
        host,
        port,
        statusCode: analysis.statusCode,
        byteLength: exchange.rawResponse.length,
        timestamp: new Date().toISOString(),
      });

      return R.ok()
        .merge({
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
        })
        .json();
    } catch (error) {
      return R.fail(error instanceof Error ? error.message : String(error)).json();
    }
  }
}
