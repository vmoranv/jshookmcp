import { describe, expect, it } from 'vitest';
import { TaskManager } from '@server/tasks/TaskManager';
import { TaskStoreAdapter } from '@server/tasks/TaskStoreAdapter';

describe('TaskStoreAdapter (SDK experimental TaskStore bridge)', () => {
  it('creates store-driven tasks that stay working until settled', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);

    const task = await adapter.createTask({ ttl: 60_000 }, 1, {}, undefined);
    expect(task.status).toBe('working');
    expect(task.ttl).toBe(60_000);

    // No executor → the record must still be working (SDK drives it).
    expect(tm.getTask(task.taskId)?.status).toBe('working');
  });

  it('storeTaskResult + getTaskResult complete the SDK task lifecycle', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const task = await adapter.createTask({}, 'req-1', {}, undefined);

    await adapter.storeTaskResult(task.taskId, 'completed', {
      content: [{ type: 'text', text: 'done' }],
    });

    expect(tm.getTask(task.taskId)?.status).toBe('completed');
    const result = await adapter.getTaskResult(task.taskId);
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }] });
  });

  it('updateTaskStatus(cancelled) routes into cancelTask', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const task = await adapter.createTask({}, 2, {}, undefined);

    await adapter.updateTaskStatus(task.taskId, 'cancelled', 'Client cancelled task execution.');

    expect(tm.getTask(task.taskId)?.status).toBe('cancelled');
  });

  it('getTaskResult throws for failed tasks and unknown ids', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const failing = await tm.createTask({
      name: 'x',
      executor: async () => {
        throw new Error('bad');
      },
    });

    await expect(adapter.getTaskResult(failing.taskId)).rejects.toThrow('bad');
    await expect(adapter.getTaskResult('ghost')).rejects.toThrow('Task not found');
  });

  it('getTask returns null for unknown ids and listTasks maps all records', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const a = await tm.createTask({ name: 'a', executor: async () => 1 });
    const b = await tm.createTask({ name: 'b', executor: async () => 2 });

    expect(await adapter.getTask('ghost')).toBeNull();
    const listed = await adapter.listTasks();
    expect(listed.tasks.map((t) => t.taskId).toSorted()).toEqual([a.taskId, b.taskId].toSorted());
    expect(listed.nextCursor).toBeUndefined();
  });

  it('maps internal record fields onto the SDK Task shape', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const internal = await tm.createTask({
      name: 'pcapng_read',
      pollIntervalMs: 1234,
      executor: async (ctx) => {
        ctx.updateProgress(50, 100, 'parsing');
        return 1;
      },
    });

    const task = await adapter.getTask(internal.taskId);
    expect(task).toMatchObject({
      taskId: internal.taskId,
      status: expect.any(String),
      ttl: expect.any(Number),
      pollInterval: 1234,
    });
    expect(task?.statusMessage).toBeTruthy();
  });
});
