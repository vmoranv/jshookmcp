import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../collector/CodeCollector.js';
import { writeFile } from 'node:fs/promises';
import { logger } from '../../utils/logger.js';
import { cdpLimit } from '../../utils/concurrency.js';
import { resolveArtifactPath } from '../../utils/artifacts.js';

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

export class PerformanceMonitor {
  private cdpSession: CDPSession | null = null;
  private coverageEnabled = false;
  private profilerEnabled = false;
  private tracingEnabled = false;
  private heapSamplingEnabled = false;

  constructor(private collector: CodeCollector) {}

  private async ensureCDPSession(): Promise<CDPSession> {
    if (!this.cdpSession) {
      const page = await this.collector.getActivePage();
      this.cdpSession = await page.createCDPSession();
    }
    return this.cdpSession;
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const page = await this.collector.getActivePage();

    const metrics = await page.evaluate(() => {
      const result: any = {};

      const navTiming = performance.getEntriesByType(
        'navigation'
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

      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries.length > 0) {
        const lastLCP = lcpEntries[lcpEntries.length - 1] as any;
        result.lcp = lastLCP.renderTime || lastLCP.loadTime;
      }

      let clsValue = 0;
      const layoutShiftEntries = performance.getEntriesByType('layout-shift') as any[];
      for (const entry of layoutShiftEntries) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
        }
      }
      result.cls = clsValue;

      if ((performance as any).memory) {
        const memory = (performance as any).memory;
        result.jsHeapSizeLimit = memory.jsHeapSizeLimit;
        result.totalJSHeapSize = memory.totalJSHeapSize;
        result.usedJSHeapSize = memory.usedJSHeapSize;
      }

      return result;
    });

    logger.info('Performance metrics collected', {
      fcp: metrics.fcp,
      lcp: metrics.lcp,
      cls: metrics.cls,
    });

    return metrics;
  }

  async getPerformanceTimeline(): Promise<any[]> {
    const page = await this.collector.getActivePage();

    const timeline = await page.evaluate(() => {
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
    const cdp = await this.ensureCDPSession();

    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', {
      callCount: true,
      detailed: true,
      allowTriggeredUpdates: false,
      ...options,
    });

    this.coverageEnabled = true;
    logger.info('Code coverage collection started');
  }

  async stopCoverage(): Promise<CoverageInfo[]> {
    if (!this.coverageEnabled) {
      throw new Error('Coverage not enabled. Call startCoverage() first.');
    }

    const cdp = await this.ensureCDPSession();

    const { result } = await cdp.send('Profiler.takePreciseCoverage');
    await cdp.send('Profiler.stopPreciseCoverage');
    await cdp.send('Profiler.disable');

    this.coverageEnabled = false;

    const coverageInfo: CoverageInfo[] = result.map((entry: any) => {
      const totalBytes = entry.functions.reduce((sum: number, func: any) => {
        return (
          sum +
          func.ranges.reduce((rangeSum: number, range: any) => {
            return rangeSum + (range.endOffset - range.startOffset);
          }, 0)
        );
      }, 0);

      const usedBytes = entry.functions.reduce((sum: number, func: any) => {
        return (
          sum +
          func.ranges.reduce((rangeSum: number, range: any) => {
            return range.count > 0 ? rangeSum + (range.endOffset - range.startOffset) : rangeSum;
          }, 0)
        );
      }, 0);

      return {
        url: entry.url,
        ranges: entry.functions.flatMap((func: any) =>
          func.ranges.map((range: any) => ({
            start: range.startOffset,
            end: range.endOffset,
            count: range.count,
          }))
        ),
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
      throw new Error('CPU profiling not enabled. Call startCPUProfiling() first.');
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

  async takeHeapSnapshot(): Promise<string> {
    const cdp = await this.ensureCDPSession();

    await cdp.send('HeapProfiler.enable');

    let snapshotData = '';

    // Use a named handler so we can reliably remove it after the snapshot
    const chunkHandler = (params: any) => {
      snapshotData += params.chunk;
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
      size: snapshotData.length,
    });

    return snapshotData;
  }

  // ── CDP Tracing (Performance Trace) ──────────────────────────

  async startTracing(options?: {
    categories?: string[];
    screenshots?: boolean;
  }): Promise<void> {
    return cdpLimit(async () => {
      if (this.tracingEnabled) {
        throw new Error('Tracing already in progress. Call stopTracing() first.');
      }

      const cdp = await this.ensureCDPSession();

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

      await cdp.send('Tracing.start', {
        traceConfig: {
          includedCategories: categories,
          excludedCategories: ['*'],
        },
        transferMode: 'ReturnAsStream',
      });

      this.tracingEnabled = true;
      logger.info('Performance tracing started', { categories: categories.length });
    });
  }

  async stopTracing(options?: {
    artifactPath?: string;
  }): Promise<{ artifactPath?: string; eventCount: number; sizeBytes: number }> {
    return cdpLimit(async () => {
      if (!this.tracingEnabled) {
        throw new Error('Tracing not in progress. Call startTracing() first.');
      }

      const cdp = await this.ensureCDPSession();

      const traceChunks: string[] = [];

      // End tracing and read stream
      await cdp.send('Tracing.end');

      // Wait for tracingComplete event with stream handle
      const completeEvent = await new Promise<any>((resolve) => {
        const handler = (params: any) => {
          cdp.off('Tracing.tracingComplete', handler);
          resolve(params);
        };
        cdp.on('Tracing.tracingComplete', handler);
      });

      // Read the stream if available
      let traceData = '';
      if (completeEvent.stream) {
        let eof = false;
        while (!eof) {
          const chunk: any = await cdp.send('IO.read', { handle: completeEvent.stream });
          traceData += chunk.data || '';
          eof = chunk.eof;
        }
        await cdp.send('IO.close', { handle: completeEvent.stream }).catch(() => {});
      } else {
        traceData = traceChunks.join('');
      }

      this.tracingEnabled = false;

      // Parse to count events
      let eventCount = 0;
      try {
        const parsed = JSON.parse(traceData);
        eventCount = Array.isArray(parsed) ? parsed.length : (parsed.traceEvents?.length ?? 0);
      } catch {
        eventCount = (traceData.match(/"ph":/g) || []).length;
      }

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

      logger.success('Performance trace saved', { eventCount, sizeBytes: traceData.length, path: savedPath });

      return {
        artifactPath: savedPath,
        eventCount,
        sizeBytes: traceData.length,
      };
    });
  }

  // ── Heap Sampling Profiler ──────────────────────────────────

  async startHeapSampling(options?: {
    samplingInterval?: number;
  }): Promise<void> {
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

  async stopHeapSampling(options?: {
    artifactPath?: string;
    topN?: number;
  }): Promise<{
    artifactPath?: string;
    sampleCount: number;
    topAllocations: Array<{ functionName: string; url: string; selfSize: number }>;
  }> {
    return cdpLimit(async () => {
      if (!this.heapSamplingEnabled) {
        throw new Error('Heap sampling not in progress. Call startHeapSampling() first.');
      }

      const cdp = await this.ensureCDPSession();

      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      await cdp.send('HeapProfiler.disable');

      this.heapSamplingEnabled = false;

      // Flatten the tree to find top allocations
      const topN = options?.topN ?? 20;
      const allNodes: Array<{ functionName: string; url: string; selfSize: number }> = [];

      function walkNodes(node: any): void {
        if (node.callFrame) {
          allNodes.push({
            functionName: node.callFrame.functionName || '(anonymous)',
            url: node.callFrame.url || '',
            selfSize: node.selfSize || 0,
          });
        }
        if (node.children) {
          for (const child of node.children) {
            walkNodes(child);
          }
        }
      }

      walkNodes(profile.head);
      allNodes.sort((a, b) => b.selfSize - a.selfSize);
      const topAllocations = allNodes.slice(0, topN);

      // Save full profile
      const profileJson = JSON.stringify(profile, null, 2);
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

      logger.success('Heap sampling profile saved', { sampleCount: allNodes.length, path: savedPath });

      return {
        artifactPath: savedPath,
        sampleCount: allNodes.length,
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
