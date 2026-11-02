/**
 * Coordination domain handler — manages Planner/Specialist Agent handoffs
 * and session-level insight accumulation.
 *
 * Handoffs and insights can be snapshotted by RuntimeSnapshotScheduler so
 * process restarts do not drop active reverse-engineering context.
 */

import { randomUUID } from 'node:crypto';
import {
  COORDINATION_GOTO_TIMEOUT_MS,
  COORDINATION_MAX_HANDOFFS,
  COORDINATION_MAX_INSIGHTS,
  COORDINATION_MAX_SNAPSHOTS,
} from '@src/constants';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
export * from './definitions';
export { sharedStateBoardTools } from './state-board/definitions';
export { SharedStateBoardHandlers } from './state-board';

// ── Types ──

interface TaskHandoff {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description: string;
  constraints?: string[];
  targetDomain?: string;
  decision?: string;
  risks?: string[];
  nextSteps?: string[];
  pageUrl?: string;
  createdAt: number;
  completedAt?: number;
  summary?: string;
  keyFindings?: string[];
  artifacts?: string[];
  /** Parent task this handoff was forked from (fan-out dependency edge). */
  parentId?: string;
  /** Other task IDs that must complete before this one (depends-on edges). */
  dependsOn?: string[];
}

export interface SessionInsight {
  id: string;
  category: string;
  content: string;
  confidence: number;
  tags?: string[];
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  toolSource?: string;
  timestamp: number;
  sourceTaskId?: string;
}

type HandoffUpdateStatus = Exclude<TaskHandoff['status'], 'completed'>;

interface CoordinationSnapshot {
  schemaVersion: 1;
  savedAt: string;
  handoffs: [string, TaskHandoff][];
  insights: SessionInsight[];
}

type PersistNotifier = () => void;

// ── Handler ──

