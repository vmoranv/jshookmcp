/**
 * Pending browser-session execution queues and deadline management.
 *
 * Owns per-session FIFO queues, the deadline min-heap, sequence numbers, the
 * pending count, and the timeout timer. Scheduling (which ready session runs)
 * lives in BrowserSessionScheduler; execution lives in the coordinator.
 */
import { IndexedMinHeap } from './IndexedMinHeap';

export interface PendingExecution {
  sessionId: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  toolName: string | null;
  estimatedCostMs: number;
  weight: number;
  enqueuedAt: number;
  deadlineAt: number;
  sequence: number;
  state: 'pending' | 'running' | 'settled';
  previous: PendingExecution | null;
  next: PendingExecution | null;
  deadlineHeapIndex: number;
  agingHeapIndex: number;
  signal: AbortSignal | null;
  abortHandler: (() => void) | null;
}

export interface SessionPendingQueue {
  head: PendingExecution | null;
  tail: PendingExecution | null;
  length: number;
}

export interface PendingExecutionInput {
  sessionId: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  toolName: string | null;
  estimatedCostMs: number;
  weight: number;
  enqueuedAt: number;
  deadlineAt: number;
  signal: AbortSignal | null;
}

export interface RemovedTaskInfo {
  wasHead: boolean;
  queueEmpty: boolean;
}

export class BrowserSessionQueue {
  private readonly pendingBySession = new Map<string, SessionPendingQueue>();
  private readonly deadlineHeap = new IndexedMinHeap<PendingExecution>({
    compare: (left, right) => left.deadlineAt - right.deadlineAt || left.sequence - right.sequence,
    getIndex: (task) => task.deadlineHeapIndex,
    setIndex: (task, index) => {
      task.deadlineHeapIndex = index;
    },
  });
  private readonly now: () => number;
  private readonly onExpire: () => void;
  private readonly onAbort: (task: PendingExecution) => void;
  private pendingCount = 0;
  private nextSequence = 0;
  private timer: NodeJS.Timeout | null = null;
  private timerDueAt: number | null = null;

  constructor(now: () => number, onExpire: () => void, onAbort: (task: PendingExecution) => void) {
    this.now = now;
    this.onExpire = onExpire;
    this.onAbort = onAbort;
  }

  get size(): number {
    return this.pendingCount;
  }

  get sessionCount(): number {
    return this.pendingBySession.size;
  }

  has(sessionId: string): boolean {
    return this.pendingBySession.has(sessionId);
  }

  head(sessionId: string): PendingExecution | null {
    return this.pendingBySession.get(sessionId)?.head ?? null;
  }

  length(sessionId: string): number {
    return this.pendingBySession.get(sessionId)?.length ?? 0;
  }

  peekDeadline(): PendingExecution | null {
    return this.deadlineHeap.peek() ?? null;
  }

  enqueue(input: PendingExecutionInput): PendingExecution {
    const task: PendingExecution = {
      ...input,
      sequence: this.nextSequence++,
      state: 'pending',
      previous: null,
      next: null,
      deadlineHeapIndex: -1,
      agingHeapIndex: -1,
      abortHandler: null,
    };
    let queue = this.pendingBySession.get(input.sessionId);
    if (!queue) {
      queue = { head: null, tail: null, length: 0 };
      this.pendingBySession.set(input.sessionId, queue);
    }
    task.previous = queue.tail;
    if (queue.tail) queue.tail.next = task;
    else queue.head = task;
    queue.tail = task;
    queue.length += 1;
    task.abortHandler = () => this.onAbort(task);
    if (task.signal) {
      task.signal.addEventListener('abort', task.abortHandler, { once: true });
    }
    this.deadlineHeap.push(task);
    this.pendingCount += 1;
    this.refreshTimer();
    return task;
  }

  /** Unlink the queue head for execution. Returns null if the session has no work. */
  takeHead(sessionId: string): PendingExecution | null {
    const queue = this.pendingBySession.get(sessionId);
    const task = queue?.head;
    if (!queue || !task) return null;

    this.unlink(queue, task);
    this.deadlineHeap.remove(task);
    this.detachAbortListener(task);
    task.state = 'running';
    this.pendingCount -= 1;
    if (queue.length === 0) this.pendingBySession.delete(sessionId);
    this.refreshTimer();
    return task;
  }

  /** Remove a pending task without running it. */
  removeTask(task: PendingExecution): RemovedTaskInfo | null {
    if (task.state !== 'pending') return null;
    const queue = this.pendingBySession.get(task.sessionId);
    if (!queue) return null;

    const wasHead = queue.head === task;
    this.unlink(queue, task);
    this.deadlineHeap.remove(task);
    this.detachAbortListener(task);
    task.state = 'settled';
    this.pendingCount -= 1;
    let queueEmpty = false;
    if (queue.length === 0) {
      this.pendingBySession.delete(task.sessionId);
      queueEmpty = true;
    }
    this.refreshTimer();
    return { wasHead, queueEmpty };
  }

  /** Reject and clear every pending task for a session. */
  rejectSession(sessionId: string, error: unknown): void {
    const queue = this.pendingBySession.get(sessionId);
    if (!queue) return;

    this.pendingBySession.delete(sessionId);
    this.pendingCount -= queue.length;
    let task = queue.head;
    while (task) {
      const next = task.next;
      this.deadlineHeap.remove(task);
      this.detachAbortListener(task);
      task.state = 'settled';
      task.previous = null;
      task.next = null;
      task.reject(error);
      task = next;
    }
    queue.head = null;
    queue.tail = null;
    queue.length = 0;
    this.refreshTimer();
  }

  /** Pop every task whose deadline has passed. Caller decides how to reject. */
  popExpired(now: number = this.now()): PendingExecution[] {
    const expired: PendingExecution[] = [];
    while (true) {
      const task = this.deadlineHeap.peek();
      if (!task || task.deadlineAt > now) break;
      this.deadlineHeap.pop();
      if (!this.removeTask(task)) continue;
      expired.push(task);
    }
    this.refreshTimer();
    return expired;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timerDueAt = null;
  }

  private unlink(queue: SessionPendingQueue, task: PendingExecution): void {
    if (task.previous) task.previous.next = task.next;
    else queue.head = task.next;
    if (task.next) task.next.previous = task.previous;
    else queue.tail = task.previous;
    task.previous = null;
    task.next = null;
    queue.length -= 1;
  }

  private detachAbortListener(task: PendingExecution): void {
    if (task.signal && task.abortHandler) {
      task.signal.removeEventListener('abort', task.abortHandler);
    }
    task.abortHandler = null;
  }

  private refreshTimer(): void {
    const nextDueAt = this.deadlineHeap.peek()?.deadlineAt ?? null;
    if (nextDueAt === this.timerDueAt && this.timer) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerDueAt = nextDueAt;
    if (nextDueAt === null) return;

    const delay = Math.min(2_147_483_647, Math.max(0, nextDueAt - this.now()));
    this.timer = setTimeout(() => this.onExpire(), delay);
    this.timer.unref();
  }
}
