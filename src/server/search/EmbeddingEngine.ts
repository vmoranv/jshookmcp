/**
 * Host-side manager for the embedding worker thread.
 *
 * Provides a clean async API for generating embeddings while keeping
 * all heavy inference in a separate worker thread.
 *
 * Usage:
 *   const engine = new EmbeddingEngine();
 *   const vec = await engine.embed("search query");  // Float32Array[384]
 *   await engine.terminate();
 */
import { Worker } from 'worker_threads';

// ── Types ──

interface PendingRequest {
  resolve: (value: Float32Array | Float32Array[]) => void;
  reject: (reason: Error) => void;
}

// ── EmbeddingEngine ──

export class EmbeddingEngine {
  private worker: Worker | null = null;
  private ready = false;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();

  /**
   * Returns whether the worker is loaded and ready for requests.
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Embed a single text string into a 384-dimensional Float32Array.
   * Lazy-starts the worker on first call.
   */
  async embed(text: string): Promise<Float32Array> {
    this.ensureWorker();
    const id = this.nextId++;
    return new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: Float32Array | Float32Array[]) => void,
        reject,
      });
      this.worker!.postMessage({ type: 'embed', id, text });
    });
  }

  /**
   * Batch embed multiple text strings.
   * Returns an array of Float32Array, one per input text.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    this.ensureWorker();
    const id = this.nextId++;
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: Float32Array | Float32Array[]) => void,
        reject,
      });
      this.worker!.postMessage({ type: 'embed_batch', id, texts });
    });
  }

  /**
   * Gracefully shut down the worker thread.
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      // Reject all pending requests
      for (const [, req] of this.pending) {
        req.reject(new Error('EmbeddingEngine terminated'));
      }
      this.pending.clear();

      await this.worker.terminate();
      this.worker = null;
      this.ready = false;
    }
  }

  // ── Private ──

  private ensureWorker(): void {
    if (this.worker) return;

    const workerPath = new URL('./EmbeddingWorker.js', import.meta.url);
    this.worker = new Worker(workerPath);

    this.worker.on('message', (msg: { type: string; id: number; embedding?: Float32Array | Float32Array[]; message?: string }) => {
      const req = this.pending.get(msg.id);
      if (!req) return;
      this.pending.delete(msg.id);

      if (msg.type === 'result') {
        this.ready = true;
        req.resolve(msg.embedding!);
      } else if (msg.type === 'error') {
        req.reject(new Error(msg.message ?? 'Unknown worker error'));
      }
    });

    this.worker.on('error', (err: Error) => {
      // Reject all pending requests
      for (const [, req] of this.pending) {
        req.reject(err);
      }
      this.pending.clear();
      this.worker = null;
      this.ready = false;
    });

    this.worker.on('exit', (code: number) => {
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