export class CoordinationHandlers {
  private readonly handoffs = new Map<string, TaskHandoff>();
  private readonly insights: SessionInsight[] = [];
  private readonly ctx: MCPServerContext;
  private mutationSeq = 0;
  private lastPersistedSeq = 0;
  private persistNotifier?: PersistNotifier;

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
  }

  setPersistNotifier(notify?: PersistNotifier): void {
    this.persistNotifier = notify;
  }

  isPersistDirty(): boolean {
    return this.mutationSeq !== this.lastPersistedSeq;
  }

  exportSnapshot(): CoordinationSnapshot {
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      handoffs: [...this.handoffs.entries()].map(([id, handoff]) => [id, cloneHandoff(handoff)]),
      insights: this.insights.map((insight) => cloneInsight(insight)),
    };
  }

  restoreSnapshot(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const snapshot = data as {
      schemaVersion?: number;
      handoffs?: unknown[];
      insights?: unknown[];
    };
    if (snapshot.schemaVersion !== 1) return;

    const restoredHandoffs = new Map<string, TaskHandoff>();
    for (const entry of snapshot.handoffs ?? []) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue;
      const handoff = entry[1];
      if (isTaskHandoff(handoff)) {
        restoredHandoffs.set(handoff.id, cloneHandoff(handoff));
      }
    }

    const restoredInsights = (snapshot.insights ?? [])
      .filter((value): value is SessionInsight => isSessionInsight(value))
      .map((insight) => cloneInsight(insight));

    this.handoffs.clear();
    for (const [id, handoff] of restoredHandoffs) {
      this.handoffs.set(id, handoff);
    }
    this.trimTerminalHandoffs();
    this.insights.splice(0, this.insights.length, ...restoredInsights);
    this.trimInsights();
    this.mutationSeq = this.handoffs.size + this.insights.length;
    this.lastPersistedSeq = this.mutationSeq;
  }

  markPersisted(): void {
    this.lastPersistedSeq = this.mutationSeq;
  }

  private markDirty(): void {
    this.mutationSeq++;
    this.persistNotifier?.();
  }

  /**
   * Drop the oldest terminal handoffs (completed or failed) until the retained
   * count fits within `COORDINATION_MAX_HANDOFFS`. Both completion and failure
   * are terminal paths that accumulate, so trimming here — on create, on each
   * terminal transition, and on restore — keeps the Map bounded without
   * disturbing pending / in-progress tasks the coordinator still needs.
   */
  private trimTerminalHandoffs(): void {
    const terminal = [...this.handoffs.values()]
      .filter((h) => h.status === 'completed' || h.status === 'failed')
      .toSorted((a, b) => (a.completedAt ?? a.createdAt) - (b.completedAt ?? b.createdAt));
    if (terminal.length <= COORDINATION_MAX_HANDOFFS) return;
    const excess = terminal.length - COORDINATION_MAX_HANDOFFS;
    for (const handoff of terminal.slice(0, excess)) {
      this.handoffs.delete(handoff.id);
    }
  }

  /** Drop the oldest insights until the array fits within `COORDINATION_MAX_INSIGHTS`. */
  private trimInsights(): void {
    while (this.insights.length > COORDINATION_MAX_INSIGHTS) {
      this.insights.shift();
    }
  }

  /** Drop the oldest (by timestamp) snapshots until the Map fits within `COORDINATION_MAX_SNAPSHOTS`. */
  private trimSnapshots(): void {
    if (this.snapshots.size <= COORDINATION_MAX_SNAPSHOTS) return;
    const entries = [...this.snapshots.entries()].toSorted(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );
    const excess = entries.length - COORDINATION_MAX_SNAPSHOTS;
    for (const [id] of entries.slice(0, excess)) {
      this.snapshots.delete(id);
    }
  }

  // ── create_task_handoff ──

  async handleCreateTaskHandoffTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCreateTaskHandoff(args));
  }

  async handleCreateTaskHandoff(args: Record<string, unknown>): Promise<unknown> {
    const description = args.description as string;
    const constraints = args.constraints as string[] | undefined;
    const targetDomain = args.targetDomain as string | undefined;
    const decision = args.decision as string | undefined;
    const risks = args.risks as string[] | undefined;
    const nextSteps = args.nextSteps as string[] | undefined;
    const parentId = typeof args.parentId === 'string' ? args.parentId : undefined;
    const dependsOn = Array.isArray(args.dependsOn)
      ? (args.dependsOn.filter((d) => typeof d === 'string') as string[])
      : undefined;

    // Auto-capture active page URL if available
    let pageUrl: string | undefined;
    try {
      const pc = this.ctx.pageController;
      if (pc) {
        const resolvedPage = await pc.getPage?.();
        if (resolvedPage && typeof resolvedPage.url === 'function') {
          pageUrl = resolvedPage.url();
        }
      }
    } catch {
      // No active page — that's fine
    }

    // Validate dependency references against known handoffs. Non-fatal (warning):
    // a parent/dependency may be created moments later, so forward refs are allowed.
    const dependencyWarnings: string[] = [];
    if (parentId && !this.handoffs.has(parentId)) {
      dependencyWarnings.push(`parentId "${parentId}" does not match a known task`);
    }
    if (dependsOn) {
      for (const dep of dependsOn) {
        if (!this.handoffs.has(dep)) {
          dependencyWarnings.push(`dependsOn "${dep}" does not match a known task`);
        }
      }
    }

    const handoff: TaskHandoff = {
      id: randomUUID().slice(0, 8),
      status: 'pending',
      description,
      constraints,
      targetDomain,
      decision,
      risks,
      nextSteps,
      pageUrl,
      createdAt: Date.now(),
      ...(parentId ? { parentId } : {}),
      ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
    };

    this.handoffs.set(handoff.id, handoff);
    this.trimTerminalHandoffs();
    this.markDirty();

    return {
      taskId: handoff.id,
      status: handoff.status,
      description: handoff.description,
      constraints: handoff.constraints,
      targetDomain: handoff.targetDomain,
      decision: handoff.decision,
      risks: handoff.risks,
      nextSteps: handoff.nextSteps,
      pageUrl: handoff.pageUrl,
      createdAt: new Date(handoff.createdAt).toISOString(),
      parentId: handoff.parentId,
      dependsOn: handoff.dependsOn,
      dependencyWarnings: dependencyWarnings.length > 0 ? dependencyWarnings : undefined,
      totalActiveHandoffs: this.handoffs.size,
    };
  }

  // ── complete_task_handoff ──

  async handleCompleteTaskHandoffTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCompleteTaskHandoff(args));
  }

  async handleCompleteTaskHandoff(args: Record<string, unknown>): Promise<unknown> {
    const taskId = args.taskId as string;
    const summary = args.summary as string;
    const keyFindings = args.keyFindings as string[] | undefined;
    const artifacts = args.artifacts as string[] | undefined;

    const handoff = this.handoffs.get(taskId);
    if (!handoff) {
      throw new Error(
        `Task handoff "${taskId}" not found. Active IDs: ${[...this.handoffs.keys()].join(', ') || '(none)'}`,
      );
    }

    if (handoff.status === 'completed') {
      throw new Error(`Task handoff "${taskId}" is already completed`);
    }

    handoff.status = 'completed';
    handoff.completedAt = Date.now();
    handoff.summary = summary;
    handoff.keyFindings = keyFindings;
    handoff.artifacts = artifacts;
    this.trimTerminalHandoffs();
    this.markDirty();

    return {
      taskId: handoff.id,
      status: 'completed',
      summary: handoff.summary,
      keyFindings: handoff.keyFindings,
      artifacts: handoff.artifacts,
      durationMs: handoff.completedAt - handoff.createdAt,
    };
  }

  // ── update_task_handoff ──

  async handleUpdateTaskHandoffTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleUpdateTaskHandoff(args));
  }

  async handleUpdateTaskHandoff(args: Record<string, unknown>): Promise<unknown> {
    const taskId = args.taskId as string;
    if (!taskId) throw new Error('taskId is required');

    const handoff = this.handoffs.get(taskId);
    if (!handoff) {
      throw new Error(
        `Task handoff "${taskId}" not found. Active IDs: ${[...this.handoffs.keys()].join(', ') || '(none)'}`,
      );
    }

    const previousStatus = handoff.status;
    if (hasArg(args, 'status')) {
      const status = readHandoffUpdateStatus(args.status);
      if (!status) {
        throw new Error('Invalid handoff status. Expected one of: pending, in_progress, failed');
      }
      if (handoff.status === 'completed') {
        throw new Error(`Task handoff "${taskId}" is already completed and cannot be reopened`);
      }
      handoff.status = status;
      if (status === 'failed') {
        handoff.completedAt = Date.now();
        this.trimTerminalHandoffs();
      } else {
        handoff.completedAt = undefined;
      }
    }

    if (typeof args.description === 'string') handoff.description = args.description;
    if (hasArg(args, 'constraints')) handoff.constraints = readStringArray(args.constraints);
    if (typeof args.targetDomain === 'string') handoff.targetDomain = args.targetDomain;
    if (typeof args.decision === 'string') handoff.decision = args.decision;
    if (hasArg(args, 'risks')) handoff.risks = readStringArray(args.risks);
    if (hasArg(args, 'nextSteps')) handoff.nextSteps = readStringArray(args.nextSteps);
    if (typeof args.summary === 'string') handoff.summary = args.summary;
    if (hasArg(args, 'keyFindings')) handoff.keyFindings = readStringArray(args.keyFindings);
    if (hasArg(args, 'artifacts')) handoff.artifacts = readStringArray(args.artifacts);

    this.markDirty();

    return {
      ...this.serializeHandoff(handoff),
      previousStatus,
    };
  }

  // ── get_task_context ──

  async handleGetTaskContextTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleGetTaskContext(args));
  }

  async handleGetTaskContext(args: Record<string, unknown>): Promise<unknown> {
    const taskId = args.taskId as string | undefined;

    if (taskId) {
      const handoff = this.handoffs.get(taskId);
      if (!handoff) {
        throw new Error(`Task handoff "${taskId}" not found`);
      }
      return { handoff: this.serializeHandoff(handoff) };
    }

    // Return all handoffs + session insights
    const handoffs = [...this.handoffs.values()].map((h) => this.serializeHandoff(h));
    const active = handoffs.filter((h) => h.status === 'pending' || h.status === 'in_progress');
    const completed = handoffs.filter((h) => h.status === 'completed');
    const failed = handoffs.filter((h) => h.status === 'failed');
    const sessionInsights = this.filterInsights(args).map((i) => this.serializeInsight(i));

    return {
      active,
      completed,
      failed,
      sessionInsights,
      dependencyGraph: this.buildDependencyGraph(),
      summary: {
        totalActive: active.length,
        totalCompleted: completed.length,
        totalFailed: failed.length,
        totalInsights: this.insights.length,
        returnedInsights: sessionInsights.length,
      },
    };
  }

  // ── append_session_insight ──

  /**
   * Build a parent/depends-on graph over all handoffs so a Planner fan-out
   * (A → B, C where B/C depend on A) can be reconstructed without re-deriving
   * ordering from prose nextSteps arrays.
   */
  private buildDependencyGraph(): {
    nodes: Array<{ taskId: string; status: string; description: string }>;
    edges: Array<{ from: string; to: string; type: 'parent' | 'depends-on' }>;
  } {
    const nodes = [...this.handoffs.values()].map((h) => ({
      taskId: h.id,
      status: h.status,
      description: h.description,
    }));
    const edges: Array<{ from: string; to: string; type: 'parent' | 'depends-on' }> = [];
    for (const h of this.handoffs.values()) {
      if (h.parentId) {
        edges.push({ from: h.parentId, to: h.id, type: 'parent' });
      }
      if (h.dependsOn) {
        for (const dep of h.dependsOn) {
          edges.push({ from: dep, to: h.id, type: 'depends-on' });
        }
      }
    }
    return { nodes, edges };
  }

  async handleAppendSessionInsightTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleAppendSessionInsight(args));
  }

  async handleAppendSessionInsight(args: Record<string, unknown>): Promise<unknown> {
    const category = args.category as string;
    const content = args.content as string;
    const confidence = clampConfidence(args.confidence);
    const tags = readStringArray(args.tags);
    const severity = hasArg(args, 'severity') ? readSeverityArg(args.severity) : undefined;
    const toolSource = typeof args.toolSource === 'string' ? args.toolSource : undefined;

    // Find the most recent in-progress handoff as source context
    const activeHandoff = [...this.handoffs.values()].find(
      (h) => h.status === 'in_progress' || h.status === 'pending',
    );

    const insight: SessionInsight = {
      id: randomUUID().slice(0, 8),
      category,
      content,
      confidence,
      tags,
      severity,
      toolSource,
      timestamp: Date.now(),
      sourceTaskId: activeHandoff?.id,
    };

    this.insights.push(insight);
    this.trimInsights();
    this.markDirty();

    return {
      insightId: insight.id,
      category: insight.category,
      confidence: insight.confidence,
      tags: insight.tags,
      severity: insight.severity,
      toolSource: insight.toolSource,
      totalInsights: this.insights.length,
      totalByCategory: this.getInsightCountByCategory(),
    };
  }

  // ── Helpers ──

  private serializeHandoff(h: TaskHandoff): Record<string, unknown> {
    return {
      taskId: h.id,
      status: h.status,
      description: h.description,
      constraints: h.constraints,
      targetDomain: h.targetDomain,
      decision: h.decision,
      risks: h.risks,
      nextSteps: h.nextSteps,
      pageUrl: h.pageUrl,
      createdAt: new Date(h.createdAt).toISOString(),
      completedAt: h.completedAt ? new Date(h.completedAt).toISOString() : undefined,
      summary: h.summary,
      keyFindings: h.keyFindings,
      artifacts: h.artifacts,
      parentId: h.parentId,
      dependsOn: h.dependsOn,
    };
  }

  private serializeInsight(i: SessionInsight): Record<string, unknown> {
    return {
      id: i.id,
      category: i.category,
      content: i.content,
      confidence: i.confidence,
      tags: i.tags,
      severity: i.severity,
      toolSource: i.toolSource,
      timestamp: new Date(i.timestamp).toISOString(),
      sourceTaskId: i.sourceTaskId,
    };
  }

  private filterInsights(args: Record<string, unknown>): SessionInsight[] {
    const category = typeof args.category === 'string' ? args.category : undefined;
    const tag = typeof args.tag === 'string' ? args.tag : undefined;
    const severity = hasArg(args, 'severity') ? readSeverityArg(args.severity) : undefined;
    const sourceTaskId = typeof args.sourceTaskId === 'string' ? args.sourceTaskId : undefined;
    const minConfidence =
      typeof args.minConfidence === 'number' && Number.isFinite(args.minConfidence)
        ? clampConfidence(args.minConfidence)
        : undefined;

    return this.insights.filter((insight) => {
      if (category && insight.category !== category) return false;
      if (tag && !insight.tags?.includes(tag)) return false;
      if (severity && insight.severity !== severity) return false;
      if (sourceTaskId && insight.sourceTaskId !== sourceTaskId) return false;
      if (minConfidence !== undefined && insight.confidence < minConfidence) return false;
      return true;
    });
  }

  private getInsightCountByCategory(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const insight of this.insights) {
      counts[insight.category] = (counts[insight.category] ?? 0) + 1;
    }
    return counts;
  }

  // ── Page Snapshots ──

  private readonly snapshots = new Map<string, PageSnapshot>();

  async handleSavePageSnapshotTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSavePageSnapshot(args));
  }

  async handleSavePageSnapshot(args: Record<string, unknown>): Promise<unknown> {
    const label = args.label as string | undefined;

    const pc = this.ctx.pageController;
    if (!pc) throw new Error('No page controller available');

    const page = await pc.getPage();
    if (!page) throw new Error('No active page to snapshot');

    const url = page.url();

    // Capture cookies via CDP
    let cookies: PageSnapshot['cookies'] = [];
    try {
      const cdp = await page.createCDPSession();
      const result = (await cdp.send('Network.getAllCookies')) as {
        cookies: Array<{ name: string; value: string; domain: string; path: string }>;
      };
      cookies = result.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
      }));
      await cdp.detach();
    } catch {
      // Cookie capture may fail without browser — proceed without
    }

    // Capture storage
    let localStorage: Record<string, string> = {};
    let sessionStorage: Record<string, string> = {};
    try {
      localStorage = await page.evaluate(() => {
        const ls: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) ls[key] = window.localStorage.getItem(key) ?? '';
        }
        return ls;
      });
      sessionStorage = await page.evaluate(() => {
        const ss: Record<string, string> = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key) ss[key] = window.sessionStorage.getItem(key) ?? '';
        }
        return ss;
      });
    } catch {
      // Storage capture may fail on some pages — proceed without
    }

    // Capture IndexedDB metadata (database / store / keyPath / count) for
    // forensic diagnosis. Modern web apps keep auth tokens / draft state in
    // IndexedDB (not localStorage); without this the snapshot misses the
    // dominant "restore logged-in session" surface.
    let indexedDB: IndexedDBDatabaseSummary[] | undefined;
    let indexedDBData: IndexedDBRecordData[] | undefined;
    try {
      const captured = (await page.evaluate(INDEXEDDB_CAPTURE_SCRIPT)) as
        | IndexedDBDatabaseSummary[]
        | null;
      if (Array.isArray(captured) && captured.length > 0) {
        indexedDB = captured;
      }
      // Also capture record data for restore support (limited to 100 records per store)
      const recordData = (await page.evaluate(INDEXEDDB_DATA_CAPTURE_SCRIPT)) as
        | IndexedDBRecordData[]
        | null;
      if (Array.isArray(recordData) && recordData.length > 0) {
        indexedDBData = recordData;
      }
    } catch {
      // IndexedDB capture may fail (no browser / cross-origin) — proceed without
    }

    const snapshot: PageSnapshot = {
      id: randomUUID().slice(0, 8),
      url,
      cookies,
      localStorage,
      sessionStorage,
      ...(indexedDB ? { indexedDB } : {}),
      ...(indexedDBData ? { indexedDBData } : {}),
      timestamp: Date.now(),
      label,
    };

    this.snapshots.set(snapshot.id, snapshot);
    this.trimSnapshots();

    return {
      snapshotId: snapshot.id,
      url: snapshot.url,
      cookieCount: snapshot.cookies.length,
      localStorageKeys: Object.keys(snapshot.localStorage).length,
      sessionStorageKeys: Object.keys(snapshot.sessionStorage).length,
      indexedDBDatabaseCount: snapshot.indexedDB?.length ?? 0,
      indexedDBRecordCount:
        snapshot.indexedDBData?.reduce(
          (sum, r) => sum + (Array.isArray(r.records) ? r.records.length : 0),
          0,
        ) ?? 0,
      label: snapshot.label,
    };
  }

  async handleRestorePageSnapshotTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRestorePageSnapshot(args));
  }

  async handleRestorePageSnapshot(args: Record<string, unknown>): Promise<unknown> {
    const snapshotId = args.snapshotId as string;
    if (!snapshotId) throw new Error('snapshotId is required');

    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`Snapshot "${snapshotId}" not found`);

    const pc = this.ctx.pageController;
    if (!pc) throw new Error('No page controller available');

    const page = await pc.getPage();
    if (!page) throw new Error('No active page for restoration');

    // Navigate to saved URL
    await page.goto(snapshot.url, {
      waitUntil: 'domcontentloaded',
      timeout: COORDINATION_GOTO_TIMEOUT_MS,
    });

    // Restore cookies via CDP
    if (snapshot.cookies.length > 0) {
      try {
        const cdp = await page.createCDPSession();
        await cdp.send('Network.setCookies', {
          cookies: snapshot.cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
          })),
        });
        await cdp.detach();
      } catch {
        // Cookie restore may fail — proceed
      }
    }

    // Restore localStorage and sessionStorage
    try {
      await page.evaluate(
        (ls: Record<string, string>, ss: Record<string, string>) => {
          window.localStorage.clear();
          for (const [k, v] of Object.entries(ls)) {
            window.localStorage.setItem(k, v);
          }
          window.sessionStorage.clear();
          for (const [k, v] of Object.entries(ss)) {
            window.sessionStorage.setItem(k, v);
          }
        },
        snapshot.localStorage,
        snapshot.sessionStorage,
      );
    } catch {
      // Storage restore may fail on some pages
    }

    return {
      restored: true,
      snapshotId: snapshot.id,
      url: snapshot.url,
      cookiesRestored: snapshot.cookies.length,
      localStorageKeysRestored: Object.keys(snapshot.localStorage).length,
      sessionStorageKeysRestored: Object.keys(snapshot.sessionStorage).length,
    };
  }

  async handleListPageSnapshotsTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleListPageSnapshots());
  }

  async handleListPageSnapshots(): Promise<unknown> {
    const list = [...this.snapshots.values()].map((s) => ({
      id: s.id,
      url: s.url,
      label: s.label,
      cookieCount: s.cookies.length,
      localStorageKeys: Object.keys(s.localStorage).length,
      sessionStorageKeys: Object.keys(s.sessionStorage).length,
      indexedDBDatabaseCount: s.indexedDB?.length ?? 0,
      indexedDBRecordCount:
        s.indexedDBData?.reduce(
          (sum, r) => sum + (Array.isArray(r.records) ? r.records.length : 0),
          0,
        ) ?? 0,
      createdAt: new Date(s.timestamp).toISOString(),
    }));

    return { snapshots: list, total: list.length };
  }

  // ── coordination_restore_snapshot ──

  async handleCoordinationRestoreSnapshotTool(
    args: Record<string, unknown>,
  ): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCoordinationRestoreSnapshot(args));
  }

  async handleCoordinationRestoreSnapshot(args: Record<string, unknown>): Promise<unknown> {
    const snapshotId = args.snapshotId as string;
    if (!snapshotId) throw new Error('snapshotId is required');

    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) throw new Error(`Snapshot "${snapshotId}" not found`);

    const pc = this.ctx.pageController;
    if (!pc) throw new Error('No page controller available');

    const page = await pc.getPage();
    if (!page) throw new Error('No active page for restoration');

    // Navigate to saved URL
    await page.goto(snapshot.url, {
      waitUntil: 'domcontentloaded',
      timeout: COORDINATION_GOTO_TIMEOUT_MS,
    });

    // Restore cookies via CDP
    let cookiesRestored = 0;
    if (snapshot.cookies.length > 0) {
      try {
        const cdp = await page.createCDPSession();
        await cdp.send('Network.setCookies', {
          cookies: snapshot.cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
          })),
        });
        await cdp.detach();
        cookiesRestored = snapshot.cookies.length;
      } catch {
        // Cookie restore may fail — proceed
      }
    }

    // Restore localStorage and sessionStorage
    let storageRestored = false;
    try {
      await page.evaluate(
        (ls: Record<string, string>, ss: Record<string, string>) => {
          window.localStorage.clear();
          for (const [k, v] of Object.entries(ls)) {
            window.localStorage.setItem(k, v);
          }
          window.sessionStorage.clear();
          for (const [k, v] of Object.entries(ss)) {
            window.sessionStorage.setItem(k, v);
          }
        },
        snapshot.localStorage,
        snapshot.sessionStorage,
      );
      storageRestored = true;
    } catch {
      // Storage restore may fail on some pages
    }

    // Restore IndexedDB data
    let indexedDBRestored = false;
    let indexedDBRecordsRestored = 0;
    if (snapshot.indexedDBData && snapshot.indexedDBData.length > 0) {
      try {
        const dataJson = JSON.stringify({
          records: snapshot.indexedDBData,
          schemas: snapshot.indexedDB ?? [],
        });
        const restored = (await page.evaluate(async (json: string) => {
          const idb = (globalThis as Record<string, unknown>).indexedDB as IDBFactory | undefined;
          if (!idb) return { restored: false, recordCount: 0 };
          const captured = JSON.parse(json) as {
            records: Array<{
              database?: string;
              store?: string;
              records?: Array<{ key: unknown; value: unknown }>;
            }>;
            schemas: Array<{
              name: string;
              version?: number;
              stores?: Array<{
                name: string;
                keyPath?: string | string[];
                autoIncrement?: boolean;
              }>;
            }>;
          };
          const data = captured.records;
          if (!Array.isArray(data) || data.length === 0) return { restored: false, recordCount: 0 };

          // Group by database
          const dbMap = new Map<
            string,
            Array<{ store: string; records: Array<{ key: unknown; value: unknown }> }>
          >();
          for (const entry of data) {
            if (!entry.database || !entry.store || !Array.isArray(entry.records)) continue;
            if (!dbMap.has(entry.database)) dbMap.set(entry.database, []);
            dbMap.get(entry.database)!.push({ store: entry.store, records: entry.records });
          }

          let totalRecords = 0;
          for (const [dbName, entries] of dbMap) {
            try {
              // Delete existing
              await new Promise<void>((resolve, reject) => {
                const delReq = idb.deleteDatabase(dbName);
                // eslint-disable-next-line unicorn/prefer-add-event-listener
                delReq.onsuccess = () => resolve();
                // eslint-disable-next-line unicorn/prefer-add-event-listener
                delReq.onerror = () => reject(delReq.error);
                // eslint-disable-next-line unicorn/prefer-add-event-listener
                delReq.onblocked = () => reject(new Error(`Deletion blocked for ${dbName}`));
              });

              // Create and populate
              await new Promise<void>((resolve, reject) => {
                const schema = captured.schemas.find((item) => item.name === dbName);
                const openReq = idb.open(dbName, schema?.version ?? 1);
                openReq.onupgradeneeded = () => {
                  const db = openReq.result;
                  for (const entry of entries) {
                    if (!db.objectStoreNames.contains(entry.store)) {
                      const storeSchema = schema?.stores?.find((item) => item.name === entry.store);
                      db.createObjectStore(entry.store, {
                        ...(storeSchema?.keyPath !== undefined
                          ? { keyPath: storeSchema.keyPath }
                          : {}),
                        autoIncrement: storeSchema?.autoIncrement ?? false,
                      });
                    }
                  }
                };
                openReq.onsuccess = async () => {
                  const db = openReq.result;
                  for (const entry of entries) {
                    try {
                      await new Promise<void>((resolveStore) => {
                        const tx = db.transaction(entry.store, 'readwrite');
                        // eslint-disable-next-line unicorn/prefer-add-event-listener
                        tx.oncomplete = () => resolveStore();
                        // eslint-disable-next-line unicorn/prefer-add-event-listener
                        tx.onerror = () => resolveStore();
                        // eslint-disable-next-line unicorn/prefer-add-event-listener
                        tx.onabort = () => resolveStore();
                        const store = tx.objectStore(entry.store);
                        for (const rec of entry.records) {
                          try {
                            if (store.keyPath === null)
                              store.add(rec.value, rec.key as IDBValidKey);
                            else store.add(rec.value);
                            totalRecords++;
                          } catch {
                            /* skip */
                          }
                        }
                      });
                    } catch {
                      /* skip store */
                    }
                  }
                  db.close();
                  resolve();
                };
                // eslint-disable-next-line unicorn/prefer-add-event-listener
                openReq.onerror = () => reject(openReq.error);
              });
            } catch {
              /* skip db */
            }
          }
          return { restored: totalRecords > 0, recordCount: totalRecords };
        }, dataJson)) as { restored: boolean; recordCount: number };
        indexedDBRestored = restored.restored;
        indexedDBRecordsRestored = restored.recordCount;
      } catch {
        // IndexedDB restore may fail — proceed
      }
    }

    return {
      restored: true,
      snapshotId: snapshot.id,
      url: snapshot.url,
      cookiesRestored,
      storageRestored,
      indexedDBRestored,
      indexedDBRecordsRestored,
    };
  }
}

