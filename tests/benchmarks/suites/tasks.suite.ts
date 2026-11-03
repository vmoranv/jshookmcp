/**
 * Tasks domain — MCP 2.0 background-task lifecycle (offline, deterministic).
 *
 * Ground truth: the TaskManager state machine — executor-less tasks stay
 * 'working' until externally settled via setTaskResult()/cancelTask(); cancel
 * of a terminal task is refused; tasks_result polls up to waitMs for a
 * terminal state before reporting; list orders by lastUpdatedAt descending
 * with status/name filters.
 */
import { TaskManager } from '@server/tasks/TaskManager';
import { TaskToolsHandlers } from '@server/domains/tasks/handlers';
import { body, expectSuccess, type BenchSuite } from '../harness';

const manager = new TaskManager({ defaultTtlMs: 60_000 });
const handlers = new TaskToolsHandlers(manager);

export const tasksSuite: BenchSuite = {
  name: 'tasks-lifecycle',
  domain: 'tasks',
  description:
    'tasks_get/result/cancel/list lifecycle: working→completed settle, cooperative cancel, poll-until-terminal, filtered listing',
  cases: [
    {
      name: 'tasks_get/unknown-not-found',
      tool: 'tasks_get',
      origin: 'homemade',
      reference: 'an unknown taskId answers success=false with notFound=true, not a stale snapshot',
      run: () => handlers.handleTasksGet({ taskId: 'no-such-task' }),
      validate: (v) => {
        const b = body(v);
        if (b.success !== false) return `unknown task must fail, got success=${b.success}`;
        return b.notFound === true ? true : `expected notFound=true, got ${b.notFound}`;
      },
    },
    {
      name: 'tasks_get/working-until-settled',
      tool: 'tasks_get',
      origin: 'homemade',
      reference: 'executor-less task stays working; setTaskResult(completed) flips it with payload',
      run: async () => {
        const task = await manager.createTask({ name: 'bench-get' });
        const working = body(await handlers.handleTasksGet({ taskId: task.taskId }));
        const settled = manager.setTaskResult(task.taskId, 'completed', { answer: 42 });
        const completed = body(await handlers.handleTasksGet({ taskId: task.taskId }));
        return { working, settled, completed, taskId: task.taskId };
      },
      validate: (v) => {
        const b = body(v);
        const working = b.working as Record<string, unknown>;
        const settled = b.settled as unknown;
        const completed = b.completed as Record<string, unknown>;
        if (working.status !== 'working')
          return `fresh task must be working, got ${working.status}`;
        if (settled !== true) return `setTaskResult must succeed, got ${settled}`;
        if (completed.status !== 'completed') return `expected completed, got ${completed.status}`;
        return Number(completed.progress) >= 0 ? true : 'snapshot must carry progress';
      },
    },
    {
      name: 'tasks_cancel/terminal-refuses',
      tool: 'tasks_cancel',
      origin: 'homemade',
      reference: 'cancel flips working→cancelled; cancelling an already-terminal task is refused',
      run: async () => {
        const task = await manager.createTask({ name: 'bench-cancel' });
        const cancelled = body(await handlers.handleTasksCancel({ taskId: task.taskId }));
        const again = body(await handlers.handleTasksCancel({ taskId: task.taskId }));
        const snapshot = body(await handlers.handleTasksGet({ taskId: task.taskId }));
        return { cancelled, again, snapshot };
      },
      validate: (v) => {
        const b = body(v);
        const cancelled = b.cancelled as Record<string, unknown>;
        const again = b.again as Record<string, unknown>;
        const snapshot = b.snapshot as Record<string, unknown>;
        if (snapshot.status !== 'cancelled')
          return `snapshot status must be cancelled, got ${snapshot.status}`;
        if (cancelled.cancelled !== true)
          return `first cancel must succeed, got ${JSON.stringify(cancelled)}`;
        if (again.success !== false)
          return `second cancel must be refused, got success=${again.success}`;
        const msg = String(again.message ?? again.error ?? '');
        return msg.includes('not cancellable')
          ? true
          : `refusal must explain the terminal status, got: ${msg.slice(0, 120)}`;
      },
    },
    {
      name: 'tasks_result/poll-until-terminal',
      tool: 'tasks_result',
      origin: 'homemade',
      reference:
        'tasks_result polls up to waitMs; a mid-flight settle must surface with resultAvailable=true',
      run: async () => {
        const task = await manager.createTask({ name: 'bench-poll' });
        setTimeout(() => manager.setTaskResult(task.taskId, 'completed', { sum: 7 }), 50);
        return handlers.handleTasksResult({ taskId: task.taskId, waitMs: 2_000 });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.status !== 'completed') return `poll must observe completed, got ${b.status}`;
        if (b.resultAvailable !== true)
          return `resultAvailable must be true, got ${b.resultAvailable}`;
        const result = b.result as Record<string, unknown> | undefined;
        return result?.sum === 7 ? true : `payload must roundtrip, got ${JSON.stringify(result)}`;
      },
    },
    {
      name: 'tasks_list/status-filter',
      tool: 'tasks_list',
      origin: 'homemade',
      reference:
        'list orders strictly by lastUpdatedAt descending and honors the status filter — mutations are spaced by real sleeps so every timestamp is distinct and the expected order is exact',
      run: async () => {
        const gap = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const t1 = await manager.createTask({ name: 'bench-list-a' });
        await gap(6);
        const t2 = await manager.createTask({ name: 'bench-list-b' });
        await gap(6);
        const t3 = await manager.createTask({ name: 'bench-list-c' });
        await gap(6);
        manager.setTaskResult(t2.taskId, 'failed', undefined, 'boom');
        await gap(6);
        manager.setTaskResult(t3.taskId, 'completed', 'ok');
        const working = body(await handlers.handleTasksList({ status: 'working' }));
        const failed = body(await handlers.handleTasksList({ status: 'failed' }));
        const all = body(await handlers.handleTasksList({}));
        return { ids: [t1.taskId, t2.taskId, t3.taskId], working, failed, all };
      },
      validate: (v) => {
        const b = body(v);
        const working = b.working as Record<string, unknown>;
        const failed = b.failed as Record<string, unknown>;
        const all = b.all as Record<string, unknown>;
        const workingTasks = (working.tasks as Array<Record<string, unknown>>) ?? [];
        const failedTasks = (failed.tasks as Array<Record<string, unknown>>) ?? [];
        const allTasks = (all.tasks as Array<Record<string, unknown>>) ?? [];
        const caseIds = new Set(b.ids as string[]);
        const scopedWorking = workingTasks.filter((t) => caseIds.has(String(t.taskId)));
        const scopedFailed = failedTasks.filter((t) => caseIds.has(String(t.taskId)));
        if (scopedWorking.length !== 1)
          return `working filter expected 1, got ${scopedWorking.length}`;
        if (scopedWorking[0]?.taskId !== (b.ids as string[])[0]) {
          return 'the untouched task must be the working one';
        }
        if (scopedFailed.length !== 1)
          return `failed filter expected 1, got ${scopedFailed.length}`;
        if (scopedFailed[0]?.status !== 'failed') return 'failed filter must return failed tasks';
        const got = allTasks.map((t) => String(t.taskId)).filter((id) => caseIds.has(id));
        const expected = [(b.ids as string[])[2], (b.ids as string[])[1], (b.ids as string[])[0]];
        return got.join(',') === expected.join(',')
          ? true
          : `list must order by lastUpdatedAt desc (${expected}), got ${got.join(',')}`;
      },
    },
  ],
};
