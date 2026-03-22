import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsSyncMock = vi.fn();
const executablePathMock = vi.fn();

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('fs', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  existsSync: (...args: any[]) => existsSyncMock(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    executablePath: (...args: any[]) => executablePathMock(...args),
  },
}));

async function loadModule() {
  return import('@utils/browserExecutable');
}

describe('browserExecutable utils', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.BROWSER_EXECUTABLE_PATH;
  });

  it('resolves from BROWSER_EXECUTABLE_PATH when file exists', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/browser-bin';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    existsSyncMock.mockImplementation((p: string) => p === '/browser-bin');

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBe('/browser-bin');
  });

  it('falls back to puppeteer executable path when env missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    executablePathMock.mockReturnValue('/managed-browser-bin');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    existsSyncMock.mockImplementation((p: string) => p === '/managed-browser-bin');

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBe('/managed-browser-bin');
  });

  it('returns undefined when no executable is available', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    executablePathMock.mockReturnValue('/none');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    existsSyncMock.mockReturnValue(false);

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBeUndefined();
  });

  it('uses cache on repeated calls', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/cached-browser';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    existsSyncMock.mockImplementation((p: string) => p === '/cached-browser');

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBe('/cached-browser');
    expect(findBrowserExecutable()).toBe('/cached-browser');
    expect(existsSyncMock).toHaveBeenCalledTimes(2);
  });

  it('clearBrowserPathCache forces re-resolution', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/first-browser';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    existsSyncMock.mockImplementation(
      (p: string) => p === '/first-browser' || p === '/second-browser'
    );

    const mod = await loadModule();
    expect(mod.findBrowserExecutable()).toBe('/first-browser');

    process.env.BROWSER_EXECUTABLE_PATH = '/second-browser';
    mod.clearBrowserPathCache();
    expect(mod.findBrowserExecutable()).toBe('/second-browser');
  });

  it('re-resolves when cached path no longer exists', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/stale-browser';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    executablePathMock.mockReturnValue('/fresh-browser');
    existsSyncMock
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockReturnValueOnce(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockReturnValueOnce(false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockReturnValueOnce(false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockReturnValueOnce(true);

    const mod = await loadModule();
    expect(mod.findBrowserExecutable()).toBe('/stale-browser');
    expect(mod.findBrowserExecutable()).toBe('/fresh-browser');
  });
});
