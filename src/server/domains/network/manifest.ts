import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { advancedTools } from '@server/domains/network/definitions';
import type { AdvancedToolHandlers } from '@server/domains/network/index';

const DOMAIN = 'network' as const;
const DEP_KEY = 'advancedHandlers' as const;
type H = AdvancedToolHandlers;
const t = toolLookup(advancedTools);
const registrations = defineMethodRegistrations<H, (typeof advancedTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'network_enable', method: 'handleNetworkEnable' },
    { tool: 'network_disable', method: 'handleNetworkDisable' },
    { tool: 'network_get_status', method: 'handleNetworkGetStatus' },
    { tool: 'network_monitor', method: 'handleNetworkMonitor' },
    { tool: 'network_get_requests', method: 'handleNetworkGetRequests' },
    { tool: 'network_get_response_body', method: 'handleNetworkGetResponseBody' },
    { tool: 'network_get_stats', method: 'handleNetworkGetStats' },
    { tool: 'performance_get_metrics', method: 'handlePerformanceGetMetrics' },
    { tool: 'performance_coverage', method: 'handlePerformanceCoverage' },
    { tool: 'performance_take_heap_snapshot', method: 'handlePerformanceTakeHeapSnapshot' },
    { tool: 'performance_trace', method: 'handlePerformanceTraceDispatch' },
    { tool: 'profiler_cpu', method: 'handleProfilerCpuDispatch' },
    { tool: 'profiler_heap_sampling', method: 'handleProfilerHeapSamplingDispatch' },
    { tool: 'console_get_exceptions', method: 'handleConsoleGetExceptions' },
    { tool: 'console_inject', method: 'handleConsoleInjectDispatch' },
    {
      tool: 'console_inject_fetch_interceptor',
      method: 'handleConsoleInjectFetchInterceptor',
    },
    {
      tool: 'console_inject_xhr_interceptor',
      method: 'handleConsoleInjectXhrInterceptor',
    },
    { tool: 'console_buffers', method: 'handleConsoleBuffersDispatch' },
    { tool: 'http_request_build', method: 'handleHttpRequestBuild' },
    { tool: 'http_plain_request', method: 'handleHttpPlainRequest' },
    { tool: 'http2_probe', method: 'handleHttp2Probe' },
    { tool: 'http2_frame_build', method: 'handleHttp2FrameBuild' },
    { tool: 'network_rtt_measure', method: 'handleNetworkRttMeasure' },
    { tool: 'network_traceroute', method: 'handleNetworkTraceroute' },
    { tool: 'network_icmp_probe', method: 'handleNetworkIcmpProbe' },
    { tool: 'network_extract_auth', method: 'handleNetworkExtractAuth' },
    { tool: 'network_export_har', method: 'handleNetworkExportHar' },
    { tool: 'network_replay_request', method: 'handleNetworkReplayRequest' },
    { tool: 'network_intercept', method: 'handleNetworkInterceptDispatch' },
    { tool: 'network_tls_fingerprint', method: 'handleNetworkTlsFingerprint' },
    { tool: 'network_bot_detect_analyze', method: 'handleNetworkBotDetectAnalyze' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { AdvancedToolHandlers } = await import('@server/domains/network/index');
  await ensureBrowserCore(ctx);

  if (!ctx.advancedHandlers) {
    ctx.advancedHandlers = new AdvancedToolHandlers(
      ctx.collector!,
      ctx.consoleMonitor!,
      ctx.eventBus,
      () => ctx.traceRecorder ?? null,
    );
  }

  return ctx.advancedHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,

  // ── Routing metadata (consumed by ToolRouter) ──

  workflowRule: {
    patterns: [
      /(capture|intercept|monitor|hook).*(network|request|response|api|traffic)/i,
      /(抓包|拦截|监控|hook).*(网络|请求|响应|api|流量)/i,
    ],
    priority: 100,
    tools: [
      'run_extension_workflow',
      'list_extension_workflows',
      'network_monitor',
      'page_navigate',
      'network_get_requests',
    ],
    hint: 'Network capture workflow: prefer extension workflows first; otherwise bootstrap browser/page state -> enable capture -> navigate or act -> inspect captured requests',
  },

  prerequisites: {
    network_get_requests: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
      {
        condition: 'Network monitoring must be enabled',
        fix: 'Call network_monitor(enable) first',
      },
    ],
    network_get_response_body: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
      {
        condition: 'Network monitoring must be enabled',
        fix: 'Call network_monitor(enable) first',
      },
    ],
    network_extract_auth: [
      {
        condition: 'Network monitoring must be enabled',
        fix: 'Call network_monitor(enable) first',
      },
    ],
  },

  registrations,
};

export default manifest;
