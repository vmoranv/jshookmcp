/**
 * Streaming domain — composition facade.
 *
 * Delegates to WsHandlers (WebSocket monitoring) and SseHandlers (SSE monitoring).
 * Shared state is held in StreamingSharedState and passed to both sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { createStreamingSharedState, type StreamingSharedState } from './handlers/shared';
import { WsHandlers } from './handlers/ws-handlers';
import { SseHandlers } from './handlers/sse-handlers';
import { GrpcHandlers } from './handlers/grpc-handlers';
import { FetchStreamHandlers } from './handlers/fetch-stream-handlers';

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
  GrpcCallRecord,
  GrpcMonitorListeners,
} from './handlers/shared';

export class StreamingToolHandlers {
  protected collector: CodeCollector;
  protected state: StreamingSharedState;
  private ws: WsHandlers;
  private sse: SseHandlers;
  private grpc: GrpcHandlers;
  private fetchStream: FetchStreamHandlers;

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
    this.grpc = new GrpcHandlers(this.state);
    this.fetchStream = new FetchStreamHandlers(this.state);
  }

  // ── WebSocket ──

  async handleWsMonitorDispatchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWsMonitorDispatch(args));
  }

  async handleWsGetFramesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWsGetFrames(args));
  }

  async handleWsGetConnectionsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWsGetConnections(args));
  }

  async handleWsExportCaptureTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWsExportCapture(args));
  }

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
  handleWsExportCapture = (args: Record<string, unknown>) => this.ws.handleWsExportCapture(args);

  // ── SSE ──

  async handleSseMonitorEnableTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSseMonitorEnable(args));
  }

  async handleSseGetEventsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSseGetEvents(args));
  }

  async handleSseExportCaptureTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSseExportCapture(args));
  }

  handleSseMonitorEnable = (args: Record<string, unknown>) => this.sse.handleSseMonitorEnable(args);
  handleSseGetEvents = (args: Record<string, unknown>) => this.sse.handleSseGetEvents(args);
  handleSseExportCapture = (args: Record<string, unknown>) => this.sse.handleSseExportCapture(args);

  // ── gRPC ──

  async handleGrpcMonitorTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => this.handleGrpcMonitorDispatch(args));
  }

  async handleGrpcGetCallsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => this.grpc.handleGrpcGetCalls(args));
  }

  handleGrpcMonitorDispatch = (args: Record<string, unknown>) => {
    const action = String(args['action'] ?? '');
    return action === 'disable'
      ? this.grpc.handleGrpcMonitorDisable(args)
      : this.grpc.handleGrpcMonitorEnable(args);
  };

  // ── fetch()-based stream ──

  async handleFetchStreamMonitorTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const action = String(args['action'] ?? 'enable');
      return action === 'disable'
        ? this.fetchStream.handleFetchStreamMonitorDisable(args)
        : this.fetchStream.handleFetchStreamMonitorEnable(args);
    });
  }

  async handleFetchStreamGetEventsTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => this.fetchStream.handleFetchStreamGetEvents(args));
  }
}
