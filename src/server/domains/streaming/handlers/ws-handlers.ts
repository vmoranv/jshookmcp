/**
 * WebSocket monitoring handlers — enable, disable, get frames, get connections.
 */

import { writeFile } from 'node:fs/promises';
import { logger } from '@utils/logger';
import { RingBuffer } from '@utils/RingBuffer';
import { resolveArtifactPath } from '@utils/artifacts';
import { evaluateWithTimeout } from '@modules/collector/PageController';
import { WS_PAYLOAD_PREVIEW_LIMIT, WS_PAYLOAD_SAMPLE_LIMIT } from '@src/constants';
import type {
  StreamingSharedState,
  TextToolResponse,
  WsDirection,
  WsFrameOrderEntry,
  WsFrameRecord,
  WsMonitorListeners,
  CdpSessionLike,
} from './shared';
import {
  asJson,
  parseBooleanArg,
  parseNumberArg,
  parseOptionalStringArg,
  parseWsDirection,
  compileRegex,
} from './shared';

type UnknownRecord = Record<string, unknown>;

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

type ExportFormat = 'json' | 'ndjson';

const parseExportFormat = (value: unknown): ExportFormat =>
  value === 'ndjson' ? 'ndjson' : 'json';

/**
 * Runs in the browser. Wraps window.WebSocket so each new WebSocket instance is
 * retained in window.__jshookWsInstances keyed by url, enabling ws_send_frame
 * edit-and-resend replay. Existing sockets (created before this wrapper installs)
 * are NOT retroactively reachable — only sockets created after. Self-contained
 * (no closure over module scope) so it survives serialization.
 */
function wsInstanceInjectionFn(): unknown {
  type AnyWs = {
    readyState: number;
    send: (d: unknown) => void;
    addEventListener: (t: string, l: () => void) => void;
  };
  const gw = window as Window &
    typeof globalThis & {
      __jshookWsInstances?: Record<string, AnyWs[]>;
      __jshookWsInstancesPatched?: boolean;
      WebSocket: typeof WebSocket;
    };

  if (gw.__jshookWsInstancesPatched) {
    return { success: true, patched: false, alreadyPatched: true };
  }

  const registry: Record<string, AnyWs[]> = {};
  gw.__jshookWsInstances = registry;

  const OriginalWS = gw.WebSocket;

  const WrappedWS = function (
    this: unknown,
    url: string | URL,
    protocols?: string | string[],
  ): WebSocket {
    const ws = (protocols === undefined
      ? new OriginalWS(url)
      : new OriginalWS(url, protocols)) as unknown as WebSocket & AnyWs;
    const key = String(url);
    const arr = registry[key] ?? [];
    arr.push(ws);
    registry[key] = arr;
    ws.addEventListener('close', () => {
      const list = registry[key];
      if (!list) return;
      const idx = list.indexOf(ws);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) delete registry[key];
    });
    return ws;
  } as unknown as typeof WebSocket;

  WrappedWS.prototype = OriginalWS.prototype;
  try {
    (WrappedWS as { CONNECTING?: number }).CONNECTING = OriginalWS.CONNECTING;
    (WrappedWS as { OPEN?: number }).OPEN = OriginalWS.OPEN;
    (WrappedWS as { CLOSING?: number }).CLOSING = OriginalWS.CLOSING;
    (WrappedWS as { CLOSED?: number }).CLOSED = OriginalWS.CLOSED;
  } catch {
    /* static constants are read-only on some platforms */
  }

  gw.WebSocket = WrappedWS;
  gw.__jshookWsInstancesPatched = true;
  return { success: true, patched: true };
}

export class WsHandlers {
  constructor(private s: StreamingSharedState) {}

