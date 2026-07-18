import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEARCH_VECTOR_MODEL_ID, SEARCH_VECTOR_WORKER_IDLE_MS } from '@src/constants';
import { ProcessRegistry } from '@utils/ProcessRegistry';

type EmbeddingResult = Float32Array | Float32Array[];

interface PendingRequest {
  worker: Worker;
  resolve: (value: EmbeddingResult) => void;
  reject: (reason: Error) => void;
}

export interface EmbeddingEngineOptions {
  idleMs?: number;
  modelId?: string;
}

export class EmbeddingEngine {
  private worker: Worker | null = null;
  private ready = false;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;
  private readonly modelId: string;

  constructor(options?: EmbeddingEngineOptions) {
    const rawIdleMs = process.env.SEARCH_VECTOR_WORKER_IDLE_MS;
    const parsedIdleMs =
      rawIdleMs === undefined || rawIdleMs === '' ? Number.NaN : Number(rawIdleMs);
    const transportDefault =
      process.env.MCP_TRANSPORT?.trim().toLowerCase() === 'http'
        ? 300_000
        : SEARCH_VECTOR_WORKER_IDLE_MS;
    const runtimeIdleMs = Number.isFinite(parsedIdleMs) ? parsedIdleMs : transportDefault;
    const configuredIdleMs = options?.idleMs ?? runtimeIdleMs;
    this.idleMs = Number.isFinite(configuredIdleMs) ? Math.max(0, configuredIdleMs) : 0;
    this.modelId = options?.modelId?.trim() || SEARCH_VECTOR_MODEL_ID;
  }

  isReady(): boolean {
    return this.ready;
  }

  isWorkerAlive(): boolean {
    return this.worker !== null;
  }

  embed(text: string): Promise<Float32Array> {
    return this.dispatch<Float32Array>('embed', { text });
  }

  embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return Promise.resolve([]);
    return this.dispatch<Float32Array[]>('embed_batch', { texts });
  }

  async terminate(): Promise<void> {
    this.clearIdleTimer();
    const worker = this.worker;
    if (!worker) {
      this.ready = false;
      return;
    }
    await this.terminateWorker(worker, new Error('EmbeddingEngine terminated'));
  }

  private dispatch<T extends EmbeddingResult>(
    type: 'embed' | 'embed_batch',
    payload: { text: string } | { texts: string[] },
  ): Promise<T> {
    this.clearIdleTimer();
    const worker = this.ensureWorker();
    const id = this.nextId++;

    const result = new Promise<T>((resolve, reject) => {
      const request: PendingRequest = {
        worker,
        resolve: resolve as (value: EmbeddingResult) => void,
        reject,
      };
      this.pending.set(id, request);
      try {
        worker.postMessage({ type, id, modelId: this.modelId, ...payload });
      } catch (error) {
        const pendingRequest = this.takePendingRequest(id);
        pendingRequest?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return result.finally(() => this.armIdleRelease(worker));
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private armIdleRelease(worker: Worker): void {
    if (this.worker !== worker || this.idleMs <= 0 || this.hasPendingRequests(worker)) return;

    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.worker !== worker || this.hasPendingRequests(worker)) return;
      void this.terminateWorker(worker, new Error('Embedding worker released after idle timeout'));
    }, this.idleMs);
    this.idleTimer.unref?.();
  }

  private hasPendingRequests(worker: Worker): boolean {
    return [...this.pending.values()].some((request) => request.worker === worker);
  }

  private takePendingRequest(id: number): PendingRequest | undefined {
    const request = this.pending.get(id);
    if (!request) return undefined;
    this.pending.delete(id);
    return request;
  }

  private rejectWorkerRequests(worker: Worker, error: Error): void {
    for (const [id, request] of this.pending) {
      if (request.worker !== worker) continue;
      this.takePendingRequest(id);
      request.reject(error);
    }
  }

  private async terminateWorker(worker: Worker, reason: Error): Promise<void> {
    if (this.worker === worker) {
      this.worker = null;
      this.ready = false;
      this.clearIdleTimer();
    }
    this.rejectWorkerRequests(worker, reason);
    try {
      await worker.terminate();
    } catch {
      // The worker may already have exited.
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const bundledWorkerPath = new URL('./server/search/EmbeddingWorker.mjs', import.meta.url);
    const workerPath = existsSync(fileURLToPath(bundledWorkerPath))
      ? bundledWorkerPath
      : new URL('./EmbeddingWorker.ts', import.meta.url);
    const worker = new Worker(workerPath);
    this.worker = worker;
    worker.unref?.();
    ProcessRegistry.register(worker);

    worker.on(
      'message',
      (message: { type: string; id: number; embedding?: EmbeddingResult; message?: string }) => {
        const request = this.pending.get(message.id);
        if (!request || request.worker !== worker) return;
        this.takePendingRequest(message.id);

        if (message.type === 'result' && message.embedding) {
          if (this.worker === worker) this.ready = true;
          request.resolve(message.embedding);
        } else {
          request.reject(new Error(message.message ?? 'Unknown embedding worker error'));
        }
      },
    );

    worker.on('error', (error: Error) => {
      this.rejectWorkerRequests(worker, error);
      if (this.worker === worker) {
        this.worker = null;
        this.ready = false;
        this.clearIdleTimer();
      }
    });

    worker.on('exit', (code: number) => {
      if (code !== 0) {
        this.rejectWorkerRequests(worker, new Error(`Embedding worker exited with code ${code}`));
      }
      if (this.worker === worker) {
        this.worker = null;
        this.ready = false;
        this.clearIdleTimer();
      }
    });

    return worker;
  }
}
