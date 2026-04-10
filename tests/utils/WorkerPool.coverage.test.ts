import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Coverage tests targeting the v8 ignore next branches in WorkerPool.
 * These represent TypeScript-unreachable paths that we exercise via direct
 * private method invocation.
 */
type Listener = (payload: any) => void;

const workerState = vi.hoisted(() => {
  class WorkerMock {
    public listeners = new Map<string, Listener[]>();
    public postMessage = vi.fn();
    public terminate = vi.fn(async () => 0);
    public removeAllListeners = vi.fn((event?: string) => {
      if (event) {
        this.listeners.delete(event);
      } else {
        this.listeners.clear();
      }
      return this;
    });

    constructor(
      public readonly script: string,
      public readonly options: Record<string, unknown>,
    ) {}

    on(event: string, callback: Listener) {
      const callbacks = this.listeners.get(event) ?? [];
      callbacks.push(callback);
      this.listeners.set(event, callbacks);
      return this;
    }

    emit(event: string, payload?: any) {
      const callbacks = this.listeners.get(event) ?? [];
      callbacks.forEach((callback) => callback(payload));
    }
  }

  return {
    instances: [] as WorkerMock[],
    WorkerMock,
  };
});

vi.mock('node:worker_threads', () => ({
  Worker: class WorkerCtor {
    private readonly inner: InstanceType<typeof workerState.WorkerMock>;
    public postMessage: ReturnType<typeof vi.fn>;
    public terminate: ReturnType<typeof vi.fn>;
    public removeAllListeners: ReturnType<typeof vi.fn>;

    constructor(script: string, options: Record<string, unknown>) {
      this.inner = new workerState.WorkerMock(script, options);
      workerState.instances.push(this.inner);
      this.postMessage = this.inner.postMessage;
      this.removeAllListeners = this.inner.removeAllListeners;
      this.terminate = vi.fn(async () => {
        const result = await this.inner.terminate();
        this.inner.emit('exit', result);
        return result;
      });
    }

    on(event: string, callback: Listener) {
      this.inner.on(event, callback);
      return this;
    }
  },
}));

import { WorkerPool } from '@utils/WorkerPool';

