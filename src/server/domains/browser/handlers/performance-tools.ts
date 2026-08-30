/**
 * P0: atomic performance primitives — browser_performance_observer,
 * browser_resource_timing, browser_cdp_performance_metrics, v8_type_profile.
 *
 * Phase 2 additions: browser_get_metrics, browser_trace_start/stop,
 * browser_cpu_profile_start/stop (split from network's action-enum tools).
 *
 * Each handler is a single CDP / Web API primitive (no pipeline orchestration):
 * - observer: in-page PerformanceObserver subscription (buffered + live)
 * - resource timing: read-only Resource Timing API snapshot
 * - cdp metrics: CDP Performance.getMetrics()
 * - type profile: CDP Profiler.startTypeProfile / takeTypeProfile / stopTypeProfile
 * - get_metrics / trace / cpu_profile: thin facade over @modules/monitor/PerformanceMonitor
 */

import { PerformanceMonitor } from '@modules/monitor/PerformanceMonitor';
import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringArray,
} from '@server/domains/shared/parse-args';
import { handleSafe, R } from '@server/domains/shared/ResponseBuilder';
import { logger } from '@utils/logger';
import { resolveArtifactPath } from '@utils/artifacts';
import { writeFile } from 'node:fs/promises';
import {
  buildHotFunctions,
  type CpuProfilePayload,
  toCpuProfilePayload,
} from '@server/domains/network/handlers.base.types';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import type { ToolResponse } from '@server/types';

// ── Shared structural guards (page abstraction: Puppeteer | Camoufox) ──

interface PerformanceToolsDeps {
  collector: {
    getActivePage(): Promise<unknown>;
  };
}

interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  detach(): Promise<void>;
}

interface CDPPageLike {
  createCDPSession(): Promise<CDPSessionLike>;
}

interface EvaluatePageLike {
  evaluate(pageFunction: unknown, ...args: unknown[]): Promise<unknown>;
}

interface TypeProfileEntry {
  offset: number;
  types: Array<{ name: string; count: number }>;
}

interface TypeProfileScript {
  scriptId: string;
  url: string;
  entries: TypeProfileEntry[];
}

// ── PerformanceMonitor facade (Phase 2) ──
//
// Both browser_get_metrics / browser_trace_* / browser_cpu_profile_* and the
// legacy network tools (performance_get_metrics / performance_trace /
// profiler_cpu) share the same underlying module. The browser facade owns a
// single lazy PerformanceMonitor instance per browser handler instance — the
// network domain owns its own; start/stop pairs must be issued from the same
// domain to see consistent state. resetPerformanceMonitorForTest clears the
// cached instance for isolation in forks-mode tests.
//
// We intentionally reuse the lighter `PerformanceToolsDeps` shape (only
// `getActivePage()` is needed at runtime — see PerformanceMonitor class) so
// test mocks can satisfy the dep with just `createCodeCollectorMock()`.

interface PerformanceMonitorDeps {
  collector: {
    getActivePage(): Promise<unknown>;
  };
}

let _performanceMonitor: PerformanceMonitor | null = null;

// Per-facade start/stop pairing state — the underlying PerformanceMonitor
// tracks this on its own instance, but vi.fn() mocks don't replicate that
// state machine. The wrapper owns the pairing invariants locally so the
// browser facade behaves identically under mocks and the real class.
let _tracingActive = false;
let _cpuProfilingActive = false;

function getPerformanceMonitor(collector: PerformanceMonitorDeps['collector']): PerformanceMonitor {
  if (!_performanceMonitor) {
    // Some test mocks use vi.fn(() => mockMethods) — vi.fn() returns an
    // arrow-function-shaped callable that throws "is not a constructor"
    // when invoked with `new`. Try `new` first (production / class-mock
    // path); fall back to a plain call when the target isn't constructable.
    try {
      _performanceMonitor = new PerformanceMonitor(collector as unknown as CodeCollector);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('not a constructor')) {
        throw err;
      }
      _performanceMonitor = (
        PerformanceMonitor as unknown as (c: typeof collector) => PerformanceMonitor
      )(collector);
    }
  }
  return _performanceMonitor;
}

