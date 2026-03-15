// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebuggerControlHandlers } from '@server/domains/debugger/handlers/debugger-control';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

describe('DebuggerControlHandlers', () => {
  const debuggerManager = {
    init: vi.fn(),
    initAdvancedFeatures: vi.fn(),
    isEnabled: vi.fn(),
    disable: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  const runtimeInspector = {
    init: vi.fn(),
    disable: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables the debugger and runtime inspector', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    const handlers = new DebuggerControlHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

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
    const handlers = new DebuggerControlHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

    const body = parseJson(await handlers.handleDebuggerDisable({}));

    expect(debuggerManager.disable).toHaveBeenCalledOnce();
    expect(runtimeInspector.disable).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Debugger disabled',
    });
  });

  it('pauses execution', async () => {
    const handlers = new DebuggerControlHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

    const body = parseJson(await handlers.handleDebuggerPause({}));

    expect(debuggerManager.pause).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Execution paused',
    });
  });

  it('propagates resume failures', async () => {
    debuggerManager.resume.mockRejectedValueOnce(new Error('resume failed'));
    const handlers = new DebuggerControlHandlers({
      debuggerManager,
      runtimeInspector,
    } as any);

    await expect(handlers.handleDebuggerResume({})).rejects.toThrow(
      'resume failed'
    );
  });
});
