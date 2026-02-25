import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const advancedTools: Tool[] = [
  {
    name: 'network_enable',
    description:
      'Enable network request monitoring. Must be called before page_navigate to capture requests.\n\nCorrect order:\n1. network_enable()\n2. page_navigate("https://example.com")\n3. network_get_requests()\n\nOr use enableNetworkMonitoring parameter on page_navigate.',
    inputSchema: {
      type: 'object',
      properties: {
        enableExceptions: {
          type: 'boolean',
          description: 'Also capture uncaught exceptions',
          default: true,
        },
      },
    },
  },

  {
    name: 'network_disable',
    description: 'Disable network request monitoring',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'network_get_status',
    description: 'Get network monitoring status (enabled, request count, response count)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'network_get_requests',
    description:
      'Get captured network requests. Large results (>50KB) automatically return a summary with detailId.\n\nPrerequisites:\n1. Call network_enable first\n2. Navigate to a page\n\nResponse fields:\n- requestId: unique request identifier\n- url: request URL\n- method: HTTP method (GET/POST)\n- headers: request headers\n- postData: POST body (if present)\n- timestamp: capture time\n- type: resource type (Document/Script/XHR)\n\nBest practices:\n1. Use url filter to reduce result size\n2. Set limit <= 100 (default: 50)\n3. Use get_detailed_data(detailId) for full data when summary is returned',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Filter by URL substring (e.g., "api" matches all API URLs)',
        },
        method: {
          type: 'string',
          description: 'Filter by HTTP method (GET, POST, PUT, DELETE)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50, max: 100)',
          default: 50,
        },
      },
    },
  },

  {
    name: 'network_get_response_body',
    description:
      'Get response body for a specific request. Auto-truncates responses >100KB. Use returnSummary=true for large files.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'Request ID (from network_get_requests)',
        },
        maxSize: {
          type: 'number',
          description: 'Maximum response size in bytes (default: 100KB)',
          default: 100000,
        },
        returnSummary: {
          type: 'boolean',
          description: 'Return only size and preview instead of full body',
          default: false,
        },
      },
      required: ['requestId'],
    },
  },

  {
    name: 'network_get_stats',
    description: 'Get network statistics (total requests, response count, error rate, timing)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'performance_get_metrics',
    description: 'Get page performance metrics (Web Vitals: FCP, LCP, FID, CLS)',
    inputSchema: {
      type: 'object',
      properties: {
        includeTimeline: {
          type: 'boolean',
          description: 'Include detailed timeline events',
          default: false,
        },
      },
    },
  },

  {
    name: 'performance_start_coverage',
    description: 'Start JavaScript and CSS code coverage recording',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'performance_stop_coverage',
    description: 'Stop coverage recording and return coverage report',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'performance_take_heap_snapshot',
    description: 'Take a V8 heap memory snapshot',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_get_exceptions',
    description: 'Get captured uncaught exceptions from the page',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Filter by URL substring',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of exceptions to return',
          default: 50,
        },
      },
    },
  },

  {
    name: 'console_inject_script_monitor',
    description: 'Inject a monitor that tracks dynamically created script elements',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_inject_xhr_interceptor',
    description: 'Inject an XHR interceptor to capture AJAX request/response data',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_inject_fetch_interceptor',
    description: 'Inject a Fetch API interceptor to capture fetch request/response data',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_clear_injected_buffers',
    description:
      'Clear injected in-page monitoring buffers (XHR/Fetch queues and dynamic script records) without removing interceptors',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_reset_injected_interceptors',
    description:
      'Reset injected interceptors/monitors to recover from stale hook state and allow clean reinjection',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'console_inject_function_tracer',
    description: 'Inject a Proxy-based function tracer to log all calls to a named function',
    inputSchema: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'Global function path to trace (e.g., "window.someFunction")',
        },
      },
      required: ['functionName'],
    },
  },
];
