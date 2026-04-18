import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const networkAuthorizationSchema = {
  allowedHosts: {
    type: 'array',
    items: { type: 'string' },
    description: 'Exact hostnames or IP literals allowed for this request.',
  },
  allowedCidrs: {
    type: 'array',
    items: { type: 'string' },
    description: 'Explicit CIDR ranges allowed for this request.',
  },
  allowPrivateNetwork: {
    type: 'boolean',
    description:
      'Allow access to private or reserved network targets, but only when the resolved host matches allowedHosts or allowedCidrs.',
  },
  allowInsecureHttp: {
    type: 'boolean',
    description:
      'Allow plain HTTP access to explicitly authorized targets in allowedHosts or allowedCidrs.',
  },
  expiresAt: {
    type: 'string',
    description: 'Optional ISO-8601 expiry time for this authorization.',
  },
  reason: {
    type: 'string',
    description: 'Short audit note describing why this authorization is needed.',
  },
} as const;

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
  tool('dns_resolve', (t) =>
    t
      .desc(
        'Resolve a hostname to IPv4/IPv6 addresses using deterministic server-side DNS lookup. Accepts hostnames or IP literals. Results are sorted by family and address.',
      )
      .string('hostname', 'Hostname or IP literal to resolve')
      .enum('family', ['auto', 'ipv4', 'ipv6'], 'Address family to query. Default: auto', {
        default: 'auto',
      })
      .boolean(
        'all',
        'When true (default), return all matching addresses. When false, return only the first result.',
        { default: true },
      )
      .requiredOpenWorld('hostname'),
  ),
  tool('dns_reverse', (t) =>
    t
      .desc(
        'Perform a reverse DNS lookup (PTR) for an IPv4 or IPv6 literal using deterministic server-side DNS logic.',
      )
      .string('address', 'IPv4 or IPv6 literal to reverse-resolve')
      .requiredOpenWorld('address'),
  ),
  tool('http_request_build', (t) =>
    t
      .desc(
        'Build a raw HTTP/1.x request payload with CRLF line endings. Useful for preparing deterministic request text for http_plain_request or other raw socket tools.',
      )
      .string('method', 'HTTP method token, e.g. GET, POST, HEAD')
      .string('target', 'Request target, such as /path, *, or an absolute-form URL')
      .string('host', 'Optional Host header value to inject when addHostHeader is enabled')
      .object(
        'headers',
        { additionalProperties: { type: 'string' } },
        'Optional HTTP headers to include in the request',
      )
      .string('body', 'Optional UTF-8 request body')
      .enum('httpVersion', ['1.0', '1.1'], 'HTTP protocol version to emit. Default: 1.1', {
        default: '1.1',
      })
      .boolean('addHostHeader', 'Auto-add the Host header when host is provided', {
        default: true,
      })
      .boolean(
        'addContentLength',
        'Auto-add Content-Length when a body is present and Transfer-Encoding is absent',
        { default: true },
      )
      .boolean('addConnectionClose', 'Auto-add Connection: close when absent', {
        default: true,
      })
      .requiredOpenWorld('method', 'target'),
  ),
  tool('http_plain_request', (t) =>
    t
      .desc(
        'Send a raw HTTP request over plain TCP using deterministic server-side logic with DNS pinning, response parsing, and bounded capture. Non-loopback HTTP targets require explicit request-scoped authorization.',
      )
      .string('host', 'Target hostname or IP literal')
      .number('port', 'TCP port to connect to. Default: 80', { default: 80 })
      .string('requestText', 'Raw HTTP request text to send as UTF-8 bytes')
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP targets. Use exact hosts/CIDRs instead of process-wide bypasses.',
      )
      .number('timeoutMs', 'Socket timeout in milliseconds', { default: 30000 })
      .number(
        'maxResponseBytes',
        'Maximum number of raw response bytes to capture before truncating the exchange',
        { default: 512000 },
      )
      .requiredOpenWorld('host', 'requestText'),
  ),
  tool('http2_probe', (t) =>
    t
      .desc(
        'Probe an HTTP/2 endpoint using Node http2 with deterministic DNS pinning and bounded response capture. Reports the negotiated protocol, ALPN result, response headers, status, and a response body snippet. Non-loopback plaintext h2c targets require explicit request-scoped authorization.',
      )
      .string('url', 'Absolute http:// or https:// URL to probe')
      .string('method', 'HTTP method token to send. Default: GET')
      .object(
        'headers',
        { additionalProperties: { type: 'string' } },
        'Optional request headers to include. Header names are normalized to lowercase for HTTP/2.',
      )
      .string('body', 'Optional UTF-8 request body to send with the probe')
      .array(
        'alpnProtocols',
        { type: 'string' },
        'Optional ALPN preference list for TLS probes. Default: ["h2", "http/1.1"].',
      )
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP targets. Use exact hosts/CIDRs instead of process-wide bypasses.',
      )
      .number('timeoutMs', 'Probe timeout in milliseconds', { default: 30000 })
      .number(
        'maxBodyBytes',
        'Maximum number of response body bytes to capture for the snippet before truncating',
        { default: 32768 },
      )
      .requiredOpenWorld('url'),
  ),
  tool('http2_frame_build', (t) =>
    t
      .desc(
        'Build a raw HTTP/2 binary frame of any supported type (DATA, SETTINGS, PING, WINDOW_UPDATE, RST_STREAM, GOAWAY, or RAW). Returns the 9-byte frame header and full frame as hex strings, ready to send over a tcp_write or tls_write channel for protocol-level fuzzing and injection.',
      )
      .string(
        'frameType',
        'HTTP/2 frame type: DATA, SETTINGS, PING, WINDOW_UPDATE, RST_STREAM, GOAWAY, or RAW',
      )
      .number('streamId', 'Stream identifier (0 for connection-level frames). Default: 0', {
        default: 0,
      })
      .number('flags', 'Raw flags byte (0-255). Overrides type-specific defaults when set.')
      .number(
        'frameTypeCode',
        'Explicit frame type code for RAW frames (0-255). Required when frameType is RAW.',
      )
      .string('payloadHex', 'Frame payload as a hex string. Mutually exclusive with payloadText.')
      .string('payloadText', 'Frame payload as a text string. Mutually exclusive with payloadHex.')
      .string('payloadEncoding', 'Encoding for payloadText: utf8 or ascii. Default: utf8')
      .array(
        'settings',
        {
          type: 'object',
          properties: { id: { type: 'number' }, value: { type: 'number' } },
          required: ['id', 'value'],
        },
        'Array of {id, value} entries for SETTINGS frames',
      )
      .boolean('ack', 'Set the ACK flag on SETTINGS or PING frames')
      .string('pingOpaqueDataHex', 'Exactly 8 bytes of opaque data for PING frames (hex string)')
      .number('windowSizeIncrement', 'Window size increment for WINDOW_UPDATE frames (1 to 2^31-1)')
      .number('errorCode', 'Error code for RST_STREAM or GOAWAY frames (0 to 2^32-1)')
      .number('lastStreamId', 'Last stream ID for GOAWAY frames (0 to 2^31-1)')
      .string('debugDataText', 'Optional debug data for GOAWAY frames')
      .string('debugDataEncoding', 'Encoding for debugDataText: utf8 or ascii. Default: utf8')
      .requiredOpenWorld('frameType'),
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
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP replay. Use exact hosts/CIDRs instead of process-wide bypasses.',
      )
      .string(
        'authorizationCapability',
        'Base64url-encoded JSON capability for request-scoped authorization. Payload fields mirror authorization and must include requestId.',
      )
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