export function resetPerformanceMonitorForTest(): void {
  _performanceMonitor = null;
  _tracingActive = false;
  _cpuProfilingActive = false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCDPPageLike(value: unknown): value is CDPPageLike {
  return isRecord(value) && typeof value.createCDPSession === 'function';
}

function isEvaluatePageLike(value: unknown): value is EvaluatePageLike {
  return isRecord(value) && typeof value.evaluate === 'function';
}

// ── Handlers ──

/** browser_performance_observer — PerformanceObserver subscription (buffered + live). */
export async function handleBrowserPerformanceObserver(
  deps: PerformanceToolsDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const entryTypes = argStringArray(args, 'entryTypes');
    const durationMs = argNumber(args, 'durationMs', 5000);
    const buffered = argBool(args, 'buffered', true);

    if (entryTypes.length === 0) {
      return R.fail('entryTypes is required — at least one PerformanceObserver entry type').build();
    }

    const page = await deps.collector.getActivePage();
    if (!isEvaluatePageLike(page)) {
      throw new Error('Active page does not support evaluate()');
    }

    // One observer per type — PerformanceObserver.observe() accepts a single entry type.
    // Unsupported entry types (or entry types disabled) are skipped silently.
    const entries = await page.evaluate(
      (
        types: string[],
        ms: number,
        bufferedFlag: boolean,
      ): Promise<Array<Record<string, unknown>>> =>
        new Promise((resolve) => {
          const collected: Array<Record<string, unknown>> = [];
          const observers: PerformanceObserver[] = [];
          for (const type of types) {
            try {
              const obs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                  collected.push(entry.toJSON() as Record<string, unknown>);
                }
              });
              obs.observe({ type, buffered: bufferedFlag });
              observers.push(obs);
            } catch {
              // Unsupported entry type — skip.
            }
          }
          setTimeout(() => {
            for (const obs of observers) {
              obs.disconnect();
            }
            resolve(collected);
          }, ms);
        }),
      entryTypes,
      durationMs,
      buffered,
    );

    return {
      success: true,
      entryTypes,
      durationMs,
      buffered,
      entryCount: (entries as unknown[]).length,
      entries,
    };
  });
}

/** browser_resource_timing — Resource Timing API decomposition snapshot. */
export async function handleBrowserResourceTiming(
  deps: PerformanceToolsDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const urlPattern = argString(args, 'urlPattern', '');
    const includeServerTiming = argBool(args, 'includeServerTiming', false);
    const limit = argNumber(args, 'limit', 50);

    const page = await deps.collector.getActivePage();
    if (!isEvaluatePageLike(page)) {
      throw new Error('Active page does not support evaluate()');
    }

    const resources = (await page.evaluate(
      (filterLower: string, withServerTiming: boolean): Array<Record<string, unknown>> => {
        const out: Array<Record<string, unknown>> = [];
        for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
          const name = String(e.name ?? '');
          if (filterLower && !name.toLowerCase().includes(filterLower)) {
            continue;
          }
          const row: Record<string, unknown> = {
            name,
            initiatorType: e.initiatorType,
            startTime: e.startTime,
            duration: e.duration,
            transferSize: e.transferSize,
            encodedBodySize: e.encodedBodySize,
            decodedBodySize: e.decodedBodySize,
            dns: e.domainLookupEnd - e.domainLookupStart,
            connect: e.connectEnd - e.connectStart,
            tls: e.secureConnectionStart > 0 ? e.connectEnd - e.secureConnectionStart : null,
            ttfb: e.responseStart - e.requestStart,
            download: e.responseEnd - e.responseStart,
          };
          if (withServerTiming && e.serverTiming) {
            row.serverTiming = e.serverTiming.map((s) => ({
              name: s.name,
              duration: s.duration,
              description: s.description,
            }));
          }
          out.push(row);
        }
        return out;
      },
      urlPattern.toLowerCase(),
      includeServerTiming,
    )) as Array<Record<string, unknown>>;

    const limited = resources.slice(0, limit);
    const timed = limited.filter((r) => typeof r.ttfb === 'number' && r.ttfb >= 0);

    return {
      success: true,
      totalResources: resources.length,
      returned: limited.length,
      truncated: resources.length > limit,
      urlFilter: urlPattern || null,
      includeServerTiming,
      totalTransferSize: limited.reduce(
        (s, r) => s + (typeof r.transferSize === 'number' ? (r.transferSize as number) : 0),
        0,
      ),
      avgTtfbMs:
        timed.length > 0
          ? Math.round(timed.reduce((s, r) => s + (r.ttfb as number), 0) / timed.length)
          : null,
      resources: limited,
    };
  });
}

