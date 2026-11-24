import type { CodeCollector } from '@modules/collector/CodeCollector';
import { evaluateWithTimeout } from '@modules/collector/PageController';
import { createCDPSessionWithTimeout } from '@modules/monitor/cdp-utils';
import { logger } from '@utils/logger';
import type {
  PerformanceMetrics,
  PerformanceTimelineEntry,
  LargestContentfulPaintEntryLike,
  LayoutShiftEntryLike,
  PerformanceWithMemory,
} from './PerformanceMonitor.types';

export async function getPerformanceMetrics(collector: CodeCollector): Promise<PerformanceMetrics> {
  const page = await collector.getActivePage();

  // CDP engine-level metrics — cross-origin aggregate counters that in-page
  // performance.getEntriesByType() cannot see (it is origin-scoped). Best-effort:
  // when CDP is unavailable we fall back to in-page entries only.
  const cdpMetrics: Record<string, number> = {};
  try {
    // createCDPSession() can hang; the shared helper fails fast and detaches
    // any late-resolving orphan session.
    const cdp = await createCDPSessionWithTimeout(page);
    try {
      await cdp.send('Performance.enable');
      const raw = (await cdp.send('Performance.getMetrics')) as {
        metrics?: Array<{ name?: unknown; value?: unknown }>;
      };
      const rawMetrics = Array.isArray(raw?.metrics) ? raw.metrics : [];
      for (const metric of rawMetrics) {
        if (metric && typeof metric.name === 'string' && typeof metric.value === 'number') {
          cdpMetrics[metric.name] = metric.value;
        }
      }
    } finally {
      await cdp.send('Performance.disable').catch(() => {});
      await cdp.detach().catch(() => {});
    }
  } catch (err) {
    logger.warn('CDP Performance.getMetrics unavailable, using in-page entries only', err);
  }

  const metrics = (await evaluateWithTimeout(page, () => {
    const result: Partial<PerformanceMetrics> = {};

    const navTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navTiming) {
      result.domContentLoaded = navTiming.domContentLoadedEventEnd - navTiming.fetchStart;
      result.loadComplete = navTiming.loadEventEnd - navTiming.fetchStart;
      // requestStart of 0 means the timing is unavailable — null, not a
      // meaningless (or negative) delta.
      result.ttfb =
        navTiming.requestStart > 0 ? navTiming.responseStart - navTiming.requestStart : null;
      result.transferSize = navTiming.transferSize;
      result.encodedBodySize = navTiming.encodedBodySize;
      result.decodedBodySize = navTiming.decodedBodySize;
    }

    const paintEntries = performance.getEntriesByType('paint');
    const fcpEntry = paintEntries.find((entry) => entry.name === 'first-contentful-paint');
    if (fcpEntry) {
      result.fcp = fcpEntry.startTime;
    }

    const lcpEntries = performance.getEntriesByType(
      'largest-contentful-paint',
    ) as LargestContentfulPaintEntryLike[];
    const lastLCP = lcpEntries.at(-1);
    if (lastLCP) {
      result.lcp = lastLCP.renderTime || lastLCP.loadTime;
    }

    let clsValue = 0;
    const layoutShiftEntries = performance.getEntriesByType(
      'layout-shift',
    ) as LayoutShiftEntryLike[];
    for (const entry of layoutShiftEntries) {
      if (!entry.hadRecentInput) {
        clsValue += entry.value ?? 0;
      }
    }
    result.cls = clsValue;

    const performanceWithMemory = performance as PerformanceWithMemory;
    if (performanceWithMemory.memory) {
      const memory = performanceWithMemory.memory;
      result.jsHeapSizeLimit = memory.jsHeapSizeLimit;
      result.totalJSHeapSize = memory.totalJSHeapSize;
      result.usedJSHeapSize = memory.usedJSHeapSize;
    }

    return result as PerformanceMetrics;
  })) as PerformanceMetrics;

  // Merge engine-level counters; CDP heap numbers take precedence over the
  // Chrome-only performance.memory fallback when both are present.
  metrics.scriptDuration = cdpMetrics.ScriptDuration;
  metrics.layoutDuration = cdpMetrics.LayoutDuration;
  metrics.recalcStyleDuration = cdpMetrics.RecalcStyleDuration;
  if (cdpMetrics.JSHeapUsedSize !== undefined) metrics.usedJSHeapSize = cdpMetrics.JSHeapUsedSize;
  if (cdpMetrics.JSHeapTotalSize !== undefined)
    metrics.totalJSHeapSize = cdpMetrics.JSHeapTotalSize;
  if (cdpMetrics.JSHeapSizeLimit !== undefined)
    metrics.jsHeapSizeLimit = cdpMetrics.JSHeapSizeLimit;

  logger.info('Performance metrics collected', {
    fcp: metrics.fcp,
    lcp: metrics.lcp,
    cls: metrics.cls,
  });

  return metrics;
}

export async function getPerformanceTimeline(
  collector: CodeCollector,
  maxEntries = 500,
): Promise<PerformanceTimelineEntry[]> {
  const page = await collector.getActivePage();

  const timeline = await evaluateWithTimeout(page, () => {
    return performance.getEntries().map((entry) => ({
      name: entry.name,
      entryType: entry.entryType,
      startTime: entry.startTime,
      duration: entry.duration,
    }));
  });

  if (timeline.length > maxEntries) {
    logger.warn(
      `Performance timeline truncated from ${timeline.length} to ${maxEntries} entries (most recent)`,
    );
    return timeline.slice(-maxEntries);
  }

  logger.info(`Performance timeline collected: ${timeline.length} entries`);
  return timeline;
}
