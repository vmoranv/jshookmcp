/**
 * Phase 2: browser_get_metrics — moved from network domain.
 *
 * Atomic primitive: read Web Vitals + memory + engine counters via the shared
 * PerformanceMonitor module. Lives in browser domain (same facade as
 * performance_get_metrics in network, but the browser atomic name).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodeCollectorMock, parseJson } from '@tests/server/domains/shared/mock-factories';

const { mockMethods, mockGetPerformanceMetrics, mockGetPerformanceTimeline } = vi.hoisted(() => {
  const mockGetPerfMetrics = vi.fn();
  const mockGetPerfTimeline = vi.fn();
  const methods = {
    getPerformanceMetrics: mockGetPerfMetrics,
    getPerformanceTimeline: mockGetPerfTimeline,
    startCPUProfiling: vi.fn(),
    stopCPUProfiling: vi.fn(),
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
    mockGetPerformanceMetrics: mockGetPerfMetrics,
    mockGetPerformanceTimeline: mockGetPerfTimeline,
  };
});

vi.mock('@modules/monitor/PerformanceMonitor', () => ({
  PerformanceMonitor: vi.fn(() => mockMethods),
}));

const autoImport = async () => await import('@server/domains/browser/handlers/performance-tools');

interface GetMetricsResponse {
  success?: boolean;
  error?: string;
  metrics?: Record<string, unknown>;
  timeline?: Array<{ name: string; startTime: number }>;
}

describe('Phase 2: browser_get_metrics', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetPerformanceMonitorForTest } = await autoImport();
    resetPerformanceMonitorForTest();
  });

  it('returns metrics from PerformanceMonitor.getPerformanceMetrics()', async () => {
    mockGetPerformanceMetrics.mockResolvedValue({ fcp: 100, lcp: 250, cls: 0.01 });

    const { handleBrowserGetMetrics } = await autoImport();
    const collector = createCodeCollectorMock();
    const res = parseJson<GetMetricsResponse>(await handleBrowserGetMetrics({ collector }, {}));

    expect(res.success).toBe(true);
    expect(res.metrics).toEqual({ fcp: 100, lcp: 250, cls: 0.01 });
    expect(res.timeline).toBeUndefined();
  });

  it('includes timeline when includeTimeline is true', async () => {
    mockGetPerformanceMetrics.mockResolvedValue({ fcp: 50 });
    mockGetPerformanceTimeline.mockResolvedValue([{ name: 'paint', startTime: 50 }]);

    const { handleBrowserGetMetrics } = await autoImport();
    const collector = createCodeCollectorMock();
    const res = parseJson<GetMetricsResponse>(
      await handleBrowserGetMetrics({ collector }, { includeTimeline: true }),
    );

    expect(res.success).toBe(true);
    expect(res.metrics).toEqual({ fcp: 50 });
    expect(res.timeline).toEqual([{ name: 'paint', startTime: 50 }]);
  });

  it('does not include timeline when includeTimeline is false', async () => {
    mockGetPerformanceMetrics.mockResolvedValue({});

    const { handleBrowserGetMetrics } = await autoImport();
    const collector = createCodeCollectorMock();
    const res = parseJson<GetMetricsResponse>(
      await handleBrowserGetMetrics({ collector }, { includeTimeline: false }),
    );

    expect(res.success).toBe(true);
    expect(res.timeline).toBeUndefined();
    expect(mockGetPerformanceTimeline).not.toHaveBeenCalled();
  });

  it('wraps thrown errors as a failure response', async () => {
    mockGetPerformanceMetrics.mockRejectedValue(new Error('no active page'));

    const { handleBrowserGetMetrics } = await autoImport();
    const collector = createCodeCollectorMock();
    const res = parseJson<GetMetricsResponse>(await handleBrowserGetMetrics({ collector }, {}));

    expect(res.success).toBe(false);
    expect(res.error).toContain('no active page');
  });
});
