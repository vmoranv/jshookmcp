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
    ctx.advancedHandlers = new AdvancedToolHandlers(ctx.collector!, ctx.consoleMonitor!);
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
    tools: ['web_api_capture_session', 'network_enable', 'page_navigate', 'network_get_requests'],
    hint: 'Network capture workflow: bootstrap browser/page state -> enable capture -> navigate or act -> inspect captured requests',
  },

  prerequisites: {
    network_get_requests: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
      { condition: 'Network monitoring must be enabled', fix: 'Call network_enable first' },
    ],
    network_get_response_body: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
      { condition: 'Network monitoring must be enabled', fix: 'Call network_enable first' },
    ],
    network_extract_auth: [
      { condition: 'Network monitoring must be enabled', fix: 'Call network_enable first' },
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
      tool: t('performance_start_coverage'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceStartCoverage(a)),
    },
    {
      tool: t('performance_stop_coverage'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceStopCoverage(a)),
    },
    {
      tool: t('performance_take_heap_snapshot'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceTakeHeapSnapshot(a)),
    },
    {
      tool: t('performance_trace_start'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceTraceStart(a)),
    },
    {
      tool: t('performance_trace_stop'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePerformanceTraceStop(a)),
    },
    {
      tool: t('profiler_cpu_start'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleProfilerCpuStart(a)),
    },
    { tool: t('profiler_cpu_stop'), domain: DOMAIN, bind: b((h, a) => h.handleProfilerCpuStop(a)) },
    {
      tool: t('profiler_heap_sampling_start'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleProfilerHeapSamplingStart(a)),
    },
    {
      tool: t('profiler_heap_sampling_stop'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleProfilerHeapSamplingStop(a)),
    },
    {
      tool: t('console_get_exceptions'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleGetExceptions(a)),
    },
    {
      tool: t('console_inject_script_monitor'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleInjectScriptMonitor(a)),
    },
    {
      tool: t('console_inject_xhr_interceptor'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleInjectXhrInterceptor(a)),
    },
    {
      tool: t('console_inject_fetch_interceptor'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleInjectFetchInterceptor(a)),
    },
    {
      tool: t('console_clear_injected_buffers'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleClearInjectedBuffers(a)),
    },
    {
      tool: t('console_reset_injected_interceptors'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleResetInjectedInterceptors(a)),
    },
    {
      tool: t('console_inject_function_tracer'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleConsoleInjectFunctionTracer(a)),
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
      tool: t('network_intercept_response'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkInterceptResponse(a)),
    },
    {
      tool: t('network_intercept_list'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkInterceptList(a)),
    },
    {
      tool: t('network_intercept_disable'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleNetworkInterceptDisable(a)),
    },
  ],
};

export default manifest;
