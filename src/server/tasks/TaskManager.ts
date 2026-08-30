/**
 * MCP 2.0 Tasks Protocol — Unified Task Manager
 *
 * Implements the official Model Context Protocol Tasks Specification (2025-11-25+):
 * - Long-running background operations without tool-call timeouts (Frida trace, PCAP capture, AST taint scans)
 * - State machine: 'working' | 'completed' | 'failed' | 'cancelled'
 * - Progress tracking & payload caching with configurable TTL
 *
 * Caller binding: records created inside a tool-call request context carry the
 * owning sessionId; read/cancel/list calls from a *different* session do not
 * see them (mirrors ToolCircuitBreaker / SessionScopedResourcePool scoping).
 *
 * @module TaskManager
 */

import { randomUUID } from 'node:crypto';
import type { TaskStatus } from '@modelcontextprotocol/server';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';
import { logger } from '@utils/logger';

export type { TaskStatus };

export interface TaskRecord<TResult = unknown> {
  taskId: string;
  name: string;
  status: TaskStatus;
  createdAt: string;
  lastUpdatedAt: string;
  ttl: number;
  pollInterval?: number;
  progress?: number;
  total?: number;
  message?: string;
  result?: TResult;
  error?: string;
  cancelHandler?: () => Promise<void> | void;
  /** Owning session (from the request context at createTask time); null = process-level. */
  sessionId?: string | null;
}

export interface CreateTaskOptions<TResult = unknown> {
  name: string;
  ttlMs?: number;
  pollIntervalMs?: number;
  /**
   * Drives the task to completion. When omitted, the task is created in the
   * 'working' state and stays there until an external driver settles it via
   * setTaskResult() / cancelTask() — used by the TaskStoreAdapter for
   * SDK-driven task-augmented requests.
   */
  executor?: (context: TaskExecutionContext) => Promise<TResult>;
  cancelHandler?: () => Promise<void> | void;
}

export interface TaskExecutionContext {
  taskId: string;
  isCancelled: () => boolean;
  /**
   * Aborted by cancelTask()/shutdown(). Long-running executors should pass
   * this into cancellable child operations (e.g. frida CLI processes) and/or
   * poll it between stages instead of only relying on isCancelled().
   */
  signal: AbortSignal;
  updateProgress: (progress: number, total?: number, message?: string) => void;
}

