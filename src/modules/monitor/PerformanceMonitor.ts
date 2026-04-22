import type { CDPSession, Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { writeFile } from 'node:fs/promises';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { logger } from '@utils/logger';
import {
  evaluateWithTimeout,
  coverageStartJSWithTimeout,
  coverageStartCSSWithTimeout,
  coverageStopJSWithTimeout,
  coverageStopCSSWithTimeout,
} from '@modules/collector/PageController';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { cdpLimit } from '@utils/concurrency';
import { resolveArtifactPath } from '@utils/artifacts';

export interface PerformanceMetrics {
  fcp?: number;
  lcp?: number;
  fid?: number;
  cls?: number;
  ttfb?: number;

  domContentLoaded?: number;
  loadComplete?: number;

  scriptDuration?: number;
  layoutDuration?: number;
  recalcStyleDuration?: number;

  jsHeapSizeLimit?: number;
  totalJSHeapSize?: number;
  usedJSHeapSize?: number;
}

export interface CoverageInfo {
  url: string;
  ranges: Array<{
    start: number;
    end: number;
    count: number;
  }>;
  text?: string;
  totalBytes: number;
  usedBytes: number;
  coveragePercentage: number;
}

export interface CPUProfile {
  nodes: Array<{
    id: number;
    callFrame: {
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    };
    hitCount?: number;
    children?: number[];
  }>;
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

interface LargestContentfulPaintEntryLike extends PerformanceEntry {
  renderTime?: number;
  loadTime?: number;
}

interface LayoutShiftEntryLike extends PerformanceEntry {
  hadRecentInput?: boolean;
  value?: number;
}

interface PerformanceMemoryLike {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemoryLike;
}

interface PerformanceTimelineEntry {
  name: string;
  entryType: string;
  startTime: number;
  duration: number;
}

interface CDPHeapSnapshotChunkPayload {
  chunk: string;
}

interface CDPHeapSamplingNode {
  callFrame?: {
    functionName?: string;
    url?: string;
  };
  selfSize?: number;
  children?: CDPHeapSamplingNode[];
}

interface CDPHeapSamplingProfile {
  head: CDPHeapSamplingNode;
}

interface CDPHeapSamplingPayload {
  profile: CDPHeapSamplingProfile;
}

interface HeapAllocationSummary {
  functionName: string;
  url: string;
  selfSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCDPHeapSnapshotChunkPayload(value: unknown): value is CDPHeapSnapshotChunkPayload {
  return isRecord(value) && typeof value.chunk === 'string';
}

function isCDPHeapSamplingNode(value: unknown): value is CDPHeapSamplingNode {
  if (!isRecord(value)) {
    return false;
  }
  const { callFrame, selfSize, children } = value;
  if (callFrame !== undefined) {
    if (!isRecord(callFrame)) {
      return false;
    }
    if (callFrame.functionName !== undefined && typeof callFrame.functionName !== 'string') {
      return false;
    }
    if (callFrame.url !== undefined && typeof callFrame.url !== 'string') {
      return false;
    }
  }
  if (selfSize !== undefined && typeof selfSize !== 'number') {
    return false;
  }
  if (children !== undefined && !Array.isArray(children)) {
    return false;
  }
  return true;
}

function isCDPHeapSamplingPayload(value: unknown): value is CDPHeapSamplingPayload {
  return isRecord(value) && isRecord(value.profile) && isCDPHeapSamplingNode(value.profile.head);
}

async function yieldToEventLoop(): Promise<void> {
  await waitForImmediate();
}

function countTraceEvents(traceData: string): number {
  const eventPattern = /"ph"\s*:/g;
  let count = 0;
  while (eventPattern.exec(traceData) !== null) {
    count++;
  }
  return count;
}

function insertTopAllocation(
  topAllocations: HeapAllocationSummary[],
  candidate: HeapAllocationSummary,
  topN: number,
): void {
  if (topN <= 0) {
    return;
  }

  if (
    topAllocations.length === topN &&
    candidate.selfSize <= topAllocations[topAllocations.length - 1]!.selfSize
  ) {
    return;
  }

  let insertIndex = topAllocations.findIndex((entry) => candidate.selfSize > entry.selfSize);
  if (insertIndex === -1) {
    insertIndex = topAllocations.length;
  }
  topAllocations.splice(insertIndex, 0, candidate);

  if (topAllocations.length > topN) {
    topAllocations.length = topN;
  }
}

function collectTopHeapAllocations(
  root: CDPHeapSamplingNode,
  topN: number,
): { sampleCount: number; topAllocations: HeapAllocationSummary[] } {
  const stack: CDPHeapSamplingNode[] = [root];
  const topAllocations: HeapAllocationSummary[] = [];
  let sampleCount = 0;

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    if (node.callFrame) {
      sampleCount++;
      insertTopAllocation(
        topAllocations,
        {
          functionName: node.callFrame.functionName || '(anonymous)',
          url: node.callFrame.url || '',
          selfSize: node.selfSize || 0,
        },
        topN,
      );
    }

    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (child) {
          stack.push(child);
        }
      }
    }
  }

  return { sampleCount, topAllocations };
}

