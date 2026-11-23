import { createCodeCollectorMock, parseJson } from '@tests/server/domains/shared/mock-factories';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeFileMock = vi.fn();
const resolveArtifactPathMock = vi.fn();

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: any) => payload,
    }),
  },
}));

vi.mock('@modules/monitor/PerformanceMonitor', () => ({ PerformanceMonitor: vi.fn() }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, writeFile: (...args: any[]) => writeFileMock(...args) };
});

vi.mock('@src/utils/artifacts', () => ({
  resolveArtifactPath: (...args: any[]) => resolveArtifactPathMock(...args),
}));

import { PerformanceHandlers } from '@server/domains/network/handlers/performance-handlers';

// Coverage / heap-snapshot / heap-sampling paths were retired from the
// compositional PerformanceHandlers (superseded by page_coverage_*,
// v8_heap_snapshot_capture, v8_heap_sampling tools) and are intentionally
// not migrated here.

describe('PerformanceHandlers (composition, ex-runtime-performance)', () => {
  const performanceMonitorMethods = {
    getPerformanceMetrics: vi.fn(),
    getPerformanceTimeline: vi.fn(),
    startTracing: vi.fn(),
    stopTracing: vi.fn(),
    startCPUProfiling: vi.fn(),
    stopCPUProfiling: vi.fn(),
  };

  const collector = createCodeCollectorMock();

  let handler: PerformanceHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new PerformanceHandlers({
      collector: collector as any,
      getPerformanceMonitor: () => performanceMonitorMethods as any,
    });
  });

  // ---------- handlePerformanceGetMetrics ----------

  describe('handlePerformanceGetMetrics', () => {
    it('returns metrics without timeline by default', async () => {
      performanceMonitorMethods.getPerformanceMetrics.mockResolvedValue({
        fcp: 100,
        lcp: 250,
      });

      const body = parseJson<any>(await handler.handlePerformanceGetMetrics({}));
      expect(body.success).toBe(true);
      expect(body.metrics).toEqual({ fcp: 100, lcp: 250 });
      expect(body.timeline).toBeUndefined();
    });

    it('includes timeline when includeTimeline is true', async () => {
      performanceMonitorMethods.getPerformanceMetrics.mockResolvedValue({
        fcp: 50,
      });
      performanceMonitorMethods.getPerformanceTimeline.mockResolvedValue([
        { name: 'paint', startTime: 50 },
      ]);

      const body = parseJson<any>(
        await handler.handlePerformanceGetMetrics({ includeTimeline: true }),
      );
      expect(body.success).toBe(true);
      expect(body.metrics).toEqual({ fcp: 50 });
      expect(body.timeline).toEqual([{ name: 'paint', startTime: 50 }]);
    });

    it('does not include timeline when includeTimeline is false', async () => {
      performanceMonitorMethods.getPerformanceMetrics.mockResolvedValue({});

      const body = parseJson<any>(
        await handler.handlePerformanceGetMetrics({ includeTimeline: false }),
      );
      expect(body.timeline).toBeUndefined();
      expect(performanceMonitorMethods.getPerformanceTimeline).not.toHaveBeenCalled();
    });
  });

  // ---------- handlePerformanceTraceStart ----------

  describe('handlePerformanceTraceStart', () => {
    it('starts tracing with default options', async () => {
      performanceMonitorMethods.startTracing.mockResolvedValue(undefined);

      const body = parseJson<any>(await handler.handlePerformanceTraceStart({}));
      expect(body.success).toBe(true);
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

      const body = parseJson<any>(await handler.handlePerformanceTraceStop({}));
      expect(body.success).toBe(true);
      expect(body.artifactPath).toBe('/tmp/trace.json');
      expect(body.eventCount).toBe(500);
      expect(body.sizeBytes).toBe(102400);
      expect(body.sizeKB).toBe('100.0');
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

      const body = parseJson<any>(await handler.handleProfilerCpuStart({}));
      expect(body.success).toBe(true);
      expect(body.message).toContain('CPU profiling started');
    });

    it('passes samplingInterval to the monitor', async () => {
      performanceMonitorMethods.startCPUProfiling.mockResolvedValue(undefined);

      await handler.handleProfilerCpuStart({ samplingInterval: 500 });
      expect(performanceMonitorMethods.startCPUProfiling).toHaveBeenCalledWith({
        samplingInterval: 500,
      });
    });

    it('passes undefined samplingInterval when absent', async () => {
      performanceMonitorMethods.startCPUProfiling.mockResolvedValue(undefined);

      await handler.handleProfilerCpuStart({});
      expect(performanceMonitorMethods.startCPUProfiling).toHaveBeenCalledWith({
        samplingInterval: undefined,
      });
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

      const body = parseJson<any>(await handler.handleProfilerCpuStop({}));
      expect(body.success).toBe(true);
      expect(body.artifactPath).toBe('artifacts/profiles/cpu-profile.cpuprofile');
      expect(body.totalNodes).toBe(3);
      expect(body.totalSamples).toBe(3);
      expect(body.durationMs).toBe(1000);
      expect(body.hotFunctions).toHaveLength(2); // coldFunc (hitCount=0) excluded
      expect(body.hotFunctions[0].functionName).toBe('hotFunc');
      expect(body.hotFunctions[0].hitCount).toBe(100);
      expect(writeFileMock).toHaveBeenCalledWith(
        '/tmp/profile.cpuprofile',
        expect.any(String),
        'utf-8',
      );
    });

    it('saves to custom artifactPath when provided', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [],
        startTime: 0,
        endTime: 100,
      });
      writeFileMock.mockResolvedValue(undefined);

      const body = parseJson<any>(
        await handler.handleProfilerCpuStop({
          artifactPath: join(tmpdir(), 'jshook-custom-profile.cpuprofile'),
        }),
      );
      expect(body.success).toBe(true);
      expect(body.artifactPath).toBe(join(tmpdir(), 'jshook-custom-profile.cpuprofile'));
      expect(readFileSync(join(tmpdir(), 'jshook-custom-profile.cpuprofile'), 'utf8')).toContain(
        'nodes',
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

      const body = parseJson<any>(await handler.handleProfilerCpuStop({}));
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

      const body = parseJson<any>(await handler.handleProfilerCpuStop({}));
      expect(body.totalSamples).toBe(0);
      expect(body.hotFunctions).toHaveLength(0);
    });

    it('aggregates hot functions from samples when hitCount is absent', async () => {
      // 现代 Chrome CPU profile 是 samples + timeDeltas 形态,hitCount 已弃用恒 0。
      // 热函数须从 samples 聚合: 每个样本沿调用链自底向上累计频次。
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [
          {
            id: 1,
            callFrame: { functionName: 'root', url: 'app.js', lineNumber: 1 },
            children: [2, 4],
          },
          {
            id: 2,
            callFrame: { functionName: 'hotFunc', url: 'app.js', lineNumber: 10 },
            children: [3],
          },
          { id: 3, callFrame: { functionName: 'inner', url: 'app.js', lineNumber: 20 } },
          { id: 4, callFrame: { functionName: 'warmFunc', url: 'app.js', lineNumber: 30 } },
        ],
        startTime: 1000,
        endTime: 2000,
        samples: [3, 3, 4, 3],
      });
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/p.cpuprofile',
        displayPath: 'p.cpuprofile',
      });
      writeFileMock.mockResolvedValue(undefined);

      const body = parseJson<any>(await handler.handleProfilerCpuStop({}));
      // 样本 3×3 次 → 节点 3/2/1 各 +3;样本 4×1 次 → 节点 4/1 各 +1
      // counts: {1: 4, 3: 3, 2: 3, 4: 1} — 父节点(根)累计子样本;
      // 同频节点(3/2)按 samples 首次出现序稳定排序
      expect(body.hotFunctions.map((h: any) => h.functionName)).toEqual([
        'root',
        'inner',
        'hotFunc',
        'warmFunc',
      ]);
      expect(body.hotFunctions[0].hitCount).toBe(4);
      expect(body.hotFunctions[1].hitCount).toBe(3);
    });

    it('prefers samples aggregation over hitCount when both are present', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [
          {
            id: 1,
            hitCount: 1,
            callFrame: { functionName: 'samplesHot', url: 'app.js', lineNumber: 5 },
          },
          {
            id: 2,
            hitCount: 999,
            callFrame: { functionName: 'hitCountHot', url: 'app.js', lineNumber: 9 },
          },
        ],
        startTime: 0,
        endTime: 100,
        samples: [1, 1, 1],
      });
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/p.cpuprofile',
        displayPath: 'p.cpuprofile',
      });
      writeFileMock.mockResolvedValue(undefined);

      const body = parseJson<any>(await handler.handleProfilerCpuStop({}));
      expect(body.hotFunctions[0].functionName).toBe('samplesHot');
      expect(body.hotFunctions[0].hitCount).toBe(3);
    });

    it('falls back to hitCount when samples are unavailable', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [
          {
            hitCount: 100,
            callFrame: { functionName: 'hotFunc', url: 'app.js', lineNumber: 5 },
          },
          {
            hitCount: 0,
            callFrame: { functionName: 'coldFunc', url: 'app.js', lineNumber: 9 },
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

      const body = parseJson<any>(await handler.handleProfilerCpuStop({}));
      expect(body.hotFunctions).toHaveLength(1);
      expect(body.hotFunctions[0].functionName).toBe('hotFunc');
    });

    it('notes the samples-based format when no hot data is derivable', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({
        nodes: [
          { id: 1, hitCount: 0, callFrame: { functionName: 'fn', url: 'app.js', lineNumber: 5 } },
        ],
        startTime: 0,
        endTime: 100,
        samples: [],
      });
      resolveArtifactPathMock.mockResolvedValue({
        absolutePath: '/tmp/p.cpuprofile',
        displayPath: 'p.cpuprofile',
      });
      writeFileMock.mockResolvedValue(undefined);

      const body = parseJson<any>(await handler.handleProfilerCpuStop({}));
      expect(body.hotFunctions).toHaveLength(0);
      expect(body.message).toContain('samples-based format');
    });

    it('rejects a profile with an unexpected shape instead of casting blindly', async () => {
      performanceMonitorMethods.stopCPUProfiling.mockResolvedValue({ broken: true });

      const body = parseJson<any>(await handler.handleProfilerCpuStop({}));
      expect(body.success).toBe(false);
      expect(body.error).toContain('unexpected shape');
      expect(writeFileMock).not.toHaveBeenCalled();
    });
  });
});