// ── Snapshot type ──

/**
 * In-page IndexedDB metadata capture, run via `page.evaluate(string)`. Returns
 * database → store summaries (name / count / keyPath). Serialized as a string
 * so it carries no Node-side type/lint surface and runs self-contained in the
 * page. Uses `indexedDB.databases()` (Chromium 71+); older browsers return [].
 * Fail-soft: an unopenable DB (cross-origin / blocked) is surfaced with
 * `{ name, error }` rather than aborting the whole capture.
 */
const INDEXEDDB_CAPTURE_SCRIPT = `(async () => {
  const idb = globalThis.indexedDB;
  if (!idb) return [];
  let dbs = [];
  try { if (typeof idb.databases === 'function') dbs = await idb.databases(); } catch (e) {}
  const out = [];
  for (const info of dbs) {
    const name = info && info.name;
    if (typeof name !== 'string') continue;
    try {
      const db = await new Promise((resolve, reject) => {
        const r = idb.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const storeNames = Array.from(db.objectStoreNames);
      const stores = [];
      if (storeNames.length) {
        await new Promise((resolve) => {
          const tx = db.transaction(storeNames, 'readonly');
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
          for (const sn of storeNames) {
            const s = tx.objectStore(sn);
            const c = s.count();
            c.onsuccess = () => {
              const kp = s.keyPath;
              const base = { name: sn, count: c.result, autoIncrement: s.autoIncrement };
              stores.push(kp === null || kp === undefined ? base : { ...base, keyPath: kp });
            };
            c.onerror = () => stores.push({ name: sn, count: 0 });
          }
        });
      }
      const version = typeof db.version === 'number' ? db.version : undefined;
      db.close();
      out.push(version === undefined ? { name, stores } : { name, version, stores });
    } catch (e) {
      out.push({ name, error: (e && e.message) ? String(e.message) : 'open-failed' });
    }
  }
  return out;
})()`;

