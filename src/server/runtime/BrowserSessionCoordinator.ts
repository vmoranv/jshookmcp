import { logger } from '@utils/logger';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { TabRegistry } from '@modules/browser/TabRegistry';
import { IndexedMinHeap } from '@server/runtime/IndexedMinHeap';
import {
  BrowserSessionCostModel,
  DEFAULT_COST_MS,
  MAX_COST_MS,
  MIN_COST_MS,
  type BrowserSessionToolCostStats,
} from '@server/runtime/BrowserSessionCostModel';
export type { BrowserSessionToolCostStats } from '@server/runtime/BrowserSessionCostModel';
import {
  BROWSER_SESSION_IDLE_TTL_MS,
  BROWSER_SESSION_MAX_SESSIONS,
  BROWSER_SESSION_SWEEP_MS,
} from '@src/constants/server';

export interface BrowserSessionSnapshot {
  currentTabIndex: number | null;
  currentPageId: string | null;
  currentTargetId: string | null;
  lastToolName: string | null;
  lastTouchedAt: string | null;
}

interface BrowserSessionEntry extends BrowserSessionSnapshot {
  tabRegistry: TabRegistry;
  /** Monotonic clock timestamp of the most recent access (idle-sweep input). */
  lastTouchedMs: number;
}

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

export interface BrowserSessionLifecycleOptions {
  maxSessions: number;
  idleTtlMs: number;
  sweepIntervalMs: number;
}

export interface BrowserSessionQueueStats extends BrowserSessionSchedulerOptions {
  policy: 'drr-aging' | 'eevdf';
  systemVirtualTimeMs?: number;
  pending: number;
  pendingSessions: number;
  readySessions: number;
  activeSessionId: string | null;
  admissionLimit: number;
  oldestPendingWaitMs: number;
  dispatchCount: number;
  agedDispatchCount: number;
  queueTimeoutCount: number;
  queueRejectedCount: number;
  averageQueueWaitMs: number;
  averageServiceMs: number;
  maxQueueWaitMs: number;
  trackedToolCosts: number;
  deadlineTimerActive: boolean;
  trackedSessions: number;
  sessionLimit: number;
}

export interface BrowserSessionExecutionOptions {
  toolName?: string;
  costHintMs?: number;
  weight?: number;
  signal?: AbortSignal;
}

