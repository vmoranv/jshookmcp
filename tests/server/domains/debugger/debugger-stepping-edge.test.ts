import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { logger } from '@utils/logger';
import { DebuggerSteppingHandlers } from '@server/domains/debugger/handlers/debugger-stepping';


describe('DebuggerSteppingHandlers – edge cases', () => {
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

  // ── stepInto: success path ──────────────────────────────────

  it('steps into successfully when the debugger is enabled and paused', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepInto({}));

    expect(debuggerManager.stepInto).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Stepped into',
    });
  });

  // ── stepInto: not paused ────────────────────────────────────

  it('returns "not paused" error for stepInto when enabled but running', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepInto({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('Cannot step while not paused');
    expect(body.currentState).toBe('running');
    expect(body.hint).toBeDefined();
    expect(debuggerManager.stepInto).not.toHaveBeenCalled();
  });

  // ── stepOver: disabled ──────────────────────────────────────

  it('returns disabled error for stepOver when debugger is not enabled', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepOver({}));

    expect(body).toEqual({
      success: false,
      error: 'Debugger not enabled',
      hint: 'Call debugger_enable() first to enable the debugger',
    });
    expect(debuggerManager.stepOver).not.toHaveBeenCalled();
  });

  // ── stepOver: success path ──────────────────────────────────

  it('steps over successfully when the debugger is paused', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepOver({}));

    expect(debuggerManager.stepOver).toHaveBeenCalledOnce();
    expect(body).toEqual({
      success: true,
      message: 'Stepped over',
    });
  });

  // ── stepOver: throws ────────────────────────────────────────

  it('logs and returns a structured failure when stepping over throws', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    debuggerManager.stepOver.mockRejectedValueOnce(new Error('CDP timeout'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepOver({}));

    expect(logger.error).toHaveBeenCalledWith('Step over failed: CDP timeout');
    expect(body).toEqual({
      success: false,
      error: 'CDP timeout',
    });
  });

  // ── stepOut: disabled ───────────────────────────────────────

  it('returns disabled error for stepOut when debugger is not enabled', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepOut({}));

    expect(body).toEqual({
      success: false,
      error: 'Debugger not enabled',
      hint: 'Call debugger_enable() first to enable the debugger',
    });
    expect(debuggerManager.stepOut).not.toHaveBeenCalled();
  });

  // ── stepOut: not paused ─────────────────────────────────────

  it('returns "not paused" error for stepOut when enabled but running', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepOut({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('Cannot step out while not paused');
    expect(body.currentState).toBe('running');
    expect(body.hint).toBeDefined();
    expect(debuggerManager.stepOut).not.toHaveBeenCalled();
  });

  // ── stepOut: throws ─────────────────────────────────────────

  it('logs and returns a structured failure when stepping out throws', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    debuggerManager.stepOut.mockRejectedValueOnce(new Error('connection lost'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepOut({}));

    expect(logger.error).toHaveBeenCalledWith('Step out failed: connection lost');
    expect(body).toEqual({
      success: false,
      error: 'connection lost',
    });
  });

  // ── stepInto: non-Error thrown ──────────────────────────────

  it('handles non-Error thrown objects in stepInto', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    debuggerManager.stepInto.mockRejectedValueOnce('string error');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepInto({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('string error');
    expect(logger.error).toHaveBeenCalledWith('Step into failed: string error');
  });

  // ── stepOver: non-Error thrown ──────────────────────────────

  it('handles non-Error thrown objects in stepOver', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    debuggerManager.stepOver.mockRejectedValueOnce(42);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepOver({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('42');
  });

  // ── stepOut: non-Error thrown ───────────────────────────────

  it('handles non-Error thrown objects in stepOut', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    debuggerManager.stepOut.mockRejectedValueOnce(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleDebuggerStepOut({}));

    expect(body.success).toBe(false);
    expect(body.error).toBe('null');
  });

  // ── Response structure validation ───────────────────────────

  it('every response has content array with a single text entry', async () => {
    debuggerManager.isEnabled.mockReturnValueOnce(true);
    debuggerManager.isPaused.mockReturnValueOnce(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new DebuggerSteppingHandlers({ debuggerManager } as any);

    const result = await handlers.handleDebuggerStepInto({});
    const firstContent = result.content[0];

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(firstContent).toBeDefined();
    expect(firstContent).toHaveProperty('type', 'text');
    expect(typeof firstContent?.text).toBe('string');
  });
});