interface IndexedDBStoreSummary {
  name: string;
  count: number;
  keyPath?: string | string[];
  autoIncrement?: boolean;
}

interface IndexedDBDatabaseSummary {
  name: string;
  version?: number;
  stores?: IndexedDBStoreSummary[];
  /** Present when a database is listed but cannot be opened (cross-origin / blocked). */
  error?: string;
}

interface IndexedDBRecordData {
  database: string;
  store: string;
  key: unknown;
  value: unknown;
  records: Array<{ key: unknown; value: unknown }>;
}

interface PageSnapshot {
  id: string;
  url: string;
  cookies: Array<{ name: string; value: string; domain: string; path: string }>;
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  /**
   * IndexedDB metadata (database / store / keyPath / count) captured for
   * forensic diagnosis.
   */
  indexedDB?: IndexedDBDatabaseSummary[];
  /**
   * Captured IndexedDB record data for snapshot restore. Limited to 100 records
   * per store to bound memory usage. Stored as serializable JSON-safe values.
   */
  indexedDBData?: IndexedDBRecordData[];
  timestamp: number;
  label?: string;
}

/**
 * In-page IndexedDB record data capture. Opens each database and reads up to
 * MAX_RECORDS_PER_STORE records from each object store. Returns an array of
 * { database, store, key, value, records } objects suitable for serialization.
 * Records must be JSON-serializable; non-serializable values (Buffer, Blob,
 * etc.) are replaced with a type marker string.
 */
