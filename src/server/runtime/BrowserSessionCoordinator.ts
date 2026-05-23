import { logger } from '@utils/logger';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { TabRegistry } from '@modules/browser/TabRegistry';

export interface BrowserSessionSnapshot {
  currentTabIndex: number | null;
  currentPageId: string | null;
  currentTargetId: string | null;
  lastToolName: string | null;
  lastTouchedAt: string | null;
}

interface BrowserSessionEntry extends BrowserSessionSnapshot {
  tabRegistry: TabRegistry;
}

const DEFAULT_SESSION_ID = 'default';

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

export function parseBrowserSessionSnapshot(response: unknown): BrowserSessionSnapshot | null {
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
  return {
    currentTabIndex:
      typeof parsed.selectedIndex === 'number' && Number.isFinite(parsed.selectedIndex)
        ? parsed.selectedIndex
        : typeof parsed.currentIndex === 'number' && Number.isFinite(parsed.currentIndex)
          ? parsed.currentIndex
          : null,
    currentPageId: typeof parsed.selectedPageId === 'string' ? parsed.selectedPageId : null,
    currentTargetId: typeof parsed.targetId === 'string' ? parsed.targetId : null,
    lastToolName: typeof parsed.toolName === 'string' ? parsed.toolName : null,
    lastTouchedAt: new Date().toISOString(),
  };
}

export class BrowserSessionCoordinator {
  private readonly executionContext = new AsyncLocalStorage<{ sessionId: string }>();
  private readonly sessions = new Map<string, BrowserSessionEntry>();
  private lastActiveSessionId: string | null = null;
  private executionQueue: Promise<void> = Promise.resolve();

  constructor(private readonly getCollector: () => CodeCollector | null | undefined) {}

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
      entry = {
        tabRegistry: new TabRegistry(),
        currentTabIndex: null,
        currentPageId: null,
        currentTargetId: null,
        lastToolName: null,
        lastTouchedAt: null,
      };
      this.sessions.set(normalized, entry);
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

    if (typeof entry.currentTabIndex === 'number') {
      try {
        await collector.selectPage(entry.currentTabIndex);
      } catch (error) {
        logger.warn(
          `[browser-session] Failed to restore page index ${entry.currentTabIndex} for session ${normalized}: ` +
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

  async runExclusive<T>(sessionId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
    const normalized = this.normalizeSessionId(sessionId);
    const activeContext = this.executionContext.getStore();
    if (activeContext?.sessionId === normalized) {
      return await fn();
    }

    const previous = this.executionQueue;
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.executionQueue = previous.then(() => current);

    await previous;
    try {
      return await this.executionContext.run({ sessionId: normalized }, fn);
    } finally {
      release();
    }
  }
}
