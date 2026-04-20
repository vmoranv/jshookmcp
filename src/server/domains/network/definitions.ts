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
  tool('network_monitor', (t) =>
    t
      .desc(
        'Manage network request monitoring. Enable/disable monitoring or check status. Must enable before page_navigate to capture requests.',
      )
      .enum('action', ['enable', 'disable', 'status'], 'Action to perform')
      .boolean('enableExceptions', 'Only for enable action: Also capture uncaught exceptions', {
        default: true,
      })
      .required('action'),
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
  tool('performance_coverage', (t) =>
    t
      .desc('Start or stop JavaScript and CSS code coverage recording')
      .enum('action', ['start', 'stop'], 'Coverage action')
      .required('action'),
  ),
  tool('performance_take_heap_snapshot', (t) => t.desc('Take a V8 heap memory snapshot')),
  tool('performance_trace', (t) =>
    t
      .desc(
        `Chrome Performance Trace recording. Action 'start' begins capture; 'stop' ends and saves trace file.

Captures timeline events (JS execution, layout, paint, rendering) loadable in Chrome DevTools Performance tab.`,
      )
      .enum('action', ['start', 'stop'], 'Trace action')
      .array(
        'categories',
        { type: 'string' },
        'Trace categories (action=start, default: devtools.timeline, v8.execute)',
      )
      .boolean('screenshots', 'Capture screenshots during tracing (action=start, default: false)', {
        default: false,
      })
      .string('artifactPath', 'Custom output path (action=stop)')
      .required('action'),
  ),
  tool('profiler_cpu', (t) =>
    t
      .desc(
        `CDP CPU profiling. Action 'start' begins recording; 'stop' ends and saves profile with top hot functions.`,
      )
      .enum('action', ['start', 'stop'], 'Profiler action')
      .string('artifactPath', 'Custom output path (action=stop)')
      .required('action'),
  ),
  tool('profiler_heap_sampling', (t) =>
    t
      .desc(
        `V8 heap allocation sampling. Action 'start' begins tracking; 'stop' ends and returns top allocators.`,
      )
      .enum('action', ['start', 'stop'], 'Sampling action')
      .number('samplingInterval', 'Sampling interval bytes (action=start, default: 32768)', {
        default: 32768,
      })
      .string('artifactPath', 'Custom output path (action=stop)')
      .number('topN', 'Number of top allocators (action=stop, default: 20)', { default: 20 })
      .required('action'),
  ),
  tool('console_get_exceptions', (t) =>
    t
      .desc('Get captured uncaught exceptions from the page')
      .string('url', 'Filter by URL substring')
      .number('limit', 'Maximum number of exceptions to return', { default: 50 })
      .readOnly(),
  ),
  tool('console_inject', (t) =>
    t
      .desc(
        `Inject an in-page monitor/interceptor. Types:
- script: Track dynamically created script elements
- xhr: Capture AJAX request/response data
- fetch: Capture fetch() calls (useful when CDP misses wrapped fetch)
- function: Proxy-based tracer for a named global function (requires functionName)`,
      )
      .enum('type', ['script', 'xhr', 'fetch', 'function'], 'Injection type')
      .string(
        'functionName',
        'Global function path to trace (type=function, e.g. "window.someFunction")',
      )
      .boolean(
        'persistent',
        'Survive page navigations via evaluateOnNewDocument (default: false)',
        { default: false },
      )
      .required('type')
      .openWorld(),
  ),
  tool('console_buffers', (t) =>
    t
      .desc('Manage injected interceptor state.')
      .enum('action', ['clear', 'reset'], 'Buffer action: clear buffers or reset interceptors')
      .required('action'),
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
  tool('network_rtt_measure', (t) =>
    t
      .desc(
        'Measure round-trip time (RTT) to a target URL using TCP, TLS, or HTTP probes. Returns per-sample latencies and aggregate statistics (min/max/mean/median/p95).',
      )
      .string('url', 'Target URL to measure RTT to')
      .string('probeType', 'Probe type: tcp, tls, or http. Default: tcp', { default: 'tcp' })
      .number('iterations', 'Number of probe iterations (1-50). Default: 5', { default: 5 })
      .number('timeoutMs', 'Per-probe timeout in milliseconds (100-30000). Default: 5000', {
        default: 5000,
      })
      .object(
        'authorization',
        { additionalProperties: { type: 'string' } },
        'Authorization policy for network access',
      )
      .requiredOpenWorld('url'),
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
  tool('network_intercept', (t) =>
    t
      .desc(
        `Manage response interception rules using CDP Fetch domain. Actions: add (create rule), list (show active rules), disable (remove rules).

When adding rules, matched requests receive a custom response instead of the real server response.
URL patterns support glob (* for segment, ** for any) and regex.
When all rules are removed, the CDP Fetch domain is automatically disabled.`,
      )
      .enum('action', ['add', 'list', 'disable'], 'Intercept operation')
      .string(
        'urlPattern',
        'URL pattern to match (action=add). Supports glob (* = segment, ** = any) or regex.',
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
        'Batch mode: array of rule objects (action=add)',
      )
      .string('ruleId', 'ID of the rule to remove (action=disable)')
      .boolean('all', 'Set to true to remove all rules and disable interception (action=disable)', {
        default: false,
      })
      .required('action'),
  ),
];
