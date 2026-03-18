import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakpointExceptionHandlers } from '@server/domains/debugger/handlers/breakpoint-exception';
import type { DebuggerManager } from '@server/domains/shared/modules';

type ExceptionDebuggerManager = Pick<DebuggerManager, 'setPauseOnExceptions'>;

function parseJson(response: { content: Array<{ text: string }> }): unknown {
  const firstContent = response.content[0];
  expect(firstContent).toBeDefined();
  return JSON.parse(firstContent!.text) as unknown;
}

describe('BreakpointExceptionHandlers', () => {
  const debuggerManager = {
    setPauseOnExceptions: vi.fn<ExceptionDebuggerManager['setPauseOnExceptions']>(),
  } satisfies ExceptionDebuggerManager;

  function createHandlers() {
    return new BreakpointExceptionHandlers({
      debuggerManager: debuggerManager as unknown as DebuggerManager,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults pause-on-exception state to none', async () => {
    const handlers = createHandlers();

    const body = parseJson(await handlers.handleBreakpointSetOnException({}));

    expect(debuggerManager.setPauseOnExceptions).toHaveBeenCalledWith('none');
    expect(body).toEqual({
      success: true,
      message: 'Pause on exceptions set to: none',
      state: 'none',
    });
  });

  it('uses the provided pause-on-exception state', async () => {
    const handlers = createHandlers();

    const body = parseJson(await handlers.handleBreakpointSetOnException({ state: 'all' }));

    expect(debuggerManager.setPauseOnExceptions).toHaveBeenCalledWith('all');
    expect(body).toEqual({
      success: true,
      message: 'Pause on exceptions set to: all',
      state: 'all',
    });
  });

  it('propagates debugger manager failures', async () => {
    debuggerManager.setPauseOnExceptions.mockRejectedValueOnce(new Error('nope'));
    const handlers = createHandlers();

    await expect(handlers.handleBreakpointSetOnException({ state: 'uncaught' })).rejects.toThrow(
      'nope'
    );
  });
});
