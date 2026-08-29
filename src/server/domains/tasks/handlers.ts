/**
 * MCP 2.0 Tasks protocol — client-facing polling handlers.
 *
 * Thin adapters over TaskManager: long-running tools create tasks; clients
 * poll status / results / cancellation through these tools.
 */

import type { TaskManager, TaskRecord, TaskStatus } from '@server/tasks/TaskManager';
import { argNumber, argString } from '@server/domains/shared/parse-args';
import { R, handleSafe } from '@server/domains/shared/ResponseBuilder';
import type { ToolArgs, ToolResponse } from '@server/types';

/** Upper bound for a single tasks_result poll — keeps one tool call under MCP client timeouts. */
const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 100;

const TERMINAL_STATUSES = new Set<TaskStatus>(['completed', 'failed', 'cancelled']);

function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeTask(task: TaskRecord): Record<string, unknown> {
  return {
    taskId: task.taskId,
    name: task.name,
    status: task.status,
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    ttl: task.ttl,
    pollInterval: task.pollInterval,
    progress: task.progress,
    total: task.total,
    message: task.message,
  };
}

export class TaskToolsHandlers {
  private readonly taskManager: TaskManager;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  /** tools/tasks_get — snapshot of a task's lifecycle state. */
  async handleTasksGet(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const taskId = argString(args, 'taskId');
      if (!taskId) return R.fail('taskId is required').json();

      const task = this.taskManager.getTask(taskId);
      if (!task) {
        return R.fail(`Unknown task: ${taskId}`).set('notFound', true).json();
      }
      return R.ok().merge(serializeTask(task)).json();
    });
  }

  /** tools/tasks_result — final payload; optionally polls up to waitMs for a terminal state. */
  async handleTasksResult(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const taskId = argString(args, 'taskId');
      if (!taskId) return R.fail('taskId is required').json();
      const waitMs = Math.min(Math.max(argNumber(args, 'waitMs', 5000), 0), MAX_WAIT_MS);

      const deadline = Date.now() + waitMs;
      let task = this.taskManager.getTask(taskId);
      while (task && !isTerminal(task.status) && Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        task = this.taskManager.getTask(taskId);
      }

      if (!task) {
        // Polling outlived the task TTL — report unknown rather than a stale snapshot.
        return R.fail(`Unknown task: ${taskId}`).set('notFound', true).json();
      }

      const payload = this.taskManager.getTaskPayload(taskId);
      return R.ok()
        .merge(serializeTask(task))
        .merge({
          result: payload?.result,
          error: payload?.error,
          resultAvailable: task.status === 'completed',
        })
        .json();
    });
  }

  /** tools/tasks_cancel — cooperative cancellation of a working task. */
  async handleTasksCancel(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const taskId = argString(args, 'taskId');
      if (!taskId) return R.fail('taskId is required').json();

      const task = this.taskManager.getTask(taskId);
      if (!task) {
        return R.fail(`Unknown task: ${taskId}`).set('notFound', true).json();
      }

      const cancelled = await this.taskManager.cancelTask(taskId);
      if (!cancelled) {
        return R.fail(`Task ${taskId} is not cancellable (status: ${task.status})`).json();
      }
      return R.ok().set('taskId', taskId).set('cancelled', true).json();
    });
  }

  /** tools/tasks_list — recent tasks with optional status/name filters. */
  async handleTasksList(args: ToolArgs): Promise<ToolResponse> {
    return handleSafe(async () => {
      const statusFilter = argString(args, 'status');
      const nameFilter = argString(args, 'name');
      const limit = Math.min(Math.max(argNumber(args, 'limit', 50), 1), 500);

      let tasks = this.taskManager.listTasks();
      if (statusFilter) {
        tasks = tasks.filter((t) => t.status === statusFilter);
      }
      if (nameFilter) {
        tasks = tasks.filter((t) => t.name === nameFilter);
      }

      const ordered = tasks.toSorted(
        (a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime(),
      );
      const trimmed = ordered.slice(0, limit).map(serializeTask);

      return R.ok().set('count', trimmed.length).set('tasks', trimmed).json();
    });
  }
}
