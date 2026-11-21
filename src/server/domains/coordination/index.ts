/**
 * Coordination domain handler — manages Planner/Specialist Agent handoffs
 * and session-level insight accumulation.
 *
 * Handoffs and insights can be snapshotted by RuntimeSnapshotScheduler so
 * process restarts do not drop active reverse-engineering context.
 */

import { randomUUID } from 'node:crypto';
import { COORDINATION_MAX_HANDOFFS, COORDINATION_MAX_INSIGHTS } from '@src/constants';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { PageSnapshotService } from './page-snapshot/service';
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
  private readonly pageSnapshots: PageSnapshotService;

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
    this.pageSnapshots = new PageSnapshotService(() => this.ctx.pageController);
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

  async handleSavePageSnapshotTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSavePageSnapshot(args));
  }

  async handleSavePageSnapshot(args: Record<string, unknown>): Promise<unknown> {
    return this.pageSnapshots.save(args);
  }

  async handleRestorePageSnapshotTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRestorePageSnapshot(args));
  }

  async handleRestorePageSnapshot(args: Record<string, unknown>): Promise<unknown> {
    const snapshotId = readSnapshotIdArg(args);
    const restored = await this.pageSnapshots.restore(snapshotId, { includeIndexedDB: false });
    // Legacy shape: report the snapshot's cookie count, not the number actually
    // written. The pre-service implementation did the same even when CDP failed.
    return {
      restored: restored.restored,
      snapshotId: restored.snapshotId,
      url: restored.url,
      cookiesRestored: restored.cookieCount,
      localStorageKeysRestored: restored.localStorageKeys,
      sessionStorageKeysRestored: restored.sessionStorageKeys,
    };
  }

  async handleListPageSnapshotsTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleListPageSnapshots());
  }

  async handleListPageSnapshots(): Promise<unknown> {
    return this.pageSnapshots.list();
  }

  // ── coordination_restore_snapshot ──

  async handleCoordinationRestoreSnapshotTool(
    args: Record<string, unknown>,
  ): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCoordinationRestoreSnapshot(args));
  }

  async handleCoordinationRestoreSnapshot(args: Record<string, unknown>): Promise<unknown> {
    const snapshotId = readSnapshotIdArg(args);
    const restored = await this.pageSnapshots.restore(snapshotId, { includeIndexedDB: true });
    return {
      restored: restored.restored,
      snapshotId: restored.snapshotId,
      url: restored.url,
      cookiesRestored: restored.cookiesRestored,
      storageRestored: restored.storageRestored,
      indexedDBRestored: restored.indexedDBRestored,
      indexedDBRecordsRestored: restored.indexedDBRecordsRestored,
    };
  }
}

function readSnapshotIdArg(args: Record<string, unknown>): string {
  const value = args['snapshotId'];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('snapshotId is required');
  }
  return value;
}

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
