import { afterEach, describe, expect, it, vi } from 'vitest';

const loadConcurrencyModule = async () => {
  vi.resetModules();
  return import('../../src/utils/concurrency.js');
};

describe('concurrency utilities', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('ioLimit runs a task and returns its result', async () => {
    process.env.JSHHOOK_IO_CONCURRENCY = '2';
    const { ioLimit } = await loadConcurrencyModule();
    await expect(ioLimit(async () => 123)).resolves.toBe(123);
  });

  it('ioLimit enforces configured max parallelism', async () => {
    process.env.JSHHOOK_IO_CONCURRENCY = '2';
    const { ioLimit } = await loadConcurrencyModule();

    let running = 0;
    let maxRunning = 0;
    const tasks = Array.from({ length: 6 }, (_, idx) =>
      ioLimit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running--;
        return idx;
      })
    );

    await Promise.all(tasks);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('cpuLimit can be forced to run sequentially', async () => {
    process.env.JSHHOOK_CPU_CONCURRENCY = '1';
    const { cpuLimit } = await loadConcurrencyModule();

    const order: string[] = [];
    const tasks = ['a', 'b', 'c'].map((id) =>
      cpuLimit(async () => {
        order.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end-${id}`);
        return id;
      })
    );
    await Promise.all(tasks);

    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
  });

  it('cdpLimit propagates task failures', async () => {
    process.env.JSHHOOK_CDP_CONCURRENCY = '2';
    const { cdpLimit } = await loadConcurrencyModule();
    await expect(cdpLimit(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
  });

  it('throws during module load for invalid concurrency values', async () => {
    process.env.JSHHOOK_IO_CONCURRENCY = '0';
    await expect(loadConcurrencyModule()).rejects.toThrow('concurrency must be >= 1');
  });
});
