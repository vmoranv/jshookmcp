import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CamoufoxBrowserManager } from '@modules/browser/CamoufoxBrowserManager';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  success: vi.fn(),
}));

const camoufoxLaunchMock = vi.hoisted(() => vi.fn());
const camoufoxServerLaunchMock = vi.hoisted(() => vi.fn());

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('camoufox-js', () => ({
  Camoufox: camoufoxLaunchMock,
  launchServer: camoufoxServerLaunchMock,
}));

describe('CamoufoxBrowserManager bug fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('close() also closes a running browser server', async () => {
    const server = {
      wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/x'),
      close: vi.fn(async () => {}),
    };
    camoufoxServerLaunchMock.mockResolvedValue(server);

    const manager = new CamoufoxBrowserManager();
    await manager.launchAsServer();

    await manager.close();

    expect(server.close).toHaveBeenCalled();
    expect(manager.getBrowserServerEndpoint()).toBeNull();
  });

  it('close() closes browser and server together when both are active', async () => {
    const browser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
    };
    const server = {
      wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/x'),
      close: vi.fn(async () => {}),
    };
    camoufoxLaunchMock.mockResolvedValue(browser);
    camoufoxServerLaunchMock.mockResolvedValue(server);

    const manager = new CamoufoxBrowserManager();
    await manager.launch();
    await manager.launchAsServer();

    await manager.close();

    expect(browser.close).toHaveBeenCalled();
    expect(server.close).toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CamoufoxBrowserManager teardown ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('still closes the server when the browser close fails, and reports the failure', async () => {
    const browser = {
      newPage: vi.fn(),
      close: vi.fn(async () => {
        throw new Error('browser close failed');
      }),
      isConnected: vi.fn(() => true),
    };
    const server = {
      wsEndpoint: vi.fn(() => 'ws://127.0.0.1:8888/x'),
      close: vi.fn(async () => {}),
    };
    camoufoxLaunchMock.mockResolvedValue(browser);
    camoufoxServerLaunchMock.mockResolvedValue(server);

    const manager = new CamoufoxBrowserManager();
    await manager.launch();
    await manager.launchAsServer();

    await expect(manager.close()).rejects.toThrow('browser close failed');
    // The server teardown must not be skipped by the browser failure.
    expect(server.close).toHaveBeenCalled();
    expect(manager.getBrowserServerEndpoint()).toBeNull();
  });

  it('closes a server that finishes launching after close() already completed', async () => {
    const gate = deferred<{ wsEndpoint: () => string; close: () => Promise<void> }>();
    camoufoxServerLaunchMock.mockReturnValue(gate.promise);

    const manager = new CamoufoxBrowserManager();
    const launchPromise = manager.launchAsServer();
    await vi.waitFor(() => {
      expect(camoufoxServerLaunchMock).toHaveBeenCalledTimes(1);
    });

    // No browser and no in-flight launch(): close() completes immediately and
    // resets isClosing, so the epoch has to catch the post-close assignment.
    await manager.close();

    const server = { wsEndpoint: () => 'ws://127.0.0.1:9999/x', close: vi.fn(async () => {}) };
    gate.resolve(server);

    await expect(launchPromise).rejects.toThrow(/close was requested/);
    expect(server.close).toHaveBeenCalled();
    expect(manager.getBrowserServerEndpoint()).toBeNull();
  });

  it('newPage() relaunches when the cached browser is disconnected', async () => {
    const page = { goto: vi.fn(), context: vi.fn() };
    const fresh = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
    };
    camoufoxLaunchMock.mockResolvedValue(fresh);

    const manager = new CamoufoxBrowserManager();
    Reflect.set(manager as object, 'browser', {
      newPage: vi.fn(),
      close: vi.fn(async () => {}),
      isConnected: () => false,
    });

    await expect(manager.newPage()).resolves.toBe(page);
    expect(fresh.newPage).toHaveBeenCalledTimes(1);
  });
});