interface PendingExecution {
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

interface SessionPendingQueue {
  head: PendingExecution | null;
  tail: PendingExecution | null;
  length: number;
}

interface SessionScheduleState {
  sessionId: string;
  deficitMs: number;
  globalCreditBaseMs: number;
  vruntimeMs: number;
  weight: number;
  ready: boolean;
  previousReady: SessionScheduleState | null;
  nextReady: SessionScheduleState | null;
}

interface SelectedExecution {
  sessionId: string;
  task: PendingExecution;
  scheduleState: SessionScheduleState;
  aged: boolean;
}

export class BrowserSessionQueueError extends Error {
  public readonly code:
    | 'BROWSER_SESSION_QUEUE_FULL'
    | 'BROWSER_SESSION_QUEUE_TIMEOUT'
    | 'BROWSER_SESSION_QUEUE_CANCELLED'
    | 'BROWSER_SESSION_CLOSED'
    | 'BROWSER_SESSION_LIMIT_REACHED'
    | 'BROWSER_SESSION_CROSS_SESSION_REENTRY';
  public readonly retryAfterMs: number | null;
  public readonly queueDepth: number | null;
  public readonly queueLimit: number | null;
  constructor(
    message: string,
    code:
      | 'BROWSER_SESSION_QUEUE_FULL'
      | 'BROWSER_SESSION_QUEUE_TIMEOUT'
      | 'BROWSER_SESSION_QUEUE_CANCELLED'
      | 'BROWSER_SESSION_CLOSED'
      | 'BROWSER_SESSION_LIMIT_REACHED'
      | 'BROWSER_SESSION_CROSS_SESSION_REENTRY',
    retryAfterMs: number | null = null,
    queueDepth: number | null = null,
    queueLimit: number | null = null,
  ) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.queueDepth = queueDepth;
    this.queueLimit = queueLimit;
    this.name = 'BrowserSessionQueueError';
  }
}

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_SCHEDULER_OPTIONS: BrowserSessionSchedulerOptions = {
  policy: 'eevdf',
  maxPending: 256,
  maxPendingPerSession: 16,
  waitTimeoutMs: 180_000,
  quantumMs: 250,
  agingMs: 15_000,
  expectedConcurrency: 10,
  reservedPendingPerSession: 1,
  costEwmaAlpha: 0.2,
  maxLagMs: 500,
};

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function boundedFraction(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1
    ? value
    : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseBrowserSessionSnapshot(
  response: unknown,
): Partial<BrowserSessionSnapshot> | null {
  if (!isRecord(response) || !Array.isArray(response.content) || response.content.length === 0) {
    return null;
  }
  const first = response.content[0];
  if (!isRecord(first) || typeof first.text !== 'string') {
    return null;
  }
  const parsed = safeJson(first.text);
  if (!isRecord(parsed)) {
    return null;
  }
  const tabContext = isRecord(parsed._tabContext) ? parsed._tabContext : null;
  const snapshot: Partial<BrowserSessionSnapshot> = {};
  const tabIndex =
    typeof parsed.selectedIndex === 'number' && Number.isFinite(parsed.selectedIndex)
      ? parsed.selectedIndex
      : typeof parsed.currentIndex === 'number' && Number.isFinite(parsed.currentIndex)
        ? parsed.currentIndex
        : typeof tabContext?.tabIndex === 'number' && Number.isFinite(tabContext.tabIndex)
          ? tabContext.tabIndex
          : undefined;
  const pageId =
    typeof parsed.selectedPageId === 'string'
      ? parsed.selectedPageId
      : typeof parsed.currentPageId === 'string'
        ? parsed.currentPageId
        : typeof tabContext?.pageId === 'string'
          ? tabContext.pageId
          : undefined;

  if (tabIndex !== undefined) snapshot.currentTabIndex = tabIndex;
  if (pageId !== undefined) snapshot.currentPageId = pageId;
  if (typeof parsed.targetId === 'string') snapshot.currentTargetId = parsed.targetId;
  if (typeof parsed.toolName === 'string') snapshot.lastToolName = parsed.toolName;

  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

export class BrowserSessionCoordinator {
  private readonly getCollector: () => CodeCollector | null | undefined;
  private readonly now: () => number;
  private readonly executionContext = new AsyncLocalStorage<{ sessionId: string }>();
  private readonly sessions = new Map<string, BrowserSessionEntry>();
  private readonly browserOwners = new Set<string>();
  private readonly pendingBySession = new Map<string, SessionPendingQueue>();
  private readonly scheduleBySession = new Map<string, SessionScheduleState>();
  private readonly costModel = new BrowserSessionCostModel();
  private readonly deadlineHeap = new IndexedMinHeap<PendingExecution>({
    compare: (left, right) => left.deadlineAt - right.deadlineAt || left.sequence - right.sequence,
    getIndex: (task) => task.deadlineHeapIndex,
    setIndex: (task, index) => {
      task.deadlineHeapIndex = index;
    },
  });
  private readonly agingHeap = new IndexedMinHeap<PendingExecution>({
    compare: (left, right) => left.enqueuedAt - right.enqueuedAt || left.sequence - right.sequence,
    getIndex: (task) => task.agingHeapIndex,
    setIndex: (task, index) => {
      task.agingHeapIndex = index;
    },
  });
  private readonly schedulerOptions: BrowserSessionSchedulerOptions;
  private readonly lifecycle: BrowserSessionLifecycleOptions;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readyHead: SessionScheduleState | null = null;
  private readyTail: SessionScheduleState | null = null;
  private readySessionCount = 0;
  private globalCreditMs = 0;
  private systemVirtualTimeMs = 0;
  private deadlineTimer: NodeJS.Timeout | null = null;
  private deadlineTimerDueAt: number | null = null;
  private lastActiveSessionId: string | null = null;
  private activeExecutionSessionId: string | null = null;
  private pendingExecutionCount = 0;
  private draining = false;
  private nextSequence = 0;
  private dispatchCount = 0;
  private agedDispatchCount = 0;
  private queueTimeoutCount = 0;
  private queueRejectedCount = 0;
  private totalQueueWaitMs = 0;
  private totalServiceMs = 0;
  private maxQueueWaitMs = 0;

  constructor(
    getCollector: () => CodeCollector | null | undefined,
    options: Partial<BrowserSessionSchedulerOptions & BrowserSessionLifecycleOptions> = {},
    now: () => number = () => performance.now(),
  ) {
    this.getCollector = getCollector;
    this.now = now;
    const maxPending = positiveInteger(options.maxPending, DEFAULT_SCHEDULER_OPTIONS.maxPending);
    this.schedulerOptions = {
      policy: options.policy ?? DEFAULT_SCHEDULER_OPTIONS.policy,
      maxPending,
      maxPendingPerSession: Math.min(
        positiveInteger(
          options.maxPendingPerSession,
          DEFAULT_SCHEDULER_OPTIONS.maxPendingPerSession,
        ),
        maxPending,
      ),
      waitTimeoutMs: positiveInteger(
        options.waitTimeoutMs,
        DEFAULT_SCHEDULER_OPTIONS.waitTimeoutMs,
      ),
      quantumMs: positiveInteger(options.quantumMs, DEFAULT_SCHEDULER_OPTIONS.quantumMs),
      agingMs: positiveInteger(options.agingMs, DEFAULT_SCHEDULER_OPTIONS.agingMs),
      expectedConcurrency: positiveInteger(
        options.expectedConcurrency,
        DEFAULT_SCHEDULER_OPTIONS.expectedConcurrency,
      ),
      reservedPendingPerSession: nonNegativeInteger(
        options.reservedPendingPerSession,
        DEFAULT_SCHEDULER_OPTIONS.reservedPendingPerSession,
      ),
      costEwmaAlpha: boundedFraction(
        options.costEwmaAlpha,
        DEFAULT_SCHEDULER_OPTIONS.costEwmaAlpha,
      ),
      maxLagMs: positiveInteger(options.maxLagMs, DEFAULT_SCHEDULER_OPTIONS.maxLagMs ?? 500),
    };
    this.lifecycle = {
      maxSessions: positiveInteger(options.maxSessions, BROWSER_SESSION_MAX_SESSIONS),
      idleTtlMs: positiveInteger(options.idleTtlMs, BROWSER_SESSION_IDLE_TTL_MS),
      sweepIntervalMs: positiveInteger(options.sweepIntervalMs, BROWSER_SESSION_SWEEP_MS),
    };
    this.sweepTimer = setInterval(() => this.sweepIdleSessions(), this.lifecycle.sweepIntervalMs);
    // Don't keep the event loop (and thus the process) alive for the sweep.
    this.sweepTimer.unref();
  }

  normalizeSessionId(sessionId: string | null | undefined): string {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return DEFAULT_SESSION_ID;
    }
    return sessionId;
  }

  getCurrentSessionId(): string | null {
    return this.executionContext.getStore()?.sessionId ?? null;
  }

  getOrCreateSession(sessionId: string | null | undefined): BrowserSessionEntry {
    const normalized = this.normalizeSessionId(sessionId);
    let entry = this.sessions.get(normalized);
    if (!entry) {
      if (this.sessions.size >= this.lifecycle.maxSessions) {
        throw new BrowserSessionQueueError(
          `Browser session limit reached (${this.lifecycle.maxSessions} tracked sessions); ` +
            'close an HTTP session or wait for idle reclamation',
          'BROWSER_SESSION_LIMIT_REACHED',
          this.estimateSessionRetryAfterMs(),
          this.sessions.size,
          this.lifecycle.maxSessions,
        );
      }
      entry = {
        tabRegistry: new TabRegistry(),
        currentTabIndex: null,
        currentPageId: null,
        currentTargetId: null,
        lastToolName: null,
        lastTouchedAt: null,
        lastTouchedMs: this.now(),
      };
      this.sessions.set(normalized, entry);
    } else {
      entry.lastTouchedMs = this.now();
    }
    return entry;
  }

  getTabRegistry(sessionId: string | null | undefined): TabRegistry {
    return this.getOrCreateSession(sessionId).tabRegistry;
  }

  noteToolResult(
    sessionId: string | null | undefined,
    toolName: string,
    snapshot?: Partial<BrowserSessionSnapshot> | null,
  ): void {
    const entry = this.getOrCreateSession(sessionId);
    const registryMeta = entry.tabRegistry.getContextMeta();
    if (registryMeta.tabIndex !== null) entry.currentTabIndex = registryMeta.tabIndex;
    if (registryMeta.pageId !== null) entry.currentPageId = registryMeta.pageId;
    if (snapshot?.currentTabIndex !== undefined)
      entry.currentTabIndex = snapshot.currentTabIndex ?? null;
    if (snapshot?.currentPageId !== undefined) entry.currentPageId = snapshot.currentPageId ?? null;
    if (snapshot?.currentTargetId !== undefined)
      entry.currentTargetId = snapshot.currentTargetId ?? null;
    entry.lastToolName = toolName;
    entry.lastTouchedAt = new Date().toISOString();
    this.lastActiveSessionId = this.normalizeSessionId(sessionId);
  }

  getSnapshot(sessionId: string | null | undefined): BrowserSessionSnapshot {
    const entry = this.getOrCreateSession(sessionId);
    return {
      currentTabIndex: entry.currentTabIndex,
      currentPageId: entry.currentPageId,
      currentTargetId: entry.currentTargetId,
      lastToolName: entry.lastToolName,
      lastTouchedAt: entry.lastTouchedAt,
    };
  }

  getBrowserLease(sessionId: string | null | undefined): {
    owned: boolean;
    otherOwners: number;
    totalOwners: number;
  } {
    const normalized = this.normalizeSessionId(sessionId);
    const owned = this.browserOwners.has(normalized);
    return {
      owned,
      otherOwners: this.browserOwners.size - (owned ? 1 : 0),
      totalOwners: this.browserOwners.size,
    };
  }

  claimBrowserLease(sessionId: string | null | undefined): {
    alreadyOwned: boolean;
    totalOwners: number;
  } {
    const normalized = this.normalizeSessionId(sessionId);
    const alreadyOwned = this.browserOwners.has(normalized);
    this.browserOwners.add(normalized);
    this.getOrCreateSession(normalized);
    return { alreadyOwned, totalOwners: this.browserOwners.size };
  }

  releaseBrowserLease(sessionId: string | null | undefined): {
    released: boolean;
    remainingOwners: number;
  } {
    const normalized = this.normalizeSessionId(sessionId);
    const released = this.browserOwners.delete(normalized);
    return { released, remainingOwners: this.browserOwners.size };
  }

  clearSessionContext(sessionId: string | null | undefined): void {
    const entry = this.getOrCreateSession(sessionId);
    entry.tabRegistry.clear();
    entry.currentTabIndex = null;
    entry.currentPageId = null;
    entry.currentTargetId = null;
    entry.lastToolName = null;
    entry.lastTouchedAt = new Date().toISOString();
  }

  clearBrowserLeases(): void {
    this.browserOwners.clear();
  }

  dropSession(sessionId: string): boolean {
    const normalized = this.normalizeSessionId(sessionId);
    if (this.lastActiveSessionId === normalized) this.lastActiveSessionId = null;
    this.browserOwners.delete(normalized);
    this.rejectPendingSession(
      normalized,
      new BrowserSessionQueueError(
        `Browser session closed while requests were queued: ${normalized}`,
        'BROWSER_SESSION_CLOSED',
      ),
    );
    this.scheduleBySession.delete(normalized);
    return this.sessions.delete(normalized);
  }

  /** Stop the idle sweep timer. Idempotent; safe for tests and graceful shutdown. */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  getQueueStats(): BrowserSessionQueueStats {
    const now = this.now();
    const oldestPending = this.deadlineHeap.peek();
    const oldestPendingWaitMs = oldestPending ? now - oldestPending.enqueuedAt : 0;
    return {
      ...this.schedulerOptions,
      policy: this.schedulerOptions.policy ?? 'drr-aging',
      systemVirtualTimeMs:
        this.schedulerOptions.policy === 'eevdf'
          ? roundMetric(this.systemVirtualTimeMs)
          : undefined,
      pending: this.pendingExecutionCount,
      pendingSessions: this.pendingBySession.size,
      readySessions: this.readySessionCount,
      activeSessionId: this.activeExecutionSessionId,
      admissionLimit: this.getAdmissionLimit(),
      oldestPendingWaitMs: roundMetric(Math.max(0, oldestPendingWaitMs)),
      dispatchCount: this.dispatchCount,
      agedDispatchCount: this.agedDispatchCount,
      queueTimeoutCount: this.queueTimeoutCount,
      queueRejectedCount: this.queueRejectedCount,
      averageQueueWaitMs:
        this.dispatchCount === 0 ? 0 : roundMetric(this.totalQueueWaitMs / this.dispatchCount),
      averageServiceMs:
        this.dispatchCount === 0 ? 0 : roundMetric(this.totalServiceMs / this.dispatchCount),
      maxQueueWaitMs: roundMetric(this.maxQueueWaitMs),
      trackedToolCosts: this.costModel.size,
      deadlineTimerActive: this.deadlineTimer !== null,
      trackedSessions: this.sessions.size,
      sessionLimit: this.lifecycle.maxSessions,
    };
  }

  getToolCostStats(toolName: string): BrowserSessionToolCostStats | null {
    return this.costModel.getStats(toolName);
  }

  async restoreSessionContext(sessionId: string | null | undefined): Promise<void> {
    const normalized = this.normalizeSessionId(sessionId);
    const entry = this.getOrCreateSession(normalized);
    const collector = this.getCollector();

    if (!collector) {
      this.lastActiveSessionId = normalized;
      return;
    }

    if (
      this.lastActiveSessionId === normalized ||
      (entry.currentTabIndex === null && entry.currentTargetId === null)
    ) {
      this.lastActiveSessionId = normalized;
      return;
    }

    const registeredTab = entry.currentPageId
      ? entry.tabRegistry.getTabById(entry.currentPageId)
      : null;
    const restoreIndex =
      registeredTab?.stale === false ? registeredTab.index : entry.currentTabIndex;

    if (typeof restoreIndex === 'number') {
      try {
        await collector.selectPage(restoreIndex);
        entry.currentTabIndex = restoreIndex;
        if (registeredTab) entry.tabRegistry.setCurrentPageId(registeredTab.pageId);
      } catch (error) {
        logger.warn(
          `[browser-session] Failed to restore page index ${restoreIndex} for session ${normalized}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (entry.currentTargetId) {
      try {
        await collector.attachCdpTarget(entry.currentTargetId);
      } catch (error) {
        logger.warn(
          `[browser-session] Failed to restore target ${entry.currentTargetId} for session ${normalized}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.lastActiveSessionId = normalized;
  }

  async runExclusive<T>(sessionId: string | null | undefined, fn: () => Promise<T>): Promise<T>;
  async runExclusive<T>(
    sessionId: string | null | undefined,
    fn: () => Promise<T>,
    options: BrowserSessionExecutionOptions,
  ): Promise<T>;
  async runExclusive<T>(
    sessionId: string | null | undefined,
    options: BrowserSessionExecutionOptions,
    fn: () => Promise<T>,
  ): Promise<T>;
  async runExclusive<T>(
    sessionId: string | null | undefined,
    optionsOrFn: BrowserSessionExecutionOptions | (() => Promise<T>),
    optionsOrMaybeFn?: BrowserSessionExecutionOptions | (() => Promise<T>),
  ): Promise<T> {
    const normalized = this.normalizeSessionId(sessionId);
    const options =
      typeof optionsOrFn === 'function'
        ? optionsOrMaybeFn && typeof optionsOrMaybeFn !== 'function'
          ? optionsOrMaybeFn
          : {}
        : optionsOrFn;
    const fn =
      typeof optionsOrFn === 'function'
        ? optionsOrFn
        : typeof optionsOrMaybeFn === 'function'
          ? optionsOrMaybeFn
          : undefined;
    if (!fn) throw new TypeError('Browser session execution callback is required');
    if (options.signal?.aborted) {
      throw new BrowserSessionQueueError(
        `Browser session request was cancelled before admission for ${normalized}`,
        'BROWSER_SESSION_QUEUE_CANCELLED',
      );
    }

    const activeContext = this.executionContext.getStore();
    if (activeContext?.sessionId === normalized) {
      return await fn();
    }
    if (activeContext) {
      throw new BrowserSessionQueueError(
        `Cannot enter browser session ${normalized} while ${activeContext.sessionId} owns the browser`,
        'BROWSER_SESSION_CROSS_SESSION_REENTRY',
      );
    }

    this.getOrCreateSession(normalized);

    const sessionQueue = this.pendingBySession.get(normalized);
    const sessionPending = sessionQueue?.length ?? 0;
    if (sessionPending >= this.schedulerOptions.maxPendingPerSession) {
      this.queueRejectedCount += 1;
      const retryAfterMs = this.estimateRetryAfterMs();
      throw new BrowserSessionQueueError(
        `Browser session queue is full for ${normalized} ` +
          `(${sessionPending}/${this.schedulerOptions.maxPendingPerSession} pending)`,
        'BROWSER_SESSION_QUEUE_FULL',
        retryAfterMs,
        sessionPending,
        this.schedulerOptions.maxPendingPerSession,
      );
    }
    const admissionLimit = this.getAdmissionLimit(normalized);
    if (this.pendingExecutionCount >= admissionLimit) {
      this.queueRejectedCount += 1;
      const retryAfterMs = this.estimateRetryAfterMs();
      throw new BrowserSessionQueueError(
        `Browser session queue is full ` +
          `(${this.pendingExecutionCount}/${admissionLimit} currently admissible, ` +
          `${this.schedulerOptions.maxPending} absolute maximum)`,
        'BROWSER_SESSION_QUEUE_FULL',
        retryAfterMs,
        this.pendingExecutionCount,
        admissionLimit,
      );
    }

    const weight =
      typeof options.weight === 'number' && Number.isFinite(options.weight) && options.weight > 0
        ? options.weight
        : 1.0;
    const scheduleState = this.getScheduleState(normalized);
    if (weight !== scheduleState.weight) {
      scheduleState.weight = weight;
    }

    return await new Promise<T>((resolve, reject) => {
      const enqueuedAt = this.now();
      const task: PendingExecution = {
        sessionId: normalized,
        run: fn,
        resolve: (value) => resolve(value as T),
        reject,
        toolName: options.toolName?.trim() || null,
        estimatedCostMs: this.estimateCost(options.toolName, options.costHintMs),
        weight,
        enqueuedAt,
        deadlineAt: enqueuedAt + this.schedulerOptions.waitTimeoutMs,
        sequence: this.nextSequence++,
        state: 'pending',
        previous: null,
        next: null,
        deadlineHeapIndex: -1,
        agingHeapIndex: -1,
        signal: options.signal ?? null,
        abortHandler: null,
      };
      let queue = sessionQueue;
      if (!queue) {
        queue = { head: null, tail: null, length: 0 };
        this.pendingBySession.set(normalized, queue);
      }
      this.appendPendingTask(queue, task);
      this.deadlineHeap.push(task);
      if (task.signal) {
        task.abortHandler = () => this.cancelPendingTask(task);
        task.signal.addEventListener('abort', task.abortHandler, { once: true });
      }
      this.pendingExecutionCount += 1;
      this.enqueueReadySession(normalized);
      this.refreshDeadlineTimer();
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pendingExecutionCount > 0) {
        const selected = this.takeNextExecution();
        if (!selected) break;
        const { sessionId, task, scheduleState, aged } = selected;

        const queueWaitMs = Math.max(0, this.now() - task.enqueuedAt);
        this.dispatchCount += 1;
        if (aged) this.agedDispatchCount += 1;
        this.totalQueueWaitMs += queueWaitMs;
        this.maxQueueWaitMs = Math.max(this.maxQueueWaitMs, queueWaitMs);
        this.activeExecutionSessionId = sessionId;
        const serviceStartedAt = this.now();
        let result: unknown;
        let failure: unknown;
        let failed = false;
        try {
          result = await this.executionContext.run({ sessionId }, task.run);
        } catch (error) {
          failed = true;
          failure = error;
        } finally {
          const serviceMs = Math.max(0, this.now() - serviceStartedAt);
          const chargedMs = clamp(serviceMs, MIN_COST_MS, MAX_COST_MS);
          if (this.schedulerOptions.policy === 'eevdf') {
            scheduleState.vruntimeMs += chargedMs / (scheduleState.weight || 1.0);
            this.systemVirtualTimeMs = Math.max(this.systemVirtualTimeMs, scheduleState.vruntimeMs);
          } else {
            this.materializeGlobalCredit(scheduleState);
            scheduleState.deficitMs = clamp(
              scheduleState.deficitMs - chargedMs,
              -MAX_COST_MS,
              MAX_COST_MS + this.schedulerOptions.quantumMs,
            );
          }
          this.totalServiceMs += serviceMs;
          if (task.toolName) this.updateToolCost(task.toolName, chargedMs);
          task.state = 'settled';
          this.activeExecutionSessionId = null;
          const remaining = this.pendingBySession.get(sessionId);
          if (remaining && remaining.length > 0) {
            this.enqueueReadySession(sessionId);
          } else {
            if (this.schedulerOptions.policy !== 'eevdf') {
              scheduleState.deficitMs = Math.min(0, scheduleState.deficitMs);
            }
          }
        }

        if (failed) task.reject(failure);
        else task.resolve(result);
      }
    } finally {
      this.draining = false;
      if (this.pendingExecutionCount > 0) void this.drainQueue();
    }
  }

  private takeNextExecution(): SelectedExecution | null {
    const selectedSession = this.selectReadySession();
    if (!selectedSession) return null;
    const { sessionId, aged } = selectedSession;
    const queue = this.pendingBySession.get(sessionId);
    const task = queue?.head;
    if (!queue || !task) {
      this.pendingBySession.delete(sessionId);
      return this.takeNextExecution();
    }

    this.unlinkPendingTask(queue, task);
    this.deadlineHeap.remove(task);
    this.detachAbortListener(task);
    task.state = 'running';
    this.pendingExecutionCount -= 1;
    if (queue.length === 0) this.pendingBySession.delete(sessionId);
    this.refreshDeadlineTimer();
    return {
      sessionId,
      task,
      scheduleState: this.getScheduleState(sessionId),
      aged,
    };
  }

  private selectReadySession(): { sessionId: string; aged: boolean } | null {
    if (this.readySessionCount === 0) return null;

    const now = this.now();
    // Aging is an absolute starvation guard. It deliberately overrides deficit
    // or deadline accounting only at safe tool boundaries; active CDP work is never preempted.
    const oldest = this.agingHeap.peek();
    if (oldest && now - oldest.enqueuedAt >= this.schedulerOptions.agingMs) {
      const state = this.scheduleBySession.get(oldest.sessionId);
      if (state?.ready) {
        this.removeReadyState(state);
        return { sessionId: state.sessionId, aged: true };
      }
    }

    if (this.schedulerOptions.policy === 'eevdf') {
      return this.selectReadySessionEevdf();
    }
    return this.selectReadySessionDrr();
  }

  private selectReadySessionEevdf(): { sessionId: string; aged: boolean } | null {
    const activeSessions: { state: SessionScheduleState; task: PendingExecution }[] = [];
    let curr = this.readyHead;
    while (curr) {
      const next = curr.nextReady;
      const task = this.pendingBySession.get(curr.sessionId)?.head;
      if (!task) {
        this.removeReadyState(curr);
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
      const c = candidatePool[i]!;
      const d = c.state.vruntimeMs + c.task.estimatedCostMs / (c.state.weight || 1.0);
      if (
        d < bestDeadline ||
        (d === bestDeadline && c.task.sequence < bestCandidate.task.sequence)
      ) {
        bestCandidate = c;
        bestDeadline = d;
      }
    }

    this.removeReadyState(bestCandidate.state);
    return { sessionId: bestCandidate.state.sessionId, aged: false };
  }

  private selectReadySessionDrr(): { sessionId: string; aged: boolean } | null {
    // DRR accounts in milliseconds rather than request count. Bulk-crediting
    // advances a shared virtual credit instead of touching every flow twice.
    while (this.readySessionCount > 0) {
      const cycleLength = this.readySessionCount;
      let additionalRounds = Number.POSITIVE_INFINITY;
      for (let index = 0; index < cycleLength; index += 1) {
        const state = this.readyHead;
        if (!state) break;
        const task = this.pendingBySession.get(state.sessionId)?.head;
        if (!task) {
          this.removeReadyState(state);
          continue;
        }

        this.materializeGlobalCredit(state);
        state.deficitMs = Math.min(
          MAX_COST_MS + this.schedulerOptions.quantumMs,
          state.deficitMs + this.schedulerOptions.quantumMs,
        );
        if (task.estimatedCostMs <= state.deficitMs) {
          this.removeReadyState(state);
          return { sessionId: state.sessionId, aged: false };
        }
        additionalRounds = Math.min(
          additionalRounds,
          Math.max(
            0,
            Math.ceil((task.estimatedCostMs - state.deficitMs) / this.schedulerOptions.quantumMs) -
              1,
          ),
        );
        this.rotateReadyHeadToTail();
      }
      if (!Number.isFinite(additionalRounds)) return null;
      if (additionalRounds > 0) {
        this.globalCreditMs += additionalRounds * this.schedulerOptions.quantumMs;
      }
    }
    return null;
  }

  private enqueueReadySession(sessionId: string): void {
    if (this.activeExecutionSessionId === sessionId) return;
    const queue = this.pendingBySession.get(sessionId);
    if (!queue?.head) return;
    const state = this.getScheduleState(sessionId);
    if (state.ready) return;

    if (this.schedulerOptions.policy === 'eevdf') {
      const maxLag = this.schedulerOptions.maxLagMs ?? 500;
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
    this.agingHeap.push(queue.head);
  }

  private removeReadyState(state: SessionScheduleState): void {
    if (!state.ready) return;
    if (state.previousReady) state.previousReady.nextReady = state.nextReady;
    else this.readyHead = state.nextReady;
    if (state.nextReady) state.nextReady.previousReady = state.previousReady;
    else this.readyTail = state.previousReady;
    state.ready = false;
    state.previousReady = null;
    state.nextReady = null;
    this.readySessionCount -= 1;

    const head = this.pendingBySession.get(state.sessionId)?.head;
    if (head) this.agingHeap.remove(head);
  }

  private rotateReadyHeadToTail(): void {
    const state = this.readyHead;
    if (!state || state === this.readyTail) return;
    this.readyHead = state.nextReady;
    this.readyHead!.previousReady = null;
    state.previousReady = this.readyTail;
    state.nextReady = null;
    this.readyTail!.nextReady = state;
    this.readyTail = state;
  }

  private getScheduleState(sessionId: string): SessionScheduleState {
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

  private materializeGlobalCredit(state: SessionScheduleState): void {
    const credit = this.globalCreditMs - state.globalCreditBaseMs;
    if (credit > 0) {
      state.deficitMs = Math.min(MAX_COST_MS, state.deficitMs + credit);
    }
    state.globalCreditBaseMs = this.globalCreditMs;
  }

  private estimateCost(toolName: string | undefined, costHintMs: number | undefined): number {
    return this.costModel.estimate(toolName, costHintMs);
  }

  private updateToolCost(toolName: string, serviceMs: number): void {
    this.costModel.update(toolName, serviceMs, this.schedulerOptions.costEwmaAlpha);
  }

  private getAdmissionLimit(incomingSessionId?: string): number {
    const reserved = this.schedulerOptions.reservedPendingPerSession;
    if (reserved === 0) return this.schedulerOptions.maxPending;

    let demandSessionCount = this.pendingBySession.size;
    const activeHasPending = this.activeExecutionSessionId
      ? this.pendingBySession.has(this.activeExecutionSessionId)
      : false;
    if (this.activeExecutionSessionId && !activeHasPending) demandSessionCount += 1;
    if (
      incomingSessionId &&
      incomingSessionId !== this.activeExecutionSessionId &&
      !this.pendingBySession.has(incomingSessionId)
    ) {
      demandSessionCount += 1;
    }

    // Hold capacity for sessions that have not queued yet. As each late session
    // arrives its reservation becomes immediately admissible.
    const reservableConcurrency = Math.min(
      this.schedulerOptions.expectedConcurrency,
      Math.floor(this.schedulerOptions.maxPending / reserved),
    );
    const protectedSessions = Math.max(0, reservableConcurrency - demandSessionCount);
    return Math.max(1, this.schedulerOptions.maxPending - protectedSessions * reserved);
  }

  private appendPendingTask(queue: SessionPendingQueue, task: PendingExecution): void {
    task.previous = queue.tail;
    task.next = null;
    if (queue.tail) queue.tail.next = task;
    else queue.head = task;
    queue.tail = task;
    queue.length += 1;
  }

  private unlinkPendingTask(queue: SessionPendingQueue, task: PendingExecution): void {
    if (task.previous) task.previous.next = task.next;
    else queue.head = task.next;
    if (task.next) task.next.previous = task.previous;
    else queue.tail = task.previous;
    task.previous = null;
    task.next = null;
    queue.length -= 1;
  }

  private removePendingTask(task: PendingExecution): boolean {
    if (task.state !== 'pending') return false;
    const queue = this.pendingBySession.get(task.sessionId);
    if (!queue) return false;

    const state = this.scheduleBySession.get(task.sessionId);
    const wasHead = queue.head === task;
    if (wasHead && state?.ready) this.agingHeap.remove(task);
    this.unlinkPendingTask(queue, task);
    this.deadlineHeap.remove(task);
    this.detachAbortListener(task);
    task.state = 'settled';
    this.pendingExecutionCount -= 1;
    if (queue.length === 0) {
      this.pendingBySession.delete(task.sessionId);
      if (state?.ready) this.removeReadyState(state);
    } else if (wasHead && state?.ready && queue.head) {
      this.agingHeap.push(queue.head);
    }
    return true;
  }

  private rejectPendingSession(sessionId: string, error: BrowserSessionQueueError): void {
    const queue = this.pendingBySession.get(sessionId);
    if (!queue) return;

    const state = this.scheduleBySession.get(sessionId);
    if (state?.ready) this.removeReadyState(state);
    this.pendingBySession.delete(sessionId);
    this.pendingExecutionCount -= queue.length;
    let task = queue.head;
    while (task) {
      const next = task.next;
      this.deadlineHeap.remove(task);
      this.agingHeap.remove(task);
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
    this.refreshDeadlineTimer();
  }

  private refreshDeadlineTimer(): void {
    const nextDueAt = this.deadlineHeap.peek()?.deadlineAt ?? null;
    if (nextDueAt === this.deadlineTimerDueAt && this.deadlineTimer) return;
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    this.deadlineTimerDueAt = nextDueAt;
    if (nextDueAt === null) return;

    const delay = Math.min(2_147_483_647, Math.max(0, nextDueAt - this.now()));
    this.deadlineTimer = setTimeout(() => this.expirePendingTasks(), delay);
    this.deadlineTimer.unref();
  }

  private cancelPendingTask(task: PendingExecution): void {
    if (!this.removePendingTask(task)) return;
    this.refreshDeadlineTimer();
    task.reject(
      new BrowserSessionQueueError(
        `Browser session request was cancelled while queued for ${task.sessionId}`,
        'BROWSER_SESSION_QUEUE_CANCELLED',
      ),
    );
  }

  private detachAbortListener(task: PendingExecution): void {
    if (task.signal && task.abortHandler) {
      task.signal.removeEventListener('abort', task.abortHandler);
    }
    task.abortHandler = null;
  }

  private expirePendingTasks(): void {
    this.deadlineTimer = null;
    this.deadlineTimerDueAt = null;
    const now = this.now();
    while (true) {
      const task = this.deadlineHeap.peek();
      if (!task || task.deadlineAt > now) break;
      this.deadlineHeap.pop();
      if (!this.removePendingTask(task)) continue;
      this.queueTimeoutCount += 1;
      task.reject(
        new BrowserSessionQueueError(
          `Browser session request timed out after waiting ` +
            `${this.schedulerOptions.waitTimeoutMs}ms in the queue`,
          'BROWSER_SESSION_QUEUE_TIMEOUT',
          this.estimateRetryAfterMs(),
          this.pendingExecutionCount,
          this.getAdmissionLimit(),
        ),
      );
    }
    this.refreshDeadlineTimer();
  }

  private estimateRetryAfterMs(): number {
    const averageServiceMs =
      this.dispatchCount > 0 && this.totalServiceMs > 0
        ? this.totalServiceMs / this.dispatchCount
        : DEFAULT_COST_MS;
    const competingSessions = Math.max(
      1,
      this.readySessionCount + (this.activeExecutionSessionId ? 1 : 0),
    );
    return Math.ceil(
      clamp(averageServiceMs * competingSessions, MIN_COST_MS, this.schedulerOptions.waitTimeoutMs),
    );
  }

  /** Reap sessions untouched beyond the idle TTL. Busy sessions are never evicted. */
  private sweepIdleSessions(): void {
    const now = this.now();
    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastTouchedMs < this.lifecycle.idleTtlMs) continue;
      // The queue owns sessions with pending or in-flight work.
      if (this.pendingBySession.has(sessionId) || this.activeExecutionSessionId === sessionId)
        continue;
      this.dropSession(sessionId);
    }
  }

  /** Suggested retry delay when the session limit rejects a new session id. */
  private estimateSessionRetryAfterMs(): number {
    const now = this.now();
    let oldestTouchMs = Number.POSITIVE_INFINITY;
    for (const entry of this.sessions.values()) {
      oldestTouchMs = Math.min(oldestTouchMs, entry.lastTouchedMs);
    }
    const idleForMs = Number.isFinite(oldestTouchMs) ? Math.max(0, now - oldestTouchMs) : 0;
    // An idle session is reclaimed up to one TTL from its last access.
    return Math.ceil(
      clamp(this.lifecycle.idleTtlMs - idleForMs, MIN_COST_MS, this.lifecycle.idleTtlMs),
    );
  }
}
