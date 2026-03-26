/**
 * Fixed-capacity ring buffer with O(1) push/shift.
 * Drop-in replacement for arrays used as bounded FIFO queues.
 */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buf = Array.from<T | undefined>({ length: capacity });
  }

  get length(): number {
    return this.count;
  }

  push(item: T): void {
    if (this.count === this.buf.length) {
      // Buffer full — grow by 2x up to capacity, or overwrite oldest
      if (this.buf.length < this.capacity) {
        this.grow();
      } else {
        // Overwrite oldest
        this.buf[this.tail] = item;
        this.tail = (this.tail + 1) % this.buf.length;
        this.head = (this.head + 1) % this.buf.length;
        return;
      }
    }
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) % this.buf.length;
    this.count++;
  }

  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.buf[this.head];
    this.buf[this.head] = undefined; // allow GC
    this.head = (this.head + 1) % this.buf.length;
    this.count--;
    return item;
  }

  clear(): void {
    this.buf = Array.from<T | undefined>({ length: Math.min(64, this.capacity) });
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  *[Symbol.iterator](): Iterator<T> {
    for (let i = 0; i < this.count; i++) {
      yield this.buf[(this.head + i) % this.buf.length] as T;
    }
  }

  toArray(): T[] {
    const result: T[] = Array.from<T>({ length: this.count });
    for (let i = 0; i < this.count; i++) {
      result[i] = this.buf[(this.head + i) % this.buf.length] as T;
    }
    return result;
  }

  map<U>(fn: (item: T, index: number) => U): U[] {
    const result: U[] = Array.from<U>({ length: this.count });
    for (let i = 0; i < this.count; i++) {
      result[i] = fn(this.buf[(this.head + i) % this.buf.length] as T, i);
    }
    return result;
  }

  private grow(): void {
    const newSize = Math.min(this.buf.length * 2, this.capacity);
    const newBuf = Array.from<T | undefined>({ length: newSize });
    for (let i = 0; i < this.count; i++) {
      newBuf[i] = this.buf[(this.head + i) % this.buf.length];
    }
    this.buf = newBuf;
    this.head = 0;
    this.tail = this.count;
  }
}
