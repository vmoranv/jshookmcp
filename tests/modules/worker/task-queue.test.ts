import { describe, it, expect } from 'vitest';
import { TaskQueue } from '@modules/worker/TaskQueue';
import type { QueuedTask } from '@modules/worker/types';

function makeTask(id: string, priority = 0): QueuedTask {
  return {
    message: { id, type: 'test', payload: {}, priority },
    resolve: () => {},
    reject: () => {},
    submittedAt: Date.now(),
  };
}

describe('TaskQueue', () => {
  it('should start empty', () => {
    const queue = new TaskQueue();
    expect(queue.size).toBe(0);
    expect(queue.isEmpty).toBe(true);
  });

  it('should enqueue and dequeue all items', () => {
    const queue = new TaskQueue();
    queue.enqueue(makeTask('a', 0));
    queue.enqueue(makeTask('b', 0));
    queue.enqueue(makeTask('c', 0));

    expect(queue.size).toBe(3);

    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const item = queue.dequeue();
      if (item) ids.add(item.message.id);
    }

    // All items should be dequeued; heap order for same priority is not strict FIFO
    expect(ids).toEqual(new Set(['a', 'b', 'c']));
    expect(queue.isEmpty).toBe(true);
  });

  it('should dequeue by priority (lower number = higher priority)', () => {
    const queue = new TaskQueue();
    queue.enqueue(makeTask('low', 10));
    queue.enqueue(makeTask('high', 1));
    queue.enqueue(makeTask('medium', 5));

    expect(queue.dequeue()?.message.id).toBe('high');
    expect(queue.dequeue()?.message.id).toBe('medium');
    expect(queue.dequeue()?.message.id).toBe('low');
  });

  it('should peek without removing', () => {
    const queue = new TaskQueue();
    const task = makeTask('peek-me', 1);
    queue.enqueue(task);

    expect(queue.peek()?.message.id).toBe('peek-me');
    expect(queue.size).toBe(1);
  });

  it('should peek undefined when empty', () => {
    const queue = new TaskQueue();
    expect(queue.peek()).toBeUndefined();
  });

  it('should dequeue undefined when empty', () => {
    const queue = new TaskQueue();
    expect(queue.dequeue()).toBeUndefined();
  });

  it('should cancel a task by ID', () => {
    const queue = new TaskQueue();
    let rejected = false;
    const task: QueuedTask = {
      message: { id: 'cancel-me', type: 'test', payload: {}, priority: 0 },
      resolve: () => {},
      reject: () => {
        rejected = true;
      },
      submittedAt: Date.now(),
    };
    queue.enqueue(task);

    const result = queue.cancel('cancel-me');
    expect(result).toBe(true);
    expect(rejected).toBe(true);
    expect(queue.size).toBe(0);
  });

  it('should return false when cancelling non-existent task', () => {
    const queue = new TaskQueue();
    expect(queue.cancel('no-such-task')).toBe(false);
  });

  it('should drain all remaining tasks', () => {
    const queue = new TaskQueue();
    queue.enqueue(makeTask('a', 1));
    queue.enqueue(makeTask('b', 2));
    queue.enqueue(makeTask('c', 3));

    const drained = queue.drain();
    expect(drained).toHaveLength(3);
    expect(queue.size).toBe(0);
    expect(queue.isEmpty).toBe(true);
  });

  it('should re-heapify after cancelling middle element', () => {
    const queue = new TaskQueue();
    queue.enqueue(makeTask('a', 5));
    queue.enqueue(makeTask('b', 1));
    queue.enqueue(makeTask('c', 3));
    queue.enqueue(makeTask('d', 2));

    queue.cancel('c');

    // Remaining: b(1), d(2), a(5)
    expect(queue.dequeue()?.message.id).toBe('b');
    expect(queue.dequeue()?.message.id).toBe('d');
    expect(queue.dequeue()?.message.id).toBe('a');
  });

  it('should handle priority 0 correctly (default priority)', () => {
    const queue = new TaskQueue();
    queue.enqueue(makeTask('default')); // no priority = 0
    queue.enqueue(makeTask('also-default', 0));
    queue.enqueue(makeTask('higher', -1));

    expect(queue.dequeue()?.message.id).toBe('higher');
    // Remaining two have same priority; order is heap-dependent
    const remaining = [queue.dequeue()?.message.id, queue.dequeue()?.message.id];
    expect(remaining).toContain('default');
    expect(remaining).toContain('also-default');
  });
});
