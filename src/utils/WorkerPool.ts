import { Worker, type ResourceLimits } from 'node:worker_threads';

export interface WorkerPoolOptions {
  name?: string;
  workerScript: string;
  minWorkers?: number;
  maxWorkers?: number;
  idleTimeoutMs?: number;
  resourceLimits?: ResourceLimits;
}

interface WorkerJob<TPayload, TResult> {
  id: number;
  payload: TPayload;
  timeoutMs: number;
  resolve: (value: TResult) => void;
  reject: (error: Error) => void;
}

interface ActiveWorkerJob<TPayload, TResult> extends WorkerJob<TPayload, TResult> {
  workerId: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

interface WorkerResponseEnvelope<TResult> {
  jobId: number;
  ok: boolean;
  result?: TResult;
  error?: string;
}

interface PooledWorker {
  id: number;
  worker: Worker;
  busy: boolean;
  activeJobId: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_MIN_WORKERS = 2;
const DEFAULT_MAX_WORKERS = 4;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_JOB_TIMEOUT_MS = 15_000;

/**
 * Generic worker pool with O(1) dispatch, idle eviction, and graceful shutdown.
 */
export class WorkerPool<TPayload extends Record<string, unknown>, TResult> {
  private readonly name: string;
  private readonly workerScript: string;
  private readonly minWorkers: number;
  private readonly maxWorkers: number;
  private readonly idleTimeoutMs: number;
  private readonly resourceLimits?: ResourceLimits;

  private readonly workers = new Map<number, PooledWorker>();
  private readonly queuedJobs: WorkerJob<TPayload, TResult>[] = [];
  private readonly activeJobs = new Map<number, ActiveWorkerJob<TPayload, TResult>>();

  private nextWorkerId = 1;
  private nextJobId = 1;
  private closed = false;

  constructor(options: WorkerPoolOptions) {
    this.name = options.name ?? 'worker-pool';
    this.workerScript = options.workerScript;
    this.minWorkers = options.minWorkers ?? DEFAULT_MIN_WORKERS;
    this.maxWorkers = options.maxWorkers ?? DEFAULT_MAX_WORKERS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.resourceLimits = options.resourceLimits;

    if (!this.workerScript || this.workerScript.trim().length === 0) {
      throw this.toError('workerScript must be a non-empty string');
    }
    if (!Number.isInteger(this.minWorkers) || this.minWorkers < 0) {
      throw this.toError('minWorkers must be an integer >= 0');
    }
    if (!Number.isInteger(this.maxWorkers) || this.maxWorkers < 1) {
      throw this.toError('maxWorkers must be an integer >= 1');
    }
    if (this.minWorkers > this.maxWorkers) {
      throw this.toError('minWorkers cannot be greater than maxWorkers');
    }

    this.ensureMinWorkers();
  }

