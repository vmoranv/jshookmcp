/**
 * EEVDF (Earliest Eligible Virtual Deadline First) Scheduler
 *
 * Implements the core scheduling algorithm introduced in Linux 6.6 (replacing CFS).
 * Designed for heterogeneous workloads in multi-agent environments:
 * - Prevents heavy tasks (decompilations, memory scans) from starving light interactive queries.
 * - Enforces service eligibility: Lag_i = V(t) - v_i >= 0 (only flows that haven't overdrawn run).
 * - Prioritizes earliest virtual deadline: d_i = v_i + q_i / w_i.
 *   Latency-sensitive queries requesting small slices (q_i) preempt heavy tasks naturally.
 */
import { logger } from '@utils/logger';

export interface EevdfTask<T = unknown> {
  id: string;
  sessionId: string;
  costHintMs?: number;
  weight?: number;
  fn: () => Promise<T>;
}

export interface EevdfSessionScheduleState {
  sessionId: string;
  weight: number;
  vruntimeMs: number;
  totalServiceMs: number;
  taskCount: number;
  lastActiveMs: number;
}

export interface EevdfSchedulerOptions {
  maxConcurrency?: number;
  defaultCostMs?: number;
  minCostMs?: number;
  maxCostMs?: number;
  maxLagMs?: number;
}

