import { createCodeCollectorMock, parseJson, NetworkRequestsResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeFileMock = vi.fn();
const resolveArtifactPathMock = vi.fn();

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: unknown) => payload,
    }),
  },
}));

vi.mock('@src/server/domains/shared/modules', () => ({
  PerformanceMonitor: vi.fn(),
  ConsoleMonitor: vi.fn(),
  CodeCollector: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  writeFile: (...args: any[]) => writeFileMock(...args),
}));

vi.mock('@src/utils/artifacts', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  resolveArtifactPath: (...args: any[]) => resolveArtifactPathMock(...args),
}));

import { AdvancedHandlersBase } from '@server/domains/network/handlers.base';



describe('AdvancedHandlersBase (performance)', () => {
  const performanceMonitorMethods = {
    getPerformanceMetrics: vi.fn(),
    getPerformanceTimeline: vi.fn(),
    startCoverage: vi.fn(),
    stopCoverage: vi.fn(),
    takeHeapSnapshot: vi.fn(),
    startTracing: vi.fn(),
    stopTracing: vi.fn(),
    startCPUProfiling: vi.fn(),
    stopCPUProfiling: vi.fn(),
    startHeapSampling: vi.fn(),
    stopHeapSampling: vi.fn(),
  };

  const collector = createCodeCollectorMock();
  const consoleMonitor = {
    isNetworkEnabled: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    getNetworkStatus: vi.fn(),
    getNetworkRequests: vi.fn(),
    getNetworkResponses: vi.fn(),
    getResponseBody: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;

  let handler: AdvancedHandlersBase;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new AdvancedHandlersBase(collector, consoleMonitor);
    // Inject the mock performance monitor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handler as any).performanceMonitor = performanceMonitorMethods;
  });

  // ---------- handlePerformanceGetMetrics ----------

  describe('handlePerformanceGetMetrics', () => {
    it('returns metrics without timeline by default', async () => {
      performanceMonitorMethods.getPerformanceMetrics.mockResolvedValue({
        fcp: 100,
        lcp: 250,
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceGetMetrics({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.metrics).toEqual({ fcp: 100, lcp: 250 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.timeline).toBeUndefined();
    });

    it('includes timeline when includeTimeline is true', async () => {
      performanceMonitorMethods.getPerformanceMetrics.mockResolvedValue({
        fcp: 50,
      });
      performanceMonitorMethods.getPerformanceTimeline.mockResolvedValue([
        { name: 'paint', startTime: 50 },
      ]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceGetMetrics({ includeTimeline: true }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.metrics).toEqual({ fcp: 50 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.timeline).toEqual([{ name: 'paint', startTime: 50 }]);
    });

    it('does not include timeline when includeTimeline is false', async () => {
      performanceMonitorMethods.getPerformanceMetrics.mockResolvedValue({});

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceGetMetrics({ includeTimeline: false }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.timeline).toBeUndefined();
      expect(performanceMonitorMethods.getPerformanceTimeline).not.toHaveBeenCalled();
    });
  });

  // ---------- handlePerformanceStartCoverage ----------

  describe('handlePerformanceStartCoverage', () => {
    it('starts coverage and returns success', async () => {
      performanceMonitorMethods.startCoverage.mockResolvedValue(undefined);

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceStartCoverage({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toContain('coverage collection started');
      expect(performanceMonitorMethods.startCoverage).toHaveBeenCalledOnce();
    });
  });

  // ---------- handlePerformanceStopCoverage ----------

  describe('handlePerformanceStopCoverage', () => {
    it('returns coverage report with average', async () => {
      performanceMonitorMethods.stopCoverage.mockResolvedValue([
        { url: 'a.js', coveragePercentage: 80 },
        { url: 'b.js', coveragePercentage: 60 },
      ]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceStopCoverage({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalScripts).toBe(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.avgCoverage).toBe(70);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.coverage).toHaveLength(2);
    });

    it('returns 0 average when no coverage data exists', async () => {
      performanceMonitorMethods.stopCoverage.mockResolvedValue([]);

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceStopCoverage({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalScripts).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.avgCoverage).toBe(0);
    });
  });

  // ---------- handlePerformanceTakeHeapSnapshot ----------

  describe('handlePerformanceTakeHeapSnapshot', () => {
    it('takes heap snapshot and returns size', async () => {
      performanceMonitorMethods.takeHeapSnapshot.mockResolvedValue('x'.repeat(1024));

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceTakeHeapSnapshot({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.snapshotSize).toBe(1024);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toContain('Heap snapshot taken');
    });
  });

  // ---------- handlePerformanceTraceStart ----------

  describe('handlePerformanceTraceStart', () => {
    it('starts tracing with default options', async () => {
      performanceMonitorMethods.startTracing.mockResolvedValue(undefined);

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceTraceStart({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toContain('tracing started');
      expect(performanceMonitorMethods.startTracing).toHaveBeenCalledWith({
        categories: undefined,
        screenshots: undefined,
      });
    });

    it('passes categories and screenshots options', async () => {
      performanceMonitorMethods.startTracing.mockResolvedValue(undefined);

      await handler.handlePerformanceTraceStart({
        categories: ['devtools.timeline', 'v8.execute'],
        screenshots: true,
      });
      expect(performanceMonitorMethods.startTracing).toHaveBeenCalledWith({
        categories: ['devtools.timeline', 'v8.execute'],
        screenshots: true,
      });
    });

    it('ignores non-array categories', async () => {
      performanceMonitorMethods.startTracing.mockResolvedValue(undefined);

      await handler.handlePerformanceTraceStart({ categories: 'not-array' });
      expect(performanceMonitorMethods.startTracing).toHaveBeenCalledWith({
        categories: undefined,
        screenshots: undefined,
      });
    });
  });

  // ---------- handlePerformanceTraceStop ----------

  describe('handlePerformanceTraceStop', () => {
    it('stops tracing and returns artifact info', async () => {
      performanceMonitorMethods.stopTracing.mockResolvedValue({
        artifactPath: '/tmp/trace.json',
        eventCount: 500,
        sizeBytes: 102400,
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handlePerformanceTraceStop({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.artifactPath).toBe('/tmp/trace.json');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.eventCount).toBe(500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.sizeBytes).toBe(102400);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.sizeKB).toBe('100.0');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hint).toContain('Chrome DevTools');
    });

    it('passes custom artifactPath to monitor', async () => {
      performanceMonitorMethods.stopTracing.mockResolvedValue({
        artifactPath: '/custom/path.json',
        eventCount: 10,
        sizeBytes: 1024,
      });

      await handler.handlePerformanceTraceStop({ artifactPath: '/custom/path.json' });
      expect(performanceMonitorMethods.stopTracing).toHaveBeenCalledWith({
        artifactPath: '/custom/path.json',
      });
    });
  });

  // ---------- handleProfilerCpuStart ----------

  describe('handleProfilerCpuStart', () => {
    it('starts CPU profiling and returns success', async () => {
      performanceMonitorMethods.startCPUProfiling.mockResolvedValue(undefined);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleProfilerCpuStart({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toContain('CPU profiling started');
    });
  });

  // ---------- handleProfilerCpuStop ----------

  describe('handleProfilerCpuStop', () => {
    it('stops profiling, saves to auto-resolved path, and returns hot functions', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [
          {
            hitCount: 100,
            callFrame: {
              functionName: 'hotFunc',
              url: 'script.js',
              lineNumber: 10,
            },
          },
          {
            hitCount: 50,
            callFrame: {
              functionName: 'warmFunc',
              url: 'script.js',
              lineNumber: 20,
            },
          },
          {
            hitCount: 0,
            callFrame: {
              functionName: 'coldFunc',
              url: 'script.js',
              lineNumber: 30,
            },
          },
        ],
        startTime: 1000,
        endTime: 2000,
        samples: [1, 2, 3],
      });

      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/profile.cpuprofile',
        displayPath: 'artifacts/profiles/cpu-profile.cpuprofile',
      });
      writeFileMock.mockResolvedValue(undefined);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleProfilerCpuStop({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.artifactPath).toBe('artifacts/profiles/cpu-profile.cpuprofile');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalNodes).toBe(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalSamples).toBe(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.durationMs).toBe(1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hotFunctions).toHaveLength(2); // coldFunc (hitCount=0) excluded
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hotFunctions[0].functionName).toBe('hotFunc');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hotFunctions[0].hitCount).toBe(100);
      expect(writeFileMock).toHaveBeenCalledWith(
        '/tmp/profile.cpuprofile',
        expect.any(String),
        'utf-8'
      );
    });

    it('saves to custom artifactPath when provided', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [],
        startTime: 0,
        endTime: 100,
      });
      writeFileMock.mockResolvedValue(undefined);

      const body = parseJson<NetworkRequestsResponse>(
        await handler.handleProfilerCpuStop({ artifactPath: '/custom/profile.cpuprofile' })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.artifactPath).toBe('/custom/profile.cpuprofile');
      expect(writeFileMock).toHaveBeenCalledWith(
        '/custom/profile.cpuprofile',
        expect.any(String),
        'utf-8'
      );
      expect(resolveArtifactPathMock).not.toHaveBeenCalled();
    });

    it('labels anonymous functions in hot functions list', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [
          {
            hitCount: 10,
            callFrame: {},
          },
        ],
        startTime: 0,
        endTime: 100,
      });
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/p.cpuprofile',
        displayPath: 'p.cpuprofile',
      });
      writeFileMock.mockResolvedValue(undefined);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleProfilerCpuStop({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hotFunctions[0].functionName).toBe('(anonymous)');
    });

    it('handles profile with no samples', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [],
        startTime: 0,
        endTime: 50,
      });
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/p.cpuprofile',
        displayPath: 'p.cpuprofile',
      });
      writeFileMock.mockResolvedValue(undefined);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleProfilerCpuStop({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.totalSamples).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hotFunctions).toHaveLength(0);
    });
  });

  // ---------- handleProfilerHeapSamplingStart ----------

  describe('handleProfilerHeapSamplingStart', () => {
    it('starts heap sampling with default options', async () => {
      performanceMonitorMethods.startHeapSampling.mockResolvedValue(undefined);

      const body = parseJson<NetworkRequestsResponse>(await handler.handleProfilerHeapSamplingStart({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.message).toContain('Heap sampling started');
      expect(performanceMonitorMethods.startHeapSampling).toHaveBeenCalledWith({
        samplingInterval: undefined,
      });
    });

    it('passes samplingInterval option', async () => {
      performanceMonitorMethods.startHeapSampling.mockResolvedValue(undefined);

      await handler.handleProfilerHeapSamplingStart({ samplingInterval: 16384 });
      expect(performanceMonitorMethods.startHeapSampling).toHaveBeenCalledWith({
        samplingInterval: 16384,
      });
    });

    it('ignores non-number samplingInterval', async () => {
      performanceMonitorMethods.startHeapSampling.mockResolvedValue(undefined);

      await handler.handleProfilerHeapSamplingStart({ samplingInterval: 'not-a-number' });
      expect(performanceMonitorMethods.startHeapSampling).toHaveBeenCalledWith({
        samplingInterval: undefined,
      });
    });
  });

  // ---------- handleProfilerHeapSamplingStop ----------

  describe('handleProfilerHeapSamplingStop', () => {
    it('stops heap sampling and returns results', async () => {
      performanceMonitorMethods.stopHeapSampling.mockResolvedValue({
        artifactPath: '/tmp/heap.json',
        sampleCount: 42,
        topAllocations: [{ functionName: 'allocator', size: 1024 }],
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleProfilerHeapSamplingStop({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.artifactPath).toBe('/tmp/heap.json');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.sampleCount).toBe(42);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.topAllocations).toHaveLength(1);
    });

    it('passes artifactPath and topN options', async () => {
      performanceMonitorMethods.stopHeapSampling.mockResolvedValue({
        artifactPath: '/custom/heap.json',
        sampleCount: 10,
        topAllocations: [],
      });

      await handler.handleProfilerHeapSamplingStop({
        artifactPath: '/custom/heap.json',
        topN: 5,
      });
      expect(performanceMonitorMethods.stopHeapSampling).toHaveBeenCalledWith({
        artifactPath: '/custom/heap.json',
        topN: 5,
      });
    });
  });
});
