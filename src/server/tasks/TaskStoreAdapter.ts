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
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
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

const MAX_RESULT_WAIT_MS = 30_000;
// Match the domain-side poll granularity (10ms) so SDK tasks/result also wakes
// promptly after a task settles instead of sleeping up to 100ms.
const RESULT_POLL_INTERVAL_MS = 10;
const TERMINAL_STATUSES = new Set<TaskRecord['status']>(['completed', 'failed', 'cancelled']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invalidTask(taskId: string): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InvalidParams, `Unknown task: ${taskId}`);
}

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
      async (params, ctx) => {
        const deadline = Date.now() + MAX_RESULT_WAIT_MS;
        let payload = this.taskManager.getTaskPayload(params.taskId, ctx?.sessionId);
        while (payload && !TERMINAL_STATUSES.has(payload.status) && Date.now() < deadline) {
          await sleep(RESULT_POLL_INTERVAL_MS);
          payload = this.taskManager.getTaskPayload(params.taskId, ctx?.sessionId);
        }
        if (!payload) {
          throw invalidTask(params.taskId);
        }
        if (!TERMINAL_STATUSES.has(payload.status)) {
          throw new ProtocolError(
            ProtocolErrorCode.InternalError,
            `Task result timed out while task remained ${payload.status}: ${params.taskId}`,
          );
        }
        if (payload.status === 'failed') {
          throw new ProtocolError(ProtocolErrorCode.InternalError, payload.error ?? 'Task failed');
        }
        if (payload.status === 'cancelled') {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            `Task cancelled: ${params.taskId}`,
          );
        }
        const relatedTaskMeta = {
          ['io.modelcontextprotocol/related-task']: { taskId: params.taskId },
        };
        if (payload.result === undefined) return { _meta: relatedTaskMeta };
        if (
          typeof payload.result !== 'object' ||
          payload.result === null ||
          Array.isArray(payload.result)
        ) {
          return {
            content: [{ type: 'text', text: String(payload.result) }],
            _meta: relatedTaskMeta,
          };
        }
        const result = payload.result as Record<string, unknown>;
        return {
          ...result,
          _meta: {
            ...(typeof result._meta === 'object' && result._meta !== null ? result._meta : {}),
            ...relatedTaskMeta,
          },
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
        const task = this.taskManager.getTask(params.taskId, ctx?.sessionId);
        if (!task || task.status !== 'working') {
          throw invalidTask(params.taskId);
        }
        const cancelled = await this.taskManager.cancelTask(params.taskId, ctx?.sessionId);
        if (!cancelled) {
          throw invalidTask(params.taskId);
        }
        // CancelTaskResult is flat — the task fields sit at the result top level.
        const cancelledTask = this.taskManager.getTask(params.taskId, ctx?.sessionId);
        if (!cancelledTask) {
          throw invalidTask(params.taskId);
        }
        return this.toSdkTask(cancelledTask);
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
      throw invalidTask(taskId);
    }
    return payload;
  }

  private getTaskOrThrow(taskId: string, callerSession?: string | null): Task {
    const record = this.taskManager.getTask(taskId, callerSession);
    if (!record) {
      throw invalidTask(taskId);
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
