import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { advancedTools } from '@server/domains/network/definitions';
import type { AdvancedToolHandlers } from '@server/domains/network/index';
import {
  SessionScopedResourcePool,
  sessionResourcePoolOptions,
} from '@server/runtime/SessionScopedResourcePool';

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
    { tool: 'performance_trace', method: 'handlePerformanceTraceDispatch' },
    { tool: 'profiler_cpu', method: 'handleProfilerCpuDispatch' },
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
    { tool: 'http2_frame_parse', method: 'handleHttp2FrameParse' },
    { tool: 'network_http2_fingerprint', method: 'handleNetworkHttp2Fingerprint' },
    { tool: 'grpc_frame_parse', method: 'handleGrpcFrameParse' },
    { tool: 'grpc_frame_build', method: 'handleGrpcFrameBuild' },
    { tool: 'network_rtt_measure', method: 'handleNetworkRttMeasure' },
    { tool: 'network_latency_stats', method: 'handleNetworkLatencyStats' },
    { tool: 'network_traceroute', method: 'handleNetworkTraceroute' },
    { tool: 'network_icmp_probe', method: 'handleNetworkIcmpProbe' },
    { tool: 'dns_resolve', method: 'handleDnsResolve' },
    { tool: 'dns_reverse', method: 'handleDnsReverse' },
    { tool: 'dns_probe', method: 'handleDnsProbe' },
    { tool: 'dns_cname_chain', method: 'handleDnsCnameChain' },
    { tool: 'dns_bulk_resolve', method: 'handleDnsBulkResolve' },
    { tool: 'network_extract_auth', method: 'handleNetworkExtractAuth' },
    { tool: 'network_export_har', method: 'handleNetworkExportHar' },
    { tool: 'network_replay_request', method: 'handleNetworkReplayRequest' },
    { tool: 'network_intercept', method: 'handleNetworkInterceptDispatch' },
    { tool: 'network_tls_fingerprint', method: 'handleNetworkTlsFingerprint' },
    { tool: 'network_bot_detect_analyze', method: 'handleNetworkBotDetectAnalyze' },
  ],
});

// Tools that can operate without a browser. Everything else requires ensureBrowserCore.
const RAW_NETWORK_TOOLS = new Set([
  'http_request_build',
  'http_plain_request',
  'http2_probe',
  'http2_frame_build',
  'http2_frame_parse',
  'network_http2_fingerprint',
  'grpc_frame_parse',
  'grpc_frame_build',
  'network_rtt_measure',
  'network_latency_stats',
  'network_traceroute',
  'network_icmp_probe',
  'dns_resolve',
  'dns_reverse',
  'dns_probe',
  'dns_cname_chain',
  'dns_bulk_resolve',
]);

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { AdvancedToolHandlers } = await import('@server/domains/network/index');

  // Skip browser-core initialization if only raw tools are being activated
  const needsBrowser =
    !(ctx.activatedToolNames instanceof Set) ||
    [...ctx.activatedToolNames].some((name) => !RAW_NETWORK_TOOLS.has(name));

  if (needsBrowser) {
    const { ensureBrowserCore } = await import('@server/registry/ensure-browser-core');
    await ensureBrowserCore(ctx);
  }

  if (!ctx.advancedHandlers) {
    const createHandlers = () =>
      new AdvancedToolHandlers(ctx.collector!, ctx.consoleMonitor!, ctx.eventBus);
    if (typeof ctx.setDomainInstance === 'function') {
      const pool = new SessionScopedResourcePool(
        createHandlers,
        async (handlers) => await handlers.close(),
        sessionResourcePoolOptions(ctx.config?.mcp),
      );
      ctx.setDomainInstance('sessionAdvancedHandlersPool', pool);
      ctx.advancedHandlers = pool.getProxy();
    } else {
      ctx.advancedHandlers = createHandlers();
    }
  }

  return ctx.advancedHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
