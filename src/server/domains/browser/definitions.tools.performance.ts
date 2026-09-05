import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

/**
 * Atomic performance primitives (P0 + Phase 2).
 *
 * Each tool is a single CDP / Web API primitive — no pipeline orchestration:
 * - browser_performance_observer     → in-page PerformanceObserver subscription
 * - browser_resource_timing          → Resource Timing API decomposition
 * - browser_cdp_performance_metrics  → CDP Performance.getMetrics()
 * - v8_type_profile                  → CDP Profiler type profile (start/stop)
 * - browser_get_metrics              → Web Vitals + memory + engine counters
 * - browser_trace_start / _stop      → Chrome performance trace (split pair)
 * - browser_cpu_profile_start / _stop → CDP CPU profiling (split pair)
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
          'not Web Vitals (use browser_get_metrics for those).',
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
  // ── Phase 2: split action-enum tools + migrated perf metrics ──
  tool('browser_get_metrics', (t) =>
    t
      .desc(
        'Atomic primitive: collect page performance metrics via PerformanceMonitor — ' +
          'Web Vitals (FCP, LCP, CLS, TTFB), DOM timing (domContentLoaded, loadComplete), ' +
          'engine-level counters (scriptDuration, layoutDuration, recalcStyleDuration) and ' +
          'JS heap sizes (usedJSHeapSize / totalJSHeapSize / jsHeapSizeLimit). ' +
          'Optionally include the raw performance timeline entries. Replaces the legacy ' +
          'network-domain performance_get_metrics (still working as a backward-compat alias).',
      )
      .boolean('includeTimeline', 'Include raw performance timeline entries', {
        default: false,
      })
      .query(),
  ),
  tool('browser_trace_start', (t) =>
    t
      .desc(
        'Atomic primitive: begin a Chrome performance trace on the active page via ' +
          'page.tracing.start(). Pair with browser_trace_stop to save the trace to disk. ' +
          'Use a sensible categories list when you have a specific hypothesis (e.g. ' +
          '["devtools.timeline","v8.execute","blink.user_timing"]); the default set covers ' +
          'most profiling needs.',
      )
      .array('categories', { type: 'string' }, 'Trace categories to capture (omit = default set)')
      .boolean('screenshots', 'Capture screenshots during tracing', { default: false }),
  ),
  tool('browser_trace_stop', (t) =>
    t
      .desc(
        'Atomic primitive: stop the Chrome performance trace started by browser_trace_start ' +
          'and persist it to artifacts/traces/ (or to a custom path). Returns event count, ' +
          'file size, and a Chrome DevTools hint. Fails clearly if tracing was never started ' +
          'or has already been stopped.',
      )
      .string('artifactPath', 'Custom output path (omit = auto path under artifacts/traces/)')
      .query(),
  ),
  tool('browser_cpu_profile_start', (t) =>
    t
      .desc(
        'Atomic primitive: begin CDP CPU profiling on the active page (Profiler.start). ' +
          'Pair with browser_cpu_profile_stop to save the .cpuprofile. Set samplingInterval ' +
          'to 30-100 µs for high-resolution profiles (default 1000 µs / 1 ms).',
      )
      .number(
        'samplingInterval',
        'Sampling interval in microseconds. Default: 1000 (1ms). 30-100 for high-res. Range: 30-10000',
        { minimum: 30, maximum: 10000 },
      ),
  ),
  tool('browser_cpu_profile_stop', (t) =>
    t
      .desc(
        'Atomic primitive: stop CDP CPU profiling, rank hot functions by sample count, ' +
          'and persist the raw profile to artifacts/profiles/ (or a custom path). The hot ' +
          'function list is derived from the samples array — modern Chrome profiles do not ' +
          'populate hitCount. Fails clearly if profiling was never started.',
      )
      .string('artifactPath', 'Custom output path (omit = auto path under artifacts/profiles/)')
      .number('topN', 'Cap the hot-functions list to N entries (default 20)', {
        default: 20,
        minimum: 1,
      })
      .query(),
  ),
];
