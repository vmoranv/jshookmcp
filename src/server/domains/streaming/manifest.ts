import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { streamingTools } from '@server/domains/streaming/definitions';
import type { StreamingToolHandlers } from '@server/domains/streaming/index';

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
  if (!ctx.streamingHandlers) ctx.streamingHandlers = new StreamingToolHandlers(ctx.collector!);
  return ctx.streamingHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
