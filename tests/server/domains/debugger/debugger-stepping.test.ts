import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebuggerManager } from '@server/domains/shared/modules';

const loggerState = vi.hoisted(() => ({
  error: vi.fn<(message: string) => void>(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { DebuggerSteppingHandlers } from '@server/domains/debugger/handlers/debugger-stepping';

type SteppingDebuggerManager = Pick<
  DebuggerManager,
  'isEnabled' | 'isPaused' | 'stepInto' | 'stepOver' | 'stepOut'
>;

function parseJson(response: { content: Array<{ text: string }> }): unknown {
  const firstContent = response.content[0];
  expect(firstContent).toBeDefined();
  return JSON.parse(firstContent!.text) as any;
}

describe('DebuggerSteppingHandlers', () => {
  const debuggerManager = {
    isEnabled: vi.fn<SteppingDebuggerManager['isEnabled']>(),
    isPaused: vi.fn<SteppingDebuggerManager['isPaused']>(),
    stepInto: vi.fn<SteppingDebuggerManager['stepInto']>(),
    stepOver: vi.fn<SteppingDebuggerManager['stepOver']>(),
    stepOut: vi.fn<SteppingDebuggerManager['stepOut']>(),
  } satisfies SteppingDebuggerManager;

  function createHandlers() {
    return new DebuggerSteppingHandlers({
      debuggerManager: debuggerManager as unknown as DebuggerManager,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a helpful error when step into is requested while disabled', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(false);
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(await handlers.handleDebuggerStepInto({}));

    expect(body).toEqual({
      success: false,
      error: 'Debugger not enabled',
      hint: "Call debugger_lifecycle({ action: 'enable' })() first to enable the debugger",
    });
  });

  it('returns a helpful error when step over is requested while running', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(false);
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(await handlers.handleDebuggerStepOver({}));

    expect(body).toEqual({
      success: false,
      error: 'Cannot step while not paused',
      hint: 'The debugger must be paused at a breakpoint to perform step operations. Set a breakpoint with breakpoint_set() or pause with debugger_pause().',
      currentState: 'running',
    });
  });

  it('steps out successfully when the debugger is paused', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(await handlers.handleDebuggerStepOut({}));

    expect(debuggerManager.stepOut).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Stepped out',
    });
  });

  it('logs and returns a structured failure when stepping into throws', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    debuggerManager.stepInto.mockRejectedValueOnce(new Error('step failed'));
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(await handlers.handleDebuggerStepInto({}));

    expect(loggerState.error).toHaveBeenCalledWith('Step into failed: step failed');
    expect(body).toEqual({
      success: false,
      error: 'step failed',
    });
  });
});