const INDEXEDDB_DATA_CAPTURE_SCRIPT = `(async () => {
  const MAX_RECORDS_PER_STORE = 100;
  const idb = globalThis.indexedDB;
  if (!idb) return [];
  let dbs = [];
  try { if (typeof idb.databases === 'function') dbs = await idb.databases(); } catch (e) {}
  const out = [];
  for (const info of dbs) {
    const name = info && info.name;
    if (typeof name !== 'string') continue;
    try {
      const db = await new Promise((resolve, reject) => {
        const r = idb.open(name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const storeNames = Array.from(db.objectStoreNames);
      for (const sn of storeNames) {
        try {
          const records = [];
          let count = 0;
          await new Promise((resolve) => {
            const tx = db.transaction(sn, 'readonly');
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
            const store = tx.objectStore(sn);
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = (event) => {
              const cursor = event.target.result;
              if (cursor && count < MAX_RECORDS_PER_STORE) {
                try {
                  records.push({ key: JSON.parse(JSON.stringify(cursor.key)), value: JSON.parse(JSON.stringify(cursor.value)) });
                } catch (e) {
                  records.push({ key: String(cursor.key), value: '<non-serializable>' });
                }
                count++;
                cursor.continue();
              }
            };
          });
          if (records.length > 0) {
            out.push({ database: name, store: sn, records });
          }
        } catch (e) {
          // skip unreadable stores
        }
      }
      db.close();
    } catch (e) {
      // skip unopenable databases
    }
  }
  return out;
})()`;

