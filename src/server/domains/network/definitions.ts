import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const advancedTools: Tool[] = [
  tool('network_enable', (t) =>
    t
      .desc(
        'Enable network request monitoring. Must be called before page_navigate to capture requests.\n\nCorrect order:\n1. network_enable()\n2. page_navigate("https://example.com")\n3. network_get_requests()\n\nOr use enableNetworkMonitoring parameter on page_navigate.',
      )
      .boolean('enableExceptions', 'Also capture uncaught exceptions', { default: true }),
  ),
  tool('network_disable', (t) => t.desc('Disable network request monitoring').destructive()),
  tool('network_get_status', (t) =>
    t.desc('Get network monitoring status (enabled, request count, response count)').query(),
  ),
  tool('network_get_requests', (t) =>
    t
      .desc(
        'Get captured network requests. Large results (>25KB) automatically return a summary with detailId.\n\nPrerequisites:\n1. Call network_enable first\n2. Navigate to a page\n\nResponse fields:\n- requestId: unique request identifier\n- url: request URL\n- method: HTTP method (GET/POST)\n- headers: request headers\n- postData: POST body (if present)\n- timestamp: capture time\n- type: resource type (Document/Script/XHR)\n\nDefault behavior:\n- Static resources (Image/Font/Stylesheet/Media) are excluded when no filters are set\n- Results are sorted by type priority: XHR > Fetch > Document > Script > Other\n- Set any filter (url, method, etc.) to include all resource types\n\nBest practices:\n1. Use url filter to reduce result size\n2. Use offset+limit for pagination instead of multiple get_detailed_data calls\n3. Use get_detailed_data(detailId) for full data when summary is returned\n4. If 0 results returned, call console_inject_fetch_interceptor() then re-navigate to capture frontend-wrapped fetch/XHR calls',
      )
      .string('url', 'Filter by URL substring (e.g., "api" matches all API URLs)')
      .string(
        'urlRegex',
        'Filter by URL regex pattern (e.g., "/api/(v[12]|auth)/"). Takes precedence over url substring.',
      )
      .string('method', 'Filter by HTTP method (GET, POST, PUT, DELETE)')
      .number(
        'sinceTimestamp',
        'Only return requests after this epoch timestamp (milliseconds). Useful for incremental polling.',
      )
      .string(
        'sinceRequestId',
        'Only return requests after this requestId (exclusive). Useful for incremental retrieval.',
      )
      .number(
        'tail',
        'Return the last N requests (applied after all other filters). E.g., tail=5 returns the 5 most recent.',
      )
      .number('limit', 'Maximum number of results per page (default: 100, max: 1000)', {
        default: 100,
      })
      .number(
        'offset',
        'Skip first N results for pagination (default: 0). Use page.nextOffset from previous response.',
        { default: 0 },
      )
      .boolean('autoEnable', 'Auto-enable network monitoring when currently disabled', {
        default: true,
      })
      .boolean(
        'enableExceptions',
        'When autoEnable=true, also enable uncaught exception monitoring',
        { default: true },
      ),
  ),
  tool('network_get_response_body', (t) =>
    t
      .desc(
        'Get response body for a specific request. Auto-truncates responses >100KB. Use returnSummary=true for large files.',
      )
      .string('requestId', 'Request ID (from network_get_requests)')
      .number('maxSize', 'Maximum response size in bytes', { default: 100000 })
      .boolean('returnSummary', 'Return only size and preview instead of full body', {
        default: false,
      })
      .number('retries', 'Retry count when response body is not yet available', { default: 3 })
      .number('retryIntervalMs', 'Retry interval in milliseconds', { default: 500 })
      .boolean('autoEnable', 'Auto-enable network monitoring when currently disabled', {
        default: false,
      })
      .boolean(
        'enableExceptions',
        'When autoEnable=true, also enable uncaught exception monitoring',
        { default: true },
      )
      .required('requestId'),
  ),
  tool('network_get_stats', (t) =>
    t.desc('Get network statistics (total requests, response count, error rate, timing)').query(),
  ),
  tool('performance_get_metrics', (t) =>
    t
      .desc('Get page performance metrics (Web Vitals: FCP, LCP, FID, CLS)')
      .boolean('includeTimeline', 'Include detailed timeline events', { default: false })
      .query(),
  ),
  tool('performance_start_coverage', (t) =>
    t.desc('Start JavaScript and CSS code coverage recording'),
  ),
  tool('performance_stop_coverage', (t) =>
    t.desc('Stop coverage recording and return coverage report'),
  ),
  tool('performance_take_heap_snapshot', (t) => t.desc('Take a V8 heap memory snapshot')),
  tool('performance_trace_start', (t) =>
    t
      .desc(
        'Start a Chrome Performance Trace recording using the CDP Tracing domain.\n\nCaptures timeline events (JS execution, layout, paint, rendering) that can be loaded in Chrome DevTools Performance tab.\n\nUSE THIS to:\n- Profile WASM execution performance\n- Find JavaScript performance bottlenecks\n- Analyze rendering and layout thrashing\n- Record screenshots during trace (set screenshots: true)\n\nCall performance_trace_stop to end recording and save the trace file.',
      )
      .array(
        'categories',
        { type: 'string' },
        'Trace categories to include (default: devtools.timeline, v8.execute, blink.user_timing). Pass custom categories for specific tracing needs.',
      )
      .boolean(
        'screenshots',
        'Capture screenshots during tracing (increases trace file size). Default: false',
        { default: false },
      ),
  ),
  tool('performance_trace_stop', (t) =>
    t
      .desc(
        'Stop a running Performance Trace and save the trace file.\n\nReturns the artifact path (loadable in Chrome DevTools Performance tab), event count, and file size.',
      )
      .string(
        'artifactPath',
        'Custom output file path. If omitted, auto-generates path in artifacts/traces/',
      ),
  ),
  tool('profiler_cpu_start', (t) =>
    t.desc(
      'Start CDP CPU profiling.\n\nRecords a V8 CPU profile with call tree, hit counts, and time deltas. The result can be loaded in Chrome DevTools.\n\nCall profiler_cpu_stop to end and retrieve the profile.',
    ),
  ),
  tool('profiler_cpu_stop', (t) =>
    t
      .desc('Stop CPU profiling, save the profile, and return top hot functions.')
      .string(
        'artifactPath',
        'Custom output file path. If omitted, auto-generates path in artifacts/profiles/',
      ),
  ),
  tool('profiler_heap_sampling_start', (t) =>
    t
      .desc(
        'Start V8 heap allocation sampling.\n\nTracks memory allocations over time. Useful for finding memory leaks and high-allocation code paths.\n\nCall profiler_heap_sampling_stop to end and retrieve the report.',
      )
      .number(
        'samplingInterval',
        'Sampling interval in bytes. Lower values = more detail but higher overhead.',
        { default: 32768 },
      ),
  ),
  tool('profiler_heap_sampling_stop', (t) =>
    t
      .desc('Stop heap allocation sampling and return the top allocators.')
      .string(
        'artifactPath',
        'Custom output file path. If omitted, auto-generates path in artifacts/profiles/',
      )
      .number('topN', 'Number of top allocators to return', { default: 20 }),
  ),
  tool('console_get_exceptions', (t) =>
    t
      .desc('Get captured uncaught exceptions from the page')
      .string('url', 'Filter by URL substring')
      .number('limit', 'Maximum number of exceptions to return', { default: 50 })
      .readOnly(),
  ),
  tool('console_inject_script_monitor', (t) =>
    t
      .desc(
        'Inject a monitor that tracks dynamically created script elements. Use persistent: true to survive page navigations.',
      )
      .boolean(
        'persistent',
        'When true, monitor survives page navigations (uses evaluateOnNewDocument). Default: false.',
      )
      .openWorld(),
  ),
  tool('console_inject_xhr_interceptor', (t) =>
    t
      .desc(
        'Inject an XHR interceptor to capture AJAX request/response data. Use persistent: true for the interceptor to survive page navigations.',
      )
      .boolean(
        'persistent',
        'When true, interceptor survives page navigations (uses evaluateOnNewDocument). Default: false.',
      )
      .openWorld(),
  ),
  tool('console_inject_fetch_interceptor', (t) =>
    t
      .desc(
        'Inject a Fetch API interceptor to capture fetch request/response data including headers, body, and timing.\n\nUSE THIS when:\n- network_get_requests returns 0 results after page_navigate\n- The target page wraps fetch() internally (SPA, React, Vue apps)\n- You need to capture request signatures, tokens, or custom headers added by frontend JS\n- CDP network monitoring misses dynamically-constructed requests\n\nUse persistent: true to make the interceptor survive page navigations — no need to inject before page_navigate.',
      )
      .boolean(
        'persistent',
        'When true, interceptor survives page navigations (uses evaluateOnNewDocument). Default: false.',
      )
      .openWorld(),
  ),
  tool('console_clear_injected_buffers', (t) =>
    t.desc(
      'Clear injected in-page monitoring buffers (XHR/Fetch queues and dynamic script records) without removing interceptors',
    ),
  ),
  tool('console_reset_injected_interceptors', (t) =>
    t.desc(
      'Reset injected interceptors/monitors to recover from stale hook state and allow clean reinjection',
    ),
  ),
  tool('console_inject_function_tracer', (t) =>
    t
      .desc(
        'Inject a Proxy-based function tracer to log all calls to a named function. Use persistent: true to survive page navigations.',
      )
      .string('functionName', 'Global function path to trace (e.g., "window.someFunction")')
      .boolean(
        'persistent',
        'When true, tracer survives page navigations (uses evaluateOnNewDocument). Default: false.',
      )
      .requiredOpenWorld('functionName'),
  ),

  // P1: Full-chain analysis tools
  tool('network_extract_auth', (t) =>
    t
      .desc(
        'Scan all captured network requests and extract authentication credentials (tokens, cookies, API keys, signatures).\n\nReturns masked values (first 6 + last 4 chars) sorted by confidence.\nSources scanned: request headers, cookies, URL query params, JSON request body.\n\nUSE THIS after capturing traffic to automatically identify:\n- Bearer tokens / JWT tokens\n- Session cookies\n- Custom auth headers (X-Token, X-Signature, X-Api-Key)\n- Signing parameters in request body or query string',
      )
      .number('minConfidence', 'Minimum confidence threshold 0-1', { default: 0.4 }),
  ),
  tool('network_export_har', (t) =>
    t
      .desc(
        'Export all captured network traffic as a standard HAR 1.2 file.\n\nHAR (HTTP Archive) files can be opened in:\n- Chrome DevTools (Network tab → Import)\n- Fiddler, Charles Proxy, Wireshark\n- Online HAR viewers\n\nUSE THIS to:\n- Save a complete traffic snapshot for offline analysis\n- Share captured API calls with other tools\n- Reproduce a full session outside the browser',
      )
      .string('outputPath', 'File path to write the HAR file. If omitted, returns HAR as JSON.')
      .boolean(
        'includeBodies',
        'Include response bodies in the HAR (may be slow for large captures). Default: false',
        { default: false },
      )
      .openWorld(),
  ),
  tool('network_replay_request', (t) =>
    t
      .desc(
        'Replay a previously captured network request with optional modifications.\n\nUSE THIS to:\n- Re-send an API call with modified headers (e.g., different auth token)\n- Test how a server responds to altered request bodies\n- Verify that a captured signature is still valid\n- Reproduce a specific API call without navigating again\n\nSecurity: dryRun=true (default) previews what will be sent without actually sending.\nSet dryRun=false to execute the actual request.',
      )
      .string('requestId', 'Request ID from network_get_requests to replay')
      .object(
        'headerPatch',
        { additionalProperties: { type: 'string' } },
        'Headers to add or override (key-value pairs)',
      )
      .string('bodyPatch', 'Replace the entire request body with this string')
      .string('methodOverride', 'Override the HTTP method (e.g., change POST to GET)')
      .string('urlOverride', 'Override the request URL')
      .number('timeoutMs', 'Request timeout in milliseconds', { default: 30000 })
      .boolean(
        'dryRun',
        'If true (default), only preview the request without sending. Set false to execute.',
        { default: true },
      )
      .requiredOpenWorld('requestId'),
  ),

  // Fetch Interception
  tool('network_intercept_response', (t) =>
    t
      .desc(
        'Add response interception rules using CDP Fetch domain. Matched requests will receive a custom response instead of the real server response.\n\nUSE THIS to:\n- Override API responses (e.g., spoof subscription/paywall status)\n- Inject custom feature flags\n- Test error handling by returning specific error codes\n- Mock API endpoints during development\n\nSupports both single rule and batch mode. URL patterns support glob (* for segment, ** for any) and regex.\n\nPrerequisites: Browser must be launched and a page active.\n\nExample (single rule):\n  urlPattern: "*api/subscription*"\n  responseBody: \'{"status":"active","plan":"pro"}\'\n\nExample (batch):\n  rules: [{urlPattern: "*api/status*", responseBody: "..."}, ...]',
      )
      .string(
        'urlPattern',
        'URL pattern to match (single rule mode). Supports glob (* = segment, ** = any) or regex.',
      )
      .enum('urlPatternType', ['glob', 'regex'], 'How to interpret urlPattern', { default: 'glob' })
      .enum(
        'stage',
        ['Request', 'Response'],
        'Intercept stage. Response (default) intercepts after server responds.',
        { default: 'Response' },
      )
      .number('responseCode', 'HTTP status code to return', { default: 200 })
      .object(
        'responseHeaders',
        { additionalProperties: { type: 'string' } },
        'Custom response headers as key-value pairs.',
      )
      .string('responseBody', 'Custom response body string.')
      .array(
        'rules',
        {
          type: 'object',
          properties: {
            urlPattern: { type: 'string' },
            urlPatternType: { type: 'string', enum: ['glob', 'regex'] },
            stage: { type: 'string', enum: ['Request', 'Response'] },
            responseCode: { type: 'number' },
            responseHeaders: { type: 'object', additionalProperties: { type: 'string' } },
            responseBody: { type: 'string' },
          },
          required: ['urlPattern'],
        },
        'Batch mode: array of rule objects',
      )
      .openWorld(),
  ),
  tool('network_intercept_list', (t) =>
    t
      .desc(
        "List all active response interception rules with hit statistics.\n\nShows each rule's ID, URL pattern, response code, hit count, and creation time.\nUse this to monitor which rules are being triggered.",
      )
      .query(),
  ),
  tool('network_intercept_disable', (t) =>
    t
      .desc(
        'Remove interception rules. Provide ruleId to remove a single rule, or all=true to disable all interception.\n\nWhen all rules are removed, the CDP Fetch domain is automatically disabled.',
      )
      .string('ruleId', 'ID of the rule to remove (from network_intercept_list)')
      .boolean('all', 'Set to true to remove all rules and disable interception', {
        default: false,
      })
      .destructive(),
  ),
];
