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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'network_disable',
    description: 'Disable network request monitoring',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'network_get_status',
    description: 'Get network monitoring status (enabled, request count, response count)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
        urlRegex: {
          type: 'string',
          description:
            'Filter by URL regex pattern (e.g., "/api/(v[12]|auth)/"). Takes precedence over url substring.',
        },
        method: {
          type: 'string',
          description: 'Filter by HTTP method (GET, POST, PUT, DELETE)',
        },
        sinceTimestamp: {
          type: 'number',
          description:
            'Only return requests after this epoch timestamp (milliseconds). Useful for incremental polling.',
        },
        sinceRequestId: {
          type: 'string',
          description:
            'Only return requests after this requestId (exclusive). Useful for incremental retrieval.',
        },
        tail: {
          type: 'number',
          description:
            'Return the last N requests (applied after all other filters). E.g., tail=5 returns the 5 most recent.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results per page (default: 100, max: 1000)',
          default: 100,
        },
        offset: {
          type: 'number',
          description:
            'Skip first N results for pagination (default: 0). Use page.nextOffset from previous response.',
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'network_get_stats',
    description: 'Get network statistics (total requests, response count, error rate, timing)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },

  {
    name: 'performance_start_coverage',
    description: 'Start JavaScript and CSS code coverage recording',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'performance_stop_coverage',
    description: 'Stop coverage recording and return coverage report',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'performance_take_heap_snapshot',
    description: 'Take a V8 heap memory snapshot',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'performance_trace_start',
    description:
      'Start a Chrome Performance Trace recording using the CDP Tracing domain.\n\nCaptures timeline events (JS execution, layout, paint, rendering) that can be loaded in Chrome DevTools Performance tab.\n\nUSE THIS to:\n- Profile WASM execution performance\n- Find JavaScript performance bottlenecks\n- Analyze rendering and layout thrashing\n- Record screenshots during trace (set screenshots: true)\n\nCall performance_trace_stop to end recording and save the trace file.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Trace categories to include (default: devtools.timeline, v8.execute, blink.user_timing). Pass custom categories for specific tracing needs.',
        },
        screenshots: {
          type: 'boolean',
          description:
            'Capture screenshots during tracing (increases trace file size). Default: false',
          default: false,
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'performance_trace_stop',
    description:
      'Stop a running Performance Trace and save the trace file.\n\nReturns the artifact path (loadable in Chrome DevTools Performance tab), event count, and file size.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactPath: {
          type: 'string',
          description:
            'Custom output file path. If omitted, auto-generates path in artifacts/traces/',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'profiler_cpu_start',
    description:
      'Start CDP CPU profiling.\n\nRecords a V8 CPU profile with call tree, hit counts, and time deltas. The result can be loaded in Chrome DevTools.\n\nCall profiler_cpu_stop to end and retrieve the profile.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'profiler_cpu_stop',
    description: 'Stop CPU profiling, save the profile, and return top hot functions.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactPath: {
          type: 'string',
          description:
            'Custom output file path. If omitted, auto-generates path in artifacts/profiles/',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'profiler_heap_sampling_start',
    description:
      'Start V8 heap allocation sampling.\n\nTracks memory allocations over time. Useful for finding memory leaks and high-allocation code paths.\n\nCall profiler_heap_sampling_stop to end and retrieve the report.',
    inputSchema: {
      type: 'object',
      properties: {
        samplingInterval: {
          type: 'number',
          description:
            'Sampling interval in bytes (default: 32768). Lower values = more detail but higher overhead.',
          default: 32768,
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'profiler_heap_sampling_stop',
    description: 'Stop heap allocation sampling and return the top allocators.',
    inputSchema: {
      type: 'object',
      properties: {
        artifactPath: {
          type: 'string',
          description:
            'Custom output file path. If omitted, auto-generates path in artifacts/profiles/',
        },
        topN: {
          type: 'number',
          description: 'Number of top allocators to return (default: 20)',
          default: 20,
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'console_inject_script_monitor',
    description:
      'Inject a monitor that tracks dynamically created script elements. Use persistent: true to survive page navigations.',
    inputSchema: {
      type: 'object',
      properties: {
        persistent: {
          type: 'boolean',
          description:
            'When true, monitor survives page navigations (uses evaluateOnNewDocument). Default: false.',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },

  {
    name: 'console_inject_xhr_interceptor',
    description:
      'Inject an XHR interceptor to capture AJAX request/response data. Use persistent: true for the interceptor to survive page navigations.',
    inputSchema: {
      type: 'object',
      properties: {
        persistent: {
          type: 'boolean',
          description:
            'When true, interceptor survives page navigations (uses evaluateOnNewDocument). Default: false.',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },

  {
    name: 'console_inject_fetch_interceptor',
    description:
      'Inject a Fetch API interceptor to capture fetch request/response data including headers, body, and timing.\n\nUSE THIS when:\n- network_get_requests returns 0 results after page_navigate\n- The target page wraps fetch() internally (SPA, React, Vue apps)\n- You need to capture request signatures, tokens, or custom headers added by frontend JS\n- CDP network monitoring misses dynamically-constructed requests\n\nUse persistent: true to make the interceptor survive page navigations — no need to inject before page_navigate.',
    inputSchema: {
      type: 'object',
      properties: {
        persistent: {
          type: 'boolean',
          description:
            'When true, interceptor survives page navigations (uses evaluateOnNewDocument). Default: false.',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },

  {
    name: 'console_inject_function_tracer',
    description:
      'Inject a Proxy-based function tracer to log all calls to a named function. Use persistent: true to survive page navigations.',
    inputSchema: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'Global function path to trace (e.g., "window.someFunction")',
        },
        persistent: {
          type: 'boolean',
          description:
            'When true, tracer survives page navigations (uses evaluateOnNewDocument). Default: false.',
        },
      },
      required: ['functionName'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },

  // ── P1: Full-chain analysis tools ─────────────────────────────────────────

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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
          description:
            'File path to write the HAR file (optional). If omitted, returns HAR as JSON.',
        },
        includeBodies: {
          type: 'boolean',
          description:
            'Include response bodies in the HAR (may be slow for large captures). Default: false',
          default: false,
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
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
          description:
            'If true (default), only preview the request without sending. Set false to execute.',
          default: true,
        },
      },
      required: ['requestId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];
