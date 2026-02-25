import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../collector/CodeCollector.js';
import { logger } from '../../utils/logger.js';

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

    cdp.on('HeapProfiler.addHeapSnapshotChunk', (params: any) => {
      snapshotData += params.chunk;
    });

    await cdp.send('HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      treatGlobalObjectsAsRoots: true,
    });

    await cdp.send('HeapProfiler.disable');

    logger.success('Heap snapshot taken', {
      size: snapshotData.length,
    });

    return snapshotData;
  }

  async close(): Promise<void> {
    if (this.cdpSession) {
      if (this.coverageEnabled) {
        await this.stopCoverage();
      }
      if (this.profilerEnabled) {
        await this.stopCPUProfiling();
      }
      await this.cdpSession.detach();
      this.cdpSession = null;
    }
    logger.info('PerformanceMonitor closed');
  }
}
