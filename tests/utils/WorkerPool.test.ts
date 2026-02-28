import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      public readonly options: Record<string, unknown>
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

import { WorkerPool } from '../../src/utils/WorkerPool.js';

describe('WorkerPool', () => {
  beforeEach(() => {
    workerState.instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('validates constructor options', () => {
    expect(() => new WorkerPool<any, any>({ workerScript: '   ' })).toThrow('workerScript');
    expect(
      () => new WorkerPool<any, any>({ workerScript: 'x', minWorkers: 3, maxWorkers: 2 })
    ).toThrow('minWorkers cannot be greater than maxWorkers');
    expect(() => new WorkerPool<any, any>({ workerScript: 'x', maxWorkers: 0 })).toThrow(
      'maxWorkers'
    );
  });

  it('spawns minimum workers on creation', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 2,
      maxWorkers: 2,
    });

    expect(workerState.instances).toHaveLength(2);
    await pool.close();
  });

  it('executes jobs and resolves on successful worker message', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;

    const task = pool.submit({ value: 7 });
    expect(worker.postMessage).toHaveBeenCalledWith({ jobId: 1, payload: { value: 7 } });

    worker.emit('message', { jobId: 1, ok: true, result: 99 });
    await expect(task).resolves.toBe(99);

    expect(worker.terminate).not.toHaveBeenCalled();
    await pool.close();
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('rejects on worker timeout and terminates worker', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 0,
      maxWorkers: 1,
    });

    const task = pool.submit({ value: 1 }, 10);
    const worker = workerState.instances[0]!;
    vi.advanceTimersByTime(11);
    await expect(task).rejects.toThrow('timed out');
    expect(worker.terminate).toHaveBeenCalled();

    await pool.close();
  });

  it('queues jobs when max workers are busy', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;

    const first = pool.submit({ value: 1 });
    const second = pool.submit({ value: 2 });

    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenNthCalledWith(1, { jobId: 1, payload: { value: 1 } });

    worker.emit('message', { jobId: 1, ok: true, result: 10 });
    await expect(first).resolves.toBe(10);

    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, { jobId: 2, payload: { value: 2 } });
    worker.emit('message', { jobId: 2, ok: true, result: 20 });
    await expect(second).resolves.toBe(20);

    await pool.close();
  });

  it('rejects active and queued jobs when closed', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });

    const first = pool.submit({ value: 1 });
    const second = pool.submit({ value: 2 });

    await pool.close();
    await expect(first).rejects.toThrow('pool is closed');
    await expect(second).rejects.toThrow('pool is closed');
  });
});
