/**
 * Streaming domain — composition facade.
 *
 * Delegates to WsHandlers (WebSocket monitoring) and SseHandlers (SSE monitoring).
 * Shared state is held in StreamingSharedState and passed to both sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import { createStreamingSharedState, type StreamingSharedState } from './handlers/shared';
import { WsHandlers } from './handlers/ws-handlers';
import { SseHandlers } from './handlers/sse-handlers';

export type {
  TextToolResponse,
  WsDirection,
  WsQueryDirection,
  CdpEventPayload,
  CdpEventHandler,
  CdpSessionLike,
  WsFrameRecord,
  WsFrameOrderEntry,
  WsMonitorListeners,
  SseEventRecord,
  SseEnableResult,
} from './handlers/shared';

export class StreamingToolHandlers {
  protected collector: CodeCollector;
  protected state: StreamingSharedState;
  private ws: WsHandlers;
  private sse: SseHandlers;

  // Backward-compat aliases for tests that access (handler as any).xxx
  protected get wsConnections() {
    return this.state.wsConnections;
  }
  protected get wsFrameOrder() {
    return this.state.wsFrameOrder;
  }
  protected get wsConfig() {
    return this.state.wsConfig;
  }
  protected get wsFramesByRequest() {
    return this.state.wsFramesByRequest;
  }
  protected get sseConfig() {
    return this.state.sseConfig;
  }

  constructor(collector: CodeCollector) {
    this.collector = collector;
    this.state = createStreamingSharedState(collector);
    this.ws = new WsHandlers(this.state);
    this.sse = new SseHandlers(this.state);
  }

  // ── WebSocket ──

  handleWsMonitorDispatch = (args: Record<string, unknown>) => {
    const action = String(args['action'] ?? '');
    return action === 'disable'
      ? this.ws.handleWsMonitorDisable(args)
      : this.ws.handleWsMonitorEnable(args);
  };
  handleWsMonitorEnable = (args: Record<string, unknown>) => this.ws.handleWsMonitorEnable(args);
  handleWsMonitorDisable = (args: Record<string, unknown>) => this.ws.handleWsMonitorDisable(args);
  handleWsGetFrames = (args: Record<string, unknown>) => this.ws.handleWsGetFrames(args);
  handleWsGetConnections = (args: Record<string, unknown>) => this.ws.handleWsGetConnections(args);

  // ── SSE ──

  handleSseMonitorEnable = (args: Record<string, unknown>) => this.sse.handleSseMonitorEnable(args);
  handleSseGetEvents = (args: Record<string, unknown>) => this.sse.handleSseGetEvents(args);
}
