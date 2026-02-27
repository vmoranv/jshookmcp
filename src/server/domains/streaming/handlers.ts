import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { RingBuffer } from '../../../utils/RingBuffer.js';

type TextToolResponse = {
  content: [{ type: 'text'; text: string }];
};

type WsDirection = 'sent' | 'received';
type WsQueryDirection = WsDirection | 'all';

interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: any) => void): void; // CDP event payload is dynamic
  off(event: string, handler: (params: any) => void): void; // CDP event payload is dynamic
  detach(): Promise<void>;
}

interface WsFrameRecord {
  requestId: string;
  timestamp: number;
  direction: WsDirection;
  opcode: number;
  payloadLength: number;
  payloadPreview: string;
  payloadSample: string;
  isBinary: boolean;
}

interface WsFrameOrderEntry {
  requestId: string;
  frame: WsFrameRecord;
}

interface WsConnectionRecord {
  requestId: string;
  url: string;
  status: 'connecting' | 'open' | 'closed' | 'error';
  framesCount: number;
  createdTimestamp: number;
  closedTimestamp?: number;
  handshakeStatus?: number;
}

interface WsMonitorConfig {
  enabled: boolean;
  maxFrames: number;
  urlFilterRaw?: string;
  urlFilter?: RegExp;
}

interface WsMonitorListeners {
  created: (params: any) => void; // CDP event payload is dynamic
  closed: (params: any) => void; // CDP event payload is dynamic
  handshake: (params: any) => void; // CDP event payload is dynamic
  frameSent: (params: any) => void; // CDP event payload is dynamic
  frameReceived: (params: any) => void; // CDP event payload is dynamic
}

interface SseEventRecord {
  sourceUrl: string;
  eventType: string;
  dataPreview: string;
  dataLength: number;
  lastEventId: string | null;
  timestamp: number;
}

interface SseEnableResult {
  success: boolean;
  message: string;
  patched: boolean;
  urlFilter?: string;
  maxEvents: number;
  existingEvents: number;
}

export class StreamingToolHandlers {
  private collector: CodeCollector;

  private wsSession: CdpSessionLike | null = null;
  private wsListeners: WsMonitorListeners | null = null;
  private wsConfig: WsMonitorConfig = {
    enabled: false,
    maxFrames: 1000,
  };

  // Required by spec: frames are grouped by requestId in a private Map.
  private wsFramesByRequest = new Map<string, WsFrameRecord[]>();
  private wsFrameOrder = new RingBuffer<WsFrameOrderEntry>(1000);
  private wsConnections = new Map<string, WsConnectionRecord>();

  private sseConfig: { maxEvents: number; urlFilterRaw?: string } = {
    maxEvents: 2000,
  };

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  private asJson(payload: unknown): TextToolResponse {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
  }

  private parseOptionalStringArg(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private parseNumberArg(
    value: unknown,
    options: { defaultValue: number; min: number; max: number; integer?: boolean }
  ): number {
    let parsed: number | undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === 'string') {
      const n = Number(value.trim());
      if (Number.isFinite(n)) {
        parsed = n;
      }
    }

    if (parsed === undefined) {
      parsed = options.defaultValue;
    }

    if (options.integer) {
      parsed = Math.trunc(parsed);
    }

    if (parsed < options.min) {
      parsed = options.min;
    }
    if (parsed > options.max) {
      parsed = options.max;
    }
    return parsed;
  }

  private parseWsDirection(value: unknown): WsQueryDirection {
    if (value === 'sent' || value === 'received' || value === 'all') {
      return value;
    }
    return 'all';
  }

