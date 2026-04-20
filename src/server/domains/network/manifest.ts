import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { advancedTools } from '@server/domains/network/definitions';
import { AdvancedToolHandlers } from '@server/domains/network/index';

const DOMAIN = 'network' as const;
const DEP_KEY = 'advancedHandlers' as const;
type H = AdvancedToolHandlers;
const t = toolLookup(advancedTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  ensureBrowserCore(ctx);

  if (!ctx.advancedHandlers) {
    ctx.advancedHandlers = new AdvancedToolHandlers(
      ctx.collector!,
      ctx.consoleMonitor!,
      ctx.eventBus,
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

  registrations: [
    { tool: t('network_enable'), domain: DOMAIN, bind: b((h, a) => h.handleNetworkEnable(a)) },
    { tool: t('network_disable'), domain: DOMAIN, bind: b((h, a) => h.handleNetworkDisable(a)) },
    {
      tool: t('network_get_status'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkGetStatus(a)),
    },
    { tool: t('network_monitor'), domain: DOMAIN, bind: b((h, a) => h.handleNetworkMonitor(a)) },
    {
      tool: t('network_get_requests'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkGetRequests(a)),
    },
    {
      tool: t('network_get_response_body'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkGetResponseBody(a)),
    },
    { tool: t('network_get_stats'), domain: DOMAIN, bind: b((h, a) => h.handleNetworkGetStats(a)) },
    {
      tool: t('performance_get_metrics'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceGetMetrics(a)),
    },
    {
      tool: t('performance_coverage'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceCoverage(a)),
    },
    {
      tool: t('performance_take_heap_snapshot'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceTakeHeapSnapshot(a)),
    },
    {
      tool: t('performance_trace'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceTraceDispatch(a)),
    },
    {
      tool: t('profiler_cpu'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleProfilerCpuDispatch(a)),
    },
    {
      tool: t('profiler_heap_sampling'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleProfilerHeapSamplingDispatch(a)),
    },
    {
      tool: t('console_get_exceptions'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleGetExceptions(a)),
    },
    {
      tool: t('console_inject'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleInjectDispatch(a)),
    },
    {
      tool: t('console_buffers'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleBuffersDispatch(a)),
    },
    {
      tool: t('http_request_build'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleHttpRequestBuild(a)),
    },
    {
      tool: t('http_plain_request'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleHttpPlainRequest(a)),
    },
    { tool: t('http2_probe'), domain: DOMAIN, bind: b((h, a) => h.handleHttp2Probe(a)) },
    {
      tool: t('http2_frame_build'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleHttp2FrameBuild(a)),
    },
    {
      tool: t('network_rtt_measure'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkRttMeasure(a)),
    },
    {
      tool: t('network_extract_auth'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkExtractAuth(a)),
    },
    {
      tool: t('network_export_har'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkExportHar(a)),
    },
    {
      tool: t('network_replay_request'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkReplayRequest(a)),
    },
    {
      tool: t('network_intercept'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkInterceptDispatch(a)),
    },
  ],
};

export default manifest;
