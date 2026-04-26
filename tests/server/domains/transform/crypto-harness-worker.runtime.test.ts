import { afterEach, describe, expect, it } from 'vitest';
import { WorkerPool } from '@utils/WorkerPool';
import {
  CRYPTO_TEST_WORKER_SCRIPT,
  runCryptoHarness,
  type WorkerHarnessMessage,
} from '@server/domains/transform/handlers/shared';

const pools: Array<WorkerPool<Record<string, unknown>, WorkerHarnessMessage>> = [];

afterEach(async () => {
  await Promise.allSettled(pools.splice(0).map((pool) => pool.close()));
});

function createPool() {
  const pool = new WorkerPool<Record<string, unknown>, WorkerHarnessMessage>({
    name: 'crypto-harness-runtime-test',
    workerScript: CRYPTO_TEST_WORKER_SCRIPT,
    minWorkers: 0,
    maxWorkers: 1,
    idleTimeoutMs: 1000,
  });
  pools.push(pool);
  return pool;
}

describe('crypto harness worker runtime', () => {
  it('executes globally scoped function declarations inside the worker sandbox', async () => {
    const result = await runCryptoHarness(
      createPool(),
      'function encrypt(value) { return String(value).toUpperCase(); }',
      'encrypt',
      ['audit', 'probe'],
    );

    expect(result.allPassed).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({ input: 'audit', output: 'AUDIT' }),
      expect.objectContaining({ input: 'probe', output: 'PROBE' }),
    ]);
  });
});
