import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { logger } from '@utils/logger';
import { DebuggerSteppingHandlers } from '@server/domains/debugger/handlers/debugger-stepping';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

describe('DebuggerSteppingHandlers', () => {
  const debuggerManager = {
    isEnabled: vi.fn(),
    isPaused: vi.fn(),
    stepInto: vi.fn(),
    stepOver: vi.fn(),
    stepOut: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a helpful error when step into is requested while disabled', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(false);
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleDebuggerStepInto({}));

    expect(body).toEqual({
      success: false,
      error: 'Debugger not enabled',
      hint: 'Call debugger_enable() first to enable the debugger',
    });
  });

  it('returns a helpful error when step over is requested while running', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(false);
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleDebuggerStepOver({}));

    expect(body).toEqual({
      success: false,
      error: 'Cannot step while not paused',
      hint:
        'The debugger must be paused at a breakpoint to perform step operations. Set a breakpoint with breakpoint_set() or pause with debugger_pause().',
      currentState: 'running',
    });
  });

  it('steps out successfully when the debugger is paused', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleDebuggerStepOut({}));

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
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleDebuggerStepInto({}));

    expect(logger.error).toHaveBeenCalledWith('Step into failed: step failed');
    expect(body).toEqual({
      success: false,
      error: 'step failed',
    });
  });
});
