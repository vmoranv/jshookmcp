/**
 * WebSocket monitoring handlers — enable, disable, get frames, get connections.
 */

import { logger } from '@utils/logger';
import { RingBuffer } from '@utils/RingBuffer';
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

  async handleWsMonitorEnable(args: Record<string, unknown>): Promise<TextToolResponse> {
    const maxFrames = parseNumberArg(args.maxFrames, {
      defaultValue: 1000,
      min: 1,
      max: 20000,
      integer: true,
    });
    const urlFilterRaw = parseOptionalStringArg(args.urlFilter);

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

    return asJson({
      success: true,
      message: 'WebSocket monitor enabled',
      config: { maxFrames, urlFilter: urlFilterRaw ?? null },
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
    const direction = parseWsDirection(args.direction);
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
    const payloadFilterRaw = parseOptionalStringArg(args.payloadFilter);

    let payloadFilter: RegExp | undefined;
    if (payloadFilterRaw) {
      const compiled = compileRegex(payloadFilterRaw);
      if (compiled.error)
        return asJson({ success: false, error: `Invalid payloadFilter regex: ${compiled.error}` });
      payloadFilter = compiled.regex;
    }

    const filtered = this.s.wsFrameOrder
      .toArray()
      .map((entry) => entry.frame)
      .filter((frame) => (direction === 'all' ? true : frame.direction === direction))
      .filter((frame) => (payloadFilter ? payloadFilter.test(frame.payloadSample) : true));

    const pageItems = filtered.slice(offset, offset + limit).map((frame) => ({
      requestId: frame.requestId,
      timestamp: frame.timestamp,
      direction: frame.direction,
      opcode: frame.opcode,
      payloadLength: frame.payloadLength,
      payloadPreview: frame.payloadPreview,
      isBinary: frame.isBinary,
    }));

    return asJson({
      success: true,
      monitorEnabled: this.s.wsConfig.enabled,
      filters: { direction, payloadFilter: payloadFilterRaw ?? null },
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
      .map((conn) => ({
        requestId: conn.requestId,
        url: conn.url,
        status: conn.status,
        framesCount: conn.framesCount,
      }));

    return asJson({
      success: true,
      monitorEnabled: this.s.wsConfig.enabled,
      total: connections.length,
      connections,
    });
  }
}
