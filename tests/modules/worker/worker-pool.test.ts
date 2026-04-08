import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TaskMessage } from '@modules/worker/types';
import { TaskType } from '@modules/worker/types';

type Listener = (payload: unknown) => void;

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

    emit(event: string, payload?: unknown) {
      const callbacks = this.listeners.get(event) ?? [];
      callbacks.forEach((callback) => callback(payload));
    }
  }

  return {
    instances: [] as WorkerMock[],
    WorkerMock,
  };
});

vi.mock('node:worker_threads', () => {
  class WorkerCtor {
    private readonly inner: InstanceType<typeof workerState.WorkerMock>;

    public postMessage: ReturnType<typeof vi.fn>;
    public terminate: ReturnType<typeof vi.fn>;
    public removeAllListeners: ReturnType<typeof vi.fn>;

    constructor(script: string, options: Record<string, unknown>) {
      this.inner = new workerState.WorkerMock(script, options);
      workerState.instances.push(this.inner);
      this.postMessage = this.inner.postMessage;
      this.terminate = this.inner.terminate;
      this.removeAllListeners = this.inner.removeAllListeners;
    }

    on(event: string, callback: Listener) {
      this.inner.on(event, callback);
      return this;
    }
  }

  return {
    Worker: WorkerCtor,
  };
});

import { WorkerPool } from '@modules/worker/WorkerPool';

function makeTask(id: string, type: TaskType = TaskType.FfiCall): TaskMessage {
  return { type, id, payload: {} };
}

describe('WorkerPool', () => {
  beforeEach(() => {
    workerState.instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should spawn the configured number of workers', () => {
    const pool = new WorkerPool(
      { poolSize: 3, maxQueueSize: 10, defaultTimeout: 5000, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    expect(workerState.instances).toHaveLength(3);
    expect(pool.getStats().workerCount).toBe(3);
    expect(pool.getStats().activeTasks).toBe(0);
  });

  it('should default pool size to Math.max(2, cpus - 1) when not specified', () => {
    const pool = new WorkerPool(
      { maxQueueSize: 10, defaultTimeout: 5000, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    const expected = Math.max(2, require('os').cpus().length - 1);
    expect(pool.getStats().workerCount).toBe(expected);
  });

  it('should throw if poolSize is invalid', () => {
    expect(
      () =>
        new WorkerPool(
          { poolSize: 0, maxQueueSize: 10, defaultTimeout: 5000, healthCheckInterval: 0 },
          () => 'test-worker.js',
        ),
    ).toThrow('poolSize must be a positive integer');
  });

  it('should throw if maxQueueSize is negative', () => {
    expect(
      () =>
        new WorkerPool(
          { poolSize: 2, maxQueueSize: -1, defaultTimeout: 5000, healthCheckInterval: 0 },
          () => 'test-worker.js',
        ),
    ).toThrow('maxQueueSize must be a non-negative integer');
  });

  it('should submit tasks to idle workers', async () => {
    const pool = new WorkerPool(
      { poolSize: 2, maxQueueSize: 10, defaultTimeout: 5000, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    const promise = pool.submit(makeTask('task-1'));

    expect(pool.getStats().activeTasks).toBe(1);

    // Simulate worker response
    const worker = workerState.instances[0];
    expect(worker).toBeDefined();
    worker!.emit('message', { id: 'task-1', success: true, data: { result: 'ok' } });

    await expect(promise).resolves.toEqual({ result: 'ok' });
    expect(pool.getStats().totalCompleted).toBe(1);
  });

  it('should reject tasks when worker returns error', async () => {
    const pool = new WorkerPool(
      { poolSize: 1, maxQueueSize: 10, defaultTimeout: 5000, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    const promise = pool.submit(makeTask('task-1'));

    const worker = workerState.instances[0];
    expect(worker).toBeDefined();
    worker!.emit('message', { id: 'task-1', success: false, error: 'worker failed' });

    await expect(promise).rejects.toThrow('worker failed');
    expect(pool.getStats().totalFailed).toBe(1);
  });

  it('should queue tasks when all workers are busy', async () => {
    const pool = new WorkerPool(
      { poolSize: 1, maxQueueSize: 10, defaultTimeout: 5000, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    const promise1 = pool.submit(makeTask('task-1'));
    void pool.submit(makeTask('task-2'));

    expect(pool.getStats().activeTasks).toBe(1);
    expect(pool.getStats().queuedTasks).toBe(1);

    // Complete first task
    const worker = workerState.instances[0];
    expect(worker).toBeDefined();
    worker!.emit('message', { id: 'task-1', success: true, data: 'done' });

    await expect(promise1).resolves.toBe('done');
    // Second task should now be dispatched
    expect(pool.getStats().activeTasks).toBe(1);
  });

  it('should reject tasks when pool is full', async () => {
    const pool = new WorkerPool(
      { poolSize: 1, maxQueueSize: 2, defaultTimeout: 5000, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    // 1 active + 1 queued = 2 (at limit)
    pool.submit(makeTask('task-1'));
    pool.submit(makeTask('task-2'));

    // Next task should be rejected
    await expect(pool.submit(makeTask('task-3'))).rejects.toThrow('Queue full');
  });

  it('should reject tasks when pool is shutting down', async () => {
    const pool = new WorkerPool(
      { poolSize: 1, maxQueueSize: 10, defaultTimeout: 5000, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    // Start shutdown
    const shutdownPromise = pool.shutdown(100);

    await expect(pool.submit(makeTask('task-1'))).rejects.toThrow('shutting down');

    await shutdownPromise;
  });

  it('should drain queue on shutdown', async () => {
    const pool = new WorkerPool(
      { poolSize: 1, maxQueueSize: 10, defaultTimeout: 100, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    const promise1 = pool.submit(makeTask('task-1'));
    const promise2 = pool.submit(makeTask('task-2'));

    // Attach error handlers to prevent unhandled rejection warnings
    void promise1.catch(() => {});
    void promise2.catch(() => {});

    // Advance timers to trigger timeout on active task
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise1).rejects.toThrow('timed out');
    await expect(promise2).rejects.toThrow('timed out');

    // Now shutdown should be fast (no active tasks)
    await pool.shutdown(100);

    // Small delay to let any lingering timers settle
    await vi.advanceTimersByTimeAsync(50);
  });

  it('should report accurate stats', () => {
    const pool = new WorkerPool(
      { poolSize: 2, maxQueueSize: 10, defaultTimeout: 5000, healthCheckInterval: 0 },
      () => 'test-worker.js',
    );

    pool.submit(makeTask('task-1'));
    pool.submit(makeTask('task-2'));
    pool.submit(makeTask('task-3'));

    const stats = pool.getStats();
    expect(stats.workerCount).toBe(2);
    expect(stats.activeTasks).toBe(2);
    expect(stats.queuedTasks).toBe(1);
    expect(stats.totalCompleted).toBe(0);
  });
});