function cloneHandoff(handoff: TaskHandoff): TaskHandoff {
  return {
    ...handoff,
    constraints: handoff.constraints ? [...handoff.constraints] : undefined,
    risks: handoff.risks ? [...handoff.risks] : undefined,
    nextSteps: handoff.nextSteps ? [...handoff.nextSteps] : undefined,
    keyFindings: handoff.keyFindings ? [...handoff.keyFindings] : undefined,
    artifacts: handoff.artifacts ? [...handoff.artifacts] : undefined,
  };
}

function cloneInsight(insight: SessionInsight): SessionInsight {
  return {
    ...insight,
    tags: insight.tags ? [...insight.tags] : undefined,
  };
}

function isTaskHandoff(value: unknown): value is TaskHandoff {
  if (!value || typeof value !== 'object') return false;
  const handoff = value as Partial<TaskHandoff>;
  return (
    typeof handoff.id === 'string' &&
    isHandoffStatus(handoff.status) &&
    typeof handoff.description === 'string' &&
    typeof handoff.createdAt === 'number' &&
    isOptionalStringArray(handoff.constraints) &&
    isOptionalStringArray(handoff.risks) &&
    isOptionalStringArray(handoff.nextSteps) &&
    isOptionalStringArray(handoff.keyFindings) &&
    isOptionalStringArray(handoff.artifacts)
  );
}

