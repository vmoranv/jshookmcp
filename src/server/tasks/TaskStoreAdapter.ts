/**
 * Adapter bridging our internal {@link TaskManager} to the 2025-11-25 task
 * wire methods (legacy-era interoperability surface).
 *
 * v2 removed the SDK's experimental taskStore integration (SEP-2663 — tasks
 * moved to the Extensions Track), so the four legacy methods are installed
 * explicitly via `setRequestHandler` with the deprecated-but-exported wire
 * schemas from `@modelcontextprotocol/core`. On 2026-07-28 connections the
 * protocol layer answers inbound `tasks/*` with `-32601` before these handlers
 * matter; Phase E adds the `io.modelcontextprotocol/tasks` extension for the
 * modern era.
 *
 * @module TaskStoreAdapter
 */
import type { Server, Task } from '@modelcontextprotocol/server';
import {
  CancelTaskResultSchema,
  GetTaskPayloadResultSchema,
  GetTaskResultSchema,
  ListTasksResultSchema,
} from '@modelcontextprotocol/core';
import { z } from 'zod';

// The 2025-11-25 task request schemas bundle the method literal into the
// params object, which does not fit the custom-method (params-only) form.
// The wire params are minimal, so restate them locally.
const TaskIdParamsSchema = z.object({ taskId: z.string() });
const ListTasksParamsSchema = z.object({ cursor: z.string().optional() });
import type { TaskManager, TaskRecord } from './TaskManager';

/**
 * Adapts a {@link TaskManager} to the legacy (2025-11-25) task method surface.
 *
 * Tasks created here are store-driven: they stay `working` until the task
 * flow settles them via `storeTaskResult` / `updateTaskStatus`. Tasks created
 * internally by long-running tools (with an executor) settle themselves and
 * are surfaced through the same read paths. Session binding: the SDK context's
 * transport-provided sessionId scopes visibility per caller.
 */
export class TaskStoreAdapter {
  private readonly taskManager: TaskManager;

  constructor(taskManager: TaskManager) {
    this.taskManager = taskManager;
  }

  /**
   * Install the legacy `tasks/get | tasks/result | tasks/list | tasks/cancel`
   * handlers onto the low-level protocol server (explicit-schema custom-method
   * form — the typed method maps exclude task methods by design).
   */
  install(protocol: Pick<Server, 'setRequestHandler'>): void {
    protocol.setRequestHandler(
      'tasks/get',
      { params: TaskIdParamsSchema, result: GetTaskResultSchema },
      // Task result schemas are flat — the task fields sit at the result top level.
      (params, ctx) => this.getTaskOrThrow(params.taskId, ctx?.sessionId),
    );

    protocol.setRequestHandler(
      'tasks/result',
      { params: TaskIdParamsSchema, result: GetTaskPayloadResultSchema },
      (params, ctx) => {
        const payload = this.taskManager.getTaskPayload(params.taskId, ctx?.sessionId);
        if (!payload) {
          throw new Error(`Task not found: ${params.taskId}`);
        }
        if (payload.status === 'failed') {
          throw new Error(payload.error ?? 'Task failed');
        }
        return {
          status: payload.status,
          ...(payload.result !== undefined ? { result: payload.result } : {}),
        };
      },
    );

    protocol.setRequestHandler(
      'tasks/list',
      { params: ListTasksParamsSchema, result: ListTasksResultSchema },
      (_params, ctx) => ({
        tasks: this.taskManager.listTasks(ctx?.sessionId).map((r) => this.toSdkTask(r)),
        // No pagination — all tasks fit in a single page for our use case.
      }),
    );

    protocol.setRequestHandler(
      'tasks/cancel',
      { params: TaskIdParamsSchema, result: CancelTaskResultSchema },
      async (params, ctx) => {
        await this.taskManager.cancelTask(params.taskId, ctx?.sessionId);
        // CancelTaskResult is flat — the task fields sit at the result top level.
        return this.toSdkTask(this.taskManager.getTask(params.taskId, ctx?.sessionId)!);
      },
    );
  }

  /** Store-driven settle hooks — used by future tool-task integrations. */

  storeTaskResult(taskId: string, status: 'completed' | 'failed', result: unknown): boolean {
    return this.taskManager.setTaskResult(taskId, status, result);
  }

  getTaskResult(taskId: string): {
    status: TaskRecord['status'];
    result?: unknown;
    error?: string;
  } {
    const payload = this.taskManager.getTaskPayload(taskId);
    if (!payload) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return payload;
  }

  private getTaskOrThrow(taskId: string, callerSession?: string | null): Task {
    const record = this.taskManager.getTask(taskId, callerSession);
    if (!record) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return this.toSdkTask(record);
  }

  /** Convert our {@link TaskRecord} to the wire {@link Task} shape. */
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
