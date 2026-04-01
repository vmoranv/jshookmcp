import { describe, expect, it, vi } from 'vitest';
import { RateLimiter, TaskQueue, batchProcess, parallelExecute } from '@utils/parallel';

describe('parallel utilities', () => {
  it('parallelExecute returns success results for all items', async () => {
    const results = await parallelExecute([1, 2, 3], async (item) => item * 2, {
      maxConcurrency: 2,
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.map((r) => r.data)).toEqual([2, 4, 6]);
  });

  it('parallelExecute marks timed-out tasks as failed', async () => {
    const results = await parallelExecute(
      [1],
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 1;
      },
      { timeout: 10 },
    );

    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error?.message).toContain('Task timeout');
  });

  it('parallelExecute retries failed task when retryOnError is enabled', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const promise = parallelExecute(
      [1],
      async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('first failure');
        }
        return 42;
      },
      { retryOnError: true, maxRetries: 1, timeout: 5000 },
    );

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;
    vi.useRealTimers();

    expect(attempts).toBe(2);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.data).toBe(42);
  });

  it('batchProcess splits inputs into batches and merges outputs', async () => {
    const executor = vi.fn(async (batch: number[]) => batch.map((x) => x + 1));
    const out = await batchProcess([1, 2, 3, 4, 5], executor, 2);

    expect(executor).toHaveBeenCalledTimes(3);
    expect(out).toEqual([2, 3, 4, 5, 6]);
  });

  it('TaskQueue enforces concurrency and clear rejects queued tasks', async () => {
    const queue = new TaskQueue<number, number>(async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return item * 10;
    }, 1);

    const first = queue.add(1);
    const second = queue.add(2).catch((error) => error);
    const third = queue.add(3).catch((error) => error);

    queue.clear();

    await expect(first).resolves.toBe(10);
    await expect(second).resolves.toBeInstanceOf(Error);
    await expect(third).resolves.toBeInstanceOf(Error);
    await expect(second).resolves.toMatchObject({ message: 'Queue cleared' });
    await expect(third).resolves.toMatchObject({ message: 'Queue cleared' });
  });

  it('RateLimiter blocks until tokens refill', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(1, 1);

    await limiter.acquire(1);
    const blocked = limiter.acquire(1);

    let done = false;
    blocked.then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(900);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    await blocked;
    vi.useRealTimers();

    expect(done).toBe(true);
  });

  it('TaskQueue rejects structural non-error objects', async () => {
    const queue = new TaskQueue<number, number>(async () => {
      throw 'String error object';
    });
    const p = queue.add(1);
    await expect(p).rejects.toThrow('String error object');
  });

  it('RateLimiter forces implicit refill when calling getTokens', async () => {
    const limiter = new RateLimiter(10, 5);
    expect(limiter.getTokens()).toBe(10);
  });

  it('batchProcess re-throws errors during batch failure', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('Batch crash'));
    await expect(batchProcess([1, 2], executor, 2)).rejects.toThrow('Batch crash');
  });

  it('TaskQueue returns accurate status metrics', () => {
    const queue = new TaskQueue<number, number>(async (x) => x, 2);
    queue.add(1);

    const status = queue.getStatus();
    expect(status.queueLength).toBeGreaterThanOrEqual(0);
    expect(status.running).toBeGreaterThanOrEqual(1);
    expect(status.maxConcurrency).toBe(2);
  });
});
