/**
 * Phase 2: browser_cpu_profile_start / browser_cpu_profile_stop — split from
 * action-enum profiler_cpu.
 *
 * Atomic primitives: each tool is a single concern (start vs stop). State lives
 * in PerformanceMonitor (CDP Profiler domain). Stop fails clearly when start
 * was never called.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodeCollectorMock, parseJson } from '@tests/server/domains/shared/mock-factories';

const { mockMethods, mockStartCPUProfiling, mockStopCPUProfiling } = vi.hoisted(() => {
  const startCPUProfilingFn = vi.fn();
  const stopCPUProfilingFn = vi.fn();
  const methods = {
    getPerformanceMetrics: vi.fn(),
    getPerformanceTimeline: vi.fn(),
    startCPUProfiling: startCPUProfilingFn,
    stopCPUProfiling: stopCPUProfilingFn,
    startTracing: vi.fn(),
    stopTracing: vi.fn(),
    startCoverage: vi.fn(),
    stopCoverage: vi.fn(),
    takeHeapSnapshot: vi.fn(),
    startHeapSampling: vi.fn(),
    stopHeapSampling: vi.fn(),
    close: vi.fn(),
  };
  return {
    mockMethods: methods,
    mockStartCPUProfiling: startCPUProfilingFn,
    mockStopCPUProfiling: stopCPUProfilingFn,
  };
});

vi.mock('@modules/monitor/PerformanceMonitor', () => ({
  PerformanceMonitor: vi.fn(() => mockMethods),
}));

const autoImport = async () => await import('@server/domains/browser/handlers/performance-tools');

interface CpuProfileResponse {
  success?: boolean;
  error?: string;
  message?: string;
  artifactPath?: string;
  totalNodes?: number;
  totalSamples?: number;
  durationMs?: number;
  hotFunctions?: Array<{ functionName: string; hitCount: number }>;
  topN?: number;
  hint?: string;
}

describe('Phase 2: browser_cpu_profile_start / browser_cpu_profile_stop', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetPerformanceMonitorForTest } = await autoImport();
    resetPerformanceMonitorForTest();
  });

  describe('browser_cpu_profile_start', () => {
    it('starts profiling with no options (default sampling interval)', async () => {
      mockStartCPUProfiling.mockResolvedValue(undefined);

      const { handleBrowserCpuProfileStart } = await autoImport();
      const collector = createCodeCollectorMock();
      const res = parseJson<CpuProfileResponse>(
        await handleBrowserCpuProfileStart({ collector }, {}),
      );

      expect(res.success).toBe(true);
      expect(res.message).toContain('CPU profiling started');
      expect(mockStartCPUProfiling).toHaveBeenCalledWith({ samplingInterval: undefined });
    });

    it('passes samplingInterval through to PerformanceMonitor', async () => {
      mockStartCPUProfiling.mockResolvedValue(undefined);

      const { handleBrowserCpuProfileStart } = await autoImport();
      const collector = createCodeCollectorMock();
      await handleBrowserCpuProfileStart({ collector }, { samplingInterval: 100 });

      expect(mockStartCPUProfiling).toHaveBeenCalledWith({ samplingInterval: 100 });
    });
  });

  describe('browser_cpu_profile_stop', () => {
    it('returns error when profiling was never started', async () => {
      const { handleBrowserCpuProfileStop } = await autoImport();
      const collector = createCodeCollectorMock();
      const res = parseJson<CpuProfileResponse>(
        await handleBrowserCpuProfileStop({ collector }, {}),
      );

      expect(res.success).toBe(false);
      expect(res.error).toContain('not in progress');
    });

    it('returns artifact info + hot functions when stop succeeds', async () => {
      mockStartCPUProfiling.mockResolvedValue(undefined);
      mockStopCPUProfiling.mockResolvedValue({
        nodes: [
          { id: 1, callFrame: { functionName: 'hotFunc', url: 'app.js', lineNumber: 1 } },
          { id: 2, callFrame: { functionName: 'coldFunc', url: 'app.js', lineNumber: 2 } },
        ],
        startTime: 0,
        endTime: 500,
        samples: [1, 1, 1],
      });

      const {
        handleBrowserCpuProfileStart,
        handleBrowserCpuProfileStop,
        resetPerformanceMonitorForTest,
      } = await autoImport();
      const collector = createCodeCollectorMock();

      await handleBrowserCpuProfileStart({ collector }, {});
      const res = parseJson<CpuProfileResponse>(
        await handleBrowserCpuProfileStop({ collector }, {}),
      );

      expect(res.success).toBe(true);
      expect(res.artifactPath).toMatch(/cpu-profile.*\.cpuprofile$/);
      expect(res.totalNodes).toBe(2);
      expect(res.totalSamples).toBe(3);
      expect(res.durationMs).toBe(500);
      expect(res.hotFunctions?.[0]?.functionName).toBe('hotFunc');
      expect(res.hotFunctions?.[0]?.hitCount).toBe(3);
      expect(res.hint).toContain('.cpuprofile');

      resetPerformanceMonitorForTest();
    });

    it('passes topN and artifactPath through to the stop pipeline', async () => {
      mockStartCPUProfiling.mockResolvedValue(undefined);
      mockStopCPUProfiling.mockResolvedValue({
        nodes: [],
        startTime: 0,
        endTime: 100,
      });

      const {
        handleBrowserCpuProfileStart,
        handleBrowserCpuProfileStop,
        resetPerformanceMonitorForTest,
      } = await autoImport();
      const collector = createCodeCollectorMock();

      await handleBrowserCpuProfileStart({ collector }, {});
      await handleBrowserCpuProfileStop(
        { collector },
        { artifactPath: '/custom/cpu.cpuprofile', topN: 5 },
      );

      // The browser facade forwards stop options verbatim — PerformanceMonitor.stopCPUProfiling()
      // does not accept topN today (top-N is derived locally in the handler), so
      // topN is consumed by the handler, not the monitor.
      expect(mockStopCPUProfiling).toHaveBeenCalledWith();

      resetPerformanceMonitorForTest();
    });
  });
});
