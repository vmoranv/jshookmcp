import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const captureTools: Tool[] = [
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
        minimum: 1,
        maximum: 1000,
      })
      .number(
        'offset',
        'Skip first N results for pagination (default: 0). Use page.nextOffset from previous response.',
        { default: 0, minimum: 0 },
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
      .number('maxSize', 'Maximum response size in bytes', {
        default: 100000,
        minimum: 1024,
        maximum: 20000000,
      })
      .boolean('returnSummary', 'Return only size and preview instead of full body', {
        default: false,
      })
      .number('retries', 'Retry count when response body is not yet available', {
        default: 3,
        minimum: 0,
        maximum: 10,
      })
      .number('retryIntervalMs', 'Retry interval in milliseconds', {
        default: 500,
        minimum: 100,
        maximum: 10000,
      })
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
        minimum: 256,
        maximum: 1048576,
      })
      .string('artifactPath', 'Custom output path (action=stop)')
      .number('topN', 'Number of top allocators (action=stop, default: 20)', {
        default: 20,
        minimum: 1,
        maximum: 100,
      })
      .required('action'),
  ),
];