  submit(payload: TPayload, timeoutMs = DEFAULT_JOB_TIMEOUT_MS): Promise<TResult> {
    if (this.closed) {
      return Promise.reject(this.toError('pool is closed'));
    }

    return new Promise<TResult>((resolve, reject) => {
      const job: WorkerJob<TPayload, TResult> = {
        id: this.nextJobId++,
        payload,
        timeoutMs,
        resolve,
        reject,
      };
      this.queuedJobs.push(job);
      this.pumpQueue();
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const closeError = this.toError('pool is closed');
    while (this.queuedJobs.length > 0) {
      const job = this.queuedJobs.shift();
      job?.reject(closeError);
    }

    for (const activeJob of this.activeJobs.values()) {
      if (activeJob.timeoutHandle) {
        clearTimeout(activeJob.timeoutHandle);
      }
      activeJob.reject(closeError);
    }
    this.activeJobs.clear();

    const workerIds = Array.from(this.workers.keys());
    await Promise.all(workerIds.map((workerId) => this.terminateWorker(workerId)));
  }

  private ensureMinWorkers(): void {
    if (this.closed) return;
    while (this.workers.size < this.minWorkers) {
      this.spawnWorker();
    }
  }

  private pumpQueue(): void {
    if (this.closed) return;

    while (this.queuedJobs.length > 0) {
      let worker = this.findIdleWorker();
      if (!worker) {
        if (this.workers.size < this.maxWorkers) {
          worker = this.spawnWorker();
        } else {
          return;
        }
      }

      const job = this.queuedJobs.shift();
      if (!job) return;
      this.dispatchJob(worker, job);
    }
  }

  private findIdleWorker(): PooledWorker | undefined {
    for (const worker of this.workers.values()) {
      if (!worker.busy) return worker;
    }
    return undefined;
  }

  private spawnWorker(): PooledWorker {
    const id = this.nextWorkerId++;
    const worker = new Worker(this.workerScript, {
      eval: true,
      resourceLimits: this.resourceLimits,
    });

    const pooled: PooledWorker = {
      id,
      worker,
      busy: false,
      activeJobId: null,
      idleTimer: null,
    };

    worker.on('message', (message: unknown) => this.handleWorkerMessage(id, message));
    worker.on('error', (error: Error) => this.handleWorkerFailure(id, error));
    worker.on('exit', (code: number) => this.handleWorkerExit(id, code));

    this.workers.set(id, pooled);
    return pooled;
  }

  private dispatchJob(worker: PooledWorker, job: WorkerJob<TPayload, TResult>): void {
    worker.busy = true;
    worker.activeJobId = job.id;
    if (worker.idleTimer) {
      clearTimeout(worker.idleTimer);
      worker.idleTimer = null;
    }

    const timeoutHandle = setTimeout(() => {
      this.handleJobTimeout(job.id, job.timeoutMs);
    }, job.timeoutMs);

    this.activeJobs.set(job.id, {
      ...job,
      workerId: worker.id,
      timeoutHandle,
    });

    try {
      worker.worker.postMessage({
        jobId: job.id,
        payload: job.payload,
      });
    } catch (error) {
      const activeJob = this.activeJobs.get(job.id);
      if (activeJob?.timeoutHandle) clearTimeout(activeJob.timeoutHandle);
      this.activeJobs.delete(job.id);
      worker.busy = false;
      worker.activeJobId = null;
      job.reject(this.toError(error instanceof Error ? error.message : String(error)));
      void this.terminateWorker(worker.id).then(() => {
        this.ensureMinWorkers();
        this.pumpQueue();
      });
    }
  }

  private handleWorkerMessage(workerId: number, message: unknown): void {
    const envelope = message as Partial<WorkerResponseEnvelope<TResult>> | null;
    if (!envelope || typeof envelope !== 'object' || typeof envelope.jobId !== 'number') {
      return;
    }

    const activeJob = this.activeJobs.get(envelope.jobId);
    if (!activeJob) return;

    if (activeJob.timeoutHandle) clearTimeout(activeJob.timeoutHandle);
    this.activeJobs.delete(envelope.jobId);

    const worker = this.workers.get(workerId);
    if (worker) {
      worker.busy = false;
      worker.activeJobId = null;
      this.armIdleTimer(worker);
    }

    if (!envelope.ok) {
      activeJob.reject(this.toError(envelope.error ?? 'worker task failed'));
    } else if (typeof envelope.result === 'undefined') {
      activeJob.reject(this.toError('worker returned empty result'));
    } else {
      activeJob.resolve(envelope.result);
    }

    this.pumpQueue();
  }

  private handleWorkerFailure(workerId: number, error: Error): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    const activeJobId = worker.activeJobId;
    if (activeJobId !== null) {
      const activeJob = this.activeJobs.get(activeJobId);
      if (activeJob) {
        if (activeJob.timeoutHandle) clearTimeout(activeJob.timeoutHandle);
        this.activeJobs.delete(activeJobId);
        activeJob.reject(this.toError(error.message));
      }
    }

    void this.terminateWorker(workerId).then(() => {
      this.ensureMinWorkers();
      this.pumpQueue();
    });
  }

  private handleWorkerExit(workerId: number, code: number): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    const activeJobId = worker.activeJobId;
    this.workers.delete(workerId);
    if (worker.idleTimer) clearTimeout(worker.idleTimer);

    if (activeJobId !== null) {
      const activeJob = this.activeJobs.get(activeJobId);
      if (activeJob) {
        if (activeJob.timeoutHandle) clearTimeout(activeJob.timeoutHandle);
        this.activeJobs.delete(activeJobId);
        activeJob.reject(this.toError(`worker exited unexpectedly with code ${code}`));
      }
    }

    this.ensureMinWorkers();
    this.pumpQueue();
  }

  private handleJobTimeout(jobId: number, timeoutMs: number): void {
    const activeJob = this.activeJobs.get(jobId);
    if (!activeJob) return;
    this.activeJobs.delete(jobId);
    activeJob.reject(this.toError(`worker task timed out after ${timeoutMs}ms`));
    void this.terminateWorker(activeJob.workerId).then(() => {
      this.ensureMinWorkers();
      this.pumpQueue();
    });
  }

  private armIdleTimer(worker: PooledWorker): void {
    if (this.idleTimeoutMs <= 0 || this.workers.size <= this.minWorkers) return;
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    worker.idleTimer = setTimeout(() => {
      const current = this.workers.get(worker.id);
      if (!current || current.busy || this.workers.size <= this.minWorkers) return;
      void this.terminateWorker(worker.id);
    }, this.idleTimeoutMs);
  }

  private async terminateWorker(workerId: number): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    this.workers.delete(workerId);
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    worker.worker.removeAllListeners('message');
    worker.worker.removeAllListeners('error');
    worker.worker.removeAllListeners('exit');
    try {
      await worker.worker.terminate();
    } catch {
      // ignore
    }
  }

  private toError(message: string): Error {
    return new Error(`[${this.name}] ${message}`);
  }
}
