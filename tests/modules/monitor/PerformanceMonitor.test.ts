import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const writeState = vi.hoisted(() => ({
  writeFile: vi.fn(async () => undefined),
}));

const cdpState = vi.hoisted(() => ({
  cdpLimit: vi.fn(async (fn: any) => fn()),
}));

const artifactState = vi.hoisted(() => ({
  resolveArtifactPath: vi.fn(async () => ({
    absolutePath: '/tmp/artifact.json',
    displayPath: 'tmp/artifact.json',
  })),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('node:fs/promises', () => ({
  writeFile: writeState.writeFile,
}));

vi.mock('../../../src/utils/concurrency.js', () => ({
  cdpLimit: cdpState.cdpLimit,
}));

vi.mock('../../../src/utils/artifacts.js', () => ({
  resolveArtifactPath: artifactState.resolveArtifactPath,
}));

import { PerformanceMonitor } from '../../../src/modules/monitor/PerformanceMonitor.js';

function createSession(sendImpl?: (method: string, params: any, emit: (e: string, p?: any) => void) => any) {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  const emit = (event: string, payload?: any) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };
  const send = vi.fn(async (method: string, params?: any) => {
    if (sendImpl) return sendImpl(method, params, emit);
    return {};
  });
  const on = vi.fn((event: string, handler: (payload: any) => void) => {
    const set = listeners.get(event) ?? new Set();
    set.add(handler);
    listeners.set(event, set);
  });
  const off = vi.fn((event: string, handler: (payload: any) => void) => {
    listeners.get(event)?.delete(handler);
  });
  const detach = vi.fn(async () => {});
  return { session: { send, on, off, detach } as any, send, on, off, detach, emit };
}

function createCollector(session: any, evaluateResult?: any) {
  const page = {
    createCDPSession: vi.fn(async () => session),
    evaluate: vi.fn(async () => evaluateResult ?? {}),
  };
  return { collector: { getActivePage: vi.fn(async () => page) }, page };
}

describe('PerformanceMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    writeState.writeFile.mockReset();
    cdpState.cdpLimit.mockImplementation(async (fn: any) => fn());
    artifactState.resolveArtifactPath.mockResolvedValue({
      absolutePath: '/tmp/artifact.json',
      displayPath: 'tmp/artifact.json',
    });
  });

  it('collects page performance metrics via page.evaluate', async () => {
    const { session } = createSession();
    const metrics = { fcp: 111, lcp: 222, cls: 0.01, ttfb: 45 };
    const { collector, page } = createCollector(session, metrics);
    const monitor = new PerformanceMonitor(collector as any);

    const result = await monitor.getPerformanceMetrics();

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject(metrics);
  });

  it('starts and stops precise coverage with computed percentages', async () => {
    const { session, send } = createSession((method) => {
      if (method === 'Profiler.takePreciseCoverage') {
        return {
          result: [
            {
              url: 'a.js',
              functions: [{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }, { startOffset: 10, endOffset: 20, count: 0 }] }],
            },
          ],
        };
      }
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startCoverage();
    const coverage = await monitor.stopCoverage();

    expect(send).toHaveBeenCalledWith('Profiler.startPreciseCoverage', expect.any(Object));
    expect(coverage[0]!.coveragePercentage).toBe(50);
  });

  it('throws when stopCoverage is called before startCoverage', async () => {
    const { session } = createSession();
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await expect(monitor.stopCoverage()).rejects.toThrow('Coverage not enabled');
  });

  it('starts and stops CPU profiling', async () => {
    const profile = { nodes: [{ id: 1, callFrame: { functionName: 'fn', url: '', lineNumber: 0, columnNumber: 0 } }], startTime: 1, endTime: 2 };
    const { session, send } = createSession((method) => {
      if (method === 'Profiler.stop') return { profile };
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startCPUProfiling();
    const result = await monitor.stopCPUProfiling();

    expect(send).toHaveBeenCalledWith('Profiler.start');
    expect(result).toEqual(profile);
  });

  it('captures heap snapshot chunks and detaches listener', async () => {
    const { session, on, off } = createSession((method, _params, emit) => {
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: 'partA' });
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: 'partB' });
      }
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    const snapshot = await monitor.takeHeapSnapshot();

    expect(snapshot).toBe('partApartB');
    expect(on).toHaveBeenCalledWith('HeapProfiler.addHeapSnapshotChunk', expect.any(Function));
    expect(off).toHaveBeenCalledWith('HeapProfiler.addHeapSnapshotChunk', expect.any(Function));
  });

  it('stops tracing, reads stream and saves artifact', async () => {
    const { session, send } = createSession((method, params, emit) => {
      if (method === 'Tracing.end') {
        emit('Tracing.tracingComplete', { stream: 'trace-stream' });
        return {};
      }
      if (method === 'IO.read') {
        return { data: '{"traceEvents":[{"ph":"X"}]}', eof: true };
      }
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startTracing();
    const result = await monitor.stopTracing({ artifactPath: '/tmp/custom-trace.json' });

    expect(send).toHaveBeenCalledWith('Tracing.start', expect.any(Object));
    expect(send).toHaveBeenCalledWith('IO.read', { handle: 'trace-stream' });
    expect(writeState.writeFile).toHaveBeenCalledWith('/tmp/custom-trace.json', expect.any(String), 'utf-8');
    expect(result.eventCount).toBe(1);
  });

  it('collects heap sampling profile and returns top allocations', async () => {
    const profile = {
      head: {
        callFrame: { functionName: 'root', url: '', lineNumber: 0, columnNumber: 0 },
        selfSize: 0,
        children: [
          { callFrame: { functionName: 'heavy', url: 'a.js', lineNumber: 1, columnNumber: 1 }, selfSize: 500 },
          { callFrame: { functionName: 'light', url: 'b.js', lineNumber: 1, columnNumber: 1 }, selfSize: 50 },
        ],
      },
    };
    const { session } = createSession((method) => {
      if (method === 'HeapProfiler.stopSampling') return { profile };
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startHeapSampling({ samplingInterval: 1024 });
    const result = await monitor.stopHeapSampling({ artifactPath: '/tmp/heap.json', topN: 1 });

    expect(result.topAllocations).toHaveLength(1);
    expect(result.topAllocations[0]!.functionName).toBe('heavy');
    expect(writeState.writeFile).toHaveBeenCalledWith('/tmp/heap.json', expect.any(String), 'utf-8');
  });
});

