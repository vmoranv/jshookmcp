import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolError } from '@errors/ToolError';
import { DebuggerStateHandlers } from '@server/domains/debugger/handlers/debugger-state';



describe('DebuggerStateHandlers', () => {
  const debuggerManager = {
    waitForPaused: vi.fn(),
    getPausedState: vi.fn(),
  };

  const runtimeInspector = {
    getCallStack: vi.fn(),
  };

  let handlers: DebuggerStateHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new DebuggerStateHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      debuggerManager: debuggerManager as any,
      runtimeInspector: runtimeInspector as unknown,
    });
  });

  it('waits for paused state and returns the top frame location', async () => {
    debuggerManager.waitForPaused.mockResolvedValueOnce({
      reason: 'breakpoint',
      callFrames: [{ location: { url: 'app.js', lineNumber: 7, columnNumber: 1 } }],
      hitBreakpoints: ['bp-1'],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleDebuggerWaitForPaused({ timeout: 1234 }));

    expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(1234);
    expect(body).toEqual({
      success: true,
      paused: true,
      reason: 'breakpoint',
      location: { url: 'app.js', lineNumber: 7, columnNumber: 1 },
      hitBreakpoints: ['bp-1'],
    });
  });

  it('returns a failure payload for generic wait errors', async () => {
    debuggerManager.waitForPaused.mockRejectedValueOnce(new Error('timed out'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleDebuggerWaitForPaused({}));

    expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(30000);
    expect(body).toEqual({
      success: false,
      paused: false,
      message: 'timed out',
    });
  });

  it('rethrows ToolError instances from waitForPaused', async () => {
    debuggerManager.waitForPaused.mockRejectedValueOnce(
      new ToolError('PREREQUISITE', 'debugger not enabled')
    );

    await expect(handlers.handleDebuggerWaitForPaused({})).rejects.toThrow('debugger not enabled');
  });

  it('returns a non-paused payload when the debugger is running', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleDebuggerGetPausedState({}));

    expect(body).toEqual({
      paused: false,
      message: 'Debugger is not paused',
    });
  });

  it('returns paused state details', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce({
      reason: 'exception',
      callFrames: [
        {
          functionName: 'main',
          location: { url: 'app.js', lineNumber: 10, columnNumber: 5 },
        },
      ],
      hitBreakpoints: ['bp-2'],
      timestamp: 1710000000000,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleDebuggerGetPausedState({}));

    expect(body).toEqual({
      paused: true,
      reason: 'exception',
      frameCount: 1,
      topFrame: {
        functionName: 'main',
        location: { url: 'app.js', lineNumber: 10, columnNumber: 5 },
      },
      hitBreakpoints: ['bp-2'],
      timestamp: 1710000000000,
    });
  });

  it('returns guidance when call stack is unavailable', async () => {
    runtimeInspector.getCallStack.mockResolvedValueOnce(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleGetCallStack({}));

    expect(body).toEqual({
      success: false,
      message: 'Not in paused state. Set a breakpoint and trigger it first.',
    });
  });

  it('maps call stack frames into response payload', async () => {
    runtimeInspector.getCallStack.mockResolvedValueOnce({
      reason: 'breakpoint',
      callFrames: [
        {
          callFrameId: 'frame-1',
          functionName: 'render',
          location: {
            url: 'https://app.local/app.js',
            lineNumber: 15,
            columnNumber: 3,
          },
          scopeChain: [{}, {}],
        },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<any>(await handlers.handleGetCallStack({}));

    expect(body).toEqual({
      success: true,
      callStack: {
        frameCount: 1,
        reason: 'breakpoint',
        frames: [
          {
            index: 0,
            callFrameId: 'frame-1',
            functionName: 'render',
            location: 'https://app.local/app.js:15:3',
            scopeCount: 2,
          },
        ],
      },
    });
  });
});
