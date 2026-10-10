import { describe, expect, it, vi } from 'vitest';
import { R } from '@server/domains/shared/ResponseBuilder';
import { FridaHandlers } from '@server/domains/binary-instrument/handlers/frida-handlers';
import type { BinaryInstrumentState } from '@server/domains/binary-instrument/handlers/shared';
import type { FridaSession } from '@modules/binary-instrument';
import { TaskManager } from '@server/tasks/TaskManager';
import type { MCPServerContext } from '@server/MCPServer.context';

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

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
    executeScript: vi.fn(async () => ({ output: 'ok' })),
    enumerateModules: vi.fn(async () => [
      { name: 'ntdll.dll', base: '0x7ff', size: 1, path: 'C:\\Windows\\System32\\ntdll.dll' },
      { name: 'target.exe', base: '0x400000', size: 2, path: 'D:\\apps\\target.exe' },
      { name: 'libc.so', base: '0x7000', size: 3, path: '/system/lib64/libc.so' },
    ]),
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

/**
 * Handler-layer coverage for the kimi-cu report improvements:
 * - R-02: keepAliveMs clamping + wiring, async keepAlive flag threading
 * - R-09: enumerate_modules filter + isSystem tags + summary
 */
describe('FridaHandlers — keepAlive + module summary', () => {
  it('frida_run_script keepAliveMs clamps above the 25s CLI ceiling and reports a note', async () => {
    const executeScript = vi.fn(async () => ({ output: 'armed' }));
    const session = makeFakeSession({ executeScript });
    const handlers = new FridaHandlers(makeState(undefined, session));

    const res = parse(
      await handlers.handleFridaRunScript({
        sessionId: 's1',
        script: 'console.log(1)',
        keepAliveMs: 120_000,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    const notes = res.notes as string[];
    expect(notes.at(0)).toContain('clamped from 120000 to 25000');
    expect(executeScript).toHaveBeenCalledWith(
      'console.log(1)',
      expect.objectContaining({ keepAlive: true, timeoutMs: 25_000 }),
    );
  });

  it('frida_run_script keepAliveMs clamps below the 1s floor (execFile timeout 0 means no timeout)', async () => {
    const executeScript = vi.fn(async () => ({ output: '' }));
    const session = makeFakeSession({ executeScript });
    const handlers = new FridaHandlers(makeState(undefined, session));

    await handlers.handleFridaRunScript({
      sessionId: 's1',
      script: 'x',
      keepAliveMs: 50,
    } as Record<string, unknown>);

    expect(executeScript).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ keepAlive: true, timeoutMs: 1_000 }),
    );
  });

  it('frida_run_script without keepAliveMs keeps the legacy synchronous behavior', async () => {
    const executeScript = vi.fn(async () => ({ output: 'ok' }));
    const session = makeFakeSession({ executeScript });
    const handlers = new FridaHandlers(makeState(undefined, session));

    const res = parse(
      await handlers.handleFridaRunScript({
        sessionId: 's1',
        script: 'x',
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    expect(res.notes).toBeUndefined();
    expect(executeScript).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ keepAlive: false, timeoutMs: undefined }),
    );
  });

  it('frida_run_script async threads keepAlive into the executor and echoes it', async () => {
    const tm = new TaskManager();
    const executeScript = vi.fn(async () => ({ output: 'hooked' }));
    const session = makeFakeSession({ executeScript });
    const handlers = new FridaHandlers(makeState(tm, session));

    const res = parse(
      await handlers.handleFridaRunScript({
        sessionId: 's1',
        script: 'x',
        async: true,
        keepAlive: true,
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    expect(res.async).toBe(true);
    expect(res.keepAlive).toBe(true);
    const notes = res.notes as string[];
    expect(notes.at(0)).toContain('recv().wait()');
    expect(executeScript).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ keepAlive: true, signal: expect.anything() }),
    );
  });

  it('frida_run_script failure response carries the passthrough execution fields', async () => {
    const executeScript = vi.fn(async () => ({
      output: 'partial',
      error: 'TypeError: boom',
      stderr: 'TypeError: boom\n    at <anonymous>',
      exitCode: 1,
    }));
    const session = makeFakeSession({ executeScript });
    const handlers = new FridaHandlers(makeState(undefined, session));

    const res = parse(
      await handlers.handleFridaRunScript({
        sessionId: 's1',
        script: 'boom',
      } as Record<string, unknown>),
    );

    expect(res.success).toBe(false);
    expect(res.reason).toBe('TypeError: boom');
    const execution = res.execution as Record<string, unknown>;
    expect(execution.exitCode).toBe(1);
    expect(execution.stderr).toContain('TypeError');
    expect(execution.output).toBe('partial');
  });

  it('frida_enumerate_modules tags modules and returns a summary (default all)', async () => {
    const session = makeFakeSession();
    const handlers = new FridaHandlers(makeState(undefined, session));

    const res = parse(
      await handlers.handleFridaEnumerateModules({ sessionId: 's1' } as Record<string, unknown>),
    );

    expect(res.success).toBe(true);
    const modules = res.modules as Array<Record<string, unknown>>;
    expect(modules).toHaveLength(3);
    expect(modules[0]?.isSystem).toBe(true);
    expect(modules[1]?.isSystem).toBe(false);
    expect(modules[2]?.isSystem).toBe(true);
    expect(res.summary).toMatchObject({ total: 3, system: 2, nonSystem: 1, filter: 'all' });
  });

  it('frida_enumerate_modules filter=non-system returns only non-system modules but full summary', async () => {
    const session = makeFakeSession();
    const handlers = new FridaHandlers(makeState(undefined, session));

    const res = parse(
      await handlers.handleFridaEnumerateModules({
        sessionId: 's1',
        filter: 'non-system',
      } as Record<string, unknown>),
    );

    const modules = res.modules as Array<Record<string, unknown>>;
    expect(modules).toHaveLength(1);
    expect(modules[0]?.name).toBe('target.exe');
    // Summary keeps the unfiltered totals so the agent still sees the big picture.
    expect(res.summary).toMatchObject({ total: 3, system: 2, nonSystem: 1, filter: 'non-system' });
  });

  it('frida_enumerate_modules filter=system returns only system modules', async () => {
    const session = makeFakeSession();
    const handlers = new FridaHandlers(makeState(undefined, session));

    const res = parse(
      await handlers.handleFridaEnumerateModules({
        sessionId: 's1',
        filter: 'system',
      } as Record<string, unknown>),
    );

    const modules = res.modules as Array<Record<string, unknown>>;
    expect(modules).toHaveLength(2);
    expect(modules.every((m) => m.isSystem === true)).toBe(true);
  });

  it('frida_enumerate_modules unknown filter falls back to all', async () => {
    const session = makeFakeSession();
    const handlers = new FridaHandlers(makeState(undefined, session));

    const res = parse(
      await handlers.handleFridaEnumerateModules({
        sessionId: 's1',
        filter: 'bogus',
      } as Record<string, unknown>),
    );

    expect(res.modules).toHaveLength(3);
    expect(res.summary).toMatchObject({ filter: 'all' });
  });
});
