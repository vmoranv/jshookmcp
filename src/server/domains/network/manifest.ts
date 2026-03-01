import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { advancedTools } from './definitions.js';

const t = toolLookup(advancedTools);

export const networkRegistrations: readonly ToolRegistration[] = [
  { tool: t('network_enable'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkEnable(a) },
  { tool: t('network_disable'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkDisable(a) },
  { tool: t('network_get_status'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkGetStatus(a) },
  { tool: t('network_get_requests'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkGetRequests(a) },
  { tool: t('network_get_response_body'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkGetResponseBody(a) },
  { tool: t('network_get_stats'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkGetStats(a) },
  { tool: t('performance_get_metrics'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handlePerformanceGetMetrics(a) },
  { tool: t('performance_start_coverage'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handlePerformanceStartCoverage(a) },
  { tool: t('performance_stop_coverage'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handlePerformanceStopCoverage(a) },
  { tool: t('performance_take_heap_snapshot'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handlePerformanceTakeHeapSnapshot(a) },
  { tool: t('performance_trace_start'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handlePerformanceTraceStart(a) },
  { tool: t('performance_trace_stop'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handlePerformanceTraceStop(a) },
  { tool: t('profiler_cpu_start'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleProfilerCpuStart(a) },
  { tool: t('profiler_cpu_stop'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleProfilerCpuStop(a) },
  { tool: t('profiler_heap_sampling_start'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleProfilerHeapSamplingStart(a) },
  { tool: t('profiler_heap_sampling_stop'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleProfilerHeapSamplingStop(a) },
  { tool: t('console_get_exceptions'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleConsoleGetExceptions(a) },
  { tool: t('console_inject_script_monitor'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleConsoleInjectScriptMonitor(a) },
  { tool: t('console_inject_xhr_interceptor'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleConsoleInjectXhrInterceptor(a) },
  { tool: t('console_inject_fetch_interceptor'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleConsoleInjectFetchInterceptor(a) },
  { tool: t('console_clear_injected_buffers'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleConsoleClearInjectedBuffers(a) },
  { tool: t('console_reset_injected_interceptors'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleConsoleResetInjectedInterceptors(a) },
  { tool: t('console_inject_function_tracer'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleConsoleInjectFunctionTracer(a) },
  { tool: t('network_extract_auth'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkExtractAuth(a) },
  { tool: t('network_export_har'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkExportHar(a) },
  { tool: t('network_replay_request'), domain: 'network', bind: (d) => (a) => d.advancedHandlers.handleNetworkReplayRequest(a) },
];
