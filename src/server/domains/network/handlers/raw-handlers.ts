/**
 * Raw HTTP/HTTP2/DNS/RTT handlers — standalone class using composition.
 *
 * Extracted from AdvancedToolHandlersRaw (handlers.impl.core.runtime.raw.ts).
 * Uses helpers from ./raw-helpers.ts and ./shared.ts instead of inheritance.
 */

import * as net from 'node:net';
import * as tls from 'node:tls';
import * as dns from 'node:dns/promises';

import type { EventBus, ServerEventMap } from '@server/EventBus';
import { R } from '@server/domains/shared/ResponseBuilder';
import {
  parseOptionalString,
  parseRawString,
  parseHeaderRecord,
  parseNetworkAuthorization,
  clamp,
  roundMs,
  computeRttStats,
  normalizeTargetHost,
  formatHostForUrl,
  getRequestMethod,
  normalizeHttp2Headers,
  toHttp2RequestHeaders,
  resolveAuthorizedTransportTarget,
  exchangePlainHttp,
  performHttp2ProbeInternal,
  HTTP_TOKEN_RE,
  parseStringArray as parseStringArrayHelper,
  parseOptionalBoolean as parseOptionalBooleanHelper,
} from './raw-helpers';
import {
  buildHttpRequest,
  isLikelyTextHttpBody,
  analyzeHttpResponse,
} from '@server/domains/network/http-raw';
import { buildHttp2Frame } from '@server/domains/network/http2-raw';
import type { Http2FrameBuildInput, Http2SettingsEntry } from '@server/domains/network/http2-raw';

import { emitEvent, parseBooleanArg, parseNumberArg } from './shared';

export class RawHandlers {
  constructor(private eventBus?: EventBus<ServerEventMap>) {}

  // ── DNS ──

