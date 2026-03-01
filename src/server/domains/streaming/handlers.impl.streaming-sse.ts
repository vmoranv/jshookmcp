import type { SseEnableResult, SseEventRecord, TextToolResponse } from './handlers.impl.streaming-base.js';
import { StreamingToolHandlersWs } from './handlers.impl.streaming-ws.js';

export class StreamingToolHandlersSse extends StreamingToolHandlersWs {
  protected async enableSseInterceptor(
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

            const originalAddEventListener: EventSource['addEventListener'] =
              es.addEventListener.bind(es);
            const callOriginalAddEventListener = (
              type: string,
              listener: EventListenerOrEventListenerObject | null,
              options?: boolean | AddEventListenerOptions
            ): void => {
              originalAddEventListener(
                type as Parameters<EventSource['addEventListener']>[0],
                listener as Parameters<EventSource['addEventListener']>[1],
                options as Parameters<EventSource['addEventListener']>[2]
              );
            };

            const wrappedAddEventListener = (
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

                callOriginalAddEventListener(type, wrapped, options);
                return;
              }

              callOriginalAddEventListener(type, listener, options);
            };

            Object.defineProperty(es, 'addEventListener', {
              value: wrappedAddEventListener as unknown as EventSource['addEventListener'],
              configurable: true,
              writable: true,
            });

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