//
// Query phrases a user would type that bridge to this tool's vocabulary but
// do NOT share tokens with its name/description (those are already indexed).
// Folded by scripts/generate-domains-index.mjs into generated-tool-catalog.ts
// and fed to ToolSearchEngine as sceneKeywords (SEARCH_SCENE_KEYWORD_WEIGHT).
// Bilingual on purpose — SynonymExpander is bilingual and so are real queries.
// Expansion phrases are retrieval metadata, not a security feature library.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  network_enable: [
    'start capturing http traffic',
    'begin request recording',
    'start capturing traffic',
    'record api calls',
  ],
  network_disable: [
    'stop capturing traffic',
    'turn off request monitoring',
    'stop recording requests',
    'disable traffic capture',
    'stop capturing traffic',
    'halt packet capture session',
  ],
  network_get_status: [
    'is capture running',
    'is traffic capture running',
    'check whether network capture is active',
    'monitoring state',
    'capture active state',
    'is monitoring on',
    'capture status',
    'capture session state probe',
  ],
  network_monitor: [
    'manage traffic capture',
    'watch requests live',
    'watch every outgoing request',
    'log all the calls the page makes',
    'see each request as it goes out',
  ],
  network_get_requests: [
    'show captured requests',
    'list recorded http calls',
    'list the captured requests',
  ],
  network_get_response_body: [
    'download response content',
    'read returned payload',
    'read the response body',
    'see what the server returned for this request',
    'fetch the body of a captured response',
    'see what the server sent back for a request',
  ],
  network_get_stats: [
    'traffic summary numbers',
    'capture overview counters',
    'traffic counters overview',
    'request count summary',
    'traffic statistics',
    'capture counters totals only',
  ],
  performance_get_metrics: [
    'page performance numbers',
    'runtime metrics snapshot',
    'page performance metrics',
  ],
  performance_trace: ['chrome tracing capture', 'record performance trace', 'performance trace'],
  profiler_cpu: [
    'cpu usage sampling',
    'javascript cpu profile',
    'start cpu profiling',
    'cpu profiler sampling',
    'cpu flame graph',
    'profiler sampling session control',
  ],
  console_get_exceptions: [
    'uncaught errors list',
    'js exceptions thrown',
    'thrown page errors',
    'uncaught error events',
    'read the page errors',
    'runtime exception feed retrieval',
  ],
  console_inject: [
    'add console hook script',
    'patch console methods',
    'inject a console hook',
    'wrap native logging functions',
  ],
  console_inject_fetch_interceptor: [
    'log all fetch calls',
    'hook window.fetch',
    'intercept fetch requests',
  ],
  console_inject_xhr_interceptor: [
    'log ajax requests',
    'hook XMLHttpRequest',
    'intercept xhr calls',
  ],
  console_buffers: [
    'ring buffer contents',
    'captured console data store',
    'read the buffer contents',
    'intercepted payload ring store',
  ],
  http_request_build: [
    'craft raw http message',
    'construct request text',
    'build a raw http message',
  ],
  http_plain_request: ['send raw tcp http', 'manual socket request', 'send a raw http request'],
  http2_probe: ['test h2 support', 'check http2 endpoint', 'test whether http2 is supported'],
  http2_frame_build: ['craft h2 frame bytes', 'construct http2 frame', 'build an http2 frame'],
  http2_frame_parse: ['decode h2 frame', 'dissect http2 frame bytes', 'parse an http2 frame'],
  network_http2_fingerprint: [
    'akamai fingerprint hash',
    'h2 settings fingerprint',
    'http2 fingerprint',
  ],
  grpc_frame_parse: ['decode grpc frame', 'split length prefixed messages', 'parse a grpc frame'],
  grpc_frame_build: ['assemble grpc frame', 'craft grpc message bytes', 'build a grpc frame'],
  network_rtt_measure: ['ping latency to host', 'round trip time', 'measure the latency'],
  network_latency_stats: ['latency percentiles', 'p95 delay distribution', 'latency distribution'],
  network_traceroute: ['hop by hop path', 'trace route to host', 'traceroute hops'],
  network_icmp_probe: ['icmp echo check', 'ping a host', 'ping the host'],
  dns_resolve: ['lookup domain ip', 'resolve hostname address', 'resolve the domain name'],
  dns_reverse: ['ip to hostname', 'reverse dns lookup', 'reverse lookup the domain'],
  dns_probe: ['structured dns record query', 'query record types', 'probe the dns records'],
  dns_cname_chain: ['follow alias records', 'cname chain trace', 'follow the cname chain'],
  dns_bulk_resolve: [
    'resolve many domains at once',
    'batch dns lookup',
    'resolve many domain names at once',
  ],
  network_extract_auth: [
    'find tokens in traffic',
    'pull api keys from captured requests',
    'extract the credentials',
  ],
  network_export_har: [
    'save capture as har',
    'export har file',
    'export the traffic as a har file',
  ],
  network_replay_request: [
    'resend captured request',
    'replay with modifications',
    'replay the request',
  ],
  network_intercept: [
    'block or mock requests',
    'fake responses',
    'intercept and mock the requests',
  ],
  network_tls_fingerprint: ['ja3 ja4 hash', 'client hello fingerprint', 'tls fingerprint'],
  network_bot_detect_analyze: ['detect bot signals', 'anti bot scoring', 'bot detection'],
};

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
    // Only list tools owned by this domain. workflow-domain tools
    // (run_extension_workflow / list_extension_workflows) belong to the
    // workflow manifest; routing them here caused an ownership conflict
    // because both manifests claimed the same names.
    tools: ['network_monitor', 'page_navigate', 'network_get_requests'],
    hint:
      'Network capture workflow: bootstrap browser/page state ->' +
      ' enable capture -> navigate or act -> inspect captured requests.' +
      ' (Tip: list_extension_workflows can suggest higher-level recipes.)',
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

  // Document-expansion keywords for the retrieval layer (see SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
};

export default manifest;
