import { describe, expect, it } from 'vitest';
import { RingBuffer } from './RingBuffer.js';

describe('RingBuffer', () => {
  it('starts empty and shift on empty returns undefined', () => {
    const buffer = new RingBuffer<number>(3);
    expect(buffer.length).toBe(0);
    expect(buffer.shift()).toBeUndefined();
  });

  it('preserves FIFO order for basic push/shift', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    expect(buffer.toArray()).toEqual([1, 2, 3]);
    expect(buffer.shift()).toBe(1);
    expect(buffer.shift()).toBe(2);
    expect(buffer.length).toBe(1);
  });

  it('overwrites oldest item when full at fixed capacity', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);

    expect(buffer.length).toBe(3);
    expect(buffer.toArray()).toEqual([2, 3, 4]);
  });

  it('supports iterator and map based on logical order', () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(10);
    buffer.push(20);
    buffer.push(30);
    buffer.push(40);

    expect([...buffer]).toEqual([20, 30, 40]);
    expect(buffer.map((value, index) => `${index}:${value}`)).toEqual(['0:20', '1:30', '2:40']);
  });

  it('clear resets internal state and allows grow path for large capacity', () => {
    const buffer = new RingBuffer<number>(128);
    buffer.push(1);
    buffer.push(2);
    buffer.clear();
    expect(buffer.length).toBe(0);

    for (let i = 0; i < 70; i++) {
      buffer.push(i);
    }

    expect(buffer.length).toBe(70);
    expect(buffer.toArray()[0]).toBe(0);
    expect(buffer.toArray()[69]).toBe(69);
  });
});

