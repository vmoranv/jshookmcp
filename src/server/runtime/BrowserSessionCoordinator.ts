import { logger } from '@utils/logger';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { TabRegistry } from '@modules/browser/TabRegistry';
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
import { BrowserSessionQueueError } from './BrowserSessionErrors';
import { computeAdmissionLimit, computeRetryAfterMs } from './BrowserSessionAdmission';
import {
  BrowserSessionRegistry,
  type BrowserSessionEntry,
  type BrowserSessionLifecycleOptions,
  type BrowserSessionSnapshot,
} from './BrowserSessionRegistry';
import {
  BrowserSessionScheduler,
  DEFAULT_SCHEDULER_OPTIONS,
  type BrowserSessionSchedulerOptions,
  type SelectedExecution,
} from './BrowserSessionScheduler';
import { BrowserSessionQueue, type PendingExecution } from './BrowserSessionQueue';
export type { BrowserSessionSchedulerOptions } from './BrowserSessionScheduler';

export { BrowserSessionQueueError } from './BrowserSessionErrors';
export type {
  BrowserSessionEntry,
  BrowserSessionLifecycleOptions,
  BrowserSessionSnapshot,
} from './BrowserSessionRegistry';

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

type SelectedPendingExecution = Omit<SelectedExecution, 'task'> & { task: PendingExecution };

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
  private readonly registry: BrowserSessionRegistry;
  private readonly browserOwners = new Set<string>();
  private readonly costModel = new BrowserSessionCostModel();
  private readonly schedulerOptions: BrowserSessionSchedulerOptions;
  private readonly scheduler: BrowserSessionScheduler;
  private readonly queue: BrowserSessionQueue;
  private activeExecutionSessionId: string | null = null;
  private draining = false;
  private dispatchCount = 0;
  private agedDispatchCount = 0;
  private queueTimeoutCount = 0;
  private queueRejectedCount = 0;
  private totalQueueWaitMs = 0;
  private totalServiceMs = 0;
  private maxQueueWaitMs = 0;

  private get lastActiveSessionId(): string | null {
    return this.registry.lastActiveSessionId;
  }

  private set lastActiveSessionId(sessionId: string | null) {
    this.registry.lastActiveSessionId = sessionId;
  }

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
    this.queue = new BrowserSessionQueue(
      this.now,
      () => this.expirePendingTasks(),
      (task) => this.cancelPendingTask(task),
    );
    this.scheduler = new BrowserSessionScheduler({
      options: this.schedulerOptions,
      getQueueHead: (sessionId) => this.queue.head(sessionId),
      getActiveSessionId: () => this.activeExecutionSessionId,
      now: this.now,
    });
    const lifecycle: BrowserSessionLifecycleOptions = {
      maxSessions: positiveInteger(options.maxSessions, BROWSER_SESSION_MAX_SESSIONS),
      idleTtlMs: positiveInteger(options.idleTtlMs, BROWSER_SESSION_IDLE_TTL_MS),
      sweepIntervalMs: positiveInteger(options.sweepIntervalMs, BROWSER_SESSION_SWEEP_MS),
    };
    this.registry = new BrowserSessionRegistry({
      lifecycle,
      now: this.now,
      isBusy: (sessionId) =>
        this.queue.has(sessionId) || this.activeExecutionSessionId === sessionId,
      retryAfterMs: () => this.estimateSessionRetryAfterMs(),
      onEvict: (sessionId) => this.dropSession(sessionId),
    });
  }

  normalizeSessionId(sessionId: string | null | undefined): string {
    return this.registry.normalize(sessionId);
  }

  getCurrentSessionId(): string | null {
    return this.executionContext.getStore()?.sessionId ?? null;
  }

  getOrCreateSession(sessionId: string | null | undefined): BrowserSessionEntry {
    return this.registry.getOrCreate(sessionId);
  }

  getTabRegistry(sessionId: string | null | undefined): TabRegistry {
    return this.registry.getTabRegistry(sessionId);
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
    this.scheduler.removeSession(normalized);
    return this.registry.delete(normalized);
  }

  /** Stop the idle sweep timer. Idempotent; safe for tests and graceful shutdown. */
  dispose(): void {
    this.registry.dispose();
  }

  getQueueStats(): BrowserSessionQueueStats {
    const now = this.now();
    const oldestPending = this.queue.peekDeadline();
    const oldestPendingWaitMs = oldestPending ? now - oldestPending.enqueuedAt : 0;
    return {
      ...this.schedulerOptions,
      policy: this.schedulerOptions.policy ?? 'drr-aging',
      systemVirtualTimeMs:
        this.schedulerOptions.policy === 'eevdf'
          ? roundMetric(this.scheduler.virtualTimeMs)
          : undefined,
      pending: this.queue.size,
      pendingSessions: this.queue.sessionCount,
      readySessions: this.scheduler.readyCount,
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
      deadlineTimerActive: this.queue.peekDeadline() !== null,
      trackedSessions: this.registry.size,
      sessionLimit: this.registry.maxSessions,
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

    const sessionPending = this.queue.length(normalized);
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
    if (this.queue.size >= admissionLimit) {
      this.queueRejectedCount += 1;
      const retryAfterMs = this.estimateRetryAfterMs();
      throw new BrowserSessionQueueError(
        `Browser session queue is full ` +
          `(${this.queue.size}/${admissionLimit} currently admissible, ` +
          `${this.schedulerOptions.maxPending} absolute maximum)`,
        'BROWSER_SESSION_QUEUE_FULL',
        retryAfterMs,
        this.queue.size,
        admissionLimit,
      );
    }

    const weight =
      typeof options.weight === 'number' && Number.isFinite(options.weight) && options.weight > 0
        ? options.weight
        : 1.0;
    const scheduleState = this.scheduler.getState(normalized);
    if (weight !== scheduleState.weight) {
      scheduleState.weight = weight;
    }

    return await new Promise<T>((resolve, reject) => {
      const enqueuedAt = this.now();
      this.queue.enqueue({
        sessionId: normalized,
        run: fn,
        resolve: (value) => resolve(value as T),
        reject,
        toolName: options.toolName?.trim() || null,
        estimatedCostMs: this.estimateCost(options.toolName, options.costHintMs),
        weight,
        enqueuedAt,
        deadlineAt: enqueuedAt + this.schedulerOptions.waitTimeoutMs,
        signal: options.signal ?? null,
      });
      this.scheduler.enqueue(normalized);
      void this.drainQueue();
    });
  }

  private async drainQueue(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.size > 0) {
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
          this.scheduler.recordService(scheduleState, chargedMs);
          this.totalServiceMs += serviceMs;
          if (task.toolName) this.updateToolCost(task.toolName, chargedMs);
          task.state = 'settled';
          this.activeExecutionSessionId = null;
          if (this.queue.length(sessionId) > 0) {
            this.scheduler.enqueue(sessionId);
          } else {
            this.scheduler.finalizeService(scheduleState);
          }
        }

        if (failed) task.reject(failure);
        else task.resolve(result);
      }
    } finally {
      this.draining = false;
      if (this.queue.size > 0) void this.drainQueue();
    }
  }

  private takeNextExecution(): SelectedPendingExecution | null {
    const selectedSession = this.scheduler.select() as SelectedPendingExecution | null;
    if (!selectedSession) return null;
    const { sessionId, aged } = selectedSession;
    const task = this.queue.takeHead(sessionId);
    if (!task) return this.takeNextExecution();
    return {
      sessionId,
      task,
      scheduleState: selectedSession.scheduleState,
      aged,
    };
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

    let demandSessionCount = this.queue.sessionCount;
    const activeHasPending = this.activeExecutionSessionId
      ? this.queue.has(this.activeExecutionSessionId)
      : false;
    if (this.activeExecutionSessionId && !activeHasPending) demandSessionCount += 1;
    if (
      incomingSessionId &&
      incomingSessionId !== this.activeExecutionSessionId &&
      !this.queue.has(incomingSessionId)
    ) {
      demandSessionCount += 1;
    }

    return computeAdmissionLimit(this.schedulerOptions, demandSessionCount);
  }

  private removePendingTask(task: PendingExecution): boolean {
    if (task.state !== 'pending') return false;
    const state = this.scheduler.peekState(task.sessionId);
    if (this.queue.head(task.sessionId) === task && state?.ready) {
      this.scheduler.removeTask(task);
    }
    const info = this.queue.removeTask(task);
    if (!info) return false;
    if (info.queueEmpty) {
      if (state?.ready) this.scheduler.removeReady(state);
    } else if (info.wasHead && state?.ready) {
      const head = this.queue.head(task.sessionId);
      if (head) this.scheduler.pushHead(head);
    }
    return true;
  }

  private rejectPendingSession(sessionId: string, error: BrowserSessionQueueError): void {
    if (!this.queue.has(sessionId)) return;
    const state = this.scheduler.peekState(sessionId);
    if (state?.ready) this.scheduler.removeReady(state);
    this.queue.rejectSession(sessionId, error);
  }

  private cancelPendingTask(task: PendingExecution): void {
    if (!this.removePendingTask(task)) return;
    task.reject(
      new BrowserSessionQueueError(
        `Browser session request was cancelled while queued for ${task.sessionId}`,
        'BROWSER_SESSION_QUEUE_CANCELLED',
      ),
    );
  }

  private expirePendingTasks(): void {
    for (const task of this.queue.popExpired()) {
      const state = this.scheduler.peekState(task.sessionId);
      if (state?.ready) {
        this.scheduler.removeTask(task);
        this.scheduler.removeReady(state);
      }
      this.queueTimeoutCount += 1;
      task.reject(
        new BrowserSessionQueueError(
          `Browser session request timed out after waiting ` +
            `${this.schedulerOptions.waitTimeoutMs}ms in the queue`,
          'BROWSER_SESSION_QUEUE_TIMEOUT',
          this.estimateRetryAfterMs(),
          this.queue.size,
          this.getAdmissionLimit(),
        ),
      );
    }
  }

  private estimateRetryAfterMs(): number {
    const averageServiceMs =
      this.dispatchCount > 0 && this.totalServiceMs > 0
        ? this.totalServiceMs / this.dispatchCount
        : DEFAULT_COST_MS;
    const competingSessions = this.scheduler.readyCount + (this.activeExecutionSessionId ? 1 : 0);
    return computeRetryAfterMs(
      averageServiceMs,
      competingSessions,
      this.schedulerOptions.waitTimeoutMs,
    );
  }

  /** Suggested retry delay when the session limit rejects a new session id. */
  private estimateSessionRetryAfterMs(): number {
    const now = this.now();
    let oldestTouchMs = Number.POSITIVE_INFINITY;
    for (const entry of this.registry.values()) {
      oldestTouchMs = Math.min(oldestTouchMs, entry.lastTouchedMs);
    }
    const idleForMs = Number.isFinite(oldestTouchMs) ? Math.max(0, now - oldestTouchMs) : 0;
    // An idle session is reclaimed up to one TTL from its last access.
    return Math.ceil(
      clamp(this.registry.idleTtlMs - idleForMs, MIN_COST_MS, this.registry.idleTtlMs),
    );
  }
}
