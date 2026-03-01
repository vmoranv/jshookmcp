import { RingBuffer } from '../../../utils/RingBuffer.js';
import type {
  CdpSessionLike,
  TextToolResponse,
  WsDirection,
  WsFrameOrderEntry,
  WsFrameRecord,
  WsMonitorListeners,
} from './handlers.impl.streaming-base.js';
import { StreamingToolHandlersBase } from './handlers.impl.streaming-base.js';

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

export class StreamingToolHandlersWs extends StreamingToolHandlersBase {
  protected async teardownWsSession(): Promise<void> {
    if (this.wsSession && this.wsListeners) {
      try {
        this.wsSession.off('Network.webSocketCreated', this.wsListeners.created);
      } catch {}
      try {
        this.wsSession.off('Network.webSocketClosed', this.wsListeners.closed);
      } catch {}
      try {
        this.wsSession.off(
          'Network.webSocketHandshakeResponseReceived',
          this.wsListeners.handshake
        );
      } catch {}
      try {
        this.wsSession.off('Network.webSocketFrameSent', this.wsListeners.frameSent);
      } catch {}
      try {
        this.wsSession.off('Network.webSocketFrameReceived', this.wsListeners.frameReceived);
      } catch {}
    }

    if (this.wsSession) {
      try {
        await this.wsSession.detach();
      } catch {}
    }

    this.wsSession = null;
    this.wsListeners = null;
  }

