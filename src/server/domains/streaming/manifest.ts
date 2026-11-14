import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { streamingTools } from '@server/domains/streaming/definitions';
import type { StreamingToolHandlers } from '@server/domains/streaming/index';
import {
  SessionScopedResourcePool,
  sessionResourcePoolOptions,
} from '@server/runtime/SessionScopedResourcePool';

const DOMAIN = 'streaming' as const;
const DEP_KEY = 'streamingHandlers' as const;
type H = StreamingToolHandlers;
const t = toolLookup(streamingTools);
const registrations = defineMethodRegistrations<H, (typeof streamingTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'ws_monitor', method: 'handleWsMonitorDispatchTool' },
    { tool: 'ws_get_frames', method: 'handleWsGetFramesTool' },
    { tool: 'ws_get_connections', method: 'handleWsGetConnectionsTool' },
    { tool: 'ws_export_capture', method: 'handleWsExportCaptureTool' },
    { tool: 'ws_send_frame', method: 'handleWsSendFrameTool' },
    { tool: 'sse_monitor_enable', method: 'handleSseMonitorEnableTool' },
    { tool: 'sse_get_events', method: 'handleSseGetEventsTool' },
    { tool: 'sse_export_capture', method: 'handleSseExportCaptureTool' },
    { tool: 'grpc_monitor', method: 'handleGrpcMonitorTool' },
    { tool: 'grpc_get_calls', method: 'handleGrpcGetCallsTool' },
    { tool: 'grpc_export_capture', method: 'handleGrpcExportCaptureTool' },
    { tool: 'fetch_stream_monitor', method: 'handleFetchStreamMonitorTool' },
    { tool: 'fetch_stream_get_events', method: 'handleFetchStreamGetEventsTool' },
    { tool: 'fetch_stream_export_capture', method: 'handleFetchStreamExportCaptureTool' },
    { tool: 'webrtc_monitor', method: 'handleWebRtcMonitorTool' },
    { tool: 'webrtc_get_events', method: 'handleWebRtcGetEventsTool' },
    { tool: 'webrtc_export_capture', method: 'handleWebRtcExportCaptureTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { StreamingToolHandlers } = await import('@server/domains/streaming/index');

  await ensureBrowserCore(ctx);
  if (!ctx.streamingHandlers) {
    const createHandlers = () => new StreamingToolHandlers(ctx.collector!);
    if (typeof ctx.setDomainInstance === 'function') {
      const pool = new SessionScopedResourcePool(
        createHandlers,
        async (handlers) => await handlers.close(),
        sessionResourcePoolOptions(ctx.config?.mcp),
      );
      ctx.setDomainInstance('sessionStreamingHandlersPool', pool);
      ctx.streamingHandlers = pool.getProxy();
    } else {
      ctx.streamingHandlers = createHandlers();
    }
  }
  return ctx.streamingHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  ws_monitor: ['watch websocket traffic live', 'follow ws frames', 'monitor the websocket traffic'],
  ws_get_connections: [
    'list open ws sockets',
    'websocket sessions',
    'list the websocket connections',
  ],
  ws_get_frames: ['show ws messages', 'captured websocket frames', 'list the websocket frames'],
  ws_send_frame: ['push a ws message', 'inject websocket frame', 'send a websocket frame'],
  ws_export_capture: [
    'save websocket traffic',
    'dump ws session to file',
    'export the captured websocket traffic',
  ],
  sse_monitor_enable: [
    'watch server sent events',
    'follow eventsource stream',
    'monitor the sse stream',
  ],
  sse_get_events: ['show sse messages', 'captured event stream data', 'list the sse events'],
  sse_export_capture: ['save event stream', 'dump sse to file', 'export the captured sse traffic'],
  webrtc_monitor: ['watch webrtc traffic', 'follow peer connections', 'monitor the webrtc traffic'],
  webrtc_get_events: ['show webrtc activity', 'captured peer events', 'webrtc events'],
  webrtc_export_capture: [
    'save webrtc traffic',
    'dump webrtc session',
    'export the captured webrtc traffic',
  ],
  fetch_stream_monitor: [
    'watch streaming fetch bodies',
    'follow chunked responses',
    'monitor the streaming responses',
  ],
  fetch_stream_get_events: [
    'show stream chunks received',
    'captured fetch stream data',
    'stream the captured events',
  ],
  fetch_stream_export_capture: [
    'save streaming responses',
    'dump fetch streams',
    'export the captured stream traffic',
  ],
  grpc_monitor: ['watch grpc traffic live', 'follow grpc calls', 'monitor the grpc traffic'],
  grpc_get_calls: ['list captured grpc calls', 'grpc method invocations', 'list the grpc calls'],
  grpc_export_capture: [
    'save grpc traffic',
    'dump grpc session',
    'export the captured grpc traffic',
  ],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
