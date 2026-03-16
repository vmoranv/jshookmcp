import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebuggerControlHandlers } from '@server/domains/debugger/handlers/debugger-control';
import type { DebuggerManager, RuntimeInspector } from '@server/domains/shared/modules';

type ControlDebuggerManager = Pick<
  DebuggerManager,
  'init' | 'initAdvancedFeatures' | 'isEnabled' | 'disable' | 'pause' | 'resume'
>;

type ControlRuntimeInspector = Pick<RuntimeInspector, 'init' | 'disable'>;

function parseJson(response: { content: Array<{ text: string }> }): unknown {
  const firstContent = response.content[0];
  expect(firstContent).toBeDefined();
  return JSON.parse(firstContent!.text) as unknown;
}

describe('DebuggerControlHandlers', () => {
  const debuggerManager = {
    init: vi.fn<ControlDebuggerManager['init']>(),
    initAdvancedFeatures: vi.fn<ControlDebuggerManager['initAdvancedFeatures']>(),
    isEnabled: vi.fn<ControlDebuggerManager['isEnabled']>(),
    disable: vi.fn<ControlDebuggerManager['disable']>(),
    pause: vi.fn<ControlDebuggerManager['pause']>(),
    resume: vi.fn<ControlDebuggerManager['resume']>(),
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

    const body = parseJson(await handlers.handleDebuggerEnable({}));

    expect(debuggerManager.init).toHaveBeenCalledOnce();
    expect(runtimeInspector.init).toHaveBeenCalledOnce();
    expect(debuggerManager.initAdvancedFeatures).toHaveBeenCalledWith(
      runtimeInspector
    );
    expect(body).toEqual({
      success: true,
      message: 'Debugger enabled',
      enabled: true,
    });
  });

  it('disables the debugger and runtime inspector', async () => {
    const handlers = createHandlers();

    const body = parseJson(await handlers.handleDebuggerDisable({}));

    expect(debuggerManager.disable).toHaveBeenCalledOnce();
    expect(runtimeInspector.disable).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Debugger disabled',
    });
  });

  it('pauses execution', async () => {
    const handlers = createHandlers();

    const body = parseJson(await handlers.handleDebuggerPause({}));

    expect(debuggerManager.pause).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Execution paused',
    });
  });

  it('propagates resume failures', async () => {
    debuggerManager.resume.mockRejectedValueOnce(new Error('resume failed'));
    const handlers = createHandlers();

    await expect(handlers.handleDebuggerResume({})).rejects.toThrow(
      'resume failed'
    );
  });
});
