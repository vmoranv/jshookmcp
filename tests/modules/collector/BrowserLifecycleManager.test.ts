import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrerequisiteError } from '@errors/PrerequisiteError';

const state = vi.hoisted(() => ({
  findBrowserExecutableAsync: vi.fn(async () => undefined),
}));

vi.mock('@utils/browserExecutable', () => ({
  ENV_KEYS: ['CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH', 'BROWSER_EXECUTABLE_PATH'],
  findBrowserExecutableAsync: state.findBrowserExecutableAsync,
}));

function createBrowser() {
  return {
    close: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    on: vi.fn(),
    process: vi.fn(() => ({ pid: 12345 })),
  };
}

describe('BrowserLifecycleManager idle reclamation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes a jshook-launched browser after the idle timeout', async () => {
    const { BrowserLifecycleManager } = await import('@modules/collector/BrowserLifecycleManager');
    const browser = createBrowser();
    const disconnected = vi.fn();
    const manager = new BrowserLifecycleManager(
      { headless: true, timeout: 30_000 } as any,
      { width: 1280, height: 720 },
      disconnected,
      { idleTimeoutMs: 100 },
    );
    (manager as any).browser = browser;
    (manager as any).chromePid = 12345;

    manager.touch();
    await vi.advanceTimersByTimeAsync(100);

    expect(browser.close).toHaveBeenCalledOnce();
    expect(browser.disconnect).not.toHaveBeenCalled();
    expect(manager.getBrowser()).toBeNull();
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it('disconnects rather than kills an externally attached browser', async () => {
    const { BrowserLifecycleManager } = await import('@modules/collector/BrowserLifecycleManager');
    const browser = createBrowser();
    const manager = new BrowserLifecycleManager(
      { headless: true, timeout: 30_000 } as any,
      { width: 1280, height: 720 },
      vi.fn(),
      { idleTimeoutMs: 100 },
    );
    (manager as any).browser = browser;
    (manager as any).connectedToExistingBrowser = true;

    manager.touch();
    await vi.advanceTimersByTimeAsync(100);

    expect(browser.disconnect).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('resets the idle deadline when browser activity is observed', async () => {
    const { BrowserLifecycleManager } = await import('@modules/collector/BrowserLifecycleManager');
    const browser = createBrowser();
    const manager = new BrowserLifecycleManager(
      { headless: true, timeout: 30_000 } as any,
      { width: 1280, height: 720 },
      vi.fn(),
      { idleTimeoutMs: 100 },
    );
    (manager as any).browser = browser;

    manager.touch();
    await vi.advanceTimersByTimeAsync(75);
    manager.touch();
    await vi.advanceTimersByTimeAsync(75);
    expect(browser.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    expect(browser.close).toHaveBeenCalledOnce();
  });
});

describe('BrowserLifecycleManager launch error enrichment', () => {
  const PUPPETEER_CORE_MESSAGE =
    'An `executablePath` or `channel` must be specified for `puppeteer-core`';

  /** Drive launchInner with a puppeteer whose launch() rejects with `error`. */
  async function launchWithRejectingPuppeteer(error: Error) {
    vi.doMock('rebrowser-puppeteer-core', () => ({
      default: {
        launch: vi.fn(async () => {
          throw error;
        }),
      },
    }));
    const { BrowserLifecycleManager } = await import('@modules/collector/BrowserLifecycleManager');
    const manager = new BrowserLifecycleManager(
      { headless: true, timeout: 30_000 } as any,
      { width: 1280, height: 720 },
      vi.fn(),
    );
    return manager.launch().then(
      () => {
        throw new Error('launch() should have rejected');
      },
      (e: unknown) => e,
    );
  }

  afterEach(() => {
    vi.doUnmock('rebrowser-puppeteer-core');
    vi.restoreAllMocks();
  });

  it('turns the missing-executable failure into an actionable PrerequisiteError', async () => {
    const thrown = await launchWithRejectingPuppeteer(new Error(PUPPETEER_CORE_MESSAGE));

    expect(thrown).toBeInstanceOf(PrerequisiteError);
    const message = (thrown as Error).message;
    // Says what was probed and what to do about it — the whole point, because
    // the puppeteer-core text names neither.
    expect(message).toContain('No browser executable found');
    expect(message).toContain('CHROME_PATH');
    expect(message).toContain('PUPPETEER_EXECUTABLE_PATH');
    expect(message).toContain('BROWSER_EXECUTABLE_PATH');
    expect(message).toContain('executablePath');
  });

  it('leaves an unrelated launch failure untouched', async () => {
    const original = new Error('Failed to launch the browser process: code=1');
    const thrown = await launchWithRejectingPuppeteer(original);

    // Rewriting this one would bury the real cause behind a routing hint.
    expect(thrown).toBe(original);
    expect(thrown).not.toBeInstanceOf(PrerequisiteError);
  });
});

describe('BrowserLifecycleManager concurrent dispose', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still runs the close() data-clear callback when a dispose is already in flight', async () => {
    const { BrowserLifecycleManager } = await import('@modules/collector/BrowserLifecycleManager');
    const browser = createBrowser();
    let releaseClose!: () => void;
    browser.close.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          releaseClose = () => resolve(undefined);
        }),
    );
    const manager = new BrowserLifecycleManager(
      { headless: true, timeout: 30_000 } as any,
      { width: 1280, height: 720 },
      vi.fn(),
    );
    (manager as any).browser = browser;
    (manager as any).chromePid = 12345;

    // Simulate idle reclamation starting first (it passes a no-op clear callback).
    const idleDispose = (manager as any).closeIdleBrowser() as Promise<void>;
    const clearAllData = vi.fn(async () => {});
    const closePromise = manager.close(clearAllData);

    // let disposeInner reach browser.close() before releasing it
    await Promise.resolve();
    await Promise.resolve();
    releaseClose();
    await Promise.all([idleDispose, closePromise]);

    expect(clearAllData).toHaveBeenCalledTimes(1);
  });
});
