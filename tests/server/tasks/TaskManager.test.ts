import { describe, expect, it } from 'vitest';
import { TaskManager } from '@server/tasks/TaskManager';

describe('TaskManager (MCP 2.0 Tasks Protocol)', () => {
  it('should create and execute a background task successfully', async () => {
    const manager = new TaskManager();
    const task = await manager.createTask({
      name: 'test_async_scan',
      executor: async (ctx) => {
        ctx.updateProgress(50, 100, 'scanning memory');
        return { matched: 42 };
      },
    });

    expect(task.taskId).toBeDefined();
    expect(task.name).toBe('test_async_scan');

    // Wait a tick for async completion
    await new Promise((r) => setTimeout(r, 20));

    const record = manager.getTask(task.taskId);
    expect(record?.status).toBe('completed');
    expect(record?.result).toEqual({ matched: 42 });
    expect(record?.progress).toBe(100);

    const payload = manager.getTaskPayload(task.taskId);
    expect(payload?.status).toBe('completed');
    expect(payload?.result).toEqual({ matched: 42 });
  });

  it('should handle task errors gracefully', async () => {
    const manager = new TaskManager();
    const task = await manager.createTask({
      name: 'failing_task',
      executor: async () => {
        throw new Error('Process terminated unexpectedly');
      },
    });

    await new Promise((r) => setTimeout(r, 20));

    const record = manager.getTask(task.taskId);
    expect(record?.status).toBe('failed');
    expect(record?.error).toContain('Process terminated unexpectedly');
  });

  it('should support task cancellation with cleanup handler', async () => {
    const manager = new TaskManager();
    let cleanedUp = false;

    const task = await manager.createTask({
      name: 'cancellable_task',
      executor: async (ctx) => {
        await new Promise((r) => setTimeout(r, 100));
        if (ctx.isCancelled()) return null;
        return 'done';
      },
      cancelHandler: () => {
        cleanedUp = true;
      },
    });

    expect(task.status).toBe('working');
    const cancelled = await manager.cancelTask(task.taskId);
    expect(cancelled).toBe(true);
    expect(cleanedUp).toBe(true);

    const record = manager.getTask(task.taskId);
    expect(record?.status).toBe('cancelled');
  });

  it('should list tasks and prune based on TTL', async () => {
    const manager = new TaskManager({ defaultTtlMs: 50 });
    const task = await manager.createTask({
      name: 'quick_task',
      executor: async () => 'ok',
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(manager.listTasks().length).toBeGreaterThan(0);

    // Wait for TTL expiry
    await new Promise((r) => setTimeout(r, 60));
    // Trigger prune
    const list = manager.listTasks();
    expect(list.find((t) => t.taskId === task.taskId)).toBeUndefined();
  });
});