/** browser_cdp_performance_metrics — CDP Performance.getMetrics(). */
export async function handleBrowserCdpPerformanceMetrics(
  deps: PerformanceToolsDeps,
  _args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const page = await deps.collector.getActivePage();
    if (!isCDPPageLike(page)) {
      throw new Error('Active page does not support CDP session creation');
    }

    const cdp = await page.createCDPSession();
    try {
      await cdp.send('Performance.enable');
      const result = await cdp.send<{ metrics?: Array<{ name: string; value: number }> }>(
        'Performance.getMetrics',
      );
      const metrics = result.metrics ?? [];
      const asObject: Record<string, number> = {};
      for (const m of metrics) {
        asObject[m.name] = m.value;
      }
      return { success: true, metricCount: metrics.length, metrics: asObject };
    } finally {
      await cdp.detach().catch(() => {
        // Session already detached — nothing to clean up.
      });
    }
  });
}

/** v8_type_profile — CDP Profiler type profiling (start / stop). */
export async function handleV8TypeProfile(
  deps: PerformanceToolsDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const action = argEnum(args, 'action', new Set(['start', 'stop'] as const));
    const artifactPath = argString(args, 'artifactPath', '');
    const topN = argNumber(args, 'topN', 20);

    const page = await deps.collector.getActivePage();
    if (!isCDPPageLike(page)) {
      throw new Error('Active page does not support CDP session creation');
    }

    const cdp = await page.createCDPSession();
    try {
      if (action === 'start') {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.startTypeProfile');
        return {
          success: true,
          action: 'started',
          message:
            'V8 type profiling started. Call v8_type_profile with action="stop" to collect results.',
        };
      }

      const profile = await cdp.send<{ scripts?: TypeProfileScript[] }>('Profiler.takeTypeProfile');
      await cdp.send('Profiler.stopTypeProfile');
      await cdp.send('Profiler.disable');

      const scripts = profile.scripts ?? [];
      const summaries = scripts.map((script) => ({
        scriptId: script.scriptId,
        url: script.url,
        entryCount: script.entries.length,
        totalTypes: script.entries.reduce((s, e) => s + e.types.length, 0),
        topEntries: [...script.entries]
          .map((e) => ({
            offset: e.offset,
            totalSamples: e.types.reduce((s, t) => s + t.count, 0),
            types: e.types,
          }))
          .toSorted((a, b) => b.totalSamples - a.totalSamples)
          .slice(0, topN),
      }));

      const result: Record<string, unknown> = {
        success: true,
        action: 'stopped',
        scriptCount: scripts.length,
        scripts: summaries,
      };

      if (artifactPath) {
        await writeFile(artifactPath, JSON.stringify(profile, null, 2), 'utf-8');
        result.artifactPath = artifactPath;
      } else {
        const { absolutePath, displayPath } = await resolveArtifactPath({
          category: 'profiles',
          toolName: 'type-profile',
          ext: 'json',
        });
        await writeFile(absolutePath, JSON.stringify(profile, null, 2), 'utf-8');
        result.artifactPath = displayPath;
      }

      return result;
    } finally {
      await cdp.detach().catch(() => {
        // Session already detached — nothing to clean up.
      });
    }
  });
}

// ── Phase 2: split action-enum tools into atomic start/stop pairs ──

/** browser_get_metrics — Web Vitals + memory + engine counters (no action enum). */
export async function handleBrowserGetMetrics(
  deps: PerformanceMonitorDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const includeTimeline = args['includeTimeline'] === true;
    const monitor = getPerformanceMonitor(deps.collector);
    const metrics = await monitor.getPerformanceMetrics();
    const result: Record<string, unknown> = { success: true, metrics };
    if (includeTimeline) {
      result['timeline'] = await monitor.getPerformanceTimeline();
    }
    return result;
  });
}

/** browser_trace_start — begin a Chrome performance trace. */
export async function handleBrowserTraceStart(
  deps: PerformanceMonitorDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    if (_tracingActive) {
      throw new Error('Tracing already in progress. Call browser_trace_stop first.');
    }
    const monitor = getPerformanceMonitor(deps.collector);
    const categories = argStringArray(args, 'categories');
    // Pass undefined (not false) when the agent didn't opt in, so the
    // PerformanceMonitor default-categories path picks the default set.
    const screenshots = args['screenshots'] === true ? true : undefined;
    await monitor.startTracing({
      categories: categories.length > 0 ? categories : undefined,
      screenshots,
    });
    _tracingActive = true;
    return {
      success: true,
      message: 'Performance tracing started. Call browser_trace_stop to save the trace.',
    };
  });
}