  private async teardownWsSession(): Promise<void> {
    if (this.s.wsSession && this.s.wsListeners) {
      try {
        this.s.wsSession.off('Network.webSocketCreated', this.s.wsListeners.created);
      } catch (e) {
        logger.debug('[ws-teardown] Failed to remove webSocketCreated listener', e);
      }
      try {
        this.s.wsSession.off('Network.webSocketClosed', this.s.wsListeners.closed);
      } catch (e) {
        logger.debug('[ws-teardown] Failed to remove webSocketClosed listener', e);
      }
      try {
        this.s.wsSession.off(
          'Network.webSocketHandshakeResponseReceived',
          this.s.wsListeners.handshake,
        );
      } catch (e) {
        logger.debug('[ws-teardown] Failed to remove handshakeResponseReceived listener', e);
      }
      try {
        this.s.wsSession.off('Network.webSocketFrameSent', this.s.wsListeners.frameSent);
      } catch (e) {
        logger.debug('[ws-teardown] Failed to remove webSocketFrameSent listener', e);
      }
      try {
        this.s.wsSession.off('Network.webSocketFrameReceived', this.s.wsListeners.frameReceived);
      } catch (e) {
        logger.debug('[ws-teardown] Failed to remove webSocketFrameReceived listener', e);
      }
    }
    if (this.s.wsSession) {
      try {
        await this.s.wsSession.detach();
      } catch (e) {
        logger.debug('[ws-teardown] Failed to detach CDP session', e);
      }
    }
    this.s.wsSession = null;
    this.s.wsListeners = null;
  }

  private handleWsFrame(direction: WsDirection, params: unknown): void {
    const requestId = getStringField(params, 'requestId');
    if (!requestId) return;

    const tracked = this.s.wsConnections.get(requestId);
    if (!tracked) {
      if (this.s.wsConfig.urlFilter) return;
      this.s.wsConnections.set(requestId, {
        requestId,
        url: 'unknown',
        status: 'open',
        framesCount: 0,
        createdTimestamp: Date.now() / 1000,
      });
    }

    const connection = this.s.wsConnections.get(requestId);
    if (!connection) return;

    if (
      this.s.wsConfig.urlFilter &&
      connection.url !== 'unknown' &&
      !this.s.wsConfig.urlFilter.test(connection.url)
    )
      return;

    const response = getRecordField(params, 'response');
    const opcode = getNumberField(response, 'opcode') ?? -1;
    const payloadData = getStringField(response, 'payloadData') ?? '';

    const payloadPreview =
      payloadData.length > WS_PAYLOAD_PREVIEW_LIMIT
        ? `${payloadData.slice(0, WS_PAYLOAD_PREVIEW_LIMIT)}…`
        : payloadData;

    const payloadSample =
      payloadData.length > WS_PAYLOAD_SAMPLE_LIMIT
        ? payloadData.slice(0, WS_PAYLOAD_SAMPLE_LIMIT)
        : payloadData;

    const timestamp = getNumberField(params, 'timestamp') ?? Date.now() / 1000;

    const frame: WsFrameRecord = {
      requestId,
      timestamp,
      direction,
      opcode,
      payloadLength: payloadData.length,
      payloadPreview,
      payloadSample,
      payload: payloadData,
      isBinary: opcode === 2,
    };

    this.appendWsFrame(requestId, frame);
  }

  private appendWsFrame(requestId: string, frame: WsFrameRecord): void {
    const list = this.s.wsFramesByRequest.get(requestId) ?? [];
    list.push(frame);
    this.s.wsFramesByRequest.set(requestId, list);

    const connection = this.s.wsConnections.get(requestId);
    if (connection) {
      connection.framesCount += 1;
      if (connection.status === 'connecting') connection.status = 'open';
    }

    this.s.wsFrameOrder.push({ requestId, frame });
    this.enforceWsFrameLimit();
  }

  private enforceWsFrameLimit(): void {
    while (this.s.wsFrameOrder.length > this.s.wsConfig.maxFrames) {
      const oldest = this.s.wsFrameOrder.shift();
      if (!oldest) break;
      const bucket = this.s.wsFramesByRequest.get(oldest.requestId);
      if (bucket && bucket.length > 0) {
        bucket.shift();
        if (bucket.length === 0) {
          this.s.wsFramesByRequest.delete(oldest.requestId);
        } else {
          this.s.wsFramesByRequest.set(oldest.requestId, bucket);
        }
      }
      const connection = this.s.wsConnections.get(oldest.requestId);
      if (connection) connection.framesCount = Math.max(0, connection.framesCount - 1);
    }
  }

  private getWsFrameStats(): { total: number; sent: number; received: number } {
    let sent = 0;
    let received = 0;
    for (const entry of this.s.wsFrameOrder) {
      if (entry.frame.direction === 'sent') sent += 1;
      else received += 1;
    }
    return { total: this.s.wsFrameOrder.length, sent, received };
  }

