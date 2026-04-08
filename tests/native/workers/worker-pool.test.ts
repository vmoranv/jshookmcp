import { describe, it, expect, vi, beforeEach } from 'vitest';

const workerMocks = vi.hoisted(() => ({
  MockWorker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    postMessage: vi.fn(),
    terminate: vi.fn(async () => 0),
  })),
}));

vi.mock('node:worker_threads', () => ({
  Worker: workerMocks.MockWorker,
}));

import {
  createHeapSnapshotWorker,
  createFFIProxyWorker,
  resolveWorkerScript,
  WORKER_SCRIPTS,
} from '@native/workers/worker-pool';

describe('worker-pool', () => {
  beforeEach(() => {
    workerMocks.MockWorker.mockClear();
  });

  describe('WORKER_SCRIPTS', () => {
    it('should define heapSnapshot script name', () => {
      expect(WORKER_SCRIPTS.heapSnapshot).toBe('heap-snapshot');
    });

    it('should define ffiProxy script name', () => {
      expect(WORKER_SCRIPTS.ffiProxy).toBe('ffi-proxy');
    });
  });

  describe('resolveWorkerScript', () => {
    it('should resolve heap-snapshot worker path', () => {
      const path = resolveWorkerScript('heap-snapshot');
      expect(path).toContain('heap-snapshot.worker.js');
    });

    it('should resolve ffi-proxy worker path', () => {
      const path = resolveWorkerScript('ffi-proxy');
      expect(path).toContain('ffi-proxy.worker.js');
    });

    it('should resolve any named worker script', () => {
      const path = resolveWorkerScript('custom-worker');
      expect(path).toContain('custom-worker.worker.js');
    });
  });

  describe('createHeapSnapshotWorker', () => {
    it('should create a Worker instance with correct script path', () => {
      createHeapSnapshotWorker();
      expect(workerMocks.MockWorker).toHaveBeenCalledWith(
        expect.stringContaining('heap-snapshot.worker.js'),
      );
    });
  });

  describe('createFFIProxyWorker', () => {
    it('should create a Worker instance with correct script path', () => {
      createFFIProxyWorker();
      expect(workerMocks.MockWorker).toHaveBeenCalledWith(
        expect.stringContaining('ffi-proxy.worker.js'),
      );
    });
  });
});
