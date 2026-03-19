import type { Phase } from '@tests/e2e/helpers/types';

export const monitorPhases: Phase[] = [
  {
    name: 'Console Monitor',
    setup: ['console_enable'],
    tools: [
      'console_get_logs',
      'console_execute',
      'console_get_exceptions',
      'console_inject_script_monitor',
      'console_inject_function_tracer',
      'console_clear_injected_buffers',
      'console_reset_injected_interceptors',
    ],
  },
  {
    name: 'Framework & Extension',
    setup: [],
    tools: ['framework_state_extract', 'extension_list_installed'],
  },
  {
    name: 'Network Monitor',
    setup: async (call) => {
      // Enable network monitoring first, then navigate so requests are actually captured
      await call('network_enable', {});
      await new Promise((r) => setTimeout(r, 200));
      await call('console_inject_fetch_interceptor', { persistent: true });
      await call('console_inject_xhr_interceptor', { persistent: true });
      await new Promise((r) => setTimeout(r, 200));
      // Navigate to capture real HTTP requests
      await call('page_navigate', { url: 'https://vmoranv.github.io/jshookmcp/', waitUntil: 'load', timeout: 15000 });
      await new Promise((r) => setTimeout(r, 2000));
    },
    tools: [
      'network_get_status',
      'network_get_requests',
      'network_get_stats',
      'network_extract_auth',
      'network_get_response_body',
      'network_replay_request',
    ],
  },
  {
    name: 'Streaming (WS/SSE)',
    setup: ['page_navigate'],
    tools: [
      'ws_monitor_enable',
      'ws_get_frames',
      'ws_get_connections',
      'sse_monitor_enable',
      'sse_get_events',
      'ws_monitor_disable',
    ],
  },
  {
    name: 'Performance Start',
    setup: ['page_navigate'],
    tools: [
      'performance_get_metrics',
      'performance_start_coverage',
      'performance_trace_start',
    ],
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
    name: 'Heap Profiler Stop',
    setup: async (call) => {
      // Start and stop in same phase to guarantee pairing — avoids double-start or never-started issues
      await call('profiler_heap_sampling_start', {}, 5000);
      await new Promise((r) => setTimeout(r, 500));
    },
    tools: ['profiler_heap_sampling_stop', 'performance_trace_stop'],
  },
  { name: 'Network Teardown', setup: [], tools: ['network_export_har', 'network_disable'] },
  { name: 'Debugger Teardown', setup: [], tools: ['debugger_disable'] },
];
