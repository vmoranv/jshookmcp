import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { TRACE_TOOLS } from '@server/domains/trace/definitions.tools';
import { TraceToolHandlers } from '@server/domains/trace/handlers';
import { TraceRecorder } from '@modules/trace/TraceRecorder';

const DOMAIN = 'trace' as const;
const DEP_KEY = 'traceHandlers' as const;
type H = TraceToolHandlers;
const t = toolLookup(TRACE_TOOLS);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.traceRecorder) {
    ctx.traceRecorder = new TraceRecorder();
  }
  if (!ctx.traceHandlers) {
    ctx.traceHandlers = new TraceToolHandlers(ctx.traceRecorder, ctx);
  }
  return ctx.traceHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,

  prerequisites: {},

  workflowRule: {
    patterns: [/trace/i, /time.?travel/i, /replay/i, /recorded?\s+events?/i],
    priority: 70,
    tools: [
      'start_trace_recording',
      'stop_trace_recording',
      'query_trace_sql',
      'seek_to_timestamp',
      'diff_heap_snapshots',
      'export_trace',
    ],
    hint: 'Start recording → perform actions → stop recording → query/seek/diff/export',
  },

  registrations: [
    { tool: t('start_trace_recording'), domain: DOMAIN, bind: b((h, a) => h.handleStartTraceRecording(a)) },
    { tool: t('stop_trace_recording'), domain: DOMAIN, bind: b((h) => h.handleStopTraceRecording()) },
    { tool: t('query_trace_sql'), domain: DOMAIN, bind: b((h, a) => h.handleQueryTraceSql(a)) },
    { tool: t('seek_to_timestamp'), domain: DOMAIN, bind: b((h, a) => h.handleSeekToTimestamp(a)) },
    { tool: t('diff_heap_snapshots'), domain: DOMAIN, bind: b((h, a) => h.handleDiffHeapSnapshots(a)) },
    { tool: t('export_trace'), domain: DOMAIN, bind: b((h, a) => h.handleExportTrace(a)) },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
