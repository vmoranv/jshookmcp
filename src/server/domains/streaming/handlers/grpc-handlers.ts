/**
 * gRPC / gRPC-Web call monitoring handlers — enable, disable, get calls.
 *
 * gRPC rides on HTTP/2 with content-type "application/grpc(-web)?(+proto)?". There
 * is no dedicated CDP event for it, so we subscribe to the generic Network events
 * and filter by content-type. On loadingFinished we pull the response body via
 * Network.getResponseBody (base64) and split it into messages with parseGrpcFrames
 * — each message's payloadBase64 then feeds protobuf_decode_raw, completing the
 * gRPC decode chain for captured (live) traffic.
 */

import { writeFile } from 'node:fs/promises';
import { logger } from '@utils/logger';
import { RingBuffer } from '@utils/RingBuffer';
import { resolveArtifactPath } from '@utils/artifacts';
import type {
  CdpSessionLike,
  GrpcCallRecord,
  GrpcMonitorListeners,
  StreamingSharedState,
  TextToolResponse,
} from './shared';
import {
  asJson,
  compileRegex,
  isGrpcContentType,
  parseNumberArg,
  parseOptionalStringArg,
  parseBooleanArg,
} from './shared';
import { parseGrpcFrames } from '@server/domains/network/grpc-raw';

type UnknownRecord = Record<string, unknown>;

type ExportFormat = 'json' | 'ndjson';

const parseExportFormat = (value: unknown): ExportFormat =>
  value === 'ndjson' ? 'ndjson' : 'json';

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;

const getStringField = (value: unknown, key: string): string | undefined => {
  const field = asRecord(value)?.[key];
  return typeof field === 'string' ? field : undefined;
};

const getNumberField = (value: unknown, key: string): number | undefined => {
  const field = asRecord(value)?.[key];
  return typeof field === 'number' ? field : undefined;
};

const getRecordField = (value: unknown, key: string): UnknownRecord | undefined => {
  const nested = asRecord(value)?.[key];
  return asRecord(nested);
};

/** Case-insensitive content-type lookup from a CDP headers record. */
function findContentType(headers: unknown): string | null {
  const rec = asRecord(headers);
  if (!rec) return null;
  for (const key of Object.keys(rec)) {
    if (key.toLowerCase() === 'content-type') {
      const v = rec[key];
      return typeof v === 'string' ? v : null;
    }
  }
  return null;
}

interface PendingRequest {
  url: string;
  method: string;
  requestContentType: string | null;
  createdTimestamp: number;
}