interface QueuedItem<T> {
  task: EevdfTask<T>;
  costMs: number;
  weight: number;
  enqueuedAt: number;
  virtualDeadline: number;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class EevdfScheduler {
  private readonly maxConcurrency: number;
  private readonly defaultCostMs: number;
  private readonly minCostMs: number;
  private readonly maxCostMs: number;
  private readonly maxLagMs: number;

  private runningCount = 0;
  private systemVirtualTimeMs = 0;
  private readonly sessions = new Map<string, EevdfSessionScheduleState>();
  private readonly queues = new Map<string, QueuedItem<any>[]>();

  // Metrics tracking
  private totalDispatched = 0;
  private readonly queueWaitHistory: number[] = [];

  constructor(options: EevdfSchedulerOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.defaultCostMs = options.defaultCostMs ?? 50;
    this.minCostMs = options.minCostMs ?? 1;
    this.maxCostMs = options.maxCostMs ?? 30_000;
    this.maxLagMs = options.maxLagMs ?? 500;
  }

  getSystemVirtualTime(): number {
    return this.systemVirtualTimeMs;
  }

  getSessionState(sessionId: string): Readonly<EevdfSessionScheduleState> | undefined {
    return this.sessions.get(sessionId);
  }

  private getOrCreateSession(sessionId: string, weight = 1.0): EevdfSessionScheduleState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      // Lag clamp on session arrival: align vruntime near system virtual time
      // to prevent sleeping sessions from banking unbounded negative vruntime.
      state = {
        sessionId,
        weight: Math.max(0.1, weight),
        vruntimeMs: this.systemVirtualTimeMs,
        totalServiceMs: 0,
        taskCount: 0,
        lastActiveMs: Date.now(),
      };
      this.sessions.set(sessionId, state);
    } else if (Number.isFinite(weight) && weight > 0 && weight !== state.weight) {
      // Apply the same lower clamp used at creation; the update path used to
      // accept e.g. 0.0001 and make vruntime/deadline jumps starve everyone.
      state.weight = Math.max(0.1, weight);
    }
    return state;
  }

  async schedule<T>(task: EevdfTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const enqueuedAt = Date.now();
      const weight =
        typeof task.weight === 'number' && Number.isFinite(task.weight) && task.weight > 0
          ? task.weight
          : 1.0;
      const session = this.getOrCreateSession(task.sessionId, weight);

      // Lag clamp: if session was idle, don't let it drift more than maxLagMs behind V
      if (this.systemVirtualTimeMs - session.vruntimeMs > this.maxLagMs) {
        session.vruntimeMs = this.systemVirtualTimeMs - this.maxLagMs;
      }

      const costMs = Math.min(
        this.maxCostMs,
        Math.max(this.minCostMs, task.costHintMs ?? this.defaultCostMs),
      );

      // Virtual Deadline: d_i = v_i + (q_i / w_i)
      const virtualDeadline = session.vruntimeMs + costMs / session.weight;

      const item: QueuedItem<T> = {
        task,
        costMs,
        weight: session.weight,
        enqueuedAt,
        virtualDeadline,
        resolve,
        reject,
      };

      let q = this.queues.get(task.sessionId);
      if (!q) {
        q = [];
        this.queues.set(task.sessionId, q);
      }
      q.push(item);

      // A synchronous throw rejects this schedule() promise (better than a
      // detached unhandled rejection).
      this.drain();
    });
  }

  // Fully synchronous: an `async` body with no `await` would turn a throw from
  // selectNextEligible() into an unhandled rejection at every `void drain()`
  // call site, and leave runningCount incremented for a task that never ran.
  private drain(): void {
    while (this.runningCount < this.maxConcurrency) {
      const selected = this.selectNextEligible();
      if (!selected) break;

      this.runningCount++;
      this.totalDispatched++;

      const { item, session } = selected;
      const waitMs = Date.now() - item.enqueuedAt;
      this.queueWaitHistory.push(waitMs);
      if (this.queueWaitHistory.length > 2000) {
        this.queueWaitHistory.shift();
      }

      void this.executeItem(item, session);
    }
  }

  private selectNextEligible(): {
    item: QueuedItem<any>;
    session: EevdfSessionScheduleState;
  } | null {
    // 1. Gather all sessions with active queues
    const activeSessions: { session: EevdfSessionScheduleState; item: QueuedItem<any> }[] = [];
    for (const [sessionId, queue] of this.queues) {
      if (queue.length > 0) {
        const session = this.sessions.get(sessionId)!;
        activeSessions.push({ session, item: queue[0]! });
      }
    }

    if (activeSessions.length === 0) return null;

    // 2. Advance System Virtual Time V(t) monotonically to the minimum active vruntime
    const minActiveVruntime = Math.min(...activeSessions.map((s) => s.session.vruntimeMs));
    this.systemVirtualTimeMs = Math.max(this.systemVirtualTimeMs, minActiveVruntime);

    // 3. Filter Eligible sessions: v_i <= V(t) (meaning Lag >= 0, not overdrawn)
    const eligible = activeSessions.filter((s) => s.session.vruntimeMs <= this.systemVirtualTimeMs);

    // If no session is strictly eligible, all are slightly overdrawn.
    // The candidate pool falls back to all active sessions (V(t) moves up to minActiveVruntime).
    const candidatePool = eligible.length > 0 ? eligible : activeSessions;

    // 4. Select Candidate with the Earliest Virtual Deadline (d_i)
    let bestCandidate = candidatePool[0]!;
    for (let i = 1; i < candidatePool.length; i++) {
      const current = candidatePool[i]!;
      if (current.item.virtualDeadline < bestCandidate.item.virtualDeadline) {
        bestCandidate = current;
      } else if (
        current.item.virtualDeadline === bestCandidate.item.virtualDeadline &&
        current.item.enqueuedAt < bestCandidate.item.enqueuedAt
      ) {
        bestCandidate = current; // Tie-break by FIFO arrival
      }
    }

    // Dequeue selected item
    const queue = this.queues.get(bestCandidate.session.sessionId)!;
    queue.shift();
    if (queue.length === 0) {
      this.queues.delete(bestCandidate.session.sessionId);
    }

    return { item: bestCandidate.item, session: bestCandidate.session };
  }

  private async executeItem(
    item: QueuedItem<any>,
    session: EevdfSessionScheduleState,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await item.task.fn();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      const actualMs = Math.max(1, Date.now() - startedAt);
      const chargedCost = Math.min(this.maxCostMs, Math.max(this.minCostMs, actualMs));

      // Advance session virtual runtime by actual charged cost / weight
      session.vruntimeMs += chargedCost / session.weight;
      session.totalServiceMs += chargedCost;
      session.taskCount++;
      session.lastActiveMs = Date.now();

      // Advance V(t) to the minimum vruntime among sessions that still have
      // queued work (the same rule selectNextEligible() uses). Advancing to the
      // completing session's vruntime — typically the maximum — made every
      // remaining flow eligible and disabled the lag gate entirely. With no
      // queued work left, keep the single-flow progress (min === max) so V
      // stays monotonic.
      let minActiveVruntime = Number.POSITIVE_INFINITY;
      for (const [sessionId, queue] of this.queues) {
        if (queue.length === 0) continue;
        const active = this.sessions.get(sessionId);
        if (active) minActiveVruntime = Math.min(minActiveVruntime, active.vruntimeMs);
      }
      this.systemVirtualTimeMs = Math.max(
        this.systemVirtualTimeMs,
        Number.isFinite(minActiveVruntime) ? minActiveVruntime : session.vruntimeMs,
      );

      this.runningCount--;
      try {
        this.drain();
      } catch (error) {
        logger.error('[EevdfScheduler] drain failed after task completion:', error);
      }
    }
  }

  getStats(): {
    systemVirtualTimeMs: number;
    runningCount: number;
    queuedCount: number;
    activeSessions: number;
    totalDispatched: number;
    averageQueueWaitMs: number;
  } {
    let queuedCount = 0;
    for (const q of this.queues.values()) {
      queuedCount += q.length;
    }

    const avgWait =
      this.queueWaitHistory.length > 0
        ? this.queueWaitHistory.reduce((a, b) => a + b, 0) / this.queueWaitHistory.length
        : 0;

    return {
      systemVirtualTimeMs: Number(this.systemVirtualTimeMs.toFixed(2)),
      runningCount: this.runningCount,
      queuedCount,
      activeSessions: this.queues.size,
      totalDispatched: this.totalDispatched,
      averageQueueWaitMs: Number(avgWait.toFixed(2)),
    };
  }
}
