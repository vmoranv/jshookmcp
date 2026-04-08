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
      return { jsHeapSizeUsed: 0, jsHeapSizeTotal: 0, jsHeapSizeLimit: 0 };
    }

    try {
      const response = await session.send<Record<string, unknown>>('HeapProfiler.getHeapUsage');
      const jsHeapSizeUsed = response['jsHeapSizeUsed'];
      const jsHeapSizeTotal = response['jsHeapSizeTotal'];
      const jsHeapSizeLimit = response['jsHeapSizeLimit'];

      return {
        jsHeapSizeUsed: typeof jsHeapSizeUsed === 'number' ? jsHeapSizeUsed : 0,
        jsHeapSizeTotal: typeof jsHeapSizeTotal === 'number' ? jsHeapSizeTotal : 0,
        jsHeapSizeLimit: typeof jsHeapSizeLimit === 'number' ? jsHeapSizeLimit : 0,
      };
    } catch {
      // Fallback: use Runtime.evaluate to read performance.memory if available
      try {
        const response = await session.send<Record<string, unknown>>('Runtime.evaluate', {
          expression: `
            (() => {
              const m = performance.memory;
              return m ? JSON.stringify({
                jsHeapSizeUsed: m.usedJSHeapSize,
                jsHeapSizeTotal: m.totalJSHeapSize,
                jsHeapSizeLimit: m.jsHeapSizeLimit
              }) : null;
            })()
          `,
          returnByValue: true,
        });
        const result = response['result'];
        if (typeof result === 'string' && result !== 'null') {
          return JSON.parse(result) as HeapProfilerStats;
        }
      } catch {
        // intentional fallthrough
      }
      return { jsHeapSizeUsed: 0, jsHeapSizeTotal: 0, jsHeapSizeLimit: 0 };
    }
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