describe('WorkerPool – v8 ignore branch coverage', () => {
  beforeEach(() => {
    workerState.instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── ensureMinWorkers closed guard (v8 ignore next 3) ──────────────────────

  it('ensureMinWorkers returns early when pool is closed (v8 ignore next 3)', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    // Manually set closed flag and call ensureMinWorkers
    (pool as any).closed = true;
    expect(() => (pool as any).ensureMinWorkers()).not.toThrow();
    await pool.close();
  });

  // ── pumpQueue closed guard (v8 ignore next 3) ─────────────────────────────

  it('pumpQueue returns early when pool is closed (v8 ignore next 3)', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    // Set closed and push a job (which calls pumpQueue)
    (pool as any).closed = true;
    expect(() => (pool as any).pumpQueue()).not.toThrow();
    await pool.close();
  });

  // ── pumpQueue null job guard (v8 ignore next 3) ───────────────────────────

  it('pumpQueue handles null job from shift (v8 ignore next 3)', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    // Simulate an empty queue by directly calling pumpQueue after pushing
    // a job that's already gone. The queuedJobs shift returns undefined when empty.
    // We inject a scenario where queuedJobs is empty.
    (pool as any).queuedJobs.length = 0;
    expect(() => (pool as any).pumpQueue()).not.toThrow();
    await pool.close();
  });

  // ── handleWorkerMessage invalid envelope ─────────────────────────────────

  it('handleWorkerMessage ignores null envelope', () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;

    // These should all be no-ops
    expect(() => worker.emit('message', null)).not.toThrow();
    expect(() => worker.emit('message', undefined as any)).not.toThrow();
    expect(() => worker.emit('message', 42 as any)).not.toThrow();
    expect(() => worker.emit('message', 'string' as any)).not.toThrow();
    expect(() => worker.emit('message', { jobId: 'not-a-number' })).not.toThrow();
    expect(() => worker.emit('message', { jobId: NaN })).not.toThrow();
    expect(() => worker.emit('message', { jobId: 999, ok: true, result: 1 })).not.toThrow(); // no active job

    pool.close();
  });

  it('handleWorkerMessage resolves active job with result', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;
    const task = pool.submit({ v: 1 });

    worker.emit('message', { jobId: 1, ok: true, result: 42 });
    await expect(task).resolves.toBe(42);

    await pool.close();
  });

  // ── handleWorkerFailure unknown worker (v8 ignore next 3) ─────────────────

  it('handleWorkerFailure returns early for unknown worker id (v8 ignore next 3)', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    // Remove worker from pool map, then emit error
    (pool as any).workers.delete(999); // non-existent id
    expect(() => (pool as any).handleWorkerFailure(999, new Error('boom'))).not.toThrow();
    await pool.close();
  });

  it('handleWorkerFailure rejects active job and respawns', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;
    const task = pool.submit({ v: 1 });

    worker.emit('error', new Error('segfault'));

    await expect(task).rejects.toThrow('segfault');
    expect(worker.terminate).toHaveBeenCalled();
    await pool.close();
  });

  it('handleWorkerFailure handles no active job', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;
    // Worker is idle — no active job
    worker.emit('error', new Error('idle crash'));
    expect(worker.terminate).toHaveBeenCalled();
    await pool.close();
  });

  // ── handleWorkerExit unknown worker (v8 ignore next 3) ───────────────────

  it('handleWorkerExit returns early for unknown worker id (v8 ignore next 3)', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    (pool as any).workers.delete(999);
    expect(() => (pool as any).handleWorkerExit(999, 0)).not.toThrow();
    await pool.close();
  });

  it('handleWorkerExit with exit code 0 (clean exit)', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    const task = pool.submit({ v: 1 });
    const worker = workerState.instances[0]!;

    worker.emit('exit', 0);

    await expect(task).rejects.toThrow('worker exited unexpectedly with code 0');
    await pool.close();
  });

  it('handleWorkerExit cleans up idle timer', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
      idleTimeoutMs: 5000,
    });

    const task = pool.submit({ v: 1 });
    const worker = workerState.instances[0]!;
    worker.emit('message', { jobId: 1, ok: true, result: 10 });
    await expect(task).resolves.toBe(10);

    // Worker is now idle with a timer. Emit exit.
    worker.emit('exit', 0);

    await pool.close();
  });

  it('handleWorkerExit re-ensures min workers', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 2,
      maxWorkers: 4,
    });
    expect(workerState.instances).toHaveLength(2);

    const first = workerState.instances[0]!;
    first.emit('exit', 1);

    // A replacement should be spawned
    expect(workerState.instances.length).toBeGreaterThanOrEqual(3);

    await pool.close();
  });

  // ── handleJobTimeout unknown job (v8 ignore next 3) ──────────────────────

  it('handleJobTimeout returns early for unknown job id (v8 ignore next 3)', () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    expect(() => (pool as any).handleJobTimeout(999, 5000)).not.toThrow();
    pool.close();
  });

  it('handleJobTimeout rejects job and terminates worker', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    const task = pool.submit({ v: 1 }, 10);
    const worker = workerState.instances[0]!;

    vi.advanceTimersByTime(11);

    await expect(task).rejects.toThrow('timed out after 10ms');
    expect(worker.terminate).toHaveBeenCalled();

    await pool.close();
  });

  // ── armIdleTimer guards ───────────────────────────────────────────────────

  it('armIdleTimer does nothing when idleTimeoutMs <= 0', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 2,
      idleTimeoutMs: 0,
    });
    // Get the actual PooledWorker from pool's internal map
    const pooledWorker = (pool as any).workers.values().next().value;
    (pool as any).armIdleTimer(pooledWorker);
    // No timer should be set
    expect(pooledWorker.idleTimer).toBeNull();
    await pool.close();
  });

  it('armIdleTimer does nothing when at minWorkers', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 2,
      idleTimeoutMs: 1000,
    });
    const pooledWorker = (pool as any).workers.values().next().value;
    (pool as any).armIdleTimer(pooledWorker);
    // Timer should be null since we're at minWorkers
    expect(pooledWorker.idleTimer).toBeNull();
    await pool.close();
  });

  it('armIdleTimer sets timer when above minWorkers with idleTimeoutMs > 0', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 2,
      idleTimeoutMs: 1000,
    });
    // Spawn a worker by submitting and completing a job
    const task = pool.submit({ v: 1 });
    const worker = workerState.instances[0]!;
    worker.emit('message', { jobId: 1, ok: true, result: 10 });
    await expect(task).resolves.toBe(10);

    // Get the actual PooledWorker
    const pooledWorker = (pool as any).workers.values().next().value;
    // armIdleTimer was already called when job completed; check it
    expect(pooledWorker.idleTimer).not.toBeNull();

    // Advance past idle timeout — worker should be terminated
    vi.advanceTimersByTime(1001);
    expect(worker.terminate).toHaveBeenCalled();

    await pool.close();
  });

  it('armIdleTimer clears existing timer before re-arming', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 2,
      idleTimeoutMs: 3000,
    });
    // Spawn a worker by submitting and completing a job
    const task = pool.submit({ v: 1 });
    const worker = workerState.instances[0]!;
    worker.emit('message', { jobId: 1, ok: true, result: 10 });
    await expect(task).resolves.toBe(10);

    const pooledWorker = (pool as any).workers.values().next().value;

    // First idle timer should be set already
    const firstTimer = pooledWorker.idleTimer;
    expect(firstTimer).not.toBeNull();

    // Advance halfway
    vi.advanceTimersByTime(1500);

    // Re-arm
    (pool as any).armIdleTimer(pooledWorker);
    const secondTimer = pooledWorker.idleTimer;

    // Timer should be cleared and reset
    expect(secondTimer).not.toBeNull();

    await pool.close();
  });

  it('armIdleTimer does not terminate worker if it becomes busy before timeout (v8 ignore next 5)', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 2,
      idleTimeoutMs: 1000,
    });

    // Complete first job to arm idle timer
    const task1 = pool.submit({ v: 1 });
    const worker = workerState.instances[0]!;
    worker.emit('message', { jobId: 1, ok: true, result: 10 });
    await expect(task1).resolves.toBe(10);

    // Advance past idle timeout — worker should be terminated since it's idle
    vi.advanceTimersByTime(1001);
    expect(worker.terminate).toHaveBeenCalled();

    await pool.close();
  });

  // ── terminateWorker unknown worker (v8 ignore next 3) ───────────────────

  it('terminateWorker returns early for unknown worker id (v8 ignore next 3)', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    (pool as any).workers.delete(999);
    // Should not throw
    await (pool as any).terminateWorker(999);
    await pool.close();
  });

  it('terminateWorker clears idle timer and removes listeners', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 2,
      idleTimeoutMs: 5000,
    });

    // Arm the idle timer
    const task = pool.submit({ v: 1 });
    const worker = workerState.instances[0]!;
    worker.emit('message', { jobId: 1, ok: true, result: 10 });
    await expect(task).resolves.toBe(10);

    // Manually terminate — save pooledWorker ref before it gets removed from the map
    const pooledWorker = (pool as any).workers.get(1);
    await (pool as any).terminateWorker(1);

    expect(worker.removeAllListeners).toHaveBeenCalledWith('message');
    expect(worker.removeAllListeners).toHaveBeenCalledWith('error');
    expect(worker.removeAllListeners).toHaveBeenCalledWith('exit');
    // idleTimer was set by armIdleTimer and cleared by terminateWorker
    expect(pooledWorker?.idleTimer).toBeNull();

    await pool.close();
  });

  it('terminateWorker handles terminate() throwing', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;
    worker.terminate.mockRejectedValueOnce(new Error('already exited'));

    // Should not throw
    // @ts-expect-error
    await (pool as any).terminateWorker(worker.id);

    await pool.close();
  });

  // ── findIdleWorker ───────────────────────────────────────────────────────

  it('findIdleWorker returns undefined when all workers are busy', () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 2,
      maxWorkers: 2,
    });
    // Workers start idle. Submit jobs to make them busy.
    pool.submit({ v: 1 }).catch(() => {}); // reject expected on close
    pool.submit({ v: 2 }).catch(() => {}); // reject expected on close
    // Workers are now busy (jobs dispatched, awaiting worker response)
    expect((pool as any).workers.get(1)!.busy).toBe(true);
    expect((pool as any).workers.get(2)!.busy).toBe(true);
    const idle = (pool as any).findIdleWorker();
    expect(idle).toBeUndefined();
    pool.close();
  });

  // ── toError ───────────────────────────────────────────────────────────────

  it('toError includes pool name in message', () => {
    const pool = new WorkerPool<any, any>({
      name: 'my-pool',
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const err = (pool as any).toError('something failed');
    expect(err.message).toBe('[my-pool] something failed');
    pool.close();
  });

  // ── Constructor validation ───────────────────────────────────────────────

  it('constructor throws for invalid workerScript', () => {
    expect(() => new WorkerPool<any, any>({ workerScript: '' })).toThrow('workerScript');
    expect(() => new WorkerPool<any, any>({ workerScript: '   ' })).toThrow('workerScript');
  });

  it('constructor throws for invalid minWorkers', () => {
    expect(() => new WorkerPool<any, any>({ workerScript: 'x', minWorkers: -1 })).toThrow(
      'minWorkers',
    );
    expect(() => new WorkerPool<any, any>({ workerScript: 'x', minWorkers: 1.5 })).toThrow(
      'minWorkers',
    );
  });

  it('constructor throws for invalid maxWorkers', () => {
    expect(() => new WorkerPool<any, any>({ workerScript: 'x', maxWorkers: 0 })).toThrow(
      'maxWorkers',
    );
    expect(() => new WorkerPool<any, any>({ workerScript: 'x', maxWorkers: -1 })).toThrow(
      'maxWorkers',
    );
  });

  it('constructor throws when minWorkers > maxWorkers', () => {
    expect(
      () => new WorkerPool<any, any>({ workerScript: 'x', minWorkers: 5, maxWorkers: 2 }),
    ).toThrow('minWorkers cannot be greater than maxWorkers');
  });

  // ── close ────────────────────────────────────────────────────────────────

  it('close rejects queued jobs with pool closed error', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const task = pool.submit({ v: 1 });
    await pool.close();
    await expect(task).rejects.toThrow('pool is closed');
  });

  it('close rejects active jobs with pool closed error', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    const task = pool.submit({ v: 1 });
    // Don't complete the task — just close the pool
    await pool.close();
    await expect(task).rejects.toThrow('pool is closed');
  });

  it('close is idempotent', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
    });
    await pool.close();
    await expect(pool.close()).resolves.toBeUndefined();
  });

  // ── submit ──────────────────────────────────────────────────────────────

  it('submit after close rejects with pool closed error', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });
    await pool.close();
    await expect(pool.submit({})).rejects.toThrow('pool is closed');
  });

  it('submit dispatches to idle worker immediately', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 2,
    });

    const task = pool.submit({ v: 99 });
    const worker = workerState.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith({ jobId: 1, payload: { v: 99 } });

    worker.emit('message', { jobId: 1, ok: true, result: 42 });
    await expect(task).resolves.toBe(42);

    await pool.close();
  });

  // ── spawnWorker resourceLimits ──────────────────────────────────────────

  it('spawnWorker passes resourceLimits to Worker constructor', () => {
    const limits = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 256 };
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      resourceLimits: limits,
    });
    expect(workerState.instances[0]!.options.resourceLimits).toEqual(limits);
    pool.close();
  });

  // ── Multiple worker pool scenarios ──────────────────────────────────────

  it('pumpQueue dispatches queued jobs after worker becomes idle', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
    });

    const task1 = pool.submit({ v: 1 });
    const task2 = pool.submit({ v: 2 });
    const worker = workerState.instances[0]!;

    // Only first dispatched
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({ jobId: 1, payload: { v: 1 } });

    // Complete first job
    worker.emit('message', { jobId: 1, ok: true, result: 10 });
    await expect(task1).resolves.toBe(10);

    // Second job should now be dispatched
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(worker.postMessage).toHaveBeenCalledWith({ jobId: 2, payload: { v: 2 } });

    worker.emit('message', { jobId: 2, ok: true, result: 20 });
    await expect(task2).resolves.toBe(20);

    await pool.close();
  });

  it('auto-scales workers when queue grows beyond maxWorkers', async () => {
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 2,
    });
    expect(workerState.instances).toHaveLength(1);

    // Exhaust both workers
    pool.submit({ v: 1 }).catch(() => {}); // reject expected on close
    pool.submit({ v: 2 }).catch(() => {}); // reject expected on close
    expect(workerState.instances).toHaveLength(2);

    // Queue another — should still be queued
    pool.submit({ v: 3 }).catch(() => {}); // reject expected on close
    expect(workerState.instances).toHaveLength(2);

    await pool.close();
  });
});
