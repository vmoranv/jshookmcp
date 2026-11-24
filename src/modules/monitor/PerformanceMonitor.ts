import type { CDPSession, Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { logger } from '@utils/logger';
import { CDP_SESSION_TIMEOUT_MS } from '@src/constants';
import { createCDPSessionWithTimeout } from '@modules/monitor/cdp-utils';
import type {
  PerformanceMetrics,
  PerformanceTimelineEntry,
  CoverageInfo,
  CPUProfile,
} from './PerformanceMonitor.types';
import { getPerformanceMetrics, getPerformanceTimeline } from './PerformanceMonitor.metrics';
import { startCoverage, stopCoverage } from './PerformanceMonitor.coverage';
import {
  startCPUProfiling,
  stopCPUProfiling,
  startHeapSampling,
  stopHeapSampling,
} from './PerformanceMonitor.profiling';
import { startTracing, stopTracing } from './PerformanceMonitor.tracing';
import { takeHeapSnapshot } from './PerformanceMonitor.snapshot';

// Per-step cap for close() cleanup so a hung CDP call (e.g. on a zombie
// session) cannot block shutdown of the remaining collectors or the detach.
const CLEANUP_STEP_TIMEOUT_MS = 5_000;

async function PING(cdp: CDPSession): Promise<void> {
  await Promise.race([
    cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('cdp_unreachable')), CDP_SESSION_TIMEOUT_MS),
    ),
  ]);
}

export class PerformanceMonitor {
  private collector: CodeCollector;
  private cdpSession: CDPSession | null = null;
  private coverageEnabled = false;
  private profilerEnabled = false;
  private tracingEnabled = false;
  private heapSamplingEnabled = false;
  private coveragePage: Page | null = null;
  private tracingPage: Page | null = null;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  private async ensureCDPSession(): Promise<CDPSession> {
    if (!this.cdpSession) {
      const page = await this.collector.getActivePage();
      this.cdpSession = await createCDPSessionWithTimeout(page);
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
      this.cdpSession = await createCDPSessionWithTimeout(page);
      return this.cdpSession;
    }
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    return getPerformanceMetrics(this.collector);
  }

  async getPerformanceTimeline(maxEntries = 500): Promise<PerformanceTimelineEntry[]> {
    return getPerformanceTimeline(this.collector, maxEntries);
  }

  async startCoverage(options?: {
    resetOnNavigation?: boolean;
    reportAnonymousScripts?: boolean;
  }): Promise<void> {
    if (this.coverageEnabled) {
      throw new Error('Coverage already in progress');
    }
    const result = await startCoverage(this.collector, options);
    this.coverageEnabled = result.coverageEnabled;
    this.coveragePage = result.coveragePage;
  }

  async stopCoverage(): Promise<CoverageInfo[]> {
    const result = await stopCoverage(this.collector, this.coveragePage, this.coverageEnabled);
    this.coverageEnabled = false;
    this.coveragePage = null;
    return result;
  }

  async startCPUProfiling(options?: { samplingInterval?: number }): Promise<void> {
    if (this.profilerEnabled) {
      throw new Error('CPU profiling already in progress');
    }
    const cdp = await this.ensureCDPSession();
    const result = await startCPUProfiling(cdp, options);
    this.profilerEnabled = result.profilerEnabled;
  }

  async stopCPUProfiling(): Promise<CPUProfile> {
    try {
      const cdp = await this.ensureCDPSession();
      return await stopCPUProfiling(cdp, this.profilerEnabled);
    } finally {
      // Always reset state — a failed Profiler.stop must not leave
      // profilerEnabled=true forever, which would leak state and reject all
      // future startCPUProfiling calls.
      this.profilerEnabled = false;
    }
  }

  async takeHeapSnapshot(): Promise<number> {
    const cdp = await this.ensureCDPSession();
    return takeHeapSnapshot(cdp);
  }

  async startTracing(options?: { categories?: string[]; screenshots?: boolean }): Promise<void> {
    if (this.tracingEnabled) {
      throw new Error('Tracing already in progress');
    }
    const result = await startTracing(this.collector, this.tracingEnabled, options);
    this.tracingEnabled = result.tracingEnabled;
    this.tracingPage = result.tracingPage;
  }

  async stopTracing(options?: { artifactPath?: string; maxSizeMB?: number }): Promise<{
    artifactPath?: string;
    eventCount: number;
    sizeBytes: number;
    truncated?: boolean;
    originalSizeBytes?: number;
  }> {
    try {
      return await stopTracing(this.collector, this.tracingPage, this.tracingEnabled, options);
    } finally {
      // Always reset state — a failed stop (e.g. page.tracing.stop() rejecting)
      // must not leave tracingEnabled=true forever, which would deadlock all
      // future startTracing calls with "already in progress".
      this.tracingEnabled = false;
      this.tracingPage = null;
    }
  }

  async startHeapSampling(options?: { samplingInterval?: number }): Promise<void> {
    if (this.heapSamplingEnabled) {
      throw new Error('Heap sampling already in progress');
    }
    const cdp = await this.ensureCDPSession();
    const result = await startHeapSampling(cdp, this.heapSamplingEnabled, options);
    this.heapSamplingEnabled = result.heapSamplingEnabled;
  }

  async stopHeapSampling(options?: { artifactPath?: string; topN?: number }): Promise<{
    artifactPath?: string;
    sampleCount: number;
    topAllocations: Array<{ functionName: string; url: string; selfSize: number }>;
  }> {
    try {
      const cdp = await this.ensureCDPSession();
      const result = await stopHeapSampling(cdp, this.heapSamplingEnabled, options);
      return result;
    } finally {
      this.heapSamplingEnabled = false;
    }
  }

  async close(): Promise<void> {
    // LIFO cleanup — stop in reverse acquisition order (detach last, as the
    // features depend on the session). Each step is capped by a timeout so a
    // hung CDP call cannot block the remaining steps; failures are logged, not
    // swallowed. Coverage/tracing are page-scoped and may be active with no CDP
    // session, so the steps must run even when `cdpSession` is null.
    const steps: Array<[boolean, string, () => Promise<unknown>]> = [
      [this.heapSamplingEnabled, 'Stop heap sampling', () => this.stopHeapSampling()],
      [this.tracingEnabled, 'Stop tracing', () => this.stopTracing()],
      [this.profilerEnabled, 'Stop CPU profiling', () => this.stopCPUProfiling()],
      [this.coverageEnabled, 'Stop coverage', () => this.stopCoverage()],
    ];
    for (const [enabled, label, stop] of steps) {
      if (!enabled) continue;
      try {
        await Promise.race([
          stop(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out`)), CLEANUP_STEP_TIMEOUT_MS),
          ),
        ]);
      } catch (err) {
        logger.warn(`${label} failed:`, err);
      }
    }
    if (this.cdpSession) {
      await this.cdpSession.detach().catch((err) => logger.warn('Detach CDP session failed:', err));
      this.cdpSession = null;
    }
    logger.info('PerformanceMonitor closed');
  }
}
