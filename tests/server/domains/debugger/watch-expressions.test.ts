import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebuggerManager } from '@server/domains/shared/modules';
import { WatchExpressionsHandlers } from '@server/domains/debugger/handlers/watch-expressions';


describe('WatchExpressionsHandlers', () => {
  type WatchManager = ReturnType<DebuggerManager['getWatchManager']>;

  const watchManager = {
    addWatch: vi.fn((_expression: string, _name?: string): string => 'watch-default'),
    removeWatch: vi.fn((_watchId: string): boolean => false),
    getAllWatches: vi.fn((): ReturnType<WatchManager['getAllWatches']> => []),
    evaluateAll: vi.fn(
      async (_callFrameId?: string): Promise<Awaited<ReturnType<WatchManager['evaluateAll']>>> => []
    ),
    clearAll: vi.fn((): void => undefined),
  };
  const debuggerManager = {
    getWatchManager: vi.fn((): WatchManager => watchManager as unknown as WatchManager),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a watch expression and falls back to the expression as the display name', async () => {
    watchManager.addWatch.mockReturnValueOnce('watch-1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleWatchAdd({ expression: 'window.token' }));

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleWatchAdd({ expression: 'boom()' }));

    expect(body).toEqual({
      success: false,
      message: 'Failed to add watch expression',
      error: 'bad watch',
    });
  });

  it('reports whether removing a watch actually removed anything', async () => {
    watchManager.removeWatch.mockReturnValueOnce(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleWatchRemove({ watchId: 'missing' }));

    expect(body).toEqual({
      success: false,
      message: 'Watch expression not found',
      watchId: 'missing',
    });
  });

  it('lists all registered watch expressions', async () => {
    watchManager.getAllWatches.mockReturnValueOnce([
      {
        id: 'watch-1',
        expression: 'token',
        name: 'token',
        enabled: true,
        lastValue: undefined,
        lastError: null,
        valueHistory: [],
        createdAt: 1,
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleWatchList({}));

    expect(body).toEqual({
      success: true,
      message: 'Found 1 watch expression(s)',
      watches: [
        {
          id: 'watch-1',
          expression: 'token',
          name: 'token',
          enabled: true,
          lastValue: undefined,
          lastError: null,
          valueHistory: [],
          createdAt: 1,
        },
      ],
    });
  });

  it('evaluates all watch expressions in a call frame', async () => {
    watchManager.evaluateAll.mockResolvedValueOnce([
      {
        watchId: 'watch-1',
        name: 'token',
        expression: 'token',
        value: 'abc',
        error: null,
        valueChanged: true,
        timestamp: 1,
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleWatchEvaluateAll({ callFrameId: 'frame-1' }));

    expect(watchManager.evaluateAll).toHaveBeenCalledWith('frame-1');
    expect(body).toEqual({
      success: true,
      message: 'Evaluated 1 watch expression(s)',
      results: [
        {
          watchId: 'watch-1',
          name: 'token',
          expression: 'token',
          value: 'abc',
          error: null,
          valueChanged: true,
          timestamp: 1,
        },
      ],
    });
  });

  it('returns a structured error when clearing watches fails', async () => {
    watchManager.clearAll.mockImplementationOnce(() => {
      throw new Error('clear failed');
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = new WatchExpressionsHandlers({ debuggerManager } as any);

    const body = parseJson<any>(await handlers.handleWatchClearAll({}));

    expect(body).toEqual({
      success: false,
      message: 'Failed to clear watch expressions',
      error: 'clear failed',
    });
  });
});
