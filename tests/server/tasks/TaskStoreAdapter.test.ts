import { describe, expect, it, vi } from 'vitest';
import { TaskManager } from '@server/tasks/TaskManager';
import { TaskStoreAdapter } from '@server/tasks/TaskStoreAdapter';

type Handler = (params: { taskId?: string; cursor?: string }) => unknown;

function installSpy(adapter: TaskStoreAdapter) {
  const handlers = new Map<string, Handler>();
  const protocol = {
    setRequestHandler: vi.fn((method: string, _schemas: unknown, handler: Handler) => {
      handlers.set(method, handler);
    }),
  } as unknown as Parameters<TaskStoreAdapter['install']>[0];
  adapter.install(protocol);
  return {
    // Route through a promise so sync-throwing handlers surface as rejections.
    call: (method: string, params: { taskId?: string; cursor?: string }) =>
      Promise.resolve().then(() => handlers.get(method)!(params)),
  };
}

describe('TaskStoreAdapter (legacy 2025-11-25 task methods over v2)', () => {
  it('installs the four legacy task methods via explicit-schema handlers', () => {
    const adapter = new TaskStoreAdapter(new TaskManager());
    const setRequestHandler = vi.fn();
    adapter.install({ setRequestHandler } as unknown as Parameters<TaskStoreAdapter['install']>[0]);

    expect(setRequestHandler).toHaveBeenCalledTimes(4);
    const methods = setRequestHandler.mock.calls.map((c) => c[0]);
    expect(methods).toEqual(['tasks/get', 'tasks/result', 'tasks/list', 'tasks/cancel']);
  });

  it('tasks/get returns the wire Task shape for a known task', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    await tm.createTask({ name: 'pcapng_read', executor: async () => 1 });
    const { call } = installSpy(adapter);

    const record = tm.listTasks()[0]!;
    const res = (await call('tasks/get', { taskId: record.taskId })) as {
      taskId: string;
      status: string;
      ttl: number;
    };
    expect(res.taskId).toBe(record.taskId);
    expect(res.ttl).toBeTypeOf('number');
    expect(['working', 'completed']).toContain(res.status);

    await expect(call('tasks/get', { taskId: 'ghost' })).rejects.toThrow('Task not found');
  });

  it('tasks/result returns the stored payload for completed tasks', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const task = await tm.createTask({
      name: 'demo',
      executor: async () => ({ blockCount: 3 }),
    });
    const { call } = installSpy(adapter);

    const res = (await call('tasks/result', { taskId: task.taskId })) as {
      status: string;
      result?: unknown;
    };
    expect(res.status).toBe('completed');
    expect(res.result).toEqual({ blockCount: 3 });
  });

  it('tasks/result throws for failed and unknown tasks', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const failing = await tm.createTask({
      name: 'x',
      executor: async () => {
        throw new Error('bad');
      },
    });
    const { call } = installSpy(adapter);

    await expect(call('tasks/result', { taskId: failing.taskId })).rejects.toThrow('bad');
    await expect(call('tasks/result', { taskId: 'ghost' })).rejects.toThrow('Task not found');
  });

  it('tasks/cancel cancels a working task and returns its post-cancel state', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const task = await tm.createTask({
      name: 'slow',
      executor: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return 1;
      },
    });
    const { call } = installSpy(adapter);

    const res = (await call('tasks/cancel', { taskId: task.taskId })) as {
      status: string;
    };
    expect(res.status).toBe('cancelled');
    expect(tm.getTask(task.taskId)?.status).toBe('cancelled');
  });

  it('tasks/list maps every record to the wire shape', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    const a = await tm.createTask({ name: 'a', executor: async () => 1 });
    const b = await tm.createTask({ name: 'b', executor: async () => 2 });
    const { call } = installSpy(adapter);

    const res = (await call('tasks/list', {})) as { tasks: Array<{ taskId: string }> };
    expect(res.tasks.map((t) => t.taskId).toSorted()).toEqual([a.taskId, b.taskId].toSorted());
  });

  it('storeTaskResult settles a store-driven task for getTaskResult reads', async () => {
    const tm = new TaskManager();
    const adapter = new TaskStoreAdapter(tm);
    // Store-driven task — no executor, stays working until settled.
    const record = await tm.createTask({ name: 'sdk_driven' });

    expect(tm.getTask(record.taskId)?.status).toBe('working');
    expect(adapter.storeTaskResult(record.taskId, 'completed', { content: [] })).toBe(true);

    const payload = adapter.getTaskResult(record.taskId);
    expect(payload.status).toBe('completed');
    expect(payload.result).toEqual({ content: [] });
  });
});
