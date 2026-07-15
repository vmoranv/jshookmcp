import { Worker } from 'worker_threads';
import { ProcessRegistry } from '@utils/ProcessRegistry';
import { SEARCH_VECTOR_WORKER_IDLE_MS } from '@src/constants';

interface PendingRequest {
  resolve: (value: Float32Array | Float32Array[]) => void;
  reject: (reason: Error) => void;
}

export interface EmbeddingEngineOptions {
  idleMs?: number;
}

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

  isReady(): boolean {
    return this.ready;
  }

  isWorkerAlive(): boolean {
    return this.worker !== null;
  }

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

  async terminate(): Promise<void> {
    this.clearIdleTimer();
    if (!this.worker) {
      this.ready = false;
      return;
    }

    for (const [, req] of this.pending) {
      req.reject(new Error('EmbeddingEngine terminated'));
    }
    this.pending.clear();

    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    try {
      await worker.terminate();
    } catch {}
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private armIdleRelease(): void {
    this.clearIdleTimer();
    if (this.idleMs <= 0) return;
    if (this.pending.size > 0) return;
    if (!this.worker) return;

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size > 0) return;
      void this.terminate().catch(() => {});
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
