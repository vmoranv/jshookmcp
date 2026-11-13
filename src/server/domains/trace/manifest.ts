import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { TRACE_TOOLS } from '@server/domains/trace/definitions.tools';
import type { TraceToolHandlers } from '@server/domains/trace/handlers';
import { ensureTraceRecorder } from '@server/registry/ensure-trace-recorder';

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
  const { TraceToolHandlers } = await import('@server/domains/trace/handlers');
  const recorder = ensureTraceRecorder(ctx);
  if (!ctx.traceHandlers) {
    ctx.traceHandlers = new TraceToolHandlers(recorder, ctx);
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

  // Document-expansion keywords for the retrieval layer (search sceneKeywords).
  sceneKeywords: {
    diff_heap_snapshots: ['compare two heap dumps', 'heap snapshot delta', '堆快照对比'],
    export_trace: ['save recording to file', 'dump trace data', '导出 trace'],
    query_trace_sql: ['filter events with sql', 'query recorded events', 'sql 查询事件'],
    seek_to_timestamp: ['jump to a moment in the recording', 'time travel in trace', '时间定位'],
    start_trace_recording: ['begin capturing a recording', 'start tracing session', '开始录制'],
    stop_trace_recording: ['finish the recording', 'end the trace session', '停止录制'],
    summarize_trace: ['overview of the recording', 'what happened in the trace', 'trace 摘要'],
    trace_get_network_flow: [
      'network events inside the recording',
      'request flow in trace',
      'trace 网络流',
    ],
    trace_get_samples: ['profiling samples from trace', 'cpu samples in recording', '采样点'],
    trace_recording: ['current recording info', 'is a trace active', '录制状态'],
  },
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
