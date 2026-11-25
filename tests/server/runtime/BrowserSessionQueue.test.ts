import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSessionQueue, type PendingExecution } from '@server/runtime/BrowserSessionQueue';

describe('BrowserSessionQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-arms the deadline timer after it fires', async () => {
    vi.useFakeTimers();
    let now = 0;
    const expired: string[] = [];

    const queue = new BrowserSessionQueue(
      () => now,
      () => {
        for (const { task } of queue.popExpired(now)) {
          expired.push(task.sessionId);
          task.reject(new Error('timeout'));
        }
      },
      () => undefined,
    );

    const enqueue = (sessionId: string, deadlineAt: number): PendingExecution =>
      queue.enqueue({
        sessionId,
        run: async () => undefined,
        resolve: () => undefined,
        reject: () => undefined,
        toolName: null,
        estimatedCostMs: 1,
        weight: 1,
        enqueuedAt: now,
        deadlineAt,
        signal: null,
      });

    enqueue('first', 10);
    now = 10;
    await vi.advanceTimersByTimeAsync(10);
    expect(expired).toEqual(['first']);

    // A fired timer must not block arming the next deadline.
    enqueue('second', 30);
    now = 30;
    await vi.advanceTimersByTimeAsync(20);
    expect(expired).toEqual(['first', 'second']);

    queue.dispose();
  });

  it('reports whether the removed task was the queue head', () => {
    const now = 0;
    const queue = new BrowserSessionQueue(
      () => now,
      () => undefined,
      () => undefined,
    );
    const make = (sessionId: string, deadlineAt: number): PendingExecution =>
      queue.enqueue({
        sessionId,
        run: async () => undefined,
        resolve: () => undefined,
        reject: () => undefined,
        toolName: null,
        estimatedCostMs: 1,
        weight: 1,
        enqueuedAt: now,
        deadlineAt,
        signal: null,
      });

    const head = make('s', 10);
    const tail = make('s', 20);

    expect(queue.removeTask(head)).toMatchObject({ wasHead: true, queueEmpty: false });
    expect(queue.removeTask(tail)).toMatchObject({ wasHead: true, queueEmpty: true });
    queue.dispose();
  });
});