  private compileRegex(pattern: string): { regex?: RegExp; error?: string } {
    try {
      return { regex: new RegExp(pattern) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getWsFrameStats(): { total: number; sent: number; received: number } {
    let sent = 0;
    let received = 0;

    for (const entry of this.wsFrameOrder) {
      if (entry.frame.direction === 'sent') {
        sent += 1;
      } else {
        received += 1;
      }
    }

    return {
      total: this.wsFrameOrder.length,
      sent,
      received,
    };
  }

  private appendWsFrame(requestId: string, frame: WsFrameRecord): void {
    const list = this.wsFramesByRequest.get(requestId) ?? [];
    list.push(frame);
    this.wsFramesByRequest.set(requestId, list);

    const connection = this.wsConnections.get(requestId);
    if (connection) {
      connection.framesCount += 1;
      if (connection.status === 'connecting') {
        connection.status = 'open';
      }
    }

    this.wsFrameOrder.push({ requestId, frame });
    this.enforceWsFrameLimit();
  }

  private enforceWsFrameLimit(): void {
    while (this.wsFrameOrder.length > this.wsConfig.maxFrames) {
      const oldest = this.wsFrameOrder.shift();
      if (!oldest) {
        break;
      }

      const bucket = this.wsFramesByRequest.get(oldest.requestId);
      if (bucket && bucket.length > 0) {
        bucket.shift();
        if (bucket.length === 0) {
          this.wsFramesByRequest.delete(oldest.requestId);
        } else {
          this.wsFramesByRequest.set(oldest.requestId, bucket);
        }
      }

      const connection = this.wsConnections.get(oldest.requestId);
      if (connection) {
        connection.framesCount = Math.max(0, connection.framesCount - 1);
      }
    }
  }

  private async teardownWsSession(): Promise<void> {
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

  private handleWsFrame(direction: WsDirection, params: any): void {
    const requestId =
      typeof params?.requestId === 'string' ? params.requestId : undefined;
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

    const response = params?.response as
      | { opcode?: number; payloadData?: string }
      | undefined;
    const opcode = typeof response?.opcode === 'number' ? response.opcode : -1;
    const payloadData =
      typeof response?.payloadData === 'string' ? response.payloadData : '';

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

    const timestamp =
      typeof params?.timestamp === 'number'
        ? params.timestamp
        : Date.now() / 1000;

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
      created: (params: any) => {
        const requestId =
          typeof params?.requestId === 'string' ? params.requestId : undefined;
        const url = typeof params?.url === 'string' ? params.url : undefined;
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

      closed: (params: any) => {
        const requestId =
          typeof params?.requestId === 'string' ? params.requestId : undefined;
        if (!requestId) {
          return;
        }

        const connection = this.wsConnections.get(requestId);
        if (!connection) {
          return;
        }

        connection.status = 'closed';
        if (typeof params?.timestamp === 'number') {
          connection.closedTimestamp = params.timestamp;
        } else {
          connection.closedTimestamp = Date.now() / 1000;
        }
      },

      handshake: (params: any) => {
        const requestId =
          typeof params?.requestId === 'string' ? params.requestId : undefined;
        if (!requestId) {
          return;
        }

        const connection = this.wsConnections.get(requestId);
        if (!connection) {
          return;
        }

        const status = params?.response?.status;
        if (typeof status === 'number') {
          connection.handshakeStatus = status;
          connection.status = status >= 100 && status < 400 ? 'open' : 'error';
        }
      },

      frameSent: (params: any) => {
        this.handleWsFrame('sent', params);
      },

      frameReceived: (params: any) => {
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

  private async enableSseInterceptor(
    maxEvents: number,
    urlFilterRaw?: string
  ): Promise<SseEnableResult | { success: false; error: string }> {
    const page = await this.collector.getActivePage();

    const result = await page.evaluate(
      (config: { maxEvents: number; urlFilterRaw?: string }) => {
        type EventRecord = {
          sourceUrl: string;
          eventType: string;
          dataPreview: string;
          dataLength: number;
          lastEventId: string | null;
          timestamp: number;
        };

        type SourceRecord = {
          url: string;
          status: 'connecting' | 'open' | 'error' | 'closed';
          eventCount: number;
          lastEventTimestamp?: number;
        };

        type MonitorState = {
          enabled: boolean;
          patched: boolean;
          maxEvents: number;
          urlFilterRaw?: string;
          events: EventRecord[];
          sources: Record<string, SourceRecord>;
          originalEventSource?: typeof EventSource;
        };

        const globalWindow = window as Window & typeof globalThis & {
          __jshookSSEMonitor?: MonitorState;
          EventSource: typeof EventSource;
        };

        if (!globalWindow.__jshookSSEMonitor) {
          globalWindow.__jshookSSEMonitor = {
            enabled: true,
            patched: false,
            maxEvents: config.maxEvents,
            urlFilterRaw: config.urlFilterRaw,
            events: [],
            sources: {},
          };
        }

        const state = globalWindow.__jshookSSEMonitor;
        state.enabled = true;
        state.maxEvents = config.maxEvents;
        state.urlFilterRaw = config.urlFilterRaw;

        if (state.events.length > state.maxEvents) {
          state.events = state.events.slice(-state.maxEvents);
        }

        const shouldCapture = (sourceUrl: string): boolean => {
          if (!state.urlFilterRaw) {
            return true;
          }
          try {
            return new RegExp(state.urlFilterRaw).test(sourceUrl);
          } catch {
            return true;
          }
        };

        const toDataString = (value: unknown): string => {
          if (typeof value === 'string') {
            return value;
          }
          if (value === null || value === undefined) {
            return '';
          }
          if (typeof value === 'object') {
            try {
              return JSON.stringify(value);
            } catch {
              return '[unserializable]';
            }
          }
          return String(value);
        };

        const pushEvent = (
          sourceUrl: string,
          eventType: string,
          rawData: unknown,
          lastEventId: string | null
        ): void => {
          if (!state.enabled || !shouldCapture(sourceUrl)) {
            return;
          }

          const dataString = toDataString(rawData);
          const preview =
            dataString.length > 200 ? `${dataString.slice(0, 200)}…` : dataString;

          const record: EventRecord = {
            sourceUrl,
            eventType,
            dataPreview: preview,
            dataLength: dataString.length,
            lastEventId,
            timestamp: Date.now(),
          };

          state.events.push(record);
          while (state.events.length > state.maxEvents) {
            state.events.shift();
          }

          const source =
            state.sources[sourceUrl] ??
            ({
              url: sourceUrl,
              status: 'connecting',
              eventCount: 0,
            } as SourceRecord);

          source.eventCount += 1;
          source.lastEventTimestamp = record.timestamp;
          state.sources[sourceUrl] = source;
        };

        if (typeof globalWindow.EventSource === 'undefined') {
          return {
            success: false,
            error: 'EventSource is not available in current page context',
          };
        }

        if (!state.patched) {
          const OriginalEventSource = globalWindow.EventSource;

          const WrappedEventSource = function (
            this: EventSource,
            url: string | URL,
            eventSourceInitDict?: EventSourceInit
          ): EventSource {
            const sourceUrl = String(url);
            const es = new OriginalEventSource(url, eventSourceInitDict);

            if (shouldCapture(sourceUrl)) {
              const source =
                state.sources[sourceUrl] ??
                ({
                  url: sourceUrl,
                  status: 'connecting',
                  eventCount: 0,
                } as SourceRecord);
              state.sources[sourceUrl] = source;
            }

            es.addEventListener('open', () => {
              const source = state.sources[sourceUrl];
              if (source) {
                source.status = 'open';
              }
              pushEvent(sourceUrl, 'open', '', null);
            });

            es.addEventListener('error', () => {
              const source = state.sources[sourceUrl];
              if (source) {
                source.status = 'error';
              }
              pushEvent(sourceUrl, 'error', '', null);
            });

            es.addEventListener('message', (event: MessageEvent) => {
              const lastEventId =
                typeof event.lastEventId === 'string' && event.lastEventId.length > 0
                  ? event.lastEventId
                  : null;
              pushEvent(sourceUrl, event.type || 'message', event.data, lastEventId);
            });

            const originalAddEventListener = es.addEventListener.bind(es) as any;
            (es as any).addEventListener = (
              type: string,
              listener: EventListenerOrEventListenerObject | null,
              options?: boolean | AddEventListenerOptions
            ): void => {
              if (type !== 'message' && type !== 'open' && type !== 'error' && listener) {
                const wrapped: EventListener = (evt: Event) => {
                  const messageEvent = evt as MessageEvent;
                  const lastEventId =
                    typeof messageEvent.lastEventId === 'string' &&
                    messageEvent.lastEventId.length > 0
                      ? messageEvent.lastEventId
                      : null;

                  pushEvent(sourceUrl, type, messageEvent.data, lastEventId);

                  if (typeof listener === 'function') {
                    listener.call(es, evt);
                  } else {
                    listener.handleEvent(evt);
                  }
                };

                originalAddEventListener(type, wrapped, options);
                return;
              }

              originalAddEventListener(type, listener, options);
            };

            return es;
          } as unknown as typeof EventSource;

          WrappedEventSource.prototype = OriginalEventSource.prototype;

          try {
            Object.defineProperty(WrappedEventSource, 'CONNECTING', {
              value: OriginalEventSource.CONNECTING,
            });
            Object.defineProperty(WrappedEventSource, 'OPEN', {
              value: OriginalEventSource.OPEN,
            });
            Object.defineProperty(WrappedEventSource, 'CLOSED', {
              value: OriginalEventSource.CLOSED,
            });
          } catch {
            // Ignore immutable static field environments.
          }

          globalWindow.EventSource = WrappedEventSource;
          state.originalEventSource = OriginalEventSource;
          state.patched = true;
        }

        return {
          success: true,
          message: 'SSE monitor enabled',
          patched: state.patched,
          urlFilter: state.urlFilterRaw,
          maxEvents: state.maxEvents,
          existingEvents: state.events.length,
        };
      },
      { maxEvents, urlFilterRaw }
    );

    return result as SseEnableResult | { success: false; error: string };
  }

  async handleSseMonitorEnable(args: Record<string, unknown>): Promise<TextToolResponse> {
    const maxEvents = this.parseNumberArg(args.maxEvents, {
      defaultValue: 2000,
      min: 1,
      max: 50000,
      integer: true,
    });

    const urlFilterRaw = this.parseOptionalStringArg(args.urlFilter);
    if (urlFilterRaw) {
      const compiled = this.compileRegex(urlFilterRaw);
      if (compiled.error) {
        return this.asJson({
          success: false,
          error: `Invalid urlFilter regex: ${compiled.error}`,
        });
      }
    }

    const result = await this.enableSseInterceptor(maxEvents, urlFilterRaw);

    if (!result.success) {
      return this.asJson(result);
    }

    this.sseConfig = {
      maxEvents,
      urlFilterRaw,
    };

    return this.asJson({
      success: true,
      message: result.message,
      patched: result.patched,
      config: {
        maxEvents: this.sseConfig.maxEvents,
        urlFilter: this.sseConfig.urlFilterRaw ?? null,
      },
      existingEvents: result.existingEvents,
    });
  }

  async handleSseGetEvents(args: Record<string, unknown>): Promise<TextToolResponse> {
    const sourceUrl = this.parseOptionalStringArg(args.sourceUrl);
    const eventType = this.parseOptionalStringArg(args.eventType);
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

    const page = await this.collector.getActivePage();

    const result = await page.evaluate(
      (query: {
        sourceUrl?: string;
        eventType?: string;
        limit: number;
        offset: number;
      }) => {
        type EventRecord = {
          sourceUrl: string;
          eventType: string;
          dataPreview: string;
          dataLength: number;
          lastEventId: string | null;
          timestamp: number;
        };

        type SourceRecord = {
          url: string;
          status: 'connecting' | 'open' | 'error' | 'closed';
          eventCount: number;
          lastEventTimestamp?: number;
        };

        type MonitorState = {
          enabled: boolean;
          patched: boolean;
          maxEvents: number;
          urlFilterRaw?: string;
          events: EventRecord[];
          sources: Record<string, SourceRecord>;
        };

        const globalWindow = window as Window & typeof globalThis & {
          __jshookSSEMonitor?: MonitorState;
          EventSource: typeof EventSource;
        };

        const state = globalWindow.__jshookSSEMonitor;
        if (!state) {
          return {
            success: false,
            message: 'SSE monitor is not enabled. Call sse_monitor_enable first.',
          };
        }

        let events = state.events;

        if (query.sourceUrl) {
          events = events.filter((evt) => evt.sourceUrl === query.sourceUrl);
        }

        if (query.eventType) {
          events = events.filter((evt) => evt.eventType === query.eventType);
        }

        const totalAfterFilter = events.length;
        const paged = events.slice(query.offset, query.offset + query.limit);

        return {
          success: true,
          filters: {
            sourceUrl: query.sourceUrl ?? null,
            eventType: query.eventType ?? null,
          },
          page: {
            offset: query.offset,
            limit: query.limit,
            returned: paged.length,
            totalAfterFilter,
            hasMore: query.offset + paged.length < totalAfterFilter,
            nextOffset:
              query.offset + paged.length < totalAfterFilter
                ? query.offset + paged.length
                : null,
          },
          monitor: {
            enabled: state.enabled,
            patched: state.patched,
            maxEvents: state.maxEvents,
            urlFilter: state.urlFilterRaw ?? null,
            sourceCount: Object.keys(state.sources).length,
          },
          events: paged,
        };
      },
      { sourceUrl, eventType, limit, offset }
    );

    return this.asJson(result as { success: boolean; message?: string; events?: SseEventRecord[] });
  }
}
