import type { Phase } from '../helpers/types.js';

export const monitorPhases: Phase[] = [
  {
    name: 'Console Monitor',
    setup: ['console_enable'],
    tools: [
      'console_get_logs', 'console_execute', 'console_get_exceptions',
      'console_inject_script_monitor', 'console_inject_function_tracer',
      'console_clear_injected_buffers', 'console_reset_injected_interceptors',
    ],
  },
  { name: 'Framework & Extension', setup: [], tools: ['framework_state_extract', 'extension_list_installed'] },
  {
    name: 'Network Monitor',
    setup: ['network_enable'],
    tools: [
      'network_get_status', 'network_get_requests', 'network_get_stats',
      'network_extract_auth', 'network_get_response_body', 'network_replay_request',
      'console_inject_fetch_interceptor', 'console_inject_xhr_interceptor',
    ],
  },
  {
    name: 'Streaming (WS/SSE)',
    setup: [],
    tools: ['ws_monitor_enable', 'ws_get_frames', 'ws_get_connections', 'sse_monitor_enable', 'sse_get_events', 'ws_monitor_disable'],
  },
  {
    name: 'Performance Start',
    setup: [],
    tools: ['performance_get_metrics', 'performance_start_coverage', 'profiler_heap_sampling_start', 'performance_trace_start'],
  },
  { name: 'JS Heap', setup: [], tools: ['js_heap_search'] },
  {
    name: 'Performance Stop',
    setup: [],
    tools: ['performance_stop_coverage', 'performance_take_heap_snapshot'],
  },
  {
    name: 'CPU Profiler (after coverage)',
    setup: async (call) => {
      await call('profiler_cpu_start', {});
      await new Promise((r) => setTimeout(r, 300));
    },
    tools: ['profiler_cpu_stop'],
  },
  {
    name: 'Remaining Profiler Stops',
    setup: [],
    tools: ['profiler_heap_sampling_stop', 'performance_trace_stop'],
  },
  { name: 'Network Teardown', setup: [], tools: ['network_export_har', 'network_disable'] },
  { name: 'Debugger Teardown', setup: [], tools: ['debugger_disable'] },
];
