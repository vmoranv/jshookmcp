import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebuggerControlHandlers } from '@server/domains/debugger/handlers/debugger-control';
import type { DebuggerManager, RuntimeInspector } from '@server/domains/shared/modules';

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
});