export class GrpcHandlers {
  /** Provisional request metadata (method/url/content-type) before responseReceived. */
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private s: StreamingSharedState) {}

  private async teardownGrpcSession(): Promise<void> {
    if (this.s.grpcSession && this.s.grpcListeners) {
      const l = this.s.grpcListeners;
      try {
        this.s.grpcSession.off('Network.requestWillBeSent', l.requestWillBeSent);
      } catch (e) {
        logger.debug('[grpc-teardown] failed to remove requestWillBeSent', e);
      }
      try {
        this.s.grpcSession.off('Network.responseReceived', l.responseReceived);
      } catch (e) {
        logger.debug('[grpc-teardown] failed to remove responseReceived', e);
      }
      try {
        this.s.grpcSession.off('Network.loadingFinished', l.loadingFinished);
      } catch (e) {
        logger.debug('[grpc-teardown] failed to remove loadingFinished', e);
      }
    }
    if (this.s.grpcSession) {
      try {
        await this.s.grpcSession.detach();
      } catch (e) {
        logger.debug('[grpc-teardown] failed to detach CDP session', e);
      }
    }
    this.s.grpcSession = null;
    this.s.grpcListeners = null;
    this.pending.clear();
  }

  private enforceGrpcCallLimit(): void {
    while (this.s.grpcCallOrder.length > this.s.grpcConfig.maxCalls) {
      const oldest = this.s.grpcCallOrder.shift();
      if (!oldest) break;
      this.s.grpcCalls.delete(oldest);
    }
  }

  private async fetchAndParse(session: CdpSessionLike, requestId: string, record: GrpcCallRecord) {
    // Response body (primary; reliably base64 via getResponseBody for binary gRPC).
    try {
      const resp = (await session.send('Network.getResponseBody', { requestId })) as UnknownRecord;
      const body = typeof resp?.body === 'string' ? resp.body : '';
      const base64Encoded = resp?.base64Encoded === true;
      if (body) {
        const parsed = parseGrpcFrames(body, base64Encoded ? 'base64' : 'hex');
        record.responseMessages = parsed.frames;
        record.responseBodyBytes = parsed.totalBytes;
        if (parsed.warnings.length > 0) record.warnings.push(...parsed.warnings);
      }
    } catch (e) {
      record.bodyError = e instanceof Error ? e.message : String(e);
    }

    // Request body (best-effort; CDP request-body exposure for binary is less reliable).
    try {
      const pd = (await session.send('Network.getRequestPostData', { requestId })) as UnknownRecord;
      const postData = typeof pd?.postData === 'string' ? pd.postData : '';
      if (postData) {
        const parsed = parseGrpcFrames(postData, 'base64');
        record.requestMessages = parsed.frames;
        record.requestBodyBytes = parsed.totalBytes;
        if (parsed.warnings.length > 0) record.warnings.push(...parsed.warnings);
      }
    } catch {
      // Request body is optional / often unavailable; ignore silently.
    }
  }

  async handleGrpcMonitorEnable(args: Record<string, unknown>): Promise<TextToolResponse> {
    const maxCalls = parseNumberArg(args.maxCalls, {
      defaultValue: 100,
      min: 1,
      max: 5000,
      integer: true,
    });
    const urlFilterRaw = parseOptionalStringArg(args.urlFilter);

    let urlFilter: RegExp | undefined;
    if (urlFilterRaw) {
      const compiled = compileRegex(urlFilterRaw);
      if (compiled.error) {
        return asJson({ success: false, error: `Invalid urlFilter regex: ${compiled.error}` });
      }
      urlFilter = compiled.regex;
    }

    await this.teardownGrpcSession();

    this.s.grpcCalls.clear();
    this.s.grpcCallOrder = new RingBuffer<string>(maxCalls);
    this.pending.clear();

    const page = await this.s.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;
    await session.send('Network.enable');

    const listeners: GrpcMonitorListeners = {
      requestWillBeSent: (params: unknown) => {
        const requestId = getStringField(params, 'requestId');
        if (!requestId) return;
        const request = getRecordField(params, 'request');
        const url = getStringField(request, 'url') ?? '';
        if (urlFilter && url && !urlFilter.test(url)) return;
        this.pending.set(requestId, {
          url,
          method: getStringField(request, 'method') ?? 'UNKNOWN',
          requestContentType: findContentType(getRecordField(request, 'headers')),
          createdTimestamp: getNumberField(params, 'timestamp') ?? Date.now() / 1000,
        });
      },
      responseReceived: (params: unknown) => {
        const requestId = getStringField(params, 'requestId');
        if (!requestId) return;
        const response = getRecordField(params, 'response');
        if (!response) return;
        const responseContentType =
          findContentType(response.headers) ?? getStringField(response, 'mimeType') ?? null;
        if (!isGrpcContentType(responseContentType)) {
          // Not a gRPC call — drop any pending metadata so the map stays bounded.
          this.pending.delete(requestId);
          return;
        }
        const pending = this.pending.get(requestId);
        const url = pending?.url ?? getStringField(response, 'url') ?? '';
        if (this.s.grpcConfig.urlFilter && url && !this.s.grpcConfig.urlFilter.test(url)) {
          this.pending.delete(requestId);
          return;
        }
        const record: GrpcCallRecord = {
          requestId,
          url,
          method: pending?.method ?? 'UNKNOWN',
          status: getNumberField(response, 'status') ?? 0,
          requestContentType: pending?.requestContentType ?? null,
          responseContentType,
          createdTimestamp: pending?.createdTimestamp ?? Date.now() / 1000,
          finishedTimestamp: null,
          requestBodyBytes: 0,
          responseBodyBytes: 0,
          responseMessages: [],
          requestMessages: [],
          warnings: [],
          bodyError: null,
        };
        this.s.grpcCalls.set(requestId, record);
        this.s.grpcCallOrder.push(requestId);
        this.enforceGrpcCallLimit();
      },
      loadingFinished: (params: unknown) => {
        const requestId = getStringField(params, 'requestId');
        if (!requestId) return;
        const record = this.s.grpcCalls.get(requestId);
        if (!record) {
          // Non-grpc or filtered-out request finishing — clear pending bookkeeping.
          this.pending.delete(requestId);
          return;
        }
        record.finishedTimestamp = getNumberField(params, 'timestamp') ?? Date.now() / 1000;
        // Fire-and-forget: body fetch happens after the response stream closes.
        void this.fetchAndParse(session, requestId, record).catch((e) => {
          record.bodyError = e instanceof Error ? e.message : String(e);
        });
      },
    };

    session.on('Network.requestWillBeSent', listeners.requestWillBeSent);
    session.on('Network.responseReceived', listeners.responseReceived);
    session.on('Network.loadingFinished', listeners.loadingFinished);

    this.s.grpcSession = session;
    this.s.grpcListeners = listeners;
    this.s.grpcConfig = { enabled: true, maxCalls, urlFilterRaw, urlFilter };

    return asJson({
      success: true,
      message: 'gRPC monitor enabled',
      config: { maxCalls, urlFilter: urlFilterRaw ?? null },
      note: 'gRPC calls are detected by content-type application/grpc(-web)?(+proto)? and parsed on loadingFinished. Feed each message payloadBase64 to protobuf_decode_raw.',
    });
  }

  async handleGrpcMonitorDisable(_args: Record<string, unknown>): Promise<TextToolResponse> {
    const calls = Array.from(this.s.grpcCalls.values());
    const summary = {
      success: true,
      message: 'gRPC monitor disabled',
      config: {
        maxCalls: this.s.grpcConfig.maxCalls,
        urlFilter: this.s.grpcConfig.urlFilterRaw ?? null,
      },
      summary: {
        capturedCalls: calls.length,
        callsWithParsedMessages: calls.filter((c) => c.responseMessages.length > 0).length,
        callsWithBodyError: calls.filter((c) => c.bodyError !== null).length,
        totalResponseMessages: calls.reduce((n, c) => n + c.responseMessages.length, 0),
      },
    };
    await this.teardownGrpcSession();
    this.s.grpcConfig = { ...this.s.grpcConfig, enabled: false };
    return asJson(summary);
  }

  async handleGrpcGetCalls(args: Record<string, unknown>): Promise<TextToolResponse> {
    const limit = parseNumberArg(args.limit, {
      defaultValue: 50,
      min: 1,
      max: 1000,
      integer: true,
    });
    const offset = parseNumberArg(args.offset, {
      defaultValue: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      integer: true,
    });
    const fullMessages = parseBooleanArg(args.fullMessages, false);
    const urlFilterRaw = parseOptionalStringArg(args.urlFilter);

    let urlFilter: RegExp | undefined;
    if (urlFilterRaw) {
      const compiled = compileRegex(urlFilterRaw);
      if (compiled.error) {
        return asJson({ success: false, error: `Invalid urlFilter regex: ${compiled.error}` });
      }
      urlFilter = compiled.regex;
    }

    const all = Array.from(this.s.grpcCallOrder.toArray())
      .map((id) => this.s.grpcCalls.get(id))
      .filter((c): c is GrpcCallRecord => c !== undefined)
      .filter((c) => (urlFilter ? urlFilter.test(c.url) : true));

    const pageItems = all.slice(offset, offset + limit).map((call) => {
      const item: Record<string, unknown> = {
        requestId: call.requestId,
        url: call.url,
        method: call.method,
        status: call.status,
        requestContentType: call.requestContentType,
        responseContentType: call.responseContentType,
        createdTimestamp: call.createdTimestamp,
        finishedTimestamp: call.finishedTimestamp,
        responseMessageCount: call.responseMessages.length,
        requestMessageCount: call.requestMessages.length,
        responseBodyBytes: call.responseBodyBytes,
        requestBodyBytes: call.requestBodyBytes,
        compressedResponseMessages: call.responseMessages.filter((m) => m.compressed).length,
        hasTrailer: call.responseMessages.some((m) => m.isTrailer),
        bodyError: call.bodyError,
        warningCount: call.warnings.length,
      };
      if (fullMessages) {
        item.responseMessages = call.responseMessages;
        item.requestMessages = call.requestMessages;
        item.warnings = call.warnings;
      }
      return item;
    });

    return asJson({
      success: true,
      monitorEnabled: this.s.grpcConfig.enabled,
      filters: { urlFilter: urlFilterRaw ?? null, fullMessages },
      page: {
        offset,
        limit,
        returned: pageItems.length,
        totalAfterFilter: all.length,
        hasMore: offset + pageItems.length < all.length,
        nextOffset: offset + pageItems.length < all.length ? offset + pageItems.length : null,
      },
      calls: pageItems,
    });
  }

  async handleGrpcExportCapture(args: Record<string, unknown>): Promise<TextToolResponse> {
    const format = parseExportFormat(args.format);
    const includeMessages = parseBooleanArg(args.includeMessages, true);
    const urlFilterRaw = parseOptionalStringArg(args.urlFilter);

    let urlFilter: RegExp | undefined;
    if (urlFilterRaw) {
      const compiled = compileRegex(urlFilterRaw);
      if (compiled.error) {
        return asJson({ success: false, error: `Invalid urlFilter regex: ${compiled.error}` });
      }
      urlFilter = compiled.regex;
    }

    const all = Array.from(this.s.grpcCallOrder.toArray())
      .map((id) => this.s.grpcCalls.get(id))
      .filter((c): c is GrpcCallRecord => c !== undefined)
      .filter((c) => (urlFilter ? urlFilter.test(c.url) : true));

    const records = all.map((call) => {
      const record: Record<string, unknown> = {
        requestId: call.requestId,
        url: call.url,
        method: call.method,
        status: call.status,
        requestContentType: call.requestContentType,
        responseContentType: call.responseContentType,
        createdTimestamp: call.createdTimestamp,
        finishedTimestamp: call.finishedTimestamp,
        requestBodyBytes: call.requestBodyBytes,
        responseBodyBytes: call.responseBodyBytes,
        responseMessageCount: call.responseMessages.length,
        requestMessageCount: call.requestMessages.length,
        compressedResponseMessages: call.responseMessages.filter((m) => m.compressed).length,
        hasTrailer: call.responseMessages.some((m) => m.isTrailer),
        bodyError: call.bodyError,
        warningCount: call.warnings.length,
      };
      if (includeMessages) {
        record.responseMessages = call.responseMessages;
        record.requestMessages = call.requestMessages;
        record.warnings = call.warnings;
      }
      return record;
    });

    const metadata = {
      schema: 'jshookmcp.streaming.grpc.capture.v1',
      exportedAt: new Date().toISOString(),
      format,
      filters: { urlFilter: urlFilterRaw ?? null, includeMessages },
      monitor: {
        enabled: this.s.grpcConfig.enabled,
        maxCalls: this.s.grpcConfig.maxCalls,
        urlFilter: this.s.grpcConfig.urlFilterRaw ?? null,
        capturedCalls: this.s.grpcCalls.size,
      },
      recordCount: records.length,
    };

    const body =
      format === 'ndjson'
        ? [
            JSON.stringify({ type: 'metadata', ...metadata }),
            ...records.map((record) => JSON.stringify({ type: 'call', ...record })),
          ].join('\n') + '\n'
        : `${JSON.stringify({ ...metadata, calls: records }, null, 2)}\n`;

    const artifact = await resolveArtifactPath({
      category: 'captures',
      toolName: 'grpc-capture',
      target: urlFilterRaw ?? 'all',
      ext: format,
    });
    await writeFile(artifact.absolutePath, body, 'utf8');

    return asJson({
      success: true,
      artifactPath: artifact.displayPath,
      format,
      bytes: Buffer.byteLength(body, 'utf8'),
      recordCount: records.length,
      filters: metadata.filters,
      monitor: metadata.monitor,
    });
  }
}
