import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  return { Worker: WorkerCtor };
});

import { WorkerPool } from '@utils/WorkerPool';

describe('WorkerPool', () => {
  beforeEach(() => {
    workerState.instances = [];
  });

  describe('constructor', () => {
    it('should create pool with valid options', () => {
      const pool = new WorkerPool({
        workerScript: 'test-worker.js',
        minWorkers: 0,
        maxWorkers: 2,
      });
      expect(pool).toBeDefined();
    });

    it('should throw if workerScript is empty', () => {
      expect(() => new WorkerPool({ workerScript: '', minWorkers: 0, maxWorkers: 1 })).toThrow(
        'workerScript must be a non-empty string',
      );
    });

    it('should throw if workerScript is whitespace', () => {
      expect(() => new WorkerPool({ workerScript: '   ', minWorkers: 0, maxWorkers: 1 })).toThrow(
        'workerScript must be a non-empty string',
      );
    });

    it('should throw if minWorkers is negative', () => {
      expect(() => new WorkerPool({ workerScript: 'w.js', minWorkers: -1, maxWorkers: 1 })).toThrow(
        'minWorkers',
      );
    });

    it('should throw if maxWorkers is less than 1', () => {
      expect(() => new WorkerPool({ workerScript: 'w.js', minWorkers: 0, maxWorkers: 0 })).toThrow(
        'maxWorkers',
      );
    });

    it('should throw if minWorkers > maxWorkers', () => {
      expect(() => new WorkerPool({ workerScript: 'w.js', minWorkers: 3, maxWorkers: 1 })).toThrow(
        'minWorkers cannot be greater than maxWorkers',
      );
    });

    it('should spawn minWorkers on creation', () => {
      const pool = new WorkerPool({
        workerScript: 'test-worker.js',
        minWorkers: 2,
        maxWorkers: 4,
      });
      expect(workerState.instances.length).toBe(2);
      pool.close();
    });
  });

  describe('submit', () => {
    it('should reject after pool is closed', async () => {
      const pool = new WorkerPool({
        workerScript: 'test-worker.js',
        minWorkers: 0,
        maxWorkers: 1,
      });
      await pool.close();
      await expect(pool.submit({ type: 'test' })).rejects.toThrow('pool is closed');
    });
  });

  describe('close', () => {
    it('should be idempotent', async () => {
      const pool = new WorkerPool({
        workerScript: 'test-worker.js',
        minWorkers: 0,
        maxWorkers: 1,
      });
      await pool.close();
      await pool.close(); // second close should not throw
    });

    it('should terminate spawned workers', async () => {
      const pool = new WorkerPool({
        workerScript: 'test-worker.js',
        minWorkers: 1,
        maxWorkers: 2,
      });
      expect(workerState.instances.length).toBe(1);
      await pool.close();
      expect(workerState.instances[0]?.terminate).toHaveBeenCalled();
    });
  });
});
