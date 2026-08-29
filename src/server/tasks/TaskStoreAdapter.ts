/**
 * Adapter bridging our internal {@link TaskManager} to the MCP SDK's
 * {@link TaskStore} interface (SDK 1.30+ experimental tasks protocol).
 *
 * Supplying this store via `ServerOptions.taskStore` makes the SDK's Protocol
 * base class auto-install the `tasks/get`, `tasks/result`, `tasks/list` and
 * `tasks/cancel` JSON-RPC handlers — no manual `setRequestHandler` calls needed.
 *
 * @module TaskStoreAdapter
 */

import type { Task, Result } from '@modelcontextprotocol/sdk/types.js';
import type {
  CreateTaskOptions,
  TaskStore,
} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import type { TaskManager, TaskRecord } from './TaskManager';

/**
 * Adapts a {@link TaskManager} to the SDK {@link TaskStore} contract.
 *
 * Tasks created here are store-driven: they stay `working` until the SDK's
 * task flow settles them via `storeTaskResult` / `updateTaskStatus`. Tasks
 * created internally by long-running tools (with an executor) settle
 * themselves and are surfaced through the same read paths.
 */
export class TaskStoreAdapter implements TaskStore {
  private readonly taskManager: TaskManager;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  async createTask(
    taskParams: CreateTaskOptions,
    requestId: RequestIdLike,
    _request: unknown,
    _sessionId?: string,
  ): Promise<Task> {
    const task = await this.taskManager.createTask({
      name: `sdk_task:${requestId}`,
      ttlMs: taskParams.ttl ?? undefined,
      pollIntervalMs: taskParams.pollInterval,
      // No executor — the SDK's task flow drives lifecycle via storeTaskResult.
    });
    return this.toSdkTask(task);
  }

  async getTask(taskId: string, _sessionId?: string): Promise<Task | null> {
    const record = this.taskManager.getTask(taskId);
    if (!record) return null;
    return this.toSdkTask(record);
  }

  async storeTaskResult(
    taskId: string,
    status: 'completed' | 'failed',
    result: Result,
    _sessionId?: string,
  ): Promise<void> {
    this.taskManager.setTaskResult(taskId, status, result);
  }

  async getTaskResult(taskId: string, _sessionId?: string): Promise<Result> {
    const payload = this.taskManager.getTaskPayload(taskId);
    if (!payload) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (payload.status === 'failed') {
      throw new Error(payload.error ?? 'Task failed');
    }
    return payload.result as Result;
  }

  async updateTaskStatus(
    taskId: string,
    status: Task['status'],
    statusMessage?: string,
    _sessionId?: string,
  ): Promise<void> {
    if (status === 'cancelled') {
      await this.taskManager.cancelTask(taskId);
      return;
    }
    if (status === 'failed' && statusMessage) {
      this.taskManager.setTaskResult(taskId, 'failed', undefined, statusMessage);
    }
    // 'completed' results arrive via storeTaskResult (SDK calls both; the
    // result-carrying call is the authoritative settlement).
  }

  async listTasks(
    _cursor?: string,
    _sessionId?: string,
  ): Promise<{
    tasks: Task[];
    nextCursor?: string;
  }> {
    const records = this.taskManager.listTasks();
    return {
      tasks: records.map((r) => this.toSdkTask(r)),
      // No pagination yet — all tasks fit in a single page for our use case.
      nextCursor: undefined,
    };
  }

  /** Convert our {@link TaskRecord} to the SDK's {@link Task} shape. */
  private toSdkTask<T>(record: TaskRecord<T>): Task {
    return {
      taskId: record.taskId,
      status: record.status,
      ttl: record.ttl,
      createdAt: record.createdAt,
      lastUpdatedAt: record.lastUpdatedAt,
      ...(record.pollInterval !== undefined ? { pollInterval: record.pollInterval } : {}),
      ...(record.message !== undefined ? { statusMessage: record.message } : {}),
    };
  }
}

/** JSON-RPC request id — number | string per the protocol. */
type RequestIdLike = number | string;
