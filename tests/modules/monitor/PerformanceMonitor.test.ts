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

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('node:fs/promises', () => ({
  writeFile: writeState.writeFile,
}));

vi.mock('@src/utils/concurrency', () => ({
  cdpLimit: cdpState.cdpLimit,
}));

vi.mock('@src/utils/artifacts', () => ({
  resolveArtifactPath: artifactState.resolveArtifactPath,
}));

import { PerformanceMonitor } from '@modules/monitor/PerformanceMonitor';

function createSession(
  sendImpl?: (method: string, params: any, emit: (e: string, p?: any) => void) => any,
) {
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
    coverage: {
      startJSCoverage: vi.fn(async () => undefined),
      stopJSCoverage: vi.fn(
        async () =>
          [
            {
              url: 'a.js',
              text: '01234567890123456789',
              ranges: [{ start: 0, end: 10 }],
            },
          ] as Array<{ url: string; text: string; ranges: Array<{ start: number; end: number }> }>,
      ),
      startCSSCoverage: vi.fn(async () => undefined),
      stopCSSCoverage: vi.fn(
        async () =>
          [] as Array<{ url: string; text: string; ranges: Array<{ start: number; end: number }> }>,
      ),
    },
    tracing: {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => Buffer.from('')),
    },
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
    const { session } = createSession();
    const { collector, page } = createCollector(session);
    page.coverage.stopJSCoverage.mockResolvedValue([
      {
        url: 'a.js',
        text: '01234567890123456789',
        ranges: [{ start: 0, end: 10 }],
      },
    ]);
    page.coverage.stopCSSCoverage.mockResolvedValue([]);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startCoverage();
    const coverage = await monitor.stopCoverage();

    expect(page.coverage.startJSCoverage).toHaveBeenCalledWith({
      resetOnNavigation: undefined,
      reportAnonymousScripts: undefined,
    });
    expect(page.coverage.startCSSCoverage).toHaveBeenCalledWith({
      resetOnNavigation: undefined,
    });
    expect(coverage[0]!.coveragePercentage).toBe(50);
  });

  it('throws when stopCoverage is called before startCoverage', async () => {
    const { session } = createSession();
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await expect(monitor.stopCoverage()).rejects.toThrow('Coverage not enabled');
  });

  it('starts and stops CPU profiling', async () => {
    const profile = {
      nodes: [
        { id: 1, callFrame: { functionName: 'fn', url: '', lineNumber: 0, columnNumber: 0 } },
      ],
      startTime: 1,
      endTime: 2,
    };
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
    const { session } = createSession();
    const { collector, page } = createCollector(session);
    page.tracing.stop.mockResolvedValue(Buffer.from('{"traceEvents":[{"ph":"X"}]}'));
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startTracing();
    const result = await monitor.stopTracing({ artifactPath: '/tmp/custom-trace.json' });

    expect(page.tracing.start).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: expect.any(Array),
      }),
    );
    expect(writeState.writeFile).toHaveBeenCalledWith(
      '/tmp/custom-trace.json',
      expect.any(String),
      'utf-8',
    );
    expect(result.eventCount).toBe(1);
  });

  it('counts trace events without parsing the full trace payload', async () => {
    const parseSpy = vi.spyOn(JSON, 'parse');
    const { session } = createSession();
    const { collector, page } = createCollector(session);
    page.tracing.stop.mockResolvedValue(Buffer.from('{"traceEvents":[{"ph":"B"},{"ph":"E"}]}'));
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startTracing();
    const result = await monitor.stopTracing({ artifactPath: '/tmp/compact-trace.json' });

    expect(result.eventCount).toBe(2);
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it('collects heap sampling profile and returns top allocations', async () => {
    const profile = {
      head: {
        callFrame: { functionName: 'root', url: '', lineNumber: 0, columnNumber: 0 },
        selfSize: 0,
        children: [
          {
            callFrame: { functionName: 'heavy', url: 'a.js', lineNumber: 1, columnNumber: 1 },
            selfSize: 500,
          },
          {
            callFrame: { functionName: 'light', url: 'b.js', lineNumber: 1, columnNumber: 1 },
            selfSize: 50,
          },
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
    expect(writeState.writeFile).toHaveBeenCalledWith(
      '/tmp/heap.json',
      expect.any(String),
      'utf-8',
    );
  });

  it('collects the performance timeline and uses the default artifact path for traces', async () => {
    const { session } = createSession();
    const { collector, page } = createCollector(session);
    page.evaluate.mockResolvedValue([
      { name: 'navigationStart', entryType: 'navigation', startTime: 1, duration: 2 },
      { name: 'first-paint', entryType: 'paint', startTime: 3, duration: 0 },
    ]);
    page.tracing.stop.mockResolvedValue(Buffer.from('{"traceEvents":[{"ph":"B"}]}'));
    const monitor = new PerformanceMonitor(collector as any);

    const timeline = await monitor.getPerformanceTimeline();
    await monitor.startTracing({ screenshots: true, categories: ['devtools.timeline'] });
    const trace = await monitor.stopTracing();

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      name: 'navigationStart',
      entryType: 'navigation',
      startTime: 1,
      duration: 2,
    });
    expect(page.tracing.start).toHaveBeenCalledWith({
      categories: ['devtools.timeline'],
      screenshots: true,
    });
    expect(artifactState.resolveArtifactPath).toHaveBeenCalledWith({
      category: 'traces',
      toolName: 'performance-trace',
      ext: 'json',
    });
    expect(writeState.writeFile).toHaveBeenCalledWith(
      '/tmp/artifact.json',
      expect.any(String),
      'utf-8',
    );
    expect(trace.artifactPath).toBe('tmp/artifact.json');
    expect(trace.eventCount).toBe(1);
  });

  it('reads real performance entries and timelines from the page context', async () => {
    const { session } = createSession();
    const { collector, page } = createCollector(session);

    const fakePerformance = {
      getEntriesByType: vi.fn((type: string) => {
        if (type === 'navigation') {
          return [
            {
              domContentLoadedEventEnd: 120,
              fetchStart: 20,
              loadEventEnd: 180,
              responseStart: 60,
              requestStart: 30,
            },
          ];
        }
        if (type === 'paint') {
          return [{ name: 'first-contentful-paint', startTime: 41 }];
        }
        if (type === 'largest-contentful-paint') {
          return [
            { renderTime: 0, loadTime: 88 },
            { renderTime: 0, loadTime: 111 },
          ];
        }
        if (type === 'layout-shift') {
          return [
            { hadRecentInput: true, value: 0.2 },
            { hadRecentInput: false, value: 0.15 },
            { value: 0.05 },
          ];
        }
        return [];
      }),
      getEntries: vi.fn(() => [
        { name: 'navigationStart', entryType: 'navigation', startTime: 1, duration: 2 },
        { name: 'first-paint', entryType: 'paint', startTime: 3, duration: 0 },
      ]),
      memory: {
        jsHeapSizeLimit: 4096,
        totalJSHeapSize: 2048,
        usedJSHeapSize: 1024,
      },
    };

    page.evaluate.mockImplementation(async (pageFunction: any) => {
      if (typeof pageFunction === 'function') {
        return pageFunction();
      }
      return pageFunction;
    });

    vi.stubGlobal('performance', fakePerformance as any);
    try {
      const monitor = new PerformanceMonitor(collector as any);

      const metrics = await monitor.getPerformanceMetrics();
      const timeline = await monitor.getPerformanceTimeline();

      expect(metrics).toMatchObject({
        domContentLoaded: 100,
        loadComplete: 160,
        ttfb: 30,
        fcp: 41,
        lcp: 111,
        cls: 0.2,
        jsHeapSizeLimit: 4096,
        totalJSHeapSize: 2048,
        usedJSHeapSize: 1024,
      });
      expect(timeline).toEqual([
        {
          name: 'navigationStart',
          entryType: 'navigation',
          startTime: 1,
          duration: 2,
        },
        {
          name: 'first-paint',
          entryType: 'paint',
          startTime: 3,
          duration: 0,
        },
      ]);
      expect(page.evaluate).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('recreates an unresponsive CDP session before starting heap sampling', async () => {
    const staleSession = createSession((method) => {
      if (method === 'Runtime.evaluate') {
        return new Promise(() => {});
      }
      return {};
    });
    const profile = {
      head: {
        callFrame: { functionName: 'root', url: '', lineNumber: 0, columnNumber: 0 },
        selfSize: 0,
        children: [
          {
            callFrame: { functionName: 'hot', url: 'heap.js', lineNumber: 1, columnNumber: 1 },
            selfSize: 256,
          },
        ],
      },
    };
    const freshSession = createSession((method) => {
      if (method === 'HeapProfiler.stopSampling') {
        return { profile };
      }
      return {};
    });
    const { collector, page } = createCollector(staleSession.session);
    page.createCDPSession
      .mockResolvedValueOnce(staleSession.session)
      .mockResolvedValueOnce(freshSession.session);

    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startCPUProfiling();
    await monitor.startHeapSampling({ samplingInterval: 1024 });
    const result = await monitor.stopHeapSampling({
      artifactPath: '/tmp/heap-sampled.json',
      topN: 1,
    });

    expect(staleSession.detach).toHaveBeenCalledTimes(1);
    expect(page.createCDPSession).toHaveBeenCalledTimes(2);
    expect(freshSession.send).toHaveBeenCalledWith('HeapProfiler.enable');
    expect(freshSession.send).toHaveBeenCalledWith('HeapProfiler.startSampling', {
      samplingInterval: 1024,
    });
    expect(result.sampleCount).toBe(2);
    expect(result.topAllocations[0]?.functionName).toBe('hot');
  });

  it('closes active collectors and flushes all in-flight profilers', async () => {
    const profile = {
      head: {
        callFrame: { functionName: 'root', url: '', lineNumber: 0, columnNumber: 0 },
        selfSize: 0,
        children: [
          {
            callFrame: {
              functionName: 'close-hot',
              url: 'close.js',
              lineNumber: 1,
              columnNumber: 1,
            },
            selfSize: 128,
          },
        ],
      },
    };
    const { session } = createSession((method) => {
      if (method === 'HeapProfiler.stopSampling') {
        return { profile };
      }
      return {};
    });
    const { collector, page } = createCollector(session);
    page.tracing.stop.mockResolvedValue(Buffer.from('{"traceEvents":[{"ph":"X"}]}'));
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startCoverage();
    await monitor.startCPUProfiling();
    await monitor.startTracing();
    await monitor.startHeapSampling({ samplingInterval: 2048 });
    await monitor.close();

    expect(page.coverage.stopJSCoverage).toHaveBeenCalledTimes(1);
    expect(page.coverage.stopCSSCoverage).toHaveBeenCalledTimes(1);
    expect(page.tracing.stop).toHaveBeenCalledTimes(1);
    expect(session.send).toHaveBeenCalledWith('HeapProfiler.stopSampling');
    expect(session.detach).toHaveBeenCalledTimes(1);
  });

  it('throws when stopCPUProfiling is called before startCPUProfiling', async () => {
    const { session } = createSession();
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await expect(monitor.stopCPUProfiling()).rejects.toThrow('CPU profiling not enabled');
  });

  it('throws when startTracing is called twice', async () => {
    const { session } = createSession();
    const { collector, page } = createCollector(session);
    page.tracing.stop.mockResolvedValue(Buffer.from('{"traceEvents":[]}'));
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startTracing();
    await expect(monitor.startTracing()).rejects.toThrow('Tracing already in progress');
  });

  it('throws when stopTracing is called before startTracing', async () => {
    const { session } = createSession();
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await expect(monitor.stopTracing()).rejects.toThrow('Tracing not in progress');
  });

  it('takeHeapSnapshot skips malformed chunk payloads via isCDPHeapSnapshotChunkPayload guard', async () => {
    const { session } = createSession((method, _params, emit) => {
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        // Emit a valid chunk first, then a malformed one (not an object or missing chunk)
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: 'valid' });
        emit('HeapProfiler.addHeapSnapshotChunk', null); // not a record
        emit('HeapProfiler.addHeapSnapshotChunk', {}); // missing chunk property
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: 42 }); // chunk is not a string
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: 'alsoValid' });
      }
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    const snapshot = await monitor.takeHeapSnapshot();

    // Only valid string chunks are accumulated; malformed ones are silently skipped
    expect(snapshot).toBe('validalsoValid');
  });

  it('throws when startHeapSampling is called twice', async () => {
    const { session } = createSession();
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startHeapSampling();
    await expect(monitor.startHeapSampling()).rejects.toThrow('Heap sampling already in progress');
  });

  it('stopHeapSampling throws when payload shape is invalid via isCDPHeapSamplingPayload guard', async () => {
    const { session } = createSession((method) => {
      if (method === 'HeapProfiler.stopSampling') {
        // Return a malformed payload where head is a string, not a node object
        return { profile: { head: 'not a node' } };
      }
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startHeapSampling();
    await expect(monitor.stopHeapSampling()).rejects.toThrow(
      'Unexpected HeapProfiler.stopSampling payload shape',
    );
  });

  it('stopHeapSampling handles profile with no callFrame nodes gracefully', async () => {
    // Profile with root that has no callFrame, only nested child with callFrame
    const { session } = createSession((method) => {
      if (method === 'HeapProfiler.stopSampling') {
        return {
          profile: {
            head: {
              // no callFrame — root is not counted as a sample
              selfSize: 0,
              children: [{ callFrame: { functionName: 'valid', url: 'x.js' }, selfSize: 50 }],
            },
          },
        };
      }
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startHeapSampling();
    const result = await monitor.stopHeapSampling({ topN: 10 });

    expect(result.topAllocations.some((a) => a.functionName === 'valid')).toBe(true);
  });

  it('calls stopCoverage when close is invoked with coverage enabled and a CDP session present', async () => {
    // Directly set coverage state to bypass startCoverage() (which is affected by vi.restoreAllMocks).
    // This isolates the close() path that calls stopCoverage().
    const { session } = createSession();
    const { collector, page } = createCollector(session);
    page.coverage.stopJSCoverage.mockResolvedValue([]);
    page.coverage.stopCSSCoverage.mockResolvedValue([]);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startCPUProfiling(); // creates cdpSession via ensureCDPSession
    // Directly set coverage state (bypassing coverageStartJSWithTimeout which returns undefined after restore)
    Object.assign(monitor, { coverageEnabled: true, coveragePage: page });
    await monitor.close();

    expect(page.coverage.stopJSCoverage).toHaveBeenCalledTimes(1);
    expect(page.coverage.stopCSSCoverage).toHaveBeenCalledTimes(1);
    expect(session.detach).toHaveBeenCalledTimes(1);
  });

  it('insertTopAllocation does nothing when topN is zero or negative', async () => {
    const { session } = createSession();
    createCollector(session);

    // Verify by calling startHeapSampling with topN=0 — insertTopAllocation will
    // silently return without modifying the allocations list
    const profile = {
      head: {
        callFrame: { functionName: 'root', url: '', lineNumber: 0, columnNumber: 0 },
        selfSize: 0,
        children: [
          {
            callFrame: { functionName: 'big', url: 'a.js', lineNumber: 1, columnNumber: 1 },
            selfSize: 1000,
          },
        ],
      },
    };
    const { session: session2 } = createSession((method) => {
      if (method === 'HeapProfiler.stopSampling') return { profile };
      return {};
    });
    const { collector: collector2 } = createCollector(session2);
    const monitor2 = new PerformanceMonitor(collector2 as any);

    await monitor2.startHeapSampling();
    const result = await monitor2.stopHeapSampling({ topN: 0 });

    // With topN=0, no allocations are returned (insertTopAllocation returns early)
    expect(result.topAllocations).toEqual([]);
  });

  it('collectTopHeapAllocations skips falsy nodes when stack.pop() returns undefined', async () => {
    // The `!node` continue branch in collectTopHeapAllocations is reached when
    // a child in the stack is undefined. We can verify this indirectly via
    // takeHeapSnapshot's collectTopHeapAllocations — but since it uses a
    // different code path, we instead test it through the heap sampling flow
    // by providing a profile with a null/undefined child.
    const { session } = createSession((method) => {
      if (method === 'HeapProfiler.stopSampling') {
        return {
          profile: {
            head: {
              callFrame: { functionName: 'root' },
              selfSize: 0,
              children: [
                null, // null child — will cause stack.pop() to return null
                undefined, // undefined child — same
                { callFrame: { functionName: 'valid', url: 'x.js' }, selfSize: 50 },
              ],
            },
          },
        };
      }
      return {};
    });
    const { collector } = createCollector(session);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startHeapSampling();
    const result = await monitor.stopHeapSampling({ topN: 10 });

    // Should not crash; null/undefined children are skipped via continue
    expect(result.topAllocations.some((a) => a.functionName === 'valid')).toBe(true);
  });

  it('stopTracing uses default artifact path when artifactPath is not provided', async () => {
    const { session } = createSession();
    const { collector, page } = createCollector(session);
    page.tracing.stop.mockResolvedValue(
      Buffer.from('{"traceEvents":[{"ph":"A"},{"ph":"B"},{"ph":"C"}]}'),
    );
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startTracing();
    const result = await monitor.stopTracing();

    // No explicit artifactPath → uses resolveArtifactPath
    expect(artifactState.resolveArtifactPath).toHaveBeenCalledWith({
      category: 'traces',
      toolName: 'performance-trace',
      ext: 'json',
    });
    expect(writeState.writeFile).toHaveBeenCalledWith(
      '/tmp/artifact.json',
      expect.any(String),
      'utf-8',
    );
    expect(result.artifactPath).toBe('tmp/artifact.json');
    expect(result.eventCount).toBe(3);
  });

  it('stopCoverage logs avgCoverage correctly when there are entries with zero totalBytes', async () => {
    const { session } = createSession();
    const { collector, page } = createCollector(session);
    page.coverage.stopJSCoverage.mockResolvedValue([{ url: 'empty.js', text: '', ranges: [] }]);
    page.coverage.stopCSSCoverage.mockResolvedValue([]);
    const monitor = new PerformanceMonitor(collector as any);

    await monitor.startCoverage();
    const coverage = await monitor.stopCoverage();

    // totalBytes is 0 so coveragePercentage should be 0 (not NaN)
    expect(coverage[0]!.totalBytes).toBe(0);
    expect(coverage[0]!.coveragePercentage).toBe(0);
    expect(coverage[0]!.usedBytes).toBe(0);
  });
});