  private selectWsFrames(args: Record<string, unknown>): {
    direction: ReturnType<typeof parseWsDirection>;
    payloadFilterRaw?: string;
    filtered: WsFrameRecord[];
    error?: string;
  } {
    const direction = parseWsDirection(args.direction);
    const payloadFilterRaw = parseOptionalStringArg(args.payloadFilter);

    let payloadFilter: RegExp | undefined;
    if (payloadFilterRaw) {
      const compiled = compileRegex(payloadFilterRaw);
      if (compiled.error) {
        return {
          direction,
          payloadFilterRaw,
          filtered: [],
          error: `Invalid payloadFilter regex: ${compiled.error}`,
        };
      }
      payloadFilter = compiled.regex;
    }

    const filtered = this.s.wsFrameOrder
      .toArray()
      .map((entry) => entry.frame)
      .filter((frame) => (direction === 'all' ? true : frame.direction === direction))
      .filter((frame) =>
        payloadFilter ? payloadFilter.test(frame.payload ?? frame.payloadSample) : true,
      );

    return { direction, payloadFilterRaw, filtered };
  }

  private getConnectionDurationSeconds(conn: {
    createdTimestamp: number;
    closedTimestamp?: number;
  }): number | null {
    if (conn.closedTimestamp === undefined) return null;
    return Math.max(0, Number((conn.closedTimestamp - conn.createdTimestamp).toFixed(3)));
  }

  async handleWsMonitorEnable(args: Record<string, unknown>): Promise<TextToolResponse> {
    const maxFrames = parseNumberArg(args.maxFrames, {
      defaultValue: 1000,
      min: 1,
      max: 20000,
      integer: true,
    });
    const urlFilterRaw = parseOptionalStringArg(args.urlFilter);
    const exposeInstances = parseBooleanArg(args.exposeInstances, false);

    let urlFilter: RegExp | undefined;
    if (urlFilterRaw) {
      const compiled = compileRegex(urlFilterRaw);
      if (compiled.error)
        return asJson({ success: false, error: `Invalid urlFilter regex: ${compiled.error}` });
      urlFilter = compiled.regex;
    }

    await this.teardownWsSession();

    this.s.wsFramesByRequest.clear();
    this.s.wsFrameOrder = new RingBuffer<WsFrameOrderEntry>(maxFrames);
    this.s.wsConnections.clear();

    const page = await this.s.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;
    await session.send('Network.enable');

    const listeners: WsMonitorListeners = {
      created: (params: unknown) => {
        const reqId = getStringField(params, 'requestId');
        const url = getStringField(params, 'url');
        if (!reqId || !url) return;
        if (urlFilter && !urlFilter.test(url)) return;
        const existing = this.s.wsConnections.get(reqId);
        this.s.wsConnections.set(reqId, {
          requestId: reqId,
          url,
          status: existing?.status ?? 'connecting',
          framesCount: existing?.framesCount ?? 0,
          createdTimestamp: existing?.createdTimestamp ?? Date.now() / 1000,
          closedTimestamp: existing?.closedTimestamp,
          handshakeStatus: existing?.handshakeStatus,
        });
      },
      closed: (params: unknown) => {
        const reqId = getStringField(params, 'requestId');
        if (!reqId) return;
        const connection = this.s.wsConnections.get(reqId);
        if (!connection) return;
        connection.status = 'closed';
        const ts = getNumberField(params, 'timestamp');
        connection.closedTimestamp = ts !== undefined ? ts : Date.now() / 1000;
      },
      handshake: (params: unknown) => {
        const reqId = getStringField(params, 'requestId');
        if (!reqId) return;
        const connection = this.s.wsConnections.get(reqId);
        if (!connection) return;
        const status = getNumberField(getRecordField(params, 'response'), 'status');
        if (status !== undefined) {
          connection.handshakeStatus = status;
          connection.status = status >= 100 && status < 400 ? 'open' : 'error';
        }
      },
      frameSent: (params: unknown) => {
        this.handleWsFrame('sent', params);
      },
      frameReceived: (params: unknown) => {
        this.handleWsFrame('received', params);
      },
    };

    session.on('Network.webSocketCreated', listeners.created);
    session.on('Network.webSocketClosed', listeners.closed);
    session.on('Network.webSocketHandshakeResponseReceived', listeners.handshake);
    session.on('Network.webSocketFrameSent', listeners.frameSent);
    session.on('Network.webSocketFrameReceived', listeners.frameReceived);

    this.s.wsSession = session;
    this.s.wsListeners = listeners;
    this.s.wsConfig = { enabled: true, maxFrames, urlFilterRaw, urlFilter };

    if (exposeInstances) {
      try {
        await evaluateWithTimeout(page, wsInstanceInjectionFn);
      } catch (e) {
        logger.debug('[ws-monitor] failed to install instance-exposure wrapper', e);
      }
    }

    return asJson({
      success: true,
      message: 'WebSocket monitor enabled',
      config: { maxFrames, urlFilter: urlFilterRaw ?? null, exposeInstances },
      stats: {
        trackedConnections: this.s.wsConnections.size,
        capturedFrames: this.s.wsFrameOrder.length,
      },
    });
  }

