import { describe, expect, it } from 'vitest';
import { TaskManager } from '@server/tasks/TaskManager';
import { TaskToolsHandlers } from '@server/domains/tasks/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolArgs } from '@server/types';

function parse(res: unknown): Record<string, unknown> {
  return R.parse<Record<string, unknown>>(res as Parameters<typeof R.parse>[0]);
}

describe('TaskToolsHandlers (MCP 2.0 Tasks polling surface)', () => {
  it('tasks_get returns full lifecycle state and flags unknown ids', async () => {
    const tm = new TaskManager();
    const handlers = new TaskToolsHandlers(tm);
    const task = await tm.createTask({
      name: 'demo_scan',
      executor: async (ctx) => {
        ctx.updateProgress(40, 200, 'halfway');
        // Hold the task in 'working' so the snapshot below observes mid-flight state.
        await new Promise((r) => setTimeout(r, 300));
        return { ok: 1 };
      },
    });

    const got = parse(await handlers.handleTasksGet({ taskId: task.taskId } as ToolArgs));
    expect(got.success).toBe(true);
    expect(got.taskId).toBe(task.taskId);
    expect(got.name).toBe('demo_scan');
    expect(got.status).toBe('working');
    expect(got.progress).toBe(40);
    expect(got.total).toBe(200);
    expect(got.message).toBe('halfway');

    const missing = parse(await handlers.handleTasksGet({ taskId: 'nope' } as ToolArgs));
    expect(missing.success).toBe(false);
    expect(missing.notFound).toBe(true);
  });

  it('tasks_get rejects missing taskId', async () => {
    const handlers = new TaskToolsHandlers(new TaskManager());
    const res = parse(await handlers.handleTasksGet({} as ToolArgs));
    expect(res.success).toBe(false);
    expect(res.error).toContain('taskId is required');
  });

  it('tasks_result returns the payload once the task completes', async () => {
    const tm = new TaskManager();
    const handlers = new TaskToolsHandlers(tm);
    const task = await tm.createTask({
      name: 'pcapng_read',
      executor: async () => ({ blockCount: 3 }),
    });

    const done = parse(
      await handlers.handleTasksResult({ taskId: task.taskId, waitMs: 2000 } as ToolArgs),
    );
    expect(done.success).toBe(true);
    expect(done.status).toBe('completed');
    expect(done.resultAvailable).toBe(true);
    expect(done.result).toEqual({ blockCount: 3 });
  });

  it('tasks_result returns current status without result for still-working tasks', async () => {
    const tm = new TaskManager();
    const handlers = new TaskToolsHandlers(tm);
    const task = await tm.createTask({
      name: 'slow',
      executor: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return 'late';
      },
    });

    const res = parse(
      await handlers.handleTasksResult({ taskId: task.taskId, waitMs: 0 } as ToolArgs),
    );
    expect(res.status).toBe('working');
    expect(res.resultAvailable).toBe(false);
    await tm.cancelTask(task.taskId);
  });

  it('tasks_result surfaces the failure error for failed tasks', async () => {
    const tm = new TaskManager();
    const handlers = new TaskToolsHandlers(tm);
    const task = await tm.createTask({
      name: 'boom',
      executor: async () => {
        throw new Error('scan exploded');
      },
    });

    const res = parse(
      await handlers.handleTasksResult({ taskId: task.taskId, waitMs: 2000 } as ToolArgs),
    );
    expect(res.status).toBe('failed');
    expect(res.resultAvailable).toBe(false);
    expect(res.error).toContain('scan exploded');
  });

  it('tasks_result rejects unknown ids', async () => {
    const handlers = new TaskToolsHandlers(new TaskManager());
    const res = parse(await handlers.handleTasksResult({ taskId: 'ghost', waitMs: 0 } as ToolArgs));
    expect(res.success).toBe(false);
    expect(res.notFound).toBe(true);
  });

  it('tasks_cancel cancels a working task and runs its cancel handler', async () => {
    const tm = new TaskManager();
    const handlers = new TaskToolsHandlers(tm);
    let cancelled = false;
    const task = await tm.createTask({
      name: 'frida_memory_scan',
      executor: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return {};
      },
      cancelHandler: () => {
        cancelled = true;
      },
    });

    const res = parse(await handlers.handleTasksCancel({ taskId: task.taskId } as ToolArgs));
    expect(res.success).toBe(true);
    expect(res.cancelled).toBe(true);
    expect(cancelled).toBe(true);

    const after = parse(await handlers.handleTasksGet({ taskId: task.taskId } as ToolArgs));
    expect(after.status).toBe('cancelled');
  });

  it('tasks_cancel refuses non-working tasks and unknown ids', async () => {
    const tm = new TaskManager();
    const handlers = new TaskToolsHandlers(tm);
    const done = await tm.createTask({ name: 'done', executor: async () => 1 });

    const res = parse(await handlers.handleTasksCancel({ taskId: done.taskId } as ToolArgs));
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('not cancellable');

    const missing = parse(await handlers.handleTasksCancel({ taskId: 'ghost' } as ToolArgs));
    expect(missing.notFound).toBe(true);
  });

  it('tasks_list filters by status and name and honours the limit', async () => {
    const tm = new TaskManager();
    const handlers = new TaskToolsHandlers(tm);
    const finisher = await tm.createTask({ name: 'pcapng_read', executor: async () => 1 });
    const cancelled = await tm.createTask({
      name: 'pcapng_read',
      executor: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return 2;
      },
    });
    await tm.cancelTask(cancelled.taskId);

    const onlyCancelled = parse(
      await handlers.handleTasksList({ status: 'cancelled', name: 'pcapng_read' } as ToolArgs),
    );
    expect(onlyCancelled.count).toBe(1);
    expect((onlyCancelled.tasks as Array<Record<string, unknown>>)[0]?.taskId).toBe(
      cancelled.taskId,
    );

    const limited = parse(await handlers.handleTasksList({ limit: 1 } as ToolArgs));
    expect(limited.count).toBe(1);
    void finisher;
  });

  it('handlers stay usable through a real TaskManager end-to-end roundtrip', async () => {
    const tm = new TaskManager();
    const handlers = new TaskToolsHandlers(tm);
    const task = await tm.createTask({
      name: 'frida_run_script',
      executor: async (ctx) => {
        ctx.updateProgress(1, 2, 'executing');
        return { output: 'ok' };
      },
    });

    const res = R.parse(
      await handlers.handleTasksResult({ taskId: task.taskId, waitMs: 2000 } as ToolArgs),
    );
    expect(res['status']).toBe('completed');
    expect(res['result']).toEqual({ output: 'ok' });
  });
});
