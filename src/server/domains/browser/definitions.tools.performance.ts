import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

/**
 * Atomic performance primitives (P0).
 *
 * Each tool is a single CDP / Web API primitive — no pipeline orchestration:
 * - browser_performance_observer     → in-page PerformanceObserver subscription
 * - browser_resource_timing          → Resource Timing API decomposition
 * - browser_cdp_performance_metrics  → CDP Performance.getMetrics()
 * - v8_type_profile                  → CDP Profiler type profile (start/stop)
 */
export const browserPerformanceToolDefinitions: Tool[] = [
  tool('browser_performance_observer', (t) =>
    t
      .desc(
        'Atomic primitive: subscribe to PerformanceObserver entry types in the active page and ' +
          'return both buffered and live entries observed during a collection window. ' +
          'Entry types are passed through to PerformanceObserver.observe({ type }) verbatim ' +
          '(e.g. largest-contentful-paint, layout-shift, longtask, event, long-animation-frame); ' +
          'unsupported entry types are skipped silently. One observer per type — the API does ' +
          'not accept multiple types in a single observe() call.',
      )
      .array('entryTypes', { type: 'string' }, 'PerformanceObserver entry types to observe')
      .number('durationMs', 'Collection window in ms (live entries after buffered scan)', {
        default: 5000,
        minimum: 100,
      })
      .boolean('buffered', 'Include entries buffered before the observer was created', {
        default: true,
      })
      .required('entryTypes')
      .query(),
  ),
  tool('browser_resource_timing', (t) =>
    t
      .desc(
        'Atomic primitive: read Resource Timing API entries for the active page and decompose ' +
          'each resource into dns / connect / tls / ttfb / download phases plus transfer and ' +
          'body sizes. Optionally include Server-Timing headers and filter by URL substring. ' +
          'A read-only snapshot — no observers or listeners are installed.',
      )
      .string('urlPattern', 'Case-insensitive URL substring filter (empty = all resources)')
      .boolean('includeServerTiming', 'Include Server-Timing entries (entry.serverTiming)', {
        default: false,
      })
      .number('limit', 'Max resources to return', { default: 50, minimum: 1, maximum: 1000 })
      .query(),
  ),
  tool('browser_cdp_performance_metrics', (t) =>
    t
      .desc(
        'Atomic primitive: fetch browser runtime metrics via CDP Performance.getMetrics() on ' +
          'the active page. Returns raw CDP-level counters (LayoutCount, RecalcStyleCount, ' +
          'ScriptDuration, TaskDuration, JSHeapUsedSize, Nodes, Documents, Frames, ...) — ' +
          'not Web Vitals (use network domain performance_get_metrics for those).',
      )
      .query(),
  ),
  tool('v8_type_profile', (t) =>
    t
      .desc(
        'Atomic primitive: start or stop V8 type profiling via CDP ' +
          'Profiler.startTypeProfile() / takeTypeProfile() / stopTypeProfile(). ' +
          'Type profiles record the runtime types flowing through each function entry ' +
          '(type:Array, type:Object, type:number, ...) — the raw material for deobfuscating ' +
          'VM dispatchers or polymorphic call sites. action="stop" returns per-script entries ' +
          'and optionally persists the raw profile to a JSON artifact (artifacts/profiles/).',
      )
      .enum('action', ['start', 'stop'], 'Action')
      .string(
        'artifactPath',
        'Write the raw profile JSON to this path on stop (auto path when omitted)',
      )
      .number('topN', 'Top N function entries per script in the summary', {
        default: 20,
        minimum: 1,
      })
      .required('action')
      .query(),
  ),
];
