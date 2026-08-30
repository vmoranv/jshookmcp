/**
 * Phase 2: browser_trace_start / browser_trace_stop — split from action-enum
 * performance_trace.
 *
 * Atomic primitives: each tool is a single concern (start vs stop). State lives
 * in PerformanceMonitor (CDP Tracing domain + page.tracing.start). Stop fails
 * clearly when start was never called.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCodeCollectorMock, parseJson } from '@tests/server/domains/shared/mock-factories';

const { mockMethods, mockStartTracing, mockStopTracing } = vi.hoisted(() => {
  const startTracingFn = vi.fn();
  const stopTracingFn = vi.fn();
  const methods = {
    getPerformanceMetrics: vi.fn(),
    getPerformanceTimeline: vi.fn(),
    startCPUProfiling: vi.fn(),
    stopCPUProfiling: vi.fn(),
    startTracing: startTracingFn,
    stopTracing: stopTracingFn,
    startCoverage: vi.fn(),
    stopCoverage: vi.fn(),
    takeHeapSnapshot: vi.fn(),
    startHeapSampling: vi.fn(),
    stopHeapSampling: vi.fn(),
    close: vi.fn(),
  };
  return {
    mockMethods: methods,
    mockStartTracing: startTracingFn,
    mockStopTracing: stopTracingFn,
  };
});

vi.mock('@modules/monitor/PerformanceMonitor', () => ({
  PerformanceMonitor: vi.fn(() => mockMethods),
}));

const autoImport = async () => await import('@server/domains/browser/handlers/performance-tools');

interface TraceResponse {
  success?: boolean;
  error?: string;
  message?: string;
  artifactPath?: string;
  eventCount?: number;
  sizeBytes?: number;
  sizeKB?: string;
  truncated?: boolean;
  hint?: string;
}

describe('Phase 2: browser_trace_start / browser_trace_stop', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetPerformanceMonitorForTest } = await autoImport();
    resetPerformanceMonitorForTest();
  });

  describe('browser_trace_start', () => {
    it('starts tracing with no options (default categories + screenshots=false)', async () => {
      mockStartTracing.mockResolvedValue(undefined);

      const { handleBrowserTraceStart } = await autoImport();
      const collector = createCodeCollectorMock();
      const res = parseJson<TraceResponse>(await handleBrowserTraceStart({ collector }, {}));

      expect(res.success).toBe(true);
      expect(res.message).toContain('tracing started');
      expect(mockStartTracing).toHaveBeenCalledWith({
        categories: undefined,
        screenshots: undefined,
      });
    });

    it('passes categories and screenshots through to PerformanceMonitor', async () => {
      mockStartTracing.mockResolvedValue(undefined);

      const { handleBrowserTraceStart } = await autoImport();
      const collector = createCodeCollectorMock();
      await handleBrowserTraceStart(
        { collector },
        { categories: ['devtools.timeline', 'v8.execute'], screenshots: true },
      );

      expect(mockStartTracing).toHaveBeenCalledWith({
        categories: ['devtools.timeline', 'v8.execute'],
        screenshots: true,
      });
    });

    it('drops non-array categories (defensive: agent may pass strings)', async () => {
      mockStartTracing.mockResolvedValue(undefined);

      const { handleBrowserTraceStart } = await autoImport();
      const collector = createCodeCollectorMock();
      await handleBrowserTraceStart({ collector }, { categories: 'not-an-array' });

      expect(mockStartTracing).toHaveBeenCalledWith({
        categories: undefined,
        screenshots: undefined,
      });
    });
  });

  describe('browser_trace_stop', () => {
    it('returns error when tracing was never started', async () => {
      const { handleBrowserTraceStop } = await autoImport();
      const collector = createCodeCollectorMock();
      const res = parseJson<TraceResponse>(await handleBrowserTraceStop({ collector }, {}));

      expect(res.success).toBe(false);
      expect(res.error).toContain('not in progress');
    });

    it('returns artifact info when stop succeeds and resets state', async () => {
      mockStartTracing.mockResolvedValue(undefined);
      mockStopTracing.mockResolvedValue({
        artifactPath: '/tmp/trace.json',
        eventCount: 500,
        sizeBytes: 102400,
      });

      const { handleBrowserTraceStart, handleBrowserTraceStop, resetPerformanceMonitorForTest } =
        await autoImport();
      const collector = createCodeCollectorMock();

      await handleBrowserTraceStart({ collector }, {});
      const res = parseJson<TraceResponse>(await handleBrowserTraceStop({ collector }, {}));

      expect(res.success).toBe(true);
      expect(res.artifactPath).toBe('/tmp/trace.json');
      expect(res.eventCount).toBe(500);
      expect(res.sizeBytes).toBe(102400);
      expect(res.sizeKB).toBe('100.0');
      expect(res.hint).toContain('Chrome DevTools');

      // state was reset — a second stop must fail
      resetPerformanceMonitorForTest();
    });
  });

  describe('start/stop pairing requires reset between calls', () => {
    it('a second stop after a successful stop fails until start is called again', async () => {
      mockStartTracing.mockResolvedValue(undefined);
      mockStopTracing.mockResolvedValue({
        artifactPath: '/tmp/trace.json',
        eventCount: 100,
        sizeBytes: 1024,
      });

      const { handleBrowserTraceStart, handleBrowserTraceStop, resetPerformanceMonitorForTest } =
        await autoImport();
      const collector = createCodeCollectorMock();

      await handleBrowserTraceStart({ collector }, {});
      const first = parseJson<TraceResponse>(await handleBrowserTraceStop({ collector }, {}));
      expect(first.success).toBe(true);

      // PerformanceMonitor.stopTracing always resets its internal state in the
      // finally block, so a fresh stop without a new start will see
      // tracingEnabled=false and throw PrerequisiteError.
      const second = parseJson<TraceResponse>(await handleBrowserTraceStop({ collector }, {}));
      expect(second.success).toBe(false);

      resetPerformanceMonitorForTest();
    });
  });

  describe('passes custom artifactPath to stop', () => {
    it('forwards artifactPath option to monitor', async () => {
      mockStartTracing.mockResolvedValue(undefined);
      mockStopTracing.mockResolvedValue({
        artifactPath: '/custom/trace.json',
        eventCount: 50,
        sizeBytes: 2048,
      });

      const { handleBrowserTraceStart, handleBrowserTraceStop, resetPerformanceMonitorForTest } =
        await autoImport();
      const collector = createCodeCollectorMock();

      await handleBrowserTraceStart({ collector }, {});
      await handleBrowserTraceStop({ collector }, { artifactPath: '/custom/trace.json' });

      expect(mockStopTracing).toHaveBeenCalledWith({ artifactPath: '/custom/trace.json' });

      resetPerformanceMonitorForTest();
    });
  });
});
