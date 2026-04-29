import type { Phase } from '@tests/e2e/helpers/types';

export const monitorPhases: Phase[] = [
  {
    name: 'Console Monitor',
    setup: ['console_monitor'],
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
    concurrent: true,
    group: 'compute-browser',
    setup: [],
    tools: ['framework_state_extract', 'extension_list_installed'],
  },
  {
    name: 'Network Monitor',
    setup: async (call) => {
      // Enable network monitoring first, then navigate so requests are actually captured
      await call('network_enable', {});
      await new Promise((r) => setTimeout(r, 50));
      await call('console_inject_fetch_interceptor', { persistent: true });
      await call('console_inject_xhr_interceptor', { persistent: true });
      await new Promise((r) => setTimeout(r, 50));
      // Navigate to capture real HTTP requests
      await call('page_navigate', {
        url: 'https://vmoranv.github.io/jshookmcp/',
        waitUntil: 'load',
        timeout: 15000,
      });
      await new Promise((r) => setTimeout(r, 750));
    },
    tools: [
      'network_enable',
      'console_inject_fetch_interceptor',
      'console_inject_xhr_interceptor',
      'network_intercept',
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
    setup: async (call) => {
      await call('page_navigate', {});
      await call('ws_monitor', { action: 'enable' });
    },
    tools: ['ws_get_frames', 'ws_get_connections', 'sse_monitor_enable', 'sse_get_events'],
  },
  {
    name: 'Performance',
    setup: ['page_navigate'],
    tools: ['performance_get_metrics', 'js_heap_search', 'performance_take_heap_snapshot'],
  },
  { name: 'Network Teardown', setup: [], tools: ['network_export_har', 'network_disable'] },
  {
    name: 'TLS & Bot Detection',
    concurrent: true,
    group: 'compute-browser',
    setup: [],
    tools: ['network_tls_fingerprint', 'network_bot_detect_analyze'],
  },
  { name: 'Debugger Teardown', setup: [], tools: ['debugger_lifecycle'] },
];
