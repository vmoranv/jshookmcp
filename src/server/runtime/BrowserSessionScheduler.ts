/**
 * Ready-session scheduling for browser sessions: EEVDF and DRR with aging.
 *
 * Owns the ready linked list, per-session virtual state, global credit, and the
 * aging heap. Pending queues stay in BrowserSessionCoordinator; this class asks
 * the host for each session's queue head.
 */
import { IndexedMinHeap } from './IndexedMinHeap';
import { MAX_COST_MS } from './BrowserSessionCostModel';

export interface BrowserSessionSchedulerOptions {
  policy?: 'drr-aging' | 'eevdf';
  maxPending: number;
  maxPendingPerSession: number;
  waitTimeoutMs: number;
  quantumMs: number;
  agingMs: number;
  expectedConcurrency: number;
  reservedPendingPerSession: number;
  costEwmaAlpha: number;
  maxLagMs?: number;
}

export const DEFAULT_SCHEDULER_OPTIONS: BrowserSessionSchedulerOptions = {
  policy: 'eevdf',
  maxPending: 256,
  maxPendingPerSession: 16,
  waitTimeoutMs: 180_000,
  quantumMs: 250,
  agingMs: 2_000,
  expectedConcurrency: 4,
  reservedPendingPerSession: 2,
  costEwmaAlpha: 0.2,
  maxLagMs: 500,
};

export interface SchedulerTask {
  readonly sessionId: string;
  readonly enqueuedAt: number;
  readonly sequence: number;
  readonly estimatedCostMs: number;
  agingHeapIndex: number;
}

export interface SessionScheduleState {
  sessionId: string;
  deficitMs: number;
  globalCreditBaseMs: number;
  vruntimeMs: number;
  weight: number;
  ready: boolean;
  previousReady: SessionScheduleState | null;
  nextReady: SessionScheduleState | null;
}

export interface SelectedExecution {
  sessionId: string;
  task: SchedulerTask;
  scheduleState: SessionScheduleState;
  aged: boolean;
}

export interface BrowserSessionSchedulerHost {
  readonly options: BrowserSessionSchedulerOptions;
  /** Head of the session's pending queue, or null when it has no work. */
  getQueueHead(sessionId: string): SchedulerTask | null;
  getActiveSessionId(): string | null;
  now(): number;
}

export class BrowserSessionScheduler {
  private readonly host: BrowserSessionSchedulerHost;
  private readonly scheduleBySession = new Map<string, SessionScheduleState>();
  private readonly agingHeap = new IndexedMinHeap<SchedulerTask>({
    compare: (left, right) => left.enqueuedAt - right.enqueuedAt || left.sequence - right.sequence,
    getIndex: (task) => task.agingHeapIndex,
    setIndex: (task, index) => {
      task.agingHeapIndex = index;
    },
  });
  private readyHead: SessionScheduleState | null = null;
  private readyTail: SessionScheduleState | null = null;
  private readySessionCount = 0;
  private globalCreditMs = 0;
  private systemVirtualTimeMs = 0;

  constructor(host: BrowserSessionSchedulerHost) {
    this.host = host;
  }

  get readyCount(): number {
    return this.readySessionCount;
  }

  get virtualTimeMs(): number {
    return this.systemVirtualTimeMs;
  }

  peekState(sessionId: string): SessionScheduleState | undefined {
    return this.scheduleBySession.get(sessionId);
  }

