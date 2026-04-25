interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  detach(): Promise<void>;
}

interface CDPPageLike {
  createCDPSession(): Promise<CDPSessionLike>;
}

interface HeapProfilerStats {
  jsHeapSizeUsed: number;
  jsHeapSizeTotal: number;
  jsHeapSizeLimit: number;
}

interface HeapSnapshotChunkEvent {
  chunk: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unwrapRuntimeValue(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if ('value' in value) {
    return unwrapRuntimeValue(value['value']);
  }

  if ('result' in value) {
    return unwrapRuntimeValue(value['result']);
  }

  return value;
}

function parseHeapUsage(value: unknown): Partial<HeapProfilerStats> | null {
  const unwrapped = unwrapRuntimeValue(value);
  const normalized =
    typeof unwrapped === 'string'
      ? (() => {
          try {
            return JSON.parse(unwrapped) as unknown;
          } catch {
            return null;
          }
        })()
      : unwrapped;

  if (!isRecord(normalized)) {
    return null;
  }

  const jsHeapSizeUsed = toNumber(normalized['jsHeapSizeUsed']) ?? toNumber(normalized['usedSize']);
  const jsHeapSizeTotal =
    toNumber(normalized['jsHeapSizeTotal']) ?? toNumber(normalized['totalSize']);
  const jsHeapSizeLimit = toNumber(normalized['jsHeapSizeLimit']) ?? 0;

  if (jsHeapSizeUsed === null && jsHeapSizeTotal === null && jsHeapSizeLimit === 0) {
    return null;
  }

  const patch: Partial<HeapProfilerStats> = {};
  if (jsHeapSizeUsed !== null) {
    patch.jsHeapSizeUsed = jsHeapSizeUsed;
  }
  if (jsHeapSizeTotal !== null) {
    patch.jsHeapSizeTotal = jsHeapSizeTotal;
  }
  if (jsHeapSizeLimit > 0) {
    patch.jsHeapSizeLimit = jsHeapSizeLimit;
  }

  return patch;
}

function hasMeaningfulHeapUsage(stats: HeapProfilerStats): boolean {
  return stats.jsHeapSizeUsed > 0 || stats.jsHeapSizeTotal > 0 || stats.jsHeapSizeLimit > 0;
}

function mergeHeapUsage(
  base: HeapProfilerStats | null,
  patch: Partial<HeapProfilerStats> | null,
): HeapProfilerStats | null {
  if (!base && !patch) {
    return null;
  }

  const merged: HeapProfilerStats = {
    jsHeapSizeUsed: patch?.jsHeapSizeUsed ?? base?.jsHeapSizeUsed ?? 0,
    jsHeapSizeTotal: patch?.jsHeapSizeTotal ?? base?.jsHeapSizeTotal ?? 0,
    jsHeapSizeLimit: patch?.jsHeapSizeLimit ?? base?.jsHeapSizeLimit ?? 0,
  };

  return hasMeaningfulHeapUsage(merged) ? merged : null;
}

function parsePerformanceMetrics(value: unknown): Partial<HeapProfilerStats> | null {
  const unwrapped = unwrapRuntimeValue(value);
  if (!isRecord(unwrapped) || !Array.isArray(unwrapped['metrics'])) {
    return null;
  }

  const metrics = new Map<string, number>();
  for (const metric of unwrapped['metrics']) {
    if (!isRecord(metric)) {
      continue;
    }
    const name = typeof metric['name'] === 'string' ? metric['name'] : null;
    const metricValue = toNumber(metric['value']);
    if (!name || metricValue === null) {
      continue;
    }
    metrics.set(name, metricValue);
  }

  const jsHeapSizeUsed = metrics.get('JSHeapUsedSize') ?? 0;
  const jsHeapSizeTotal = metrics.get('JSHeapTotalSize') ?? 0;

  if (jsHeapSizeUsed === 0 && jsHeapSizeTotal === 0) {
    return null;
  }

  return {
    jsHeapSizeUsed,
    jsHeapSizeTotal,
  };
}

function isCDPPageLike(value: unknown): value is CDPPageLike {
  return isRecord(value) && typeof value['createCDPSession'] === 'function';
}

function isCDPSessionLike(value: unknown): value is CDPSessionLike {
  return (
    isRecord(value) && typeof value['send'] === 'function' && typeof value['detach'] === 'function'
  );
}

/**
 * CDP wrapper for V8 HeapProfiler operations.
 *
 * Provides heap snapshot capture, object inspection, and usage stats
 * via the Chrome DevTools Protocol HeapProfiler domain.
 */
export class V8InspectorClient {
  private session: CDPSessionLike | null = null;

  constructor(private readonly getPage?: () => Promise<unknown>) {}

