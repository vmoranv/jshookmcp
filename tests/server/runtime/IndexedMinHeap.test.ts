import { describe, expect, it } from 'vitest';
import { IndexedMinHeap } from '@server/runtime/IndexedMinHeap';

interface Value {
  priority: number;
  index: number;
}

describe('IndexedMinHeap', () => {
  it('orders values and removes arbitrary entries in logarithmic heap operations', () => {
    const heap = new IndexedMinHeap<Value>({
      compare: (left, right) => left.priority - right.priority,
      getIndex: (value) => value.index,
      setIndex: (value, index) => {
        value.index = index;
      },
    });
    const values = [8, 3, 5, 1, 9, 2].map((priority) => ({ priority, index: -1 }));
    for (const value of values) heap.push(value);

    expect(heap.remove(values[2]!)).toBe(true);
    expect(values[2]!.index).toBe(-1);

    const ordered: number[] = [];
    while (heap.size > 0) ordered.push(heap.pop()!.priority);
    expect(ordered).toEqual([1, 2, 3, 8, 9]);
    expect(values.every((value) => value.index === -1)).toBe(true);
  });

  it('handles falsy values (0) without treating the heap as empty or corrupting it', () => {
    const indexes = new Map<number, number>();
    // Max-heap of numbers so a falsy 0 can be the "last" slot while a non-last
    // value is removed — the exact case the old truthiness checks mishandled.
    const heap = new IndexedMinHeap<number>({
      compare: (left, right) => right - left,
      getIndex: (value) => indexes.get(value) ?? -1,
      setIndex: (value, index) => {
        if (index < 0) indexes.delete(value);
        else indexes.set(value, index);
      },
    });
    heap.push(2);
    heap.push(0);

    expect(heap.remove(2)).toBe(true);
    expect(heap.size).toBe(1);
    expect(heap.pop()).toBe(0);
    expect(heap.pop()).toBeNull();
  });
});
