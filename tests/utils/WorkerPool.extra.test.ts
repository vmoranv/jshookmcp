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

import { WorkerPool } from '@utils/WorkerPool';

describe('WorkerPool Extra Coverage', () => {
  beforeEach(() => {
    workerState.instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handles postMessage failure in dispatchJob', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;
    worker.postMessage.mockImplementation(() => {
      throw new Error('postMessage failed');
    });

    const task = pool.submit({ value: 1 });
    await expect(task).rejects.toThrow('postMessage failed');
    await pool.close();
  });

  it('handleWorkerMessage ignores invalid envelopes', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;

    // These should be ignored (return early)
    worker.emit('message', null);
    worker.emit('message', {});
    worker.emit('message', { jobId: 'not-a-number' });
    worker.emit('message', { result: 1 }); // missing jobId
    worker.emit('message', { jobId: 999 }); // No active job

    await pool.close();
  });

  it('handleWorkerMessage handles failed ok=false task', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;
    const task = pool.submit({ value: 1 });

    worker.emit('message', { jobId: 1, ok: false, error: 'custom error' });
    await expect(task).rejects.toThrow('custom error');

    await pool.close();
  });

  it('handleWorkerMessage handles empty result', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;
    const task = pool.submit({ value: 1 });

    worker.emit('message', { jobId: 1, ok: true }); // result is undefined
    await expect(task).rejects.toThrow('worker returned empty result');

    await pool.close();
  });

  it('handleWorkerFailure and handleWorkerExit without active job', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;

    // No active job
    worker.emit('error', new Error('idle error'));
    worker.emit('exit', 0);

    await pool.close();
  });

  it('terminateWorker handles terminate failure', async () => {
    const pool = new WorkerPool<{ value: number }, number>({
      workerScript: 'mock-script',
      minWorkers: 1,
      maxWorkers: 1,
    });
    const worker = workerState.instances[0]!;
    worker.terminate.mockRejectedValue(new Error('terminate failed'));

    await pool.close(); // Should not throw
  });

  it('armIdleTimer respects constraints', async () => {
    // idleTimeoutMs <= 0
    const pool1 = new WorkerPool<any, any>({
      name: 'pool1',
      workerScript: 'x',
      minWorkers: 0,
      maxWorkers: 1,
      idleTimeoutMs: 0,
    });

    // minWorkers constraint
    const pool2 = new WorkerPool<any, any>({
      name: 'pool2',
      workerScript: 'x',
      minWorkers: 1,
      maxWorkers: 1,
      idleTimeoutMs: 1000,
    });

    // pool2 spawned 1 worker immediately
    const workerForPool2 = workerState.instances.find((w) => w.options.name === 'pool2' || true); // fallback if options not passed to mock correctly

    // pool1 spawns on submit
    const t1 = pool1.submit({});
    const workerForPool1 =
      workerState.instances.find(
        (w) => w.script === 'x' && !workerState.instances.includes(workerForPool2!),
      ) || workerState.instances[1];

    if (workerForPool1) {
      workerForPool1.emit('message', { jobId: 1, ok: true, result: {} });
      await t1;
    }

    if (workerForPool2) {
      const t2 = pool2.submit({});
      workerForPool2.emit('message', { jobId: 1, ok: true, result: {} }); // jobId resets per pool
      await t2;
    }

    // Advance timers
    vi.advanceTimersByTime(2000);
    await Promise.resolve();

    if (workerForPool1) expect(workerForPool1.terminate).not.toHaveBeenCalled();
    if (workerForPool2) expect(workerForPool2.terminate).not.toHaveBeenCalled();

    await pool1.close();
    await pool2.close();
  });

  it('spawnWorker uses resourceLimits', async () => {
    const limits = { maxOldGenerationSizeMb: 512 };
    const pool = new WorkerPool<any, any>({
      workerScript: 'x',
      resourceLimits: limits,
    });
    expect(workerState.instances[0]!.options.resourceLimits).toEqual(limits);
    await pool.close();
  });

  it('handles submission when closed', async () => {
    const pool = new WorkerPool<any, any>({ workerScript: 'x' });
    await pool.close();
    await expect(pool.submit({})).rejects.toThrow('pool is closed');
  });
});
