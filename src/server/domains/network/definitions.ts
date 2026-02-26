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
      'Get captured network requests. Large results (>50KB) automatically return a summary with detailId.\n\nPrerequisites:\n1. Call network_enable first\n2. Navigate to a page\n\nResponse fields:\n- requestId: unique request identifier\n- url: request URL\n- method: HTTP method (GET/POST)\n- headers: request headers\n- postData: POST body (if present)\n- timestamp: capture time\n- type: resource type (Document/Script/XHR)\n\nBest practices:\n1. Use url filter to reduce result size\n2. Use offset+limit for pagination instead of multiple get_detailed_data calls\n3. Use get_detailed_data(detailId) for full data when summary is returned\n4. If 0 results returned, call console_inject_fetch_interceptor() then re-navigate to capture frontend-wrapped fetch/XHR calls',
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
          description: 'Maximum number of results per page (default: 100, max: 1000)',
          default: 100,
        },
        offset: {
          type: 'number',
          description: 'Skip first N results for pagination (default: 0). Use page.nextOffset from previous response.',
          default: 0,
        },
        autoEnable: {
          type: 'boolean',
          description: 'Auto-enable network monitoring when currently disabled',
          default: true,
        },
        enableExceptions: {
          type: 'boolean',
          description: 'When autoEnable=true, also enable uncaught exception monitoring',
          default: true,
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
        retries: {
          type: 'number',
          description: 'Retry count when response body is not yet available (default: 3)',
          default: 3,
        },
        retryIntervalMs: {
          type: 'number',
          description: 'Retry interval in milliseconds (default: 500)',
          default: 500,
        },
        autoEnable: {
          type: 'boolean',
          description: 'Auto-enable network monitoring when currently disabled',
          default: false,
        },
        enableExceptions: {
          type: 'boolean',
          description: 'When autoEnable=true, also enable uncaught exception monitoring',
          default: true,
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
    description:
      'Inject a Fetch API interceptor to capture fetch request/response data including headers, body, and timing.\n\nUSE THIS when:\n- network_get_requests returns 0 results after page_navigate\n- The target page wraps fetch() internally (SPA, React, Vue apps)\n- You need to capture request signatures, tokens, or custom headers added by frontend JS\n- CDP network monitoring misses dynamically-constructed requests\n\nAfter injection, re-navigate or trigger the action to capture all fetch calls.',
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

  // ── P1: Full-chain reverse engineering tools ──────────────────────────────

  {
    name: 'network_extract_auth',
    description:
      'Scan all captured network requests and extract authentication credentials (tokens, cookies, API keys, signatures).\n\nReturns masked values (first 6 + last 4 chars) sorted by confidence.\nSources scanned: request headers, cookies, URL query params, JSON request body.\n\nUSE THIS after capturing traffic to automatically identify:\n- Bearer tokens / JWT tokens\n- Session cookies\n- Custom auth headers (X-Token, X-Signature, X-Api-Key)\n- Signing parameters in request body or query string',
    inputSchema: {
      type: 'object',
      properties: {
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence threshold 0-1 (default: 0.4)',
          default: 0.4,
        },
      },
    },
  },

  {
    name: 'network_export_har',
    description:
      'Export all captured network traffic as a standard HAR 1.2 file.\n\nHAR (HTTP Archive) files can be opened in:\n- Chrome DevTools (Network tab → Import)\n- Fiddler, Charles Proxy, Wireshark\n- Online HAR viewers\n\nUSE THIS to:\n- Save a complete traffic snapshot for offline analysis\n- Share captured API calls with other tools\n- Reproduce a full session outside the browser',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: {
          type: 'string',
          description: 'File path to write the HAR file (optional). If omitted, returns HAR as JSON.',
        },
        includeBodies: {
          type: 'boolean',
          description: 'Include response bodies in the HAR (may be slow for large captures). Default: false',
          default: false,
        },
      },
    },
  },

  {
    name: 'network_replay_request',
    description:
      'Replay a previously captured network request with optional modifications.\n\nUSE THIS to:\n- Re-send an API call with modified headers (e.g., different auth token)\n- Test how a server responds to altered request bodies\n- Verify that a captured signature is still valid\n- Reproduce a specific API call without navigating again\n\nSecurity: dryRun=true (default) previews what will be sent without actually sending.\nSet dryRun=false to execute the actual request.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'Request ID from network_get_requests to replay',
        },
        headerPatch: {
          type: 'object',
          description: 'Headers to add or override (key-value pairs)',
          additionalProperties: { type: 'string' },
        },
        bodyPatch: {
          type: 'string',
          description: 'Replace the entire request body with this string',
        },
        methodOverride: {
          type: 'string',
          description: 'Override the HTTP method (e.g., change POST to GET)',
        },
        urlOverride: {
          type: 'string',
          description: 'Override the request URL',
        },
        timeoutMs: {
          type: 'number',
          description: 'Request timeout in milliseconds (default: 30000)',
          default: 30000,
        },
        dryRun: {
          type: 'boolean',
          description: 'If true (default), only preview the request without sending. Set false to execute.',
          default: true,
        },
      },
      required: ['requestId'],
    },
  },
];