  async handleDnsResolve(args: Record<string, unknown>) {
    try {
      const hostname = parseOptionalString(args.hostname, 'hostname');
      if (!hostname) {
        return R.error('hostname is required');
      }
      const rrType = parseOptionalString(args.rrType, 'rrType') ?? 'A';
      const validTypes = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'PTR', 'SRV', 'ANY'];
      if (!validTypes.includes(rrType)) {
        return R.error(`Invalid rrType: "${rrType}". Expected one of: ${validTypes.join(', ')}`);
      }
      const start = performance.now();
      const records = await dns.resolve(hostname, rrType as dns.RecordType);
      const timing = roundMs(performance.now() - start);
      return R.ok({ hostname, rrType, records, timing });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.error(`DNS resolve failed: ${message}`);
    }
  }

  async handleDnsReverse(args: Record<string, unknown>) {
    try {
      const ip = parseOptionalString(args.ip, 'ip');
      if (!ip) {
        return R.error('ip is required');
      }
      const start = performance.now();
      const hostnames = await dns.reverse(ip);
      const timing = roundMs(performance.now() - start);
      return R.ok({ ip, hostnames, timing });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return R.error(`DNS reverse lookup failed: ${message}`);
    }
  }

  // ── HTTP Request Build ──

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

  // ── HTTP Plain Request ──

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
      if (!analysis)
        throw new Error('Received data but could not parse complete HTTP response headers.');

      const contentType =
        analysis.rawHeaders.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? null;
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

  // ── HTTP/2 Probe ──

  async handleHttp2Probe(args: Record<string, unknown>) {
    const rawUrl = parseOptionalString(args.url, 'url');
    let eventUrl = rawUrl ?? '';
    let eventStatusCode: number | null = null;
    let eventAlpnProtocol: string | null = null;
    let eventSuccess = false;

    try {
      if (!rawUrl) throw new Error('url is required');

      const method = (parseOptionalString(args.method, 'method') ?? 'GET').toUpperCase();
      if (!HTTP_TOKEN_RE.test(method)) throw new Error('method must be a valid HTTP token');

      const timeoutMs = parseNumberArg(args.timeoutMs, {
        defaultValue: 30_000,
        min: 1,
        max: 120_000,
        integer: true,
      });
      const maxBodyBytes = parseNumberArg(args.maxBodyBytes, {
        defaultValue: 32_768,
        min: 128,
        max: 1_048_576,
        integer: true,
      });
      const bodyBuffer = Buffer.from(
        parseRawString(args.body, 'body', { allowEmpty: true }) ?? '',
        'utf8',
      );
      const alpnProtocols = parseStringArrayHelper(args.alpnProtocols, 'alpnProtocols');
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

      const {
        responseHeaders,
        bodyBuffer: capturedBody,
        truncated,
        alpnProtocol,
      } = await performHttp2ProbeInternal({
        url,
        target,
        method,
        requestHeaders,
        bodyBuffer,
        timeoutMs,
        maxBodyBytes,
        effectivePort,
        requestedAlpnProtocols,
      });

      const normalizedHeaders = normalizeHttp2Headers(responseHeaders);
      const rawStatus = responseHeaders[':status'];
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
      const bodyIsText = isLikelyTextHttpBody(contentType, capturedBody);

      eventStatusCode = Number.isFinite(statusCode ?? Number.NaN) ? statusCode : null;
      eventAlpnProtocol = alpnProtocol;
      eventSuccess = true;

      return R.ok()
        .merge({
          url: eventUrl,
          statusCode: eventStatusCode,
          alpnProtocol: eventAlpnProtocol,
          headers: normalizedHeaders,
          bodyBytes: capturedBody.length,
          truncated,
          bodyText: bodyIsText ? capturedBody.toString('utf8') : undefined,
          bodyBase64: bodyIsText ? undefined : capturedBody.toString('base64'),
        })
        .json();
    } catch (error) {
      return R.fail(error instanceof Error ? error.message : String(error)).json();
    } finally {
      emitEvent(this.eventBus, 'network:http2_probed', {
        url: eventUrl,
        success: eventSuccess,
        statusCode: eventStatusCode,
        alpnProtocol: eventAlpnProtocol,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ── HTTP/2 Frame Build ──

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
        ? parseNumberArg(args.streamId, { defaultValue: 0, min: 0, integer: true })
        : undefined;
    const flags =
      args.flags !== undefined
        ? parseNumberArg(args.flags, { defaultValue: 0, min: 0, max: 255, integer: true })
        : undefined;
    const frameTypeCode =
      args.frameTypeCode !== undefined
        ? parseNumberArg(args.frameTypeCode, {
            defaultValue: 0,
            min: 0,
            max: 255,
            integer: true,
          })
        : undefined;
    const windowSizeIncrement =
      args.windowSizeIncrement !== undefined
        ? parseNumberArg(args.windowSizeIncrement, { defaultValue: 1, min: 1, integer: true })
        : undefined;
    const errorCode =
      args.errorCode !== undefined
        ? parseNumberArg(args.errorCode, { defaultValue: 0, min: 0, integer: true })
        : undefined;
    const lastStreamId =
      args.lastStreamId !== undefined
        ? parseNumberArg(args.lastStreamId, { defaultValue: 0, min: 0, integer: true })
        : undefined;

    const payloadHex = parseOptionalString(args.payloadHex, 'payloadHex');
    const payloadText = parseRawString(args.payloadText, 'payloadText', { allowEmpty: true });
    const payloadEncoding = parseOptionalString(args.payloadEncoding, 'payloadEncoding') as
      | 'utf8'
      | 'ascii'
      | undefined;
    const ack = parseOptionalBooleanHelper(args.ack, 'ack');
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

    emitEvent(this.eventBus, 'network:http2_frame_build_completed', {
      frameType: result.frameType,
      typeCode: result.typeCode,
      streamId: result.streamId,
      flags: result.flags,
      payloadBytes: result.payloadBytes,
      timestamp: new Date().toISOString(),
    });

    return R.ok()
      .merge(result as unknown as Record<string, unknown>)
      .json();
  }

  // ── Network RTT Measure ──

  async handleNetworkRttMeasure(args: Record<string, unknown>) {
    const urlRaw = parseOptionalString(args.url, 'url');
    if (!urlRaw) {
      throw new Error('url is required');
    }

    const probeType = (parseOptionalString(args.probeType, 'probeType') ?? 'tcp') as
      | 'tcp'
      | 'tls'
      | 'http';
    if (!['tcp', 'tls', 'http'].includes(probeType)) {
      throw new Error('probeType must be one of: tcp, tls, http');
    }

    const iterations = clamp(
      args.iterations !== undefined
        ? parseNumberArg(args.iterations, { defaultValue: 5, min: 1, integer: true })
        : 5,
      1,
      50,
    );

    const timeoutMs = clamp(
      args.timeoutMs !== undefined
        ? parseNumberArg(args.timeoutMs, { defaultValue: 5000, min: 100, integer: true })
        : 5000,
      100,
      30000,
    );

    const authorization = parseNetworkAuthorization(args.authorization);
    const { url, target } = await resolveAuthorizedTransportTarget(
      urlRaw,
      authorization,
      'RTT measurement',
    );

    const hostname = target.hostname;
    const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
    const resolvedIp = target.resolvedAddress ?? hostname;

    const samples: number[] = [];
    const errors: string[] = [];

    for (let i = 0; i < iterations; i++) {
      try {
        const rtt = await this.measureSingleRtt(resolvedIp, port, probeType, timeoutMs);
        samples.push(rtt);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const stats = computeRttStats(samples);

    emitEvent(this.eventBus, 'network:rtt_measured', {
      url: urlRaw,
      probeType,
      iterations,
      successCount: samples.length,
      errorCount: errors.length,
      stats,
      timestamp: new Date().toISOString(),
    });

    return R.ok()
      .merge({
        target: { hostname, port, resolvedIp, probeType },
        stats,
        samples,
        errors: errors.length > 0 ? errors : undefined,
        timestamp: new Date().toISOString(),
      })
      .json();
  }

  // ── Private RTT Helpers ──

  private measureSingleRtt(
    host: string,
    port: number,
    probeType: 'tcp' | 'tls' | 'http',
    timeoutMs: number,
  ): Promise<number> {
    switch (probeType) {
      case 'tcp':
        return this.probeTcp(host, port, timeoutMs);
      case 'tls':
        return this.probeTls(host, port, timeoutMs);
      case 'http':
        return this.probeHttp(host, port, timeoutMs);
    }
  }

  private probeTcp(host: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const timer = setTimeout(
        () => reject(new Error(`TCP probe timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      const socket = net.createConnection({ host, port }, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(roundMs(performance.now() - start));
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });
    });
  }

  private probeTls(host: string, port: number, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const timer = setTimeout(
        () => reject(new Error(`TLS probe timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(roundMs(performance.now() - start));
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });
    });
  }

  private async probeHttp(host: string, port: number, timeoutMs: number): Promise<number> {
    const protocol = port === 443 ? 'https:' : 'http:';
    const probeUrl = `${protocol}//${host}:${port}/`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const start = performance.now();
    try {
      await fetch(probeUrl, {
        method: 'HEAD',
        signal: ac.signal,
        redirect: 'manual',
        // @ts-expect-error -- Node.js fetch option
        rejectUnauthorized: false,
      });
      return roundMs(performance.now() - start);
    } finally {
      clearTimeout(timer);
    }
  }
}
