// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchExpressionsHandlers } from '@server/domains/debugger/handlers/watch-expressions';

function parseJson(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

describe('WatchExpressionsHandlers', () => {
  const watchManager = {
    addWatch: vi.fn(),
    removeWatch: vi.fn(),
    getAllWatches: vi.fn(),
    evaluateAll: vi.fn(),
    clearAll: vi.fn(),
  };
  const debuggerManager = {
    getWatchManager: vi.fn(() => watchManager),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a watch expression and falls back to the expression as the display name', async () => {
    watchManager.addWatch.mockReturnValueOnce('watch-1');
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleWatchAdd({ expression: 'window.token' })
    );

    expect(watchManager.addWatch).toHaveBeenCalledWith('window.token', undefined);
    expect(body).toEqual({
      success: true,
      message: 'Watch expression added',
      watchId: 'watch-1',
      expression: 'window.token',
      name: 'window.token',
    });
  });

  it('returns a structured error when adding a watch fails', async () => {
    watchManager.addWatch.mockImplementationOnce(() => {
      throw new Error('bad watch');
    });
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleWatchAdd({ expression: 'boom()' }));

    expect(body).toEqual({
      success: false,
      message: 'Failed to add watch expression',
      error: 'bad watch',
    });
  });

  it('reports whether removing a watch actually removed anything', async () => {
    watchManager.removeWatch.mockReturnValueOnce(false);
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleWatchRemove({ watchId: 'missing' }));

    expect(body).toEqual({
      success: false,
      message: 'Watch expression not found',
      watchId: 'missing',
    });
  });

  it('lists all registered watch expressions', async () => {
    watchManager.getAllWatches.mockReturnValueOnce([
      { watchId: 'watch-1', expression: 'token' },
    ]);
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleWatchList({}));

    expect(body).toEqual({
      success: true,
      message: 'Found 1 watch expression(s)',
      watches: [{ watchId: 'watch-1', expression: 'token' }],
    });
  });

  it('evaluates all watch expressions in a call frame', async () => {
    watchManager.evaluateAll.mockResolvedValueOnce([
      { watchId: 'watch-1', value: 'abc' },
    ]);
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson(
      await handlers.handleWatchEvaluateAll({ callFrameId: 'frame-1' })
    );

    expect(watchManager.evaluateAll).toHaveBeenCalledWith('frame-1');
    expect(body).toEqual({
      success: true,
      message: 'Evaluated 1 watch expression(s)',
      results: [{ watchId: 'watch-1', value: 'abc' }],
    });
  });

  it('returns a structured error when clearing watches fails', async () => {
    watchManager.clearAll.mockImplementationOnce(() => {
      throw new Error('clear failed');
    });
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson(await handlers.handleWatchClearAll({}));

    expect(body).toEqual({
      success: false,
      message: 'Failed to clear watch expressions',
      error: 'clear failed',
    });
  });
});
