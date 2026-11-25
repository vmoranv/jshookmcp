export interface IndexedHeapAdapter<T> {
  compare(left: T, right: T): number;
  getIndex(value: T): number;
  setIndex(value: T, index: number): void;
}

/**
 * Binary min-heap with O(log n) arbitrary removal.
 *
 * Values own their heap index through the adapter, which avoids a second Map on
 * scheduler hot paths and lets one value participate in multiple independent heaps.
 */
export class IndexedMinHeap<T> {
  private readonly adapter: IndexedHeapAdapter<T>;
  private readonly values: T[] = [];

  constructor(adapter: IndexedHeapAdapter<T>) {
    this.adapter = adapter;
  }

  get size(): number {
    return this.values.length;
  }

  peek(): T | null {
    return this.values[0] ?? null;
  }

  push(value: T): void {
    if (this.adapter.getIndex(value) >= 0) {
      throw new Error('IndexedMinHeap value is already present');
    }
    const index = this.values.length;
    this.values.push(value);
    this.adapter.setIndex(value, index);
    this.siftUp(index);
  }

  pop(): T | null {
    if (this.values.length === 0) return null;
    const first = this.values[0]!;
    this.remove(first);
    return first;
  }

  remove(value: T): boolean {
    const index = this.adapter.getIndex(value);
    if (index < 0 || this.values[index] !== value) return false;

    const lastIndex = this.values.length - 1;
    const last = this.values[lastIndex]!;
    this.values.pop();
    this.adapter.setIndex(value, -1);
    if (index === lastIndex) return true;

    this.values[index] = last;
    this.adapter.setIndex(last, index);
    if (index > 0 && this.compareAt(index, this.parent(index)) < 0) {
      this.siftUp(index);
    } else {
      this.siftDown(index);
    }
    return true;
  }

  clear(): void {
    for (const value of this.values) this.adapter.setIndex(value, -1);
    this.values.length = 0;
  }

  private parent(index: number): number {
    return Math.floor((index - 1) / 2);
  }

  private left(index: number): number {
    return index * 2 + 1;
  }

  private compareAt(left: number, right: number): number {
    return this.adapter.compare(this.values[left]!, this.values[right]!);
  }

  private swap(left: number, right: number): void {
    const leftValue = this.values[left]!;
    const rightValue = this.values[right]!;
    this.values[left] = rightValue;
    this.values[right] = leftValue;
    this.adapter.setIndex(rightValue, left);
    this.adapter.setIndex(leftValue, right);
  }

  private siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parent = this.parent(index);
      if (this.compareAt(index, parent) >= 0) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex;
    while (true) {
      const left = this.left(index);
      if (left >= this.values.length) return;
      const right = left + 1;
      const smallest = right < this.values.length && this.compareAt(right, left) < 0 ? right : left;
      if (this.compareAt(smallest, index) >= 0) return;
      this.swap(index, smallest);
      index = smallest;
    }
  }
}
