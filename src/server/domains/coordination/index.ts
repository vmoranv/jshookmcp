/**
 * Coordination domain handler — manages Planner/Specialist Agent handoffs
 * and session-level insight accumulation.
 *
 * All state is in-memory for the lifetime of the MCP session.
 * No persistence — handoffs and insights are ephemeral by design
 * (use the knowledge-base workflow plugin for cross-session persistence).
 */

import { randomUUID } from 'node:crypto';
import type { MCPServerContext } from '@server/MCPServer.context';

// ── Types ──

export interface TaskHandoff {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description: string;
  constraints?: string[];
  targetDomain?: string;
  pageUrl?: string;
  createdAt: number;
  completedAt?: number;
  summary?: string;
  keyFindings?: string[];
  artifacts?: string[];
}

export interface SessionInsight {
  id: string;
  category: string;
  content: string;
  confidence: number;
  timestamp: number;
  sourceTaskId?: string;
}

// ── Handler ──

export class CoordinationHandlers {
  private readonly handoffs = new Map<string, TaskHandoff>();
  private readonly insights: SessionInsight[] = [];
  private readonly ctx: MCPServerContext;

  constructor(ctx: MCPServerContext) {
    this.ctx = ctx;
  }

  // ── create_task_handoff ──

  async handleCreateTaskHandoff(args: Record<string, unknown>): Promise<unknown> {
    const description = args.description as string;
    const constraints = args.constraints as string[] | undefined;
    const targetDomain = args.targetDomain as string | undefined;

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

    const handoff: TaskHandoff = {
      id: randomUUID().slice(0, 8),
      status: 'pending',
      description,
      constraints,
      targetDomain,
      pageUrl,
      createdAt: Date.now(),
    };

    this.handoffs.set(handoff.id, handoff);

    return {
      taskId: handoff.id,
      status: handoff.status,
      description: handoff.description,
      constraints: handoff.constraints,
      targetDomain: handoff.targetDomain,
      pageUrl: handoff.pageUrl,
      createdAt: new Date(handoff.createdAt).toISOString(),
      totalActiveHandoffs: this.handoffs.size,
    };
  }

  // ── complete_task_handoff ──

  async handleCompleteTaskHandoff(args: Record<string, unknown>): Promise<unknown> {
    const taskId = args.taskId as string;
    const summary = args.summary as string;
    const keyFindings = args.keyFindings as string[] | undefined;
    const artifacts = args.artifacts as string[] | undefined;

    const handoff = this.handoffs.get(taskId);
    if (!handoff) {
      throw new Error(`Task handoff "${taskId}" not found. Active IDs: ${[...this.handoffs.keys()].join(', ') || '(none)'}`);
    }

    if (handoff.status === 'completed') {
      throw new Error(`Task handoff "${taskId}" is already completed`);
    }

    handoff.status = 'completed';
    handoff.completedAt = Date.now();
    handoff.summary = summary;
    handoff.keyFindings = keyFindings;
    handoff.artifacts = artifacts;

    return {
      taskId: handoff.id,
      status: 'completed',
      summary: handoff.summary,
      keyFindings: handoff.keyFindings,
      artifacts: handoff.artifacts,
      durationMs: handoff.completedAt - handoff.createdAt,
    };
  }

  // ── get_task_context ──

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
    const active = handoffs.filter((h) => h.status !== 'completed');
    const completed = handoffs.filter((h) => h.status === 'completed');

    return {
      active,
      completed,
      sessionInsights: this.insights.map((i) => ({
        id: i.id,
        category: i.category,
        content: i.content,
        confidence: i.confidence,
        timestamp: new Date(i.timestamp).toISOString(),
        sourceTaskId: i.sourceTaskId,
      })),
      summary: {
        totalActive: active.length,
        totalCompleted: completed.length,
        totalInsights: this.insights.length,
      },
    };
  }

  // ── append_session_insight ──

  async handleAppendSessionInsight(args: Record<string, unknown>): Promise<unknown> {
    const category = args.category as string;
    const content = args.content as string;
    const confidence = (args.confidence as number) ?? 1.0;

    // Find the most recent in-progress handoff as source context
    const activeHandoff = [...this.handoffs.values()].find((h) => h.status === 'in_progress' || h.status === 'pending');

    const insight: SessionInsight = {
      id: randomUUID().slice(0, 8),
      category,
      content,
      confidence,
      timestamp: Date.now(),
      sourceTaskId: activeHandoff?.id,
    };

    this.insights.push(insight);

    return {
      insightId: insight.id,
      category: insight.category,
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
      pageUrl: h.pageUrl,
      createdAt: new Date(h.createdAt).toISOString(),
      completedAt: h.completedAt ? new Date(h.completedAt).toISOString() : undefined,
      summary: h.summary,
      keyFindings: h.keyFindings,
      artifacts: h.artifacts,
    };
  }

  private getInsightCountByCategory(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const insight of this.insights) {
      counts[insight.category] = (counts[insight.category] ?? 0) + 1;
    }
    return counts;
  }
}
