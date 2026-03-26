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

describe('WorkerPool – additional coverage', () => {
  beforeEach(() => {
    workerState.instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('handleWorkerFailure (lines 258-274)', () => {
    it('rejects active job and respawns worker on worker error event', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 2,
      });
      const worker = workerState.instances[0]!;

      const task = pool.submit({ v: 1 });
      expect(worker.postMessage).toHaveBeenCalledWith({ jobId: 1, payload: { v: 1 } });

      // Simulate worker error
      worker.emit('error', new Error('segfault'));

      await expect(task).rejects.toThrow('segfault');
      // Worker should be terminated and min workers re-ensured
      expect(worker.terminate).toHaveBeenCalled();

      await pool.close();
    });

    it('ignores error for unknown worker id', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 1,
      });
      const worker = workerState.instances[0]!;

      // Close pool first to clear workers map, then emit error
      await pool.close();
      // Emitting error on a worker whose id was already removed should not throw
      expect(() => worker.emit('error', new Error('late error'))).not.toThrow();
    });

    it('handles worker failure with no active job', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 2,
        maxWorkers: 4,
      });
      // 2 workers spawned for minWorkers
      expect(workerState.instances).toHaveLength(2);
      const worker = workerState.instances[0]!;

      // Worker is idle (no submitted job), emit error
      worker.emit('error', new Error('random crash'));
      // Worker should be terminated
      expect(worker.terminate).toHaveBeenCalled();

      // Wait for the async terminateWorker().then(ensureMinWorkers) chain
      await vi.advanceTimersByTimeAsync(0);

      // A replacement worker should be spawned to maintain minWorkers=2
      expect(workerState.instances.length).toBeGreaterThanOrEqual(3);

      await pool.close();
    });
  });

  describe('handleWorkerExit (lines 277-296)', () => {
    it('rejects active job when worker exits unexpectedly with non-zero code', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 2,
      });
      const worker = workerState.instances[0]!;

      const task = pool.submit({ v: 42 });

      // Simulate unexpected worker exit
      worker.emit('exit', 1);

      await expect(task).rejects.toThrow('worker exited unexpectedly with code 1');

      await pool.close();
    });

    it('cleans up idle timer on worker exit', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 0,
        maxWorkers: 2,
        idleTimeoutMs: 5000,
      });

      const task = pool.submit({ v: 1 });
      const worker = workerState.instances[0]!;

      // Complete job so worker becomes idle and gets idle timer
      worker.emit('message', { jobId: 1, ok: true, result: 10 });
      await expect(task).resolves.toBe(10);

      // Now simulate exit - idle timer should be cleaned up
      worker.emit('exit', 0);

      await pool.close();
    });

    it('ignores exit for unknown worker id', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 1,
      });

      await pool.close();
      // Exit event on already-removed worker should not throw
      const worker = workerState.instances[0]!;
      expect(() => worker.emit('exit', 0)).not.toThrow();
    });

    it('re-ensures min workers after unexpected exit', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 2,
        maxWorkers: 4,
      });
      expect(workerState.instances).toHaveLength(2);

      const firstWorker = workerState.instances[0]!;
      // Worker exits unexpectedly
      firstWorker.emit('exit', 1);

      // A replacement worker should be spawned to maintain minWorkers
      expect(workerState.instances.length).toBeGreaterThanOrEqual(3);

      await pool.close();
    });

    it('pumps queued jobs after worker exit spawns replacement', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 0,
        maxWorkers: 1,
      });

      // Submit two jobs - only first gets dispatched (maxWorkers=1)
      const task1 = pool.submit({ v: 1 });
      const task2 = pool.submit({ v: 2 });
      const worker1 = workerState.instances[0]!;

      // Worker exits while processing job1
      worker1.emit('exit', 1);
      await expect(task1).rejects.toThrow('worker exited unexpectedly');

      // A new worker should be spawned for the queued task2
      const worker2 = workerState.instances[1]!;
      expect(worker2).toBeDefined();
      worker2.emit('message', { jobId: 2, ok: true, result: 200 });
      await expect(task2).resolves.toBe(200);

      await pool.close();
    });
  });

  describe('armIdleTimer (lines 309-317)', () => {
    it('terminates idle worker after timeout when above minWorkers', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 0,
        maxWorkers: 2,
        idleTimeoutMs: 1000,
      });

      // Submit and complete a job
      const task = pool.submit({ v: 1 });
      const worker = workerState.instances[0]!;
      worker.emit('message', { jobId: 1, ok: true, result: 42 });
      await expect(task).resolves.toBe(42);

      // Advance past idle timeout
      vi.advanceTimersByTime(1001);

      // Worker should have been terminated
      expect(worker.terminate).toHaveBeenCalled();

      await pool.close();
    });

    it('does not terminate idle worker when at minWorkers', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 2,
        idleTimeoutMs: 1000,
      });
      const worker = workerState.instances[0]!;

      // Submit and complete a job
      const task = pool.submit({ v: 1 });
      worker.emit('message', { jobId: 1, ok: true, result: 42 });
      await expect(task).resolves.toBe(42);

      // Advance past idle timeout
      vi.advanceTimersByTime(1001);

      // Worker should NOT be terminated (at minWorkers)
      expect(worker.terminate).not.toHaveBeenCalled();

      await pool.close();
    });

    it('clears previous idle timer when re-arming', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 0,
        maxWorkers: 2,
        idleTimeoutMs: 2000,
      });

      // Submit first job to spawn a worker
      const task1 = pool.submit({ v: 1 });
      const worker = workerState.instances[0]!;
      worker.emit('message', { jobId: 1, ok: true, result: 10 });
      await expect(task1).resolves.toBe(10);

      // Advance partway through idle timeout
      vi.advanceTimersByTime(1500);

      // Submit and complete second job (should re-arm timer)
      const task2 = pool.submit({ v: 2 });
      worker.emit('message', { jobId: 2, ok: true, result: 20 });
      await expect(task2).resolves.toBe(20);

      // Advance past original timeout but not new one
      vi.advanceTimersByTime(1000);
      expect(worker.terminate).not.toHaveBeenCalled();

      // Now advance past the new idle timeout
      vi.advanceTimersByTime(1001);
      expect(worker.terminate).toHaveBeenCalled();

      await pool.close();
    });

    it('does not arm idle timer when idleTimeoutMs is 0', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 0,
        maxWorkers: 2,
        idleTimeoutMs: 0,
      });

      // Submit a job to spawn a worker
      const task = pool.submit({ v: 1 });
      const worker = workerState.instances[0]!;
      worker.emit('message', { jobId: 1, ok: true, result: 99 });
      await expect(task).resolves.toBe(99);

      // Even after a long time, worker should not be terminated
      vi.advanceTimersByTime(60000);
      expect(worker.terminate).not.toHaveBeenCalled();

      await pool.close();
    });
  });

  describe('handleWorkerMessage edge cases', () => {
    it('rejects when worker returns ok:false', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 1,
      });
      const worker = workerState.instances[0]!;

      const task = pool.submit({ v: 1 });
      worker.emit('message', { jobId: 1, ok: false, error: 'computation failed' });

      await expect(task).rejects.toThrow('computation failed');
      await pool.close();
    });

    it('rejects when worker returns ok:true but no result', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 1,
      });
      const worker = workerState.instances[0]!;

      const task = pool.submit({ v: 1 });
      worker.emit('message', { jobId: 1, ok: true });

      await expect(task).rejects.toThrow('worker returned empty result');
      await pool.close();
    });

    it('ignores messages with no jobId', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 1,
      });
      const worker = workerState.instances[0]!;

      const task = pool.submit({ v: 1 });
      // Send malformed message
      worker.emit('message', { something: 'random' });
      worker.emit('message', null);
      worker.emit('message', 42);

      // Job should still be pending, complete it normally
      worker.emit('message', { jobId: 1, ok: true, result: 7 });
      await expect(task).resolves.toBe(7);
      await pool.close();
    });

    it('ignores messages for unknown jobId', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 1,
      });
      const worker = workerState.instances[0]!;

      const task = pool.submit({ v: 1 });
      // Message with wrong jobId
      worker.emit('message', { jobId: 999, ok: true, result: 0 });

      // Complete correctly
      worker.emit('message', { jobId: 1, ok: true, result: 5 });
      await expect(task).resolves.toBe(5);
      await pool.close();
    });
  });

  describe('dispatchJob postMessage failure', () => {
    it('rejects job and terminates worker when postMessage throws', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 2,
      });

      // Get the pre-spawned worker from minWorkers=1
      const worker = workerState.instances[0]!;
      worker.postMessage.mockImplementation(() => {
        throw new Error('serialization failed');
      });

      const task = pool.submit({ v: 1 });
      await expect(task).rejects.toThrow('serialization failed');
      expect(worker.terminate).toHaveBeenCalled();

      await pool.close();
    });
  });

  describe('submit after close', () => {
    it('rejects submissions after pool is closed', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 1,
      });

      await pool.close();

      await expect(pool.submit({ v: 1 })).rejects.toThrow('pool is closed');
    });

    it('close is idempotent', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 1,
        maxWorkers: 1,
      });

      await pool.close();
      // Second close should be a no-op
      await expect(pool.close()).resolves.toBeUndefined();
    });
  });

  describe('pool exhaustion', () => {
    it('queues jobs beyond maxWorkers and processes them as workers free up', async () => {
      const pool = new WorkerPool<{ v: number }, number>({
        workerScript: 'mock-script',
        minWorkers: 0,
        maxWorkers: 2,
      });

      // Submit 4 jobs with only 2 max workers
      const tasks = [
        pool.submit({ v: 1 }),
        pool.submit({ v: 2 }),
        pool.submit({ v: 3 }),
        pool.submit({ v: 4 }),
      ];

      // Only 2 workers should be created
      expect(workerState.instances).toHaveLength(2);

      // Complete first two jobs
      workerState.instances[0]!.emit('message', { jobId: 1, ok: true, result: 10 });
      workerState.instances[1]!.emit('message', { jobId: 2, ok: true, result: 20 });
      await expect(tasks[0]).resolves.toBe(10);
      await expect(tasks[1]).resolves.toBe(20);

      // The remaining jobs should now be dispatched
      workerState.instances[0]!.emit('message', { jobId: 3, ok: true, result: 30 });
      workerState.instances[1]!.emit('message', { jobId: 4, ok: true, result: 40 });
      await expect(tasks[2]).resolves.toBe(30);
      await expect(tasks[3]).resolves.toBe(40);

      await pool.close();
    });
  });
});
