import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { TRACE_TOOLS } from '@server/domains/trace/definitions.tools';
import type { TraceToolHandlers } from '@server/domains/trace/handlers';

const DOMAIN = 'trace' as const;
const DEP_KEY = 'traceHandlers' as const;
type H = TraceToolHandlers;
const t = toolLookup(TRACE_TOOLS);
const registrations = defineMethodRegistrations<H, (typeof TRACE_TOOLS)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'trace_recording', method: 'handleTraceRecordingTool' },
    { tool: 'start_trace_recording', method: 'handleStartTraceRecordingTool' },
    { tool: 'stop_trace_recording', method: 'handleStopTraceRecordingTool' },
    { tool: 'query_trace_sql', method: 'handleQueryTraceSqlTool' },
    { tool: 'seek_to_timestamp', method: 'handleSeekToTimestampTool' },
    { tool: 'trace_get_samples', method: 'handleGetTraceSamplesTool' },
    { tool: 'trace_get_network_flow', method: 'handleGetTraceNetworkFlowTool' },
    { tool: 'diff_heap_snapshots', method: 'handleDiffHeapSnapshotsTool' },
    { tool: 'export_trace', method: 'handleExportTraceTool' },
    { tool: 'summarize_trace', method: 'handleSummarizeTraceTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { TraceRecorder } = await import('@modules/trace/TraceRecorder');
  const { TraceToolHandlers } = await import('@server/domains/trace/handlers');
  if (!ctx.traceRecorder || !ctx.traceHandlers) {
    if (!ctx.traceRecorder) {
      ctx.traceRecorder = new TraceRecorder();
    }
    if (!ctx.traceHandlers) {
      ctx.traceHandlers = new TraceToolHandlers(ctx.traceRecorder, ctx);
    }
  }
  return ctx.traceHandlers!;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,

  prerequisites: {},

  workflowRule: {
    patterns: [/trace/i, /time.?travel/i, /replay/i, /recorded?\s+events?/i],
    priority: 70,
    tools: [
      'trace_recording',
      'start_trace_recording',
      'stop_trace_recording',
      'query_trace_sql',
      'seek_to_timestamp',
      'trace_get_samples',
      'trace_get_network_flow',
      'diff_heap_snapshots',
      'export_trace',
      'summarize_trace',
    ],
    hint: 'Start recording → perform actions → stop recording → summarize/query/seek/diff/export',
  },
  registrations,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
