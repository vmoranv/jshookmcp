/**
 * MCP 2.0 Tasks Protocol — Unified Task Manager
 *
 * Implements the official Model Context Protocol Tasks Specification (2025-11-25+):
 * - Long-running background operations without tool-call timeouts (Frida trace, PCAP capture, AST taint scans)
 * - State machine: 'working' | 'completed' | 'failed' | 'cancelled'
 * - Progress tracking & payload caching with configurable TTL
 *
 * @module TaskManager
 */

import { randomUUID } from 'node:crypto';
import type { TaskStatus } from '@modelcontextprotocol/sdk/types.js';
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
  updateProgress: (progress: number, total?: number, message?: string) => void;
}

export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly defaultTtlMs: number;
  private readonly maxTasks: number;

  constructor(options: { defaultTtlMs?: number; maxTasks?: number } = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 10 * 60 * 1000; // 10 minutes default
    this.maxTasks = options.maxTasks ?? 500;
  }

  /**
   * Create and launch a background task executing the provided executor function.
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
    };

    this.tasks.set(taskId, task as TaskRecord);

    const executionContext: TaskExecutionContext = {
      taskId,
      isCancelled: () => task.status === 'cancelled',
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
          }
        }
      })();
    }

    return task;
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

  /** Get task state */
  getTask(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  /** Get task payload / final result */
  getTaskPayload<TResult = unknown>(
    taskId: string,
  ): { status: TaskStatus; result?: TResult; error?: string } | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return {
      status: task.status,
      result: task.result as TResult,
      error: task.error,
    };
  }

  /** List all active/recent tasks */
  listTasks(): TaskRecord[] {
    this.pruneExpiredTasks();
    return Array.from(this.tasks.values());
  }

  /** Cancel an ongoing task */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'working') {
      return false;
    }

    task.status = 'cancelled';
    task.lastUpdatedAt = new Date().toISOString();

    if (task.cancelHandler) {
      try {
        await task.cancelHandler();
      } catch (e) {
        logger.warn(`Error in cancelHandler for task ${taskId}:`, e);
      }
    }
    return true;
  }

  /** Clean up expired completed/failed/cancelled tasks based on TTL */
  private pruneExpiredTasks(): void {
    const now = Date.now();
    for (const [id, task] of this.tasks.entries()) {
      if (task.status !== 'working') {
        const updatedAt = new Date(task.lastUpdatedAt).getTime();
        if (now - updatedAt > task.ttl) {
          this.tasks.delete(id);
        }
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
        }
      }
    }
  }
}