  protected handleWsFrame(direction: WsDirection, params: unknown): void {
    const requestId = getStringField(params, 'requestId');
    if (!requestId) {
      return;
    }

    const tracked = this.wsConnections.get(requestId);
    if (!tracked) {
      // If URL filter is enabled, skip unknown connections that were not tracked on created event.
      if (this.wsConfig.urlFilter) {
        return;
      }
      this.wsConnections.set(requestId, {
        requestId,
        url: 'unknown',
        status: 'open',
        framesCount: 0,
        createdTimestamp: Date.now() / 1000,
      });
    }

    const connection = this.wsConnections.get(requestId);
    if (!connection) {
      return;
    }

    if (
      this.wsConfig.urlFilter &&
      connection.url !== 'unknown' &&
      !this.wsConfig.urlFilter.test(connection.url)
    ) {
      return;
    }

    const response = getRecordField(params, 'response');
    const opcode = getNumberField(response, 'opcode') ?? -1;
    const payloadData = getStringField(response, 'payloadData') ?? '';

    const payloadPreviewLimit = 200;
    const payloadSampleLimit = 2000;

    const payloadPreview =
      payloadData.length > payloadPreviewLimit
        ? `${payloadData.slice(0, payloadPreviewLimit)}…`
        : payloadData;

    const payloadSample =
      payloadData.length > payloadSampleLimit
        ? payloadData.slice(0, payloadSampleLimit)
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

  async handleWsMonitorEnable(args: Record<string, unknown>): Promise<TextToolResponse> {
    const maxFrames = this.parseNumberArg(args.maxFrames, {
      defaultValue: 1000,
      min: 1,
      max: 20000,
      integer: true,
    });
    const urlFilterRaw = this.parseOptionalStringArg(args.urlFilter);

    let urlFilter: RegExp | undefined;
    if (urlFilterRaw) {
      const compiled = this.compileRegex(urlFilterRaw);
      if (compiled.error) {
        return this.asJson({
          success: false,
          error: `Invalid urlFilter regex: ${compiled.error}`,
        });
      }
      urlFilter = compiled.regex;
    }

    await this.teardownWsSession();

    this.wsFramesByRequest.clear();
    this.wsFrameOrder = new RingBuffer<WsFrameOrderEntry>(maxFrames);
    this.wsConnections.clear();

    const page = await this.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;
    await session.send('Network.enable');

    const listeners: WsMonitorListeners = {
      created: (params: unknown) => {
        const requestId = getStringField(params, 'requestId');
        const url = getStringField(params, 'url');
        if (!requestId || !url) {
          return;
        }

        if (urlFilter && !urlFilter.test(url)) {
          return;
        }

        const existing = this.wsConnections.get(requestId);

        this.wsConnections.set(requestId, {
          requestId,
          url,
          status: existing?.status ?? 'connecting',
          framesCount: existing?.framesCount ?? 0,
          createdTimestamp: existing?.createdTimestamp ?? Date.now() / 1000,
          closedTimestamp: existing?.closedTimestamp,
          handshakeStatus: existing?.handshakeStatus,
        });
      },

      closed: (params: unknown) => {
        const requestId = getStringField(params, 'requestId');
        if (!requestId) {
          return;
        }

        const connection = this.wsConnections.get(requestId);
        if (!connection) {
          return;
        }

        connection.status = 'closed';
        const timestamp = getNumberField(params, 'timestamp');
        if (timestamp !== undefined) {
          connection.closedTimestamp = timestamp;
        } else {
          connection.closedTimestamp = Date.now() / 1000;
        }
      },

      handshake: (params: unknown) => {
        const requestId = getStringField(params, 'requestId');
        if (!requestId) {
          return;
        }

        const connection = this.wsConnections.get(requestId);
        if (!connection) {
          return;
        }

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

    this.wsSession = session;
    this.wsListeners = listeners;
    this.wsConfig = {
      enabled: true,
      maxFrames,
      urlFilterRaw,
      urlFilter,
    };

    return this.asJson({
      success: true,
      message: 'WebSocket monitor enabled',
      config: {
        maxFrames,
        urlFilter: urlFilterRaw ?? null,
      },
      stats: {
        trackedConnections: this.wsConnections.size,
        capturedFrames: this.wsFrameOrder.length,
      },
    });
  }

  async handleWsMonitorDisable(_args: Record<string, unknown>): Promise<TextToolResponse> {
    const stats = this.getWsFrameStats();
    const connections = Array.from(this.wsConnections.values());

    const summary = {
      success: true,
      message: 'WebSocket monitor disabled',
      config: {
        maxFrames: this.wsConfig.maxFrames,
        urlFilter: this.wsConfig.urlFilterRaw ?? null,
      },
      summary: {
        trackedConnections: connections.length,
        activeConnections: connections.filter(
          (c) => c.status === 'open' || c.status === 'connecting'
        ).length,
        closedConnections: connections.filter((c) => c.status === 'closed').length,
        totalFrames: stats.total,
        sentFrames: stats.sent,
        receivedFrames: stats.received,
      },
    };

    await this.teardownWsSession();
    this.wsConfig = {
      ...this.wsConfig,
      enabled: false,
    };

    return this.asJson(summary);
  }

  async handleWsGetFrames(args: Record<string, unknown>): Promise<TextToolResponse> {
    const direction = this.parseWsDirection(args.direction);
    const limit = this.parseNumberArg(args.limit, {
      defaultValue: 100,
      min: 1,
      max: 5000,
      integer: true,
    });
    const offset = this.parseNumberArg(args.offset, {
      defaultValue: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      integer: true,
    });
    const payloadFilterRaw = this.parseOptionalStringArg(args.payloadFilter);

    let payloadFilter: RegExp | undefined;
    if (payloadFilterRaw) {
      const compiled = this.compileRegex(payloadFilterRaw);
      if (compiled.error) {
        return this.asJson({
          success: false,
          error: `Invalid payloadFilter regex: ${compiled.error}`,
        });
      }
      payloadFilter = compiled.regex;
    }

    const filtered = this.wsFrameOrder.toArray()
      .map((entry) => entry.frame)
      .filter((frame) => (direction === 'all' ? true : frame.direction === direction))
      .filter((frame) =>
        payloadFilter ? payloadFilter.test(frame.payloadSample) : true
      );

    const pageItems = filtered.slice(offset, offset + limit).map((frame) => ({
      requestId: frame.requestId,
      timestamp: frame.timestamp,
      direction: frame.direction,
      opcode: frame.opcode,
      payloadLength: frame.payloadLength,
      payloadPreview: frame.payloadPreview,
      isBinary: frame.isBinary,
    }));

    return this.asJson({
      success: true,
      monitorEnabled: this.wsConfig.enabled,
      filters: {
        direction,
        payloadFilter: payloadFilterRaw ?? null,
      },
      page: {
        offset,
        limit,
        returned: pageItems.length,
        totalAfterFilter: filtered.length,
        hasMore: offset + pageItems.length < filtered.length,
        nextOffset:
          offset + pageItems.length < filtered.length
            ? offset + pageItems.length
            : null,
      },
      frames: pageItems,
    });
  }

  async handleWsGetConnections(_args: Record<string, unknown>): Promise<TextToolResponse> {
    const connections = Array.from(this.wsConnections.values())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((conn) => ({
        requestId: conn.requestId,
        url: conn.url,
        status: conn.status,
        framesCount: conn.framesCount,
      }));

    return this.asJson({
      success: true,
      monitorEnabled: this.wsConfig.enabled,
      total: connections.length,
      connections,
    });
  }

}