  /**
   * Enable the HeapProfiler domain via CDP.
   * Must be called before any heap profiling operations.
   */
  async enableHeapProfiler(): Promise<void> {
    const session = await this.createSession();
    if (!session) {
      throw new Error('V8InspectorClient: cannot create CDP session');
    }
    await session.send('HeapProfiler.enable');
    this.session = session;
  }

  /**
   * Take a heap snapshot and collect all chunks via the HeapProfiler.addHeapSnapshotChunk event.
   *
   * @param onChunk - Callback invoked for each snapshot chunk received.
   * @returns Total size of the snapshot in bytes.
   */
  async takeHeapSnapshot(onChunk?: (chunk: string) => void): Promise<number> {
    if (!this.session) {
      await this.enableHeapProfiler();
    }
    const session = this.session;
    if (!session) {
      throw new Error('V8InspectorClient: session not available for heap snapshot');
    }

    return new Promise<number>((resolve, reject) => {
      const chunks: string[] = [];
      let totalSize = 0;

      const chunkHandler = (data: unknown) => {
        const chunk = (data as HeapSnapshotChunkEvent | null)?.chunk;
        if (typeof chunk === 'string') {
          chunks.push(chunk);
          totalSize += Buffer.byteLength(chunk, 'utf8');
          onChunk?.(chunk);
        }
      };

      session.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler);

      session
        .send('HeapProfiler.takeHeapSnapshot', {
          reportProgress: false,
        })
        .then(() => {
          session.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
          resolve(totalSize);
        })
        .catch((error: unknown) => {
          session.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
          reject(error);
        });
    });
  }

  /**
   * Retrieve a heap object by its object ID.
   *
   * @param objectId - Heap snapshot object identifier (e.g. "1:1234").
   * @returns The object's properties and metadata.
   */
  async getObjectByObjectId(_objectId: string): Promise<Record<string, unknown> | null> {
    if (!this.session) {
      await this.enableHeapProfiler();
    }
    const session = this.session;
    if (!session) {
      return null;
    }

    try {
      // Use HeapProfiler.getObjectByObjectId to retrieve the remote object
      const response = await session.send<Record<string, unknown>>(
        'HeapProfiler.getObjectByObjectId',
        {
          objectId: _objectId,
        },
      );
      return response;
    } catch {
      return null;
    }
  }

  /**
   * Get current V8 heap usage statistics.
   *
   * @returns Object with jsHeapSizeUsed, jsHeapSizeTotal, jsHeapSizeLimit.
   */
  async getHeapUsage(): Promise<HeapProfilerStats> {
    if (!this.session) {
      await this.enableHeapProfiler();
    }
    const session = this.session;
    if (!session) {
      throw new Error('V8InspectorClient: session not available for heap usage');
    }

    let heapUsage: HeapProfilerStats | null = null;

    try {
      const runtimeUsage = await session.send<Record<string, unknown>>('Runtime.getHeapUsage');
      heapUsage = mergeHeapUsage(heapUsage, parseHeapUsage(runtimeUsage));
    } catch {
      // Continue through compatibility fallbacks below.
    }

    try {
      const profilerUsage = await session.send<Record<string, unknown>>(
        'HeapProfiler.getHeapUsage',
      );
      heapUsage = mergeHeapUsage(heapUsage, parseHeapUsage(profilerUsage));
    } catch {
      // Continue through compatibility fallbacks below.
    }

    try {
      const metrics = await session.send<Record<string, unknown>>('Performance.getMetrics');
      heapUsage = mergeHeapUsage(heapUsage, parsePerformanceMetrics(metrics));
    } catch {
      // Continue through compatibility fallbacks below.
    }

    try {
      const response = await session.send<Record<string, unknown>>('Runtime.evaluate', {
        expression: `
          (() => {
            const m = performance.memory;
            return m
              ? {
                  jsHeapSizeUsed: m.usedJSHeapSize,
                  jsHeapSizeTotal: m.totalJSHeapSize,
                  jsHeapSizeLimit: m.jsHeapSizeLimit
                }
              : null;
          })()
        `,
        returnByValue: true,
      });
      heapUsage = mergeHeapUsage(heapUsage, parseHeapUsage(response));
    } catch {
      // intentional fallthrough
    }

    if (!heapUsage) {
      throw new Error('V8InspectorClient: heap usage metrics unavailable');
    }

    return heapUsage;
  }

  /**
   * Detach the underlying CDP session and release resources.
   */
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.detach().catch(() => undefined);
      this.session = null;
    }
  }

  private async createSession(): Promise<CDPSessionLike | null> {
    if (this.session) {
      return this.session;
    }
    if (!this.getPage) {
      return null;
    }
    try {
      const page = await this.getPage();
      if (!isCDPPageLike(page)) {
        return null;
      }
      const session = await page.createCDPSession();
      if (!isCDPSessionLike(session)) {
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }
}
