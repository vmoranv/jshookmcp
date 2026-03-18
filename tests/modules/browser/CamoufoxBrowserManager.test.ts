import { beforeEach, describe, expect, it, vi } from 'vitest';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const camoufoxLaunchMock = vi.hoisted(() => vi.fn());
const camoufoxServerLaunchMock = vi.hoisted(() => vi.fn());

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('camoufox-js', () => ({
  Camoufox: (...args: any[]) => camoufoxLaunchMock(...args),
  launchServer: (...args: any[]) => camoufoxServerLaunchMock(...args),
}));

import { CamoufoxBrowserManager } from '@modules/browser/CamoufoxBrowserManager';

describe('CamoufoxBrowserManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the same launch promise for concurrent launch calls', async () => {
    const deferred = createDeferred<any>();
    const fakeBrowser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
    };
    camoufoxLaunchMock.mockReturnValue(deferred.promise);

    const manager = new CamoufoxBrowserManager();
    const firstLaunch = manager.launch();
    const secondLaunch = manager.launch();

    await vi.waitFor(() => {
      expect(camoufoxLaunchMock).toHaveBeenCalledTimes(1);
    });

    deferred.resolve(fakeBrowser);

    await expect(Promise.all([firstLaunch, secondLaunch])).resolves.toEqual([
      fakeBrowser,
      fakeBrowser,
    ]);
  });

  it('returns from close while launch is still pending and closes once launch settles', async () => {
    const deferred = createDeferred<any>();
    const fakeBrowser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
    };
    camoufoxLaunchMock.mockReturnValue(deferred.promise);

    const manager = new CamoufoxBrowserManager();
    const launchPromise = manager.launch();

    await vi.waitFor(() => {
      expect(camoufoxLaunchMock).toHaveBeenCalledTimes(1);
    });

    const closeResult = await Promise.race([
      manager.close().then(() => 'closed'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ]);

    expect(closeResult).toBe('closed');

    deferred.resolve(fakeBrowser);

    await expect(launchPromise).rejects.toThrow(/close/i);
    await vi.waitFor(() => {
      expect(fakeBrowser.close).toHaveBeenCalledTimes(1);
    });
  });
});