export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly defaultTtlMs: number;
  private readonly maxTasks: number;
  /**
   * Wall-clock ceiling for 'working' tasks. TTL applies post-terminal only, so
   * a hung or never-settled store-driven task would otherwise hold its record
   * (and result payload) forever — working tasks older than this are failed.
   */
  private readonly maxWorkingAgeMs: number;

  constructor(
    options: { defaultTtlMs?: number; maxTasks?: number; maxWorkingAgeMs?: number } = {},
  ) {
    this.defaultTtlMs = options.defaultTtlMs ?? 10 * 60 * 1000; // 10 minutes default
    this.maxTasks = options.maxTasks ?? 500;
    this.maxWorkingAgeMs = options.maxWorkingAgeMs ?? 30 * 60 * 1000; // 30 minutes default
  }

  /**
   * Create and launch a background task executing the provided executor function.
   *
   * Note on TTL semantics: the task spec's `ttl: null` ("unlimited lifetime")
   * is intentionally mapped to the default TTL here — records are in-memory
   * and unbounded retention is never desired for them.
   */
  async createTask<TResult = unknown>(
    options: CreateTaskOptions<TResult>,
  ): Promise<TaskRecord<TResult>> {
    this.pruneExpiredTasks();

    const taskId = randomUUID();
    const now = new Date().toISOString();
    const ttl = options.ttlMs ?? this.defaultTtlMs;

    const task: TaskRecord<TResult> = {
      taskId,
      name: options.name,
      status: 'working',
      createdAt: now,
      lastUpdatedAt: now,
      ttl,
      pollInterval: options.pollIntervalMs ?? 2000,
      progress: 0,
      total: 100,
      cancelHandler: options.cancelHandler,
      sessionId: getToolRequestContext()?.sessionId ?? null,
    };

    this.tasks.set(taskId, task as TaskRecord);

    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    const executionContext: TaskExecutionContext = {
      taskId,
      isCancelled: () => task.status === 'cancelled',
      signal: abortController.signal,
      updateProgress: (progress: number, total = 100, message?: string) => {
        if (task.status === 'working') {
          task.progress = progress;
          task.total = total;
          task.message = message;
          task.lastUpdatedAt = new Date().toISOString();
        }
      },
    };

    // Execute in background only when an executor is supplied. Store-driven
    // tasks (no executor) stay 'working' until setTaskResult()/cancelTask().
    // The status guards make the completion/cancel race safe in both orders:
    // whichever transition lands first wins, the loser is a no-op.
    if (options.executor) {
      void (async () => {
        try {
          const result = await options.executor!(executionContext);
          if (task.status === 'working') {
            task.status = 'completed';
            task.result = result;
            task.progress = task.total ?? 100;
            task.lastUpdatedAt = new Date().toISOString();
          }
        } catch (err: unknown) {
          if (task.status === 'working') {
            task.status = 'failed';
            task.error = err instanceof Error ? err.message : String(err);
            task.lastUpdatedAt = new Date().toISOString();
            logger.error(`Task ${taskId} (${options.name}) failed:`, err);
          } else if (task.status === 'cancelled') {
            logger.warn(`Task ${taskId} (${options.name}) rejected after cancellation:`, err);
          }
        }
      })();
    }

    return task;
  }

  /**
   * Cancel every working task and drop all records. Called by closeServer()
   * so process exit does not abandon in-flight operations (and their OS
   * children) silently.
   */
  async shutdown(): Promise<void> {
    const working = Array.from(this.tasks.values()).filter((t) => t.status === 'working');
    await Promise.allSettled(working.map((t) => this.cancelTask(t.taskId)));
    this.abortControllers.clear();
    this.tasks.clear();
  }

  /**
   * Externally settle a task (TaskStoreAdapter / SDK-driven lifecycle).
   * Returns false when the task is unknown or already in a terminal state.
   */
  setTaskResult<TResult = unknown>(
    taskId: string,
    status: 'completed' | 'failed',
    result?: TResult,
    error?: string,
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'working') {
      return false;
    }
    task.status = status;
    if (result !== undefined) task.result = result;
    if (error !== undefined) task.error = error;
    task.lastUpdatedAt = new Date().toISOString();
    return true;
  }

  /** Get task state; hidden from callers of a different owning session. */
  getTask(taskId: string, callerSession?: string | null): TaskRecord | undefined {
    const task = this.tasks.get(taskId);
    if (!task || this.isForeign(task, callerSession)) return undefined;
    return task;
  }

  /** Get task payload / final result; session-scoped like {@link getTask}. */
  getTaskPayload<TResult = unknown>(
    taskId: string,
    callerSession?: string | null,
  ): { status: TaskStatus; result?: TResult; error?: string } | null {
    const task = this.getTask(taskId, callerSession);
    if (!task) return null;
    return {
      status: task.status,
      result: task.result as TResult,
      error: task.error,
    };
  }

  /** List all active/recent tasks visible to the given caller session. */
  listTasks(callerSession?: string | null): TaskRecord[] {
    this.pruneExpiredTasks();
    return Array.from(this.tasks.values()).filter((t) => !this.isForeign(t, callerSession));
  }

  /** Cancel an ongoing task; a foreign caller cannot cancel what it cannot see. */
  async cancelTask(taskId: string, callerSession?: string | null): Promise<boolean> {
    const task = this.getTask(taskId, callerSession);
    if (!task || task.status !== 'working') {
      return false;
    }

    task.status = 'cancelled';
    task.lastUpdatedAt = new Date().toISOString();
    this.abortControllers.get(taskId)?.abort();

    if (task.cancelHandler) {
      try {
        await task.cancelHandler();
      } catch (e) {
        logger.warn(`Error in cancelHandler for task ${taskId}:`, e);
      }
    }
    return true;
  }

  /**
   * Session binding: a record with an owning session is invisible to callers
   * from a different session. Records without an owner (process-level) and
   * callers without a session (internal/test paths) are unrestricted.
   */
  private isForeign(task: TaskRecord, callerSession?: string | null): boolean {
    return (
      task.sessionId !== null &&
      task.sessionId !== undefined &&
      callerSession !== null &&
      callerSession !== undefined &&
      task.sessionId !== callerSession
    );
  }

  /** Clean up expired completed/failed/cancelled tasks based on TTL */
  private pruneExpiredTasks(): void {
    const now = Date.now();
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'working') {
        // Working-age ceiling: fail hung or never-settled tasks so their
        // records (and result payloads) cannot be retained indefinitely.
        const age = now - new Date(task.createdAt).getTime();
        if (age > this.maxWorkingAgeMs) {
          task.status = 'failed';
          task.error = `task exceeded maxWorkingAgeMs (${this.maxWorkingAgeMs}ms)`;
          task.lastUpdatedAt = new Date().toISOString();
          logger.warn(`Task ${id} (${task.name}) failed: exceeded maxWorkingAgeMs`);
        }
        continue;
      }
      const updatedAt = new Date(task.lastUpdatedAt).getTime();
      if (now - updatedAt > task.ttl) {
        this.tasks.delete(id);
        this.abortControllers.delete(id);
      }
    }

    // Hard ceiling safety
    if (this.tasks.size > this.maxTasks) {
      const sorted = Array.from(this.tasks.entries())
        .filter(([_, t]) => t.status !== 'working')
        .toSorted(
          (a, b) => new Date(a[1].lastUpdatedAt).getTime() - new Date(b[1].lastUpdatedAt).getTime(),
        );

      for (let i = 0; i < sorted.length && this.tasks.size > this.maxTasks; i++) {
        const entry = sorted[i];
        if (entry) {
          this.tasks.delete(entry[0]);
          this.abortControllers.delete(entry[0]);
        }
      }
    }
  }
}