  async handleWsMonitorDisable(_args: Record<string, unknown>): Promise<TextToolResponse> {
    const stats = this.getWsFrameStats();
    const connections = Array.from(this.s.wsConnections.values());

    const summary = {
      success: true,
      message: 'WebSocket monitor disabled',
      config: {
        maxFrames: this.s.wsConfig.maxFrames,
        urlFilter: this.s.wsConfig.urlFilterRaw ?? null,
      },
      summary: {
        trackedConnections: connections.length,
        activeConnections: connections.filter(
          (c) => c.status === 'open' || c.status === 'connecting',
        ).length,
        closedConnections: connections.filter((c) => c.status === 'closed').length,
        totalFrames: stats.total,
        sentFrames: stats.sent,
        receivedFrames: stats.received,
      },
    };

    await this.teardownWsSession();
    this.s.wsConfig = { ...this.s.wsConfig, enabled: false };

    return asJson(summary);
  }

  async handleWsGetFrames(args: Record<string, unknown>): Promise<TextToolResponse> {
    const limit = parseNumberArg(args.limit, {
      defaultValue: 100,
      min: 1,
      max: 5000,
      integer: true,
    });
    const offset = parseNumberArg(args.offset, {
      defaultValue: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      integer: true,
    });
    const fullPayload = parseBooleanArg(args.fullPayload, false);
    const { direction, payloadFilterRaw, filtered, error } = this.selectWsFrames(args);
    if (error) return asJson({ success: false, error });

    const pageItems = filtered.slice(offset, offset + limit).map((frame) => {
      const item: Record<string, unknown> = {
        requestId: frame.requestId,
        timestamp: frame.timestamp,
        direction: frame.direction,
        opcode: frame.opcode,
        payloadLength: frame.payloadLength,
        payloadPreview: frame.payloadPreview,
        isBinary: frame.isBinary,
      };
      if (fullPayload) item.payload = frame.payload ?? frame.payloadSample;
      return item;
    });

    return asJson({
      success: true,
      monitorEnabled: this.s.wsConfig.enabled,
      filters: { direction, payloadFilter: payloadFilterRaw ?? null, fullPayload },
      page: {
        offset,
        limit,
        returned: pageItems.length,
        totalAfterFilter: filtered.length,
        hasMore: offset + pageItems.length < filtered.length,
        nextOffset: offset + pageItems.length < filtered.length ? offset + pageItems.length : null,
      },
      frames: pageItems,
    });
  }

