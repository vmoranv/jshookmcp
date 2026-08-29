import { describe, expect, it, vi } from 'vitest';
import { R } from '@server/domains/shared/ResponseBuilder';
import { FridaHandlers } from '@server/domains/binary-instrument/handlers/frida-handlers';
import type { BinaryInstrumentState } from '@server/domains/binary-instrument/handlers/shared';
import type { FridaSession } from '@modules/binary-instrument';
import { TaskManager } from '@server/tasks/TaskManager';
import type { MCPServerContext } from '@server/MCPServer.context';

function parse(res: unknown): Record<string, unknown> {
  return R.parse<Record<string, unknown>>(res as Parameters<typeof R.parse>[0]);
}

function makeFakeSession(overrides: Record<string, unknown> = {}): FridaSession {
  const base = {
    getAvailability: vi.fn(async () => ({ available: true, path: 'frida' })),
    useSession: vi.fn(() => true),
    hasSession: vi.fn(() => true),
    listSessions: vi.fn(() => []),
    getSessionDiagnostics: vi.fn(() => undefined),
    memoryScan: vi.fn(async () => [{ address: '0x00007ff000000000', size: 4 }]),
    executeScript: vi.fn(async () => ({ output: 'ok' })),
    detach: vi.fn(async () => undefined),
    ...overrides,
  };
  return base as unknown as FridaSession;
}

function makeState(
  taskManager: TaskManager | undefined,
  session: FridaSession,
): BinaryInstrumentState {
  return {
    fridaSession: session,
    context: taskManager ? ({ taskManager } as unknown as MCPServerContext) : undefined,
  } as BinaryInstrumentState;
}

describe('FridaHandlers — task mode (MCP 2.0 Tasks retrofit)', () => {
  it('frida_memory_scan with async:true creates a task and threads a long timeoutMs', async () => {
    const tm = new TaskManager();
    const memoryScan = vi.fn(async () => [{ address: '0x42', size: 2 }]);
    const session = makeFakeSession({ memoryScan });
    const handlers = new FridaHandlers(makeState(tm, session));

    const res = parse(
      await handlers.handleFridaMemoryScan({
        sessionId: 's1',
        pattern: 'de ad be ef',
        async: true,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    expect(res.async).toBe(true);
    expect(typeof res.taskId).toBe('string');
    expect(res.pollWith).toEqual(['tasks_get', 'tasks_result']);

    // Executor ran against the fake session with the default task timeout (5 min).
    expect(memoryScan).toHaveBeenCalledWith(
      'de ad be ef',
      expect.objectContaining({ timeoutMs: 5 * 60_000 }),
    );

    const payload = tm.getTaskPayload<{ matches: unknown[]; count: number }>(res.taskId as string);
    expect(payload?.status).toBe('completed');
    expect(payload?.result?.count).toBe(1);
  });

  it('frida_memory_scan respects an explicit async timeoutMs (bounded to the ceiling)', async () => {
    const tm = new TaskManager();
    const memoryScan = vi.fn(async () => []);
    const session = makeFakeSession({ memoryScan });
    const handlers = new FridaHandlers(makeState(tm, session));

    await handlers.handleFridaMemoryScan({
      sessionId: 's1',
      pattern: 'aa',
      async: true,
      timeoutMs: 999_999_999,
    } as Record<string, unknown>);

    expect(memoryScan).toHaveBeenCalledWith(
      'aa',
      expect.objectContaining({ timeoutMs: 10 * 60_000 }),
    );
  });

  it('frida_memory_scan without async keeps the synchronous behavior (no task)', async () => {
    const tm = new TaskManager();
    const memoryScan = vi.fn(async () => [{ address: '0x1', size: 1 }]);
    const session = makeFakeSession({ memoryScan });
    const handlers = new FridaHandlers(makeState(tm, session));

    const res = parse(
      await handlers.handleFridaMemoryScan({ sessionId: 's1', pattern: 'aa' } as Record<
        string,
        unknown
      >),
    );

    expect(res.success).toBe(true);
    expect(res.taskId).toBeUndefined();
    expect(res.count).toBe(1);
    expect(tm.listTasks()).toHaveLength(0);
    expect(memoryScan).toHaveBeenCalledWith(
      'aa',
      expect.not.objectContaining({ timeoutMs: expect.anything() }),
    );
  });

  it('frida_memory_scan async:true without a taskManager falls back to synchronous scan', async () => {
    const memoryScan = vi.fn(async () => []);
    const session = makeFakeSession({ memoryScan });
    const handlers = new FridaHandlers(makeState(undefined, session));

    const res = parse(
      await handlers.handleFridaMemoryScan({
        sessionId: 's1',
        pattern: 'aa',
        async: true,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    expect(res.taskId).toBeUndefined();
    expect(memoryScan).toHaveBeenCalledTimes(1);
  });

  it('frida_run_script with async:true creates a task carrying the script execution', async () => {
    const tm = new TaskManager();
    const executeScript = vi.fn(async () => ({ output: 'hello' }));
    const session = makeFakeSession({ executeScript });
    const handlers = new FridaHandlers(makeState(tm, session));

    const res = parse(
      await handlers.handleFridaRunScript({
        sessionId: 's1',
        script: 'console.log("hi")',
        async: true,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    expect(res.async).toBe(true);
    expect(typeof res.taskId).toBe('string');

    const payload = tm.getTaskPayload<{ output: string }>(res.taskId as string);
    expect(payload?.status).toBe('completed');
    expect(payload?.result?.output).toBe('hello');
    expect(executeScript).toHaveBeenCalledWith(
      'console.log("hi")',
      expect.objectContaining({ timeoutMs: 5 * 60_000 }),
    );
  });

  it('availability/session failures still fail fast before any task is created', async () => {
    const tm = new TaskManager();
    const session = makeFakeSession({
      getAvailability: vi.fn(async () => ({ available: false, reason: 'frida missing' })),
    });
    const handlers = new FridaHandlers(makeState(tm, session));

    const res = parse(
      await handlers.handleFridaMemoryScan({
        sessionId: 's1',
        pattern: 'aa',
        async: true,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(false);
    expect(res.available).toBe(false);
    expect(res.taskId).toBeUndefined();
    expect(tm.listTasks()).toHaveLength(0);
  });
});