  getState(sessionId: string): SessionScheduleState {
    let state = this.scheduleBySession.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        deficitMs: 0,
        globalCreditBaseMs: this.globalCreditMs,
        vruntimeMs: this.systemVirtualTimeMs,
        weight: 1.0,
        ready: false,
        previousReady: null,
        nextReady: null,
      };
      this.scheduleBySession.set(sessionId, state);
    }
    return state;
  }

  enqueue(sessionId: string): void {
    if (this.host.getActiveSessionId() === sessionId) return;
    const head = this.host.getQueueHead(sessionId);
    if (!head) return;
    const state = this.getState(sessionId);
    if (state.ready) return;

    const options = this.host.options;
    if (options.policy === 'eevdf') {
      const maxLag = options.maxLagMs ?? 500;
      if (this.systemVirtualTimeMs - state.vruntimeMs > maxLag) {
        state.vruntimeMs = this.systemVirtualTimeMs - maxLag;
      }
    }

    state.ready = true;
    state.globalCreditBaseMs = this.globalCreditMs;
    state.previousReady = this.readyTail;
    state.nextReady = null;
    if (this.readyTail) this.readyTail.nextReady = state;
    else this.readyHead = state;
    this.readyTail = state;
    this.readySessionCount += 1;
    this.agingHeap.push(head);
  }

  removeReady(state: SessionScheduleState): void {
    if (!state?.ready) return;
    if (state.previousReady) state.previousReady.nextReady = state.nextReady;
    else this.readyHead = state.nextReady;
    if (state.nextReady) state.nextReady.previousReady = state.previousReady;
    else this.readyTail = state.previousReady;
    state.ready = false;
    state.previousReady = null;
    state.nextReady = null;
    this.readySessionCount -= 1;

    const head = this.host.getQueueHead(state.sessionId);
    if (head) this.agingHeap.remove(head);
  }

  /** Remove a task from the aging heap (queue head was cancelled). */
  removeTask(task: SchedulerTask): void {
    this.agingHeap.remove(task);
  }

  /** Replace the aged head after a queue mutation. */
  pushHead(task: SchedulerTask): void {
    this.agingHeap.push(task);
  }

  recordService(state: SessionScheduleState, chargedMs: number): void {
    if (this.host.options.policy === 'eevdf') {
      state.vruntimeMs += chargedMs / (state.weight || 1.0);
      this.systemVirtualTimeMs = Math.max(this.systemVirtualTimeMs, state.vruntimeMs);
      return;
    }
    this.materializeGlobalCredit(state);
    state.deficitMs = Math.min(
      MAX_COST_MS + this.host.options.quantumMs,
      Math.max(-MAX_COST_MS, state.deficitMs - chargedMs),
    );
  }

  finalizeService(state: SessionScheduleState): void {
    if (this.host.options.policy !== 'eevdf') {
      state.deficitMs = Math.min(0, state.deficitMs);
    }
  }

  removeSession(sessionId: string): void {
    const state = this.scheduleBySession.get(sessionId);
    if (state?.ready) this.removeReady(state);
    this.scheduleBySession.delete(sessionId);
  }

  select(): SelectedExecution | null {
    if (this.readySessionCount === 0) return null;

    const now = this.host.now();
    const oldest = this.agingHeap.peek();
    if (oldest && now - oldest.enqueuedAt >= this.host.options.agingMs) {
      const state = this.scheduleBySession.get(oldest.sessionId);
      if (state?.ready) {
        this.removeReady(state);
        return { sessionId: state.sessionId, task: oldest, scheduleState: state, aged: true };
      }
    }

    const selected = this.host.options.policy === 'eevdf' ? this.selectEevdf() : this.selectDrr();
    if (!selected) return null;
    return selected;
  }

  private selectEevdf(): SelectedExecution | null {
    const activeSessions: { state: SessionScheduleState; task: SchedulerTask }[] = [];
    let curr = this.readyHead;
    while (curr) {
      const next = curr.nextReady;
      const task = this.host.getQueueHead(curr.sessionId);
      if (!task) {
        this.removeReady(curr);
      } else {
        activeSessions.push({ state: curr, task });
      }
      curr = next;
    }

    if (activeSessions.length === 0) return null;

    const minActiveVruntime = Math.min(...activeSessions.map((s) => s.state.vruntimeMs));
    this.systemVirtualTimeMs = Math.max(this.systemVirtualTimeMs, minActiveVruntime);

    const eligible = activeSessions.filter((s) => s.state.vruntimeMs <= this.systemVirtualTimeMs);
    const candidatePool = eligible.length > 0 ? eligible : activeSessions;

    let bestCandidate = candidatePool[0]!;
    let bestDeadline =
      bestCandidate.state.vruntimeMs +
      bestCandidate.task.estimatedCostMs / (bestCandidate.state.weight || 1.0);

    for (let i = 1; i < candidatePool.length; i++) {
      const candidate = candidatePool[i]!;
      const deadline =
        candidate.state.vruntimeMs +
        candidate.task.estimatedCostMs / (candidate.state.weight || 1.0);
      if (
        deadline < bestDeadline ||
        (deadline === bestDeadline && candidate.task.sequence < bestCandidate.task.sequence)
      ) {
        bestCandidate = candidate;
        bestDeadline = deadline;
      }
    }

    this.removeReady(bestCandidate.state);
    return {
      sessionId: bestCandidate.state.sessionId,
      task: bestCandidate.task,
      scheduleState: bestCandidate.state,
      aged: false,
    };
  }

  private selectDrr(): SelectedExecution | null {
    // DRR accounts in milliseconds rather than request count. Bulk-crediting
    // advances a shared virtual credit instead of touching every flow twice.
    while (this.readySessionCount > 0) {
      const cycleLength = this.readySessionCount;
      let additionalRounds = Number.POSITIVE_INFINITY;
      for (let index = 0; index < cycleLength; index += 1) {
        const state = this.readyHead;
        if (!state) break;
        const task = this.host.getQueueHead(state.sessionId);
        if (!task) {
          this.removeReady(state);
          continue;
        }

        this.materializeGlobalCredit(state);
        state.deficitMs = Math.min(
          MAX_COST_MS + this.host.options.quantumMs,
          state.deficitMs + this.host.options.quantumMs,
        );
        if (task.estimatedCostMs <= state.deficitMs) {
          this.removeReady(state);
          return {
            sessionId: state.sessionId,
            task,
            scheduleState: state,
            aged: false,
          };
        }
        additionalRounds = Math.min(
          additionalRounds,
          Math.max(
            0,
            Math.ceil((task.estimatedCostMs - state.deficitMs) / this.host.options.quantumMs) - 1,
          ),
        );
        this.rotateHeadToTail();
      }
      if (!Number.isFinite(additionalRounds)) return null;
      if (additionalRounds > 0) {
        this.globalCreditMs += additionalRounds * this.host.options.quantumMs;
      }
    }
    return null;
  }

  private rotateHeadToTail(): void {
    const state = this.readyHead;
    if (!state || state === this.readyTail) return;
    this.readyHead = state.nextReady;
    this.readyHead!.previousReady = null;
    state.previousReady = this.readyTail;
    state.nextReady = null;
    this.readyTail!.nextReady = state;
    this.readyTail = state;
  }

  private materializeGlobalCredit(state: SessionScheduleState): void {
    const credit = this.globalCreditMs - state.globalCreditBaseMs;
    if (credit > 0) {
      state.deficitMs = Math.min(MAX_COST_MS, state.deficitMs + credit);
    }
    state.globalCreditBaseMs = this.globalCreditMs;
  }
}
