import * as dns from 'node:dns/promises';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  parseOptionalString,
  parseRawString,
  parseHeaderRecord,
  parseNetworkAuthorization,
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

export class RawDnsHttpHandlers {
  constructor(private readonly eventBus?: EventBus<ServerEventMap>) {}

  async handleDnsResolve(args: Record<string, unknown>) {
    try {
      const hostname = parseOptionalString(args.hostname, 'hostname');
      if (!hostname) {
        return R.text('hostname is required', true);
      }
      const rrType = parseOptionalString(args.rrType, 'rrType') ?? 'A';
      const validTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR', 'SRV', 'ANY'];
      if (!validTypes.includes(rrType)) {
        return R.text(
          `Invalid rrType: "${rrType}". Expected one of: ${validTypes.join(', ')}`,
          true,
        );
      }
      const start = performance.now();
      const records = await dns.resolve(hostname, rrType as never);
      const timing = Math.round((performance.now() - start) * 100) / 100;
      return R.ok().json({ hostname, rrType, records, timing });
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
      const start = performance.now();
      const hostnames = await dns.reverse(ip);
      const timing = Math.round((performance.now() - start) * 100) / 100;
      return R.ok().json({ ip, hostnames, timing });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.fail(`DNS reverse lookup failed: ${message}`).json();
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
                `HTTP request blocked: request-line target host "${targetHost}" does not match authorized host "${host}"`,
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