/** browser_trace_stop — finalize a Chrome performance trace and persist it. */
export async function handleBrowserTraceStop(
  deps: PerformanceMonitorDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    if (!_tracingActive) {
      throw new Error('Tracing not in progress. Call browser_trace_start first.');
    }
    const monitor = getPerformanceMonitor(deps.collector);
    const artifactPath = argString(args, 'artifactPath', '') || undefined;
    const result = await monitor.stopTracing({ artifactPath });
    _tracingActive = false;
    const out: Record<string, unknown> = {
      success: true,
      artifactPath: result.artifactPath,
      eventCount: result.eventCount,
      sizeBytes: result.sizeBytes,
      sizeKB: (result.sizeBytes / 1024).toFixed(1),
    };
    if (result.truncated) {
      out['truncated'] = true;
      out['originalSizeBytes'] = result.originalSizeBytes;
      out['hint'] =
        '⚠️ Trace was truncated (exceeded size limit). Open in Chrome DevTools may fail.';
    } else {
      out['hint'] = 'Open the trace file in Chrome DevTools → Performance tab → Load profile';
    }
    return out;
  });
}

/** browser_cpu_profile_start — begin CDP CPU profiling. */
export async function handleBrowserCpuProfileStart(
  deps: PerformanceMonitorDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    if (_cpuProfilingActive) {
      throw new Error('CPU profiling already in progress. Call browser_cpu_profile_stop first.');
    }
    const monitor = getPerformanceMonitor(deps.collector);
    const samplingInterval =
      typeof args['samplingInterval'] === 'number'
        ? (args['samplingInterval'] as number)
        : undefined;
    await monitor.startCPUProfiling({ samplingInterval });
    _cpuProfilingActive = true;
    return {
      success: true,
      message: 'CPU profiling started. Call browser_cpu_profile_stop to save the profile.',
    };
  });
}

/** browser_cpu_profile_stop — finalize CPU profiling, rank hot functions, persist .cpuprofile. */
export async function handleBrowserCpuProfileStop(
  deps: PerformanceMonitorDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    if (!_cpuProfilingActive) {
      throw new Error('CPU profiling not in progress. Call browser_cpu_profile_start first.');
    }
    const monitor = getPerformanceMonitor(deps.collector);
    const artifactPath = argString(args, 'artifactPath', '') || undefined;
    const topN = typeof args['topN'] === 'number' ? (args['topN'] as number) : undefined;

    const profileRaw = await monitor.stopCPUProfiling();
    _cpuProfilingActive = false;

    const profile: CpuProfilePayload =
      toCpuProfilePayload(profileRaw) || (profileRaw as CpuProfilePayload);

    const profileJson = JSON.stringify(profile, null, 2);
    let savedPath: string;
    if (artifactPath) {
      await writeFile(artifactPath, profileJson, 'utf-8');
      savedPath = artifactPath;
    } else {
      const { absolutePath, displayPath } = await resolveArtifactPath({
        category: 'profiles',
        toolName: 'cpu-profile',
        ext: 'cpuprofile',
      });
      await writeFile(absolutePath, profileJson, 'utf-8');
      savedPath = displayPath;
    }

    // buildHotFunctions is capped at 20; if the caller asks for fewer, slice
    // locally so the response stays bounded to the requested topN. Larger
    // requests get the 20-node ceiling (matches the existing network tool).
    const { hotFunctions: ranked, message } = buildHotFunctions(profile);
    const hotFunctions =
      topN !== undefined && topN >= 0 && topN < ranked.length ? ranked.slice(0, topN) : ranked;

    const out: Record<string, unknown> = {
      success: true,
      artifactPath: savedPath,
      totalNodes: profile.nodes.length,
      totalSamples: profile.samples?.length || 0,
      durationMs: profile.endTime - profile.startTime,
      hotFunctions,
      hint: 'Open the .cpuprofile file in Chrome DevTools → Performance tab',
    };
    if (message) out['message'] = message;
    logger.success('browser_cpu_profile_stop saved', {
      path: savedPath,
      hotCount: hotFunctions.length,
    });
    return out;
  });
}
