import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebuggerControlHandlers } from '@server/domains/debugger/handlers/debugger-control';
import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import type { RuntimeInspector } from '@modules/debugger/RuntimeInspector';

type ControlDebuggerManager = Pick<
  DebuggerManager,
  | 'init'
  | 'initAdvancedFeatures'
  | 'isEnabled'
  | 'disable'
  | 'pause'
  | 'resume'
  | 'waitForPaused'
  | 'getPausedState'
  | 'setBreakpointByUrl'
  | 'setBreakpoint'
  | 'removeBreakpoint'
>;

type ControlRuntimeInspector = Pick<RuntimeInspector, 'init' | 'disable'>;

function parseJson(response: { content: Array<{ text: string }> }): unknown {
  const firstContent = response.content[0];
  expect(firstContent).toBeDefined();
  return JSON.parse(firstContent!.text) as any;
}

describe('DebuggerControlHandlers', () => {
  const debuggerManager = {
    init: vi.fn<ControlDebuggerManager['init']>(),
    initAdvancedFeatures: vi.fn<ControlDebuggerManager['initAdvancedFeatures']>(),
    isEnabled: vi.fn<ControlDebuggerManager['isEnabled']>(),
    disable: vi.fn<ControlDebuggerManager['disable']>(),
    pause: vi.fn<ControlDebuggerManager['pause']>(),
    resume: vi.fn<ControlDebuggerManager['resume']>(),
    waitForPaused: vi.fn<ControlDebuggerManager['waitForPaused']>(),
    getPausedState: vi.fn<ControlDebuggerManager['getPausedState']>(),
    setBreakpointByUrl: vi.fn<ControlDebuggerManager['setBreakpointByUrl']>(),
    setBreakpoint: vi.fn<ControlDebuggerManager['setBreakpoint']>(),
    removeBreakpoint: vi.fn<ControlDebuggerManager['removeBreakpoint']>(),
  } satisfies ControlDebuggerManager;

  const runtimeInspector = {
    init: vi.fn<ControlRuntimeInspector['init']>(),
    disable: vi.fn<ControlRuntimeInspector['disable']>(),
  } satisfies ControlRuntimeInspector;

  function createHandlers() {
    return new DebuggerControlHandlers({
      debuggerManager: debuggerManager as unknown as DebuggerManager,
      runtimeInspector: runtimeInspector as unknown as RuntimeInspector,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables the debugger and runtime inspector', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    const handlers = createHandlers();

    const body = parseJson(await handlers.handleDebuggerLifecycle({ action: 'enable' }));

    expect(debuggerManager.init).toHaveBeenCalledOnce();
    expect(runtimeInspector.init).toHaveBeenCalledOnce();
    expect(debuggerManager.initAdvancedFeatures).toHaveBeenCalledWith(runtimeInspector);
    expect(body).toEqual({
      success: true,
      message: 'Debugger enabled',
      enabled: true,
    });
  });

  it('disables the debugger and runtime inspector', async () => {
    const handlers = createHandlers();

    const body = parseJson(await handlers.handleDebuggerLifecycle({ action: 'disable' }));

    expect(debuggerManager.disable).toHaveBeenCalledOnce();
    expect(runtimeInspector.disable).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Debugger disabled',
    });
  });

  it('rejects unknown debugger lifecycle actions without disabling', async () => {
    const handlers = createHandlers();

    await expect(handlers.handleDebuggerLifecycle({ action: 'restart' })).rejects.toThrow(
      'Invalid debugger lifecycle action: restart',
    );

    expect(debuggerManager.disable).not.toHaveBeenCalled();
    expect(runtimeInspector.disable).not.toHaveBeenCalled();
  });

  it('reports when execution actually pauses', async () => {
    debuggerManager.waitForPaused.mockResolvedValueOnce({
      reason: 'other',
      callFrames: [{ location: { scriptId: '1', lineNumber: 2, columnNumber: 3 } }],
    } as Awaited<ReturnType<ControlDebuggerManager['waitForPaused']>>);
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(await handlers.handleDebuggerPause({}));

    expect(debuggerManager.pause).toHaveBeenCalledOnce();
    expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(500);
    expect(body).toEqual({
      success: true,
      paused: true,
      message: 'Execution paused',
      reason: 'other',
      location: { scriptId: '1', lineNumber: 2, columnNumber: 3 },
    });
  });

  it('reports a pending pause when no paused event arrives yet', async () => {
    debuggerManager.waitForPaused.mockRejectedValueOnce(new Error('timed out'));
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(await handlers.handleDebuggerPause({}));

    expect(debuggerManager.pause).toHaveBeenCalledOnce();
    expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(500);
    expect(body).toEqual({
      success: true,
      paused: false,
      message: 'Pause requested; no paused event observed yet',
    });
  });

  it('propagates resume failures', async () => {
    debuggerManager.resume.mockRejectedValueOnce(new Error('resume failed'));
    const handlers = createHandlers();

    await expect(handlers.handleDebuggerResume({})).rejects.toThrow('resume failed');
  });

  it('reports resume as a no-op when the debugger was not paused', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce(null);
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(await handlers.handleDebuggerResume({}));

    expect(debuggerManager.resume).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      resumed: false,
      message: 'Resume requested; debugger was not paused',
    });
  });

  it.skip('runs to a URL location and removes the temporary breakpoint', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce(null);
    debuggerManager.setBreakpointByUrl.mockResolvedValueOnce({
      breakpointId: 'bp-1',
      location: { url: 'app.js', lineNumber: 7, columnNumber: 1 },
      enabled: true,
      hitCount: 0,
      createdAt: 1,
    });
    debuggerManager.waitForPaused.mockResolvedValueOnce({
      reason: 'breakpoint',
      callFrames: [
        {
          location: { scriptId: 'script-1', lineNumber: 7, columnNumber: 1 },
          url: 'app.js',
        },
      ],
      hitBreakpoints: ['bp-1'],
      timestamp: 2,
    } as Awaited<ReturnType<ControlDebuggerManager['waitForPaused']>>);
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(
      await handlers.handleDebuggerRunToLocation({
        url: 'app.js',
        lineNumber: 7,
        columnNumber: 1,
        timeout: 1234,
      }),
    );

    expect(debuggerManager.setBreakpointByUrl).toHaveBeenCalledWith({
      url: 'app.js',
      lineNumber: 7,
      columnNumber: 1,
      condition: undefined,
    });
    expect(debuggerManager.resume).toHaveBeenCalledOnce();
    expect(debuggerManager.waitForPaused).toHaveBeenCalledWith(1234);
    expect(debuggerManager.removeBreakpoint).toHaveBeenCalledWith('bp-1');
    expect(body).toEqual({
      success: true,
      paused: true,
      hitTarget: true,
      message: 'Execution paused at target location',
      reason: 'breakpoint',
      url: 'app.js',
      location: { scriptId: 'script-1', lineNumber: 7, columnNumber: 1 },
      hitBreakpoints: ['bp-1'],
      temporaryBreakpoint: {
        breakpointId: 'bp-1',
        location: { url: 'app.js', lineNumber: 7, columnNumber: 1 },
      },
      removedTemporaryBreakpoint: true,
    });
  });

  it('removes the temporary script breakpoint when waiting times out', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce(null);
    debuggerManager.setBreakpoint.mockResolvedValueOnce({
      breakpointId: 'bp-2',
      location: { scriptId: 'script-2', lineNumber: 12 },
      enabled: true,
      hitCount: 0,
      createdAt: 1,
    });
    debuggerManager.waitForPaused.mockRejectedValueOnce(
      new Error('Timeout waiting for paused event'),
    );
    const handlers = createHandlers();

    // @ts-expect-error — auto-suppressed [TS2558]
    const body = parseJson<any>(
      await handlers.handleDebuggerRunToLocation({
        scriptId: 'script-2',
        lineNumber: 12,
      }),
    );

    expect(debuggerManager.setBreakpoint).toHaveBeenCalledWith({
      scriptId: 'script-2',
      lineNumber: 12,
      columnNumber: undefined,
      condition: undefined,
    });
    expect(debuggerManager.removeBreakpoint).toHaveBeenCalledWith('bp-2');
    expect(body).toEqual({
      success: false,
      paused: false,
      message: 'Timeout waiting for paused event',
      temporaryBreakpoint: {
        breakpointId: 'bp-2',
        location: { scriptId: 'script-2', lineNumber: 12 },
      },
      removedTemporaryBreakpoint: true,
    });
  });

  it('requires either url or scriptId for run-to-location', async () => {
    const handlers = createHandlers();

    await expect(handlers.handleDebuggerRunToLocation({ lineNumber: 1 })).rejects.toThrow(
      'Either url or scriptId must be provided',
    );
    expect(debuggerManager.setBreakpoint).not.toHaveBeenCalled();
    expect(debuggerManager.setBreakpointByUrl).not.toHaveBeenCalled();
  });
});