  async handleWsGetConnections(_args: Record<string, unknown>): Promise<TextToolResponse> {
    const connections = Array.from(this.s.wsConnections.values())
      .toSorted((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((conn) => {
        const durationSeconds = this.getConnectionDurationSeconds(conn);
        return {
          requestId: conn.requestId,
          url: conn.url,
          status: conn.status,
          framesCount: conn.framesCount,
          createdTimestamp: conn.createdTimestamp,
          closedTimestamp: conn.closedTimestamp ?? null,
          durationSeconds,
          framesPerSecond:
            durationSeconds && durationSeconds > 0
              ? Number((conn.framesCount / durationSeconds).toFixed(3))
              : null,
          handshakeStatus: conn.handshakeStatus ?? null,
        };
      });

    return asJson({
      success: true,
      monitorEnabled: this.s.wsConfig.enabled,
      total: connections.length,
      connections,
    });
  }

  async handleWsExportCapture(args: Record<string, unknown>): Promise<TextToolResponse> {
    const format = parseExportFormat(args.format);
    const includePayload = parseBooleanArg(args.includePayload, true);
    const { direction, payloadFilterRaw, filtered, error } = this.selectWsFrames(args);
    if (error) return asJson({ success: false, error });

    const exportedAt = new Date().toISOString();
    const records = filtered.map((frame) => {
      const conn = this.s.wsConnections.get(frame.requestId);
      const record: Record<string, unknown> = {
        requestId: frame.requestId,
        url: conn?.url ?? null,
        timestamp: frame.timestamp,
        direction: frame.direction,
        opcode: frame.opcode,
        payloadLength: frame.payloadLength,
        payloadPreview: frame.payloadPreview,
        isBinary: frame.isBinary,
        connectionStatus: conn?.status ?? null,
        handshakeStatus: conn?.handshakeStatus ?? null,
      };
      if (includePayload) record.payload = frame.payload ?? frame.payloadSample;
      return record;
    });

    const metadata = {
      schema: 'jshookmcp.streaming.ws.capture.v1',
      exportedAt,
      format,
      filters: { direction, payloadFilter: payloadFilterRaw ?? null, includePayload },
      monitor: {
        enabled: this.s.wsConfig.enabled,
        maxFrames: this.s.wsConfig.maxFrames,
        urlFilter: this.s.wsConfig.urlFilterRaw ?? null,
        connectionCount: this.s.wsConnections.size,
      },
      recordCount: records.length,
    };

    const body =
      format === 'ndjson'
        ? [
            JSON.stringify({ type: 'metadata', ...metadata }),
            ...records.map((record) => JSON.stringify({ type: 'frame', ...record })),
          ].join('\n') + '\n'
        : `${JSON.stringify({ ...metadata, frames: records }, null, 2)}\n`;

    const artifact = await resolveArtifactPath({
      category: 'captures',
      toolName: 'ws-capture',
      target: direction,
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

  async handleWsSendFrame(args: Record<string, unknown>): Promise<TextToolResponse> {
    const url = parseOptionalStringArg(args.url);
    const payloadRaw = args.payload;
    if (!url) return asJson({ success: false, error: 'url is required' });
    if (typeof payloadRaw !== 'string')
      return asJson({ success: false, error: 'payload is required' });
    const binary = parseBooleanArg(args.binary, false);

    const page = await this.s.collector.getActivePage();
    const result = await evaluateWithTimeout(
      page,
      (query: { url: string; payload: string; binary: boolean }) => {
        type AnyWs = { readyState: number; send: (d: unknown) => void };
        const gw = window as Window &
          typeof globalThis & { __jshookWsInstances?: Record<string, AnyWs[]> };
        const registry = gw.__jshookWsInstances;
        if (!registry)
          return {
            success: false,
            message:
              'WebSocket instance exposure is not enabled. Call ws_monitor with exposeInstances=true first.',
          };
        const candidates = registry[query.url];
        if (!candidates || candidates.length === 0)
          return {
            success: false,
            message:
              'No reachable WebSocket instance for this url. Only sockets created AFTER exposeInstances=true was enabled are reachable.',
          };
        const OPEN = 1;
        const open = candidates.filter((ws) => {
          try {
            return ws.readyState === OPEN;
          } catch {
            return false;
          }
        });
        if (open.length === 0)
          return {
            success: false,
            message: `Found ${candidates.length} instance(s) for this url but none in OPEN state (readyState=1).`,
            readyStates: candidates.map((ws) => {
              try {
                return ws.readyState;
              } catch {
                return -1;
              }
            }),
          };
        const ws = open[open.length - 1]!;
        let bytesSent: number;
        if (query.binary) {
          const bin = Uint8Array.from(atob(query.payload), (c) => c.charCodeAt(0));
          ws.send(bin);
          bytesSent = bin.length;
        } else {
          ws.send(query.payload);
          bytesSent = query.payload.length;
        }
        return {
          success: true,
          url: query.url,
          readyState: ws.readyState,
          bytesSent,
          binary: query.binary,
        };
      },
      { url, payload: payloadRaw, binary },
    );
    return asJson(result as Record<string, unknown>);
  }
}
