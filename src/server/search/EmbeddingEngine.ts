/**
 * Host-side manager for the embedding worker thread.
 *
 * Provides a clean async API for generating embeddings while keeping
 * all heavy inference in a separate worker thread.
 *
 * The ONNX / transformers runtime lives only inside the worker. After each
 * successful request the engine arms an idle timer and terminates the worker
 * when idle, reclaiming hundreds of MB of RSS. Subsequent calls re-spawn the
 * worker lazily. Catalog tool embeddings are expected to be cached in the
 * host process (and optionally on disk) so the worker is not needed again
 * until a query embedding is required.
 *
 * Usage:
 *   const engine = new EmbeddingEngine();
 *   const vec = await engine.embed("search query");  // Float32Array[384]
 *   await engine.terminate();
 */
import { Worker } from 'worker_threads';
import { ProcessRegistry } from '@utils/ProcessRegistry';
import { SEARCH_VECTOR_WORKER_IDLE_MS } from '@src/constants';

// ── Types ──

interface PendingRequest {
  resolve: (value: Float32Array | Float32Array[]) => void;
  reject: (reason: Error) => void;
}

export interface EmbeddingEngineOptions {
  /** Idle release window in ms. 0 disables auto-release. Default from SEARCH_VECTOR_WORKER_IDLE_MS. */
  idleMs?: number;
}

// ── EmbeddingEngine ──

export class EmbeddingEngine {
  private worker: Worker | null = null;
  private ready = false;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;

  constructor(options?: EmbeddingEngineOptions) {
    const configured = options?.idleMs ?? SEARCH_VECTOR_WORKER_IDLE_MS;
    this.idleMs = Number.isFinite(configured) ? Math.max(0, configured) : 0;
  }

  /**
   * Returns whether the worker is loaded and ready for requests.
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Returns true when a worker thread is currently alive (may still be loading).
   */
  isWorkerAlive(): boolean {
    return this.worker !== null;
  }

  /**
   * Embed a single text string into a 384-dimensional Float32Array.
   * Lazy-starts the worker on first call.
   */
  async embed(text: string): Promise<Float32Array> {
    this.clearIdleTimer();
    this.ensureWorker();
    const id = this.nextId++;
    try {
      return await new Promise<Float32Array>((resolve, reject) => {
        this.pending.set(id, {
          resolve: resolve as (value: Float32Array | Float32Array[]) => void,
          reject,
        });
        this.worker!.postMessage({ type: 'embed', id, text });
      });
    } finally {
      this.armIdleRelease();
    }
  }

  /**
   * Batch embed multiple text strings.
   * Returns an array of Float32Array, one per input text.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    this.clearIdleTimer();
    this.ensureWorker();
    const id = this.nextId++;
    try {
      return await new Promise<Float32Array[]>((resolve, reject) => {
        this.pending.set(id, {
          resolve: resolve as (value: Float32Array | Float32Array[]) => void,
          reject,
        });
        this.worker!.postMessage({ type: 'embed_batch', id, texts });
      });
    } finally {
      this.armIdleRelease();
    }
  }

  /**
   * Gracefully shut down the worker thread and cancel any idle timer.
   */
  async terminate(): Promise<void> {
    this.clearIdleTimer();
    if (!this.worker) {
      this.ready = false;
      return;
    }

    // Reject all pending requests
    for (const [, req] of this.pending) {
      req.reject(new Error('EmbeddingEngine terminated'));
    }
    this.pending.clear();

    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    try {
      await worker.terminate();
    } catch {
      // Worker may already be dead — ignore.
    }
  }

  // ── Private ──

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * After the last in-flight request settles, schedule worker teardown so the
   * ONNX model does not sit resident between agent turns / MCP sessions.
   */
  private armIdleRelease(): void {
    this.clearIdleTimer();
    if (this.idleMs <= 0) return;
    if (this.pending.size > 0) return;
    if (!this.worker) return;

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size > 0) return;
      void this.terminate().catch(() => {
        // Idle release is best-effort.
      });
    }, this.idleMs);
    if (typeof this.idleTimer.unref === 'function') {
      this.idleTimer.unref();
    }
  }

  private ensureWorker(): void {
    if (this.worker) return;

    const workerPath = new URL('./EmbeddingWorker.js', import.meta.url);
    this.worker = new Worker(workerPath);
    if (typeof this.worker.unref === 'function') this.worker.unref();
    ProcessRegistry.register(this.worker);

    this.worker.on(
      'message',
      (msg: {
        type: string;
        id: number;
        embedding?: Float32Array | Float32Array[];
        message?: string;
      }) => {
        const req = this.pending.get(msg.id);
        if (!req) return;
        this.pending.delete(msg.id);

        if (msg.type === 'result') {
          this.ready = true;
          req.resolve(msg.embedding!);
        } else if (msg.type === 'error') {
          req.reject(new Error(msg.message ?? 'Unknown worker error'));
        }
      },
    );

    this.worker.on('error', (err: Error) => {
      this.clearIdleTimer();
      // Reject all pending requests
      for (const [, req] of this.pending) {
        req.reject(err);
      }
      this.pending.clear();
      this.worker = null;
      this.ready = false;
    });

    this.worker.on('exit', (code: number) => {
      this.clearIdleTimer();
      if (code !== 0) {
        const err = new Error(`Embedding worker exited with code ${code}`);
        for (const [, req] of this.pending) {
          req.reject(err);
        }
        this.pending.clear();
      }
      this.worker = null;
      this.ready = false;
    });
  }
}
