// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakpointExceptionHandlers } from '@server/domains/debugger/handlers/breakpoint-exception';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

describe('BreakpointExceptionHandlers', () => {
  const debuggerManager = {
    setPauseOnExceptions: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults pause-on-exception state to none', async () => {
    const handlers = new BreakpointExceptionHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleBreakpointSetOnException({}));

    expect(debuggerManager.setPauseOnExceptions).toHaveBeenCalledWith('none');
    expect(body).toEqual({
      success: true,
      message: 'Pause on exceptions set to: none',
      state: 'none',
    });
  });

  it('uses the provided pause-on-exception state', async () => {
    const handlers = new BreakpointExceptionHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleBreakpointSetOnException({ state: 'all' })
    );

    expect(debuggerManager.setPauseOnExceptions).toHaveBeenCalledWith('all');
    expect(body.state).toBe('all');
  });

  it('propagates debugger manager failures', async () => {
    debuggerManager.setPauseOnExceptions.mockRejectedValueOnce(new Error('nope'));
    const handlers = new BreakpointExceptionHandlers({ debuggerManager } as any);

    await expect(
      handlers.handleBreakpointSetOnException({ state: 'uncaught' })
    ).rejects.toThrow('nope');
  });
});
