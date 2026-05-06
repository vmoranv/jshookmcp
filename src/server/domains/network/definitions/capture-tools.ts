import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const captureTools: Tool[] = [
  tool('network_enable', (t) =>
    t
      .desc('Enable network request monitoring.')
      .boolean('enableExceptions', 'Also capture uncaught exceptions', { default: true }),
  ),
  tool('network_disable', (t) => t.desc('Disable network request monitoring').destructive()),
  tool('network_get_status', (t) => t.desc('Get network monitoring status.').query()),
  tool('network_monitor', (t) =>
    t
      .desc('Manage network request monitoring.')
      .enum('action', ['enable', 'disable', 'status'], 'Action to perform')
      .boolean('enableExceptions', 'Only for enable action: Also capture uncaught exceptions', {
        default: true,
      })
      .required('action'),
  ),
  tool('network_get_requests', (t) =>
    t
      .desc('Get captured network requests.')
      .string('url', 'Filter by URL substring')
      .string('urlRegex', 'Filter by URL regex pattern')
      .string('method', 'Filter by HTTP method (GET, POST, PUT, DELETE)')
      .number(
        'sinceTimestamp',
        'Only return requests after this epoch timestamp (milliseconds). Useful for incremental polling.',
      )
      .string(
        'sinceRequestId',
        'Only return requests after this requestId (exclusive). Useful for incremental retrieval.',
      )
      .number('tail', 'Return the last N requests after filtering')
      .number('limit', 'Maximum number of results per page', {
        default: 100,
        minimum: 1,
        maximum: 1000,
      })
      .number('offset', 'Skip results for pagination', { default: 0, minimum: 0 })
      .boolean('autoEnable', 'Auto-enable network monitoring when currently disabled', {
        default: true,
      })
      .boolean(
        'enableExceptions',
        'When autoEnable=true, also enable uncaught exception monitoring',
        { default: true },
      )
      .array(
        'fields',
        { type: 'string' },
        'Only include these fields per request (e.g. ["url","method","status"]). Reduces response size drastically.',
      )
      .boolean(
        'deduplicateUrls',
        'Deduplicate URLs by stripping query params and normalizing path segments (UUIDs/IDs → {id}). Returns unique endpoint patterns with counts instead of individual requests.',
        { default: false },
      ),
  ),
  tool('network_get_response_body', (t) =>
    t
      .desc('Get the response body for a captured request.')
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
  tool('network_get_stats', (t) => t.desc('Get network statistics.').query()),
  tool('performance_get_metrics', (t) =>
    t
      .desc('Get page performance metrics.')
      .boolean('includeTimeline', 'Include detailed timeline events', { default: false })
      .query(),
  ),
  tool('performance_coverage', (t) =>
    t
      .desc('Start or stop code coverage recording.')
      .enum('action', ['start', 'stop'], 'Coverage action')
      .required('action'),
  ),
  tool('performance_take_heap_snapshot', (t) => t.desc('Take a V8 heap memory snapshot')),
  tool('performance_trace', (t) =>
    t
      .desc('Start or stop a Chrome performance trace.')
      .enum('action', ['start', 'stop'], 'Trace action')
      .array('categories', { type: 'string' }, 'Trace categories to capture')
      .boolean('screenshots', 'Capture screenshots during tracing', {
        default: false,
      })
      .string('artifactPath', 'Custom output path')
      .required('action'),
  ),
  tool('profiler_cpu', (t) =>
    t
      .desc('Start or stop CPU profiling.')
      .enum('action', ['start', 'stop'], 'Profiler action')
      .string('artifactPath', 'Custom output path')
      .required('action'),
  ),
  tool('profiler_heap_sampling', (t) =>
    t
      .desc('Start or stop heap allocation sampling.')
      .enum('action', ['start', 'stop'], 'Sampling action')
      .number('samplingInterval', 'Sampling interval in bytes', {
        default: 32768,
        minimum: 256,
        maximum: 1048576,
      })
      .string('artifactPath', 'Custom output path')
      .number('topN', 'Number of top allocators to return', {
        default: 20,
        minimum: 1,
        maximum: 100,
      })
      .required('action'),
  ),
];