async function PING(cdp: CDPSession): Promise<void> {
  await Promise.race([
    cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('cdp_unreachable')), 500)),
  ]);
}

export class PerformanceMonitor {
  private cdpSession: CDPSession | null = null;
  private coverageEnabled = false;
  private profilerEnabled = false;
  private tracingEnabled = false;
  private heapSamplingEnabled = false;
  private coveragePage: Page | null = null;
  private tracingPage: Page | null = null;

  constructor(private collector: CodeCollector) {}

  private async ensureCDPSession(): Promise<CDPSession> {
    if (!this.cdpSession) {
      const page = await this.collector.getActivePage();
      // Wrap session creation so a hanging createCDPSession() cannot block.
      this.cdpSession = await Promise.race([
        page.createCDPSession() as Promise<CDPSession>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('cdp_session_timeout')), 500),
        ),
      ]);
      return this.cdpSession;
    }

    // Pre-flight: verify the existing CDP session is still responsive.
    // After debugger pause/resume, the session may be in a zombie state where
    // send() hangs indefinitely without firing 'disconnected'.
    try {
      await PING(this.cdpSession);
      return this.cdpSession;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'cdp_unreachable') throw err;
      logger.warn('PerformanceMonitor CDP session unresponsive, recreating...');
      try {
        await this.cdpSession.detach();
      } catch {
        /* ignore */
      }
      this.cdpSession = null;
      const page = await this.collector.getActivePage();
      this.cdpSession = await Promise.race([
        page.createCDPSession() as Promise<CDPSession>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('cdp_session_timeout')), 500),
        ),
      ]);
      return this.cdpSession;
    }
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const page = await this.collector.getActivePage();

    const metrics = (await evaluateWithTimeout(page, () => {
      const result: Partial<PerformanceMetrics> = {};

      const navTiming = performance.getEntriesByType(
        'navigation',
      )[0] as PerformanceNavigationTiming;
      if (navTiming) {
        result.domContentLoaded = navTiming.domContentLoadedEventEnd - navTiming.fetchStart;
        result.loadComplete = navTiming.loadEventEnd - navTiming.fetchStart;
        result.ttfb = navTiming.responseStart - navTiming.requestStart;
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

    logger.info('Performance metrics collected', {
      fcp: metrics.fcp,
      lcp: metrics.lcp,
      cls: metrics.cls,
    });

    return metrics;
  }

  async getPerformanceTimeline(): Promise<PerformanceTimelineEntry[]> {
    const page = await this.collector.getActivePage();

    const timeline = await evaluateWithTimeout(page, () => {
      return performance.getEntries().map((entry) => ({
        name: entry.name,
        entryType: entry.entryType,
        startTime: entry.startTime,
        duration: entry.duration,
      }));
    });

    logger.info(`Performance timeline collected: ${timeline.length} entries`);
    return timeline;
  }

  async startCoverage(options?: {
    resetOnNavigation?: boolean;
    reportAnonymousScripts?: boolean;
  }): Promise<void> {
    const page = await this.collector.getActivePage();
    await Promise.all([
      coverageStartJSWithTimeout(page, {
        resetOnNavigation: options?.resetOnNavigation,
        reportAnonymousScripts: options?.reportAnonymousScripts,
      }),
      coverageStartCSSWithTimeout(page, {
        resetOnNavigation: options?.resetOnNavigation,
      }),
    ]);

    this.coverageEnabled = true;
    this.coveragePage = page;
    logger.info('Code coverage collection started');
  }

  async stopCoverage(): Promise<CoverageInfo[]> {
    if (!this.coverageEnabled) {
      throw new PrerequisiteError('Coverage not enabled. Call startCoverage() first.');
    }

    const page = this.coveragePage ?? (await this.collector.getActivePage());
    const [jsCoverageResult, cssCoverageResult] = await Promise.all([
      coverageStopJSWithTimeout(page),
      coverageStopCSSWithTimeout(page),
    ]);

    const jsCoverage = jsCoverageResult as Array<{
      text: string;
      url: string;
      ranges: Array<{ start: number; end: number }>;
    }>;
    const cssCoverage = cssCoverageResult as Array<{
      text: string;
      url: string;
      ranges: Array<{ start: number; end: number }>;
    }>;

    this.coverageEnabled = false;
    this.coveragePage = null;

    const coverageEntries = [...jsCoverage, ...cssCoverage];
    const coverageInfo: CoverageInfo[] = coverageEntries.map((entry) => {
      const totalBytes = entry.text.length;
      const usedBytes = entry.ranges.reduce((sum, range) => sum + (range.end - range.start), 0);

      return {
        url: entry.url,
        text: entry.text,
        ranges: entry.ranges.map((range) => ({
          start: range.start,
          end: range.end,
          count: 1,
        })),
        totalBytes,
        usedBytes,
        coveragePercentage: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
      };
    });

    logger.success(`Code coverage collected: ${coverageInfo.length} scripts`, {
      totalScripts: coverageInfo.length,
      avgCoverage:
        coverageInfo.reduce((sum, info) => sum + info.coveragePercentage, 0) / coverageInfo.length,
    });

    return coverageInfo;
  }

  async startCPUProfiling(): Promise<void> {
    const cdp = await this.ensureCDPSession();

    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');

    this.profilerEnabled = true;
    logger.info('CPU profiling started');
  }

  async stopCPUProfiling(): Promise<CPUProfile> {
    if (!this.profilerEnabled) {
      throw new PrerequisiteError('CPU profiling not enabled. Call startCPUProfiling() first.');
    }

    const cdp = await this.ensureCDPSession();

    const { profile } = await cdp.send('Profiler.stop');
    await cdp.send('Profiler.disable');

    this.profilerEnabled = false;

    logger.success('CPU profiling stopped', {
      nodes: profile.nodes.length,
      samples: profile.samples?.length || 0,
    });

    return profile;
  }

  async takeHeapSnapshot(): Promise<number> {
    const cdp = await this.ensureCDPSession();

    await cdp.send('HeapProfiler.enable');

    let snapshotSize = 0;

    // Use a named handler so we can reliably remove it after the snapshot
    const chunkHandler = (params: unknown) => {
      if (!isCDPHeapSnapshotChunkPayload(params)) {
        return;
      }
      snapshotSize += params.chunk.length;
    };

    cdp.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler);

    try {
      await cdp.send('HeapProfiler.takeHeapSnapshot', {
        reportProgress: false,
        treatGlobalObjectsAsRoots: true,
      });
    } finally {
      // Always remove the listener to prevent accumulation across repeated calls
      cdp.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
      await cdp.send('HeapProfiler.disable').catch(() => {});
    }

    logger.success('Heap snapshot taken', {
      size: snapshotSize,
    });

    return snapshotSize;
  }

  // ── CDP Tracing (Performance Trace) ──────────────────────────

  async startTracing(options?: { categories?: string[]; screenshots?: boolean }): Promise<void> {
    return cdpLimit(async () => {
      if (this.tracingEnabled) {
        throw new Error('Tracing already in progress. Call stopTracing() first.');
      }

      const page = await this.collector.getActivePage();
      const categories = options?.categories ?? [
        '-*',
        'devtools.timeline',
        'v8.execute',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
        'toplevel',
        'blink.console',
        'blink.user_timing',
        'latencyInfo',
        ...(options?.screenshots ? ['disabled-by-default-devtools.screenshot'] : []),
      ];

      await page.tracing.start({
        categories,
        screenshots: options?.screenshots,
      });

      this.tracingEnabled = true;
      this.tracingPage = page;
      logger.info('Performance tracing started', { categories: categories.length });
    });
  }

  async stopTracing(options?: {
    artifactPath?: string;
  }): Promise<{ artifactPath?: string; eventCount: number; sizeBytes: number }> {
    return cdpLimit(async () => {
      if (!this.tracingEnabled) {
        throw new PrerequisiteError('Tracing not in progress. Call startTracing() first.');
      }

      const page = this.tracingPage ?? (await this.collector.getActivePage());
      const traceBuffer = await page.tracing.stop();
      const traceData = traceBuffer ? Buffer.from(traceBuffer).toString('utf-8') : '';

      this.tracingEnabled = false;
      this.tracingPage = null;

      // Counting markers is much cheaper than materializing a large trace JSON object.
      const eventCount = countTraceEvents(traceData);

      // Save to artifact file
      let savedPath: string | undefined;
      if (options?.artifactPath) {
        await writeFile(options.artifactPath, traceData, 'utf-8');
        savedPath = options.artifactPath;
      } else {
        const { absolutePath, displayPath } = await resolveArtifactPath({
          category: 'traces',
          toolName: 'performance-trace',
          ext: 'json',
        });
        await writeFile(absolutePath, traceData, 'utf-8');
        savedPath = displayPath;
      }

      logger.success('Performance trace saved', {
        eventCount,
        sizeBytes: traceData.length,
        path: savedPath,
      });

      return {
        artifactPath: savedPath,
        eventCount,
        sizeBytes: traceData.length,
      };
    });
  }

  // ── Heap Sampling Profiler ──────────────────────────────────

  async startHeapSampling(options?: { samplingInterval?: number }): Promise<void> {
    return cdpLimit(async () => {
      if (this.heapSamplingEnabled) {
        throw new Error('Heap sampling already in progress. Call stopHeapSampling() first.');
      }

      const cdp = await this.ensureCDPSession();

      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.startSampling', {
        samplingInterval: options?.samplingInterval ?? 32768,
      });

      this.heapSamplingEnabled = true;
      logger.info('Heap sampling profiler started');
    });
  }

  async stopHeapSampling(options?: { artifactPath?: string; topN?: number }): Promise<{
    artifactPath?: string;
    sampleCount: number;
    topAllocations: Array<{ functionName: string; url: string; selfSize: number }>;
  }> {
    return cdpLimit(async () => {
      if (!this.heapSamplingEnabled) {
        throw new PrerequisiteError(
          'Heap sampling not in progress. Call startHeapSampling() first.',
        );
      }

      const cdp = await this.ensureCDPSession();

      const samplingPayload = (await cdp.send('HeapProfiler.stopSampling')) as unknown;
      if (!isCDPHeapSamplingPayload(samplingPayload)) {
        throw new Error('Unexpected HeapProfiler.stopSampling payload shape');
      }
      const { profile } = samplingPayload;
      await cdp.send('HeapProfiler.disable');

      this.heapSamplingEnabled = false;

      const topN = options?.topN ?? 20;
      await yieldToEventLoop();
      const { sampleCount, topAllocations } = collectTopHeapAllocations(profile.head, topN);

      // Save full profile in compact JSON to reduce serialization overhead.
      await yieldToEventLoop();
      const profileJson = JSON.stringify(profile);
      let savedPath: string | undefined;
      if (options?.artifactPath) {
        await writeFile(options.artifactPath, profileJson, 'utf-8');
        savedPath = options.artifactPath;
      } else {
        const { absolutePath, displayPath } = await resolveArtifactPath({
          category: 'profiles',
          toolName: 'heap-sampling',
          ext: 'json',
        });
        await writeFile(absolutePath, profileJson, 'utf-8');
        savedPath = displayPath;
      }

      logger.success('Heap sampling profile saved', { sampleCount, path: savedPath });

      return {
        artifactPath: savedPath,
        sampleCount,
        topAllocations,
      };
    });
  }

  async close(): Promise<void> {
    if (this.cdpSession) {
      if (this.coverageEnabled) {
        await this.stopCoverage().catch(() => {});
      }
      if (this.profilerEnabled) {
        await this.stopCPUProfiling().catch(() => {});
      }
      if (this.tracingEnabled) {
        await this.stopTracing().catch(() => {});
      }
      if (this.heapSamplingEnabled) {
        await this.stopHeapSampling().catch(() => {});
      }
      await this.cdpSession.detach();
      this.cdpSession = null;
    }
    logger.info('PerformanceMonitor closed');
  }
}
