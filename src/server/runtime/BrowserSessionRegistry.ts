/**
 * Browser session registry: id → tab registry + last-touched snapshot.
 *
 * Owns the lifecycle cap and idle sweep. Queueing/scheduling stays in
 * BrowserSessionCoordinator; this class only answers "does this session exist
 * and what page is it on?".
 */
import { TabRegistry } from '@modules/browser/TabRegistry';
import { BrowserSessionQueueError } from './BrowserSessionErrors';

export interface BrowserSessionSnapshot {
  currentTabIndex: number | null;
  currentPageId: string | null;
  currentTargetId: string | null;
  lastToolName: string | null;
  lastTouchedAt: string | null;
}

export interface BrowserSessionEntry extends BrowserSessionSnapshot {
  tabRegistry: TabRegistry;
  /** Monotonic clock timestamp of the most recent access (idle-sweep input). */
  lastTouchedMs: number;
}

export interface BrowserSessionLifecycleOptions {
  maxSessions: number;
  idleTtlMs: number;
  sweepIntervalMs: number;
}

export interface BrowserSessionRegistryOptions {
  readonly lifecycle: BrowserSessionLifecycleOptions;
  readonly now: () => number;
  /** Sessions with pending or in-flight work must never be swept. */
  readonly isBusy: (sessionId: string) => boolean;
  /** Retry hint for the session-limit error. */
  readonly retryAfterMs: () => number;
}

const DEFAULT_SESSION_ID = 'default';

export class BrowserSessionRegistry {
  private readonly sessions = new Map<string, BrowserSessionEntry>();
  private readonly lifecycle: BrowserSessionLifecycleOptions;
  private readonly now: () => number;
  private readonly isBusy: (sessionId: string) => boolean;
  private readonly retryAfterMs: () => number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private activeSessionId: string | null = null;

  constructor(options: BrowserSessionRegistryOptions) {
    this.lifecycle = options.lifecycle;
    this.now = options.now;
    this.isBusy = options.isBusy;
    this.retryAfterMs = options.retryAfterMs;
    this.sweepTimer = setInterval(() => this.sweepIdleSessions(), this.lifecycle.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  get lastActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  set lastActiveSessionId(sessionId: string | null) {
    this.activeSessionId = sessionId;
  }

  get size(): number {
    return this.sessions.size;
  }

  get maxSessions(): number {
    return this.lifecycle.maxSessions;
  }

  get idleTtlMs(): number {
    return this.lifecycle.idleTtlMs;
  }

  values(): IterableIterator<BrowserSessionEntry> {
    return this.sessions.values();
  }

  normalize(sessionId: string | null | undefined): string {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return DEFAULT_SESSION_ID;
    }
    return sessionId;
  }

  get(sessionId: string | null | undefined): BrowserSessionEntry | undefined {
    return this.sessions.get(this.normalize(sessionId));
  }

  getOrCreate(sessionId: string | null | undefined): BrowserSessionEntry {
    const normalized = this.normalize(sessionId);
    let entry = this.sessions.get(normalized);
    if (!entry) {
      if (this.sessions.size >= this.lifecycle.maxSessions) {
        throw new BrowserSessionQueueError(
          `Browser session limit reached (${this.lifecycle.maxSessions} tracked sessions); ` +
            'close an HTTP session or wait for idle reclamation',
          'BROWSER_SESSION_LIMIT_REACHED',
          this.retryAfterMs(),
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
    return this.getOrCreate(sessionId).tabRegistry;
  }

  delete(sessionId: string): boolean {
    const normalized = this.normalize(sessionId);
    if (this.activeSessionId === normalized) this.activeSessionId = null;
    return this.sessions.delete(normalized);
  }

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweepIdleSessions(): void {
    const now = this.now();
    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastTouchedMs < this.lifecycle.idleTtlMs) continue;
      if (this.isBusy(sessionId)) continue;
      this.sessions.delete(sessionId);
      if (this.activeSessionId === sessionId) this.activeSessionId = null;
    }
  }
}