function isSessionInsight(value: unknown): value is SessionInsight {
  if (!value || typeof value !== 'object') return false;
  const insight = value as Partial<SessionInsight>;
  return (
    typeof insight.id === 'string' &&
    typeof insight.category === 'string' &&
    typeof insight.content === 'string' &&
    typeof insight.confidence === 'number' &&
    typeof insight.timestamp === 'number' &&
    isOptionalStringArray(insight.tags) &&
    (insight.severity === undefined || isInsightSeverity(insight.severity)) &&
    (insight.toolSource === undefined || typeof insight.toolSource === 'string') &&
    (insight.sourceTaskId === undefined || typeof insight.sourceTaskId === 'string')
  );
}

function isHandoffStatus(value: unknown): value is TaskHandoff['status'] {
  return (
    value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'failed'
  );
}

function hasArg(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key);
}

function readHandoffUpdateStatus(value: unknown): HandoffUpdateStatus | undefined {
  if (value === 'pending' || value === 'in_progress' || value === 'failed') {
    return value;
  }
  return undefined;
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return items.length > 0 ? [...new Set(items)] : undefined;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1.0;
  return Math.min(1, Math.max(0, value));
}

function readSeverityArg(value: unknown): NonNullable<SessionInsight['severity']> {
  if (isInsightSeverity(value)) return value;
  throw new Error('Invalid severity. Expected one of: info, low, medium, high, critical');
}

function isInsightSeverity(value: unknown): value is NonNullable<SessionInsight['severity']> {
  return (
    value === 'info' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'critical'
  );
}
