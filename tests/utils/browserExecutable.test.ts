import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsSyncMock = vi.fn();
const executablePathMock = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => existsSyncMock(...args),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    executablePath: (...args: any[]) => executablePathMock(...args),
  },
}));

async function loadModule() {
  return import('../../src/utils/browserExecutable.js');
}

describe('browserExecutable utils', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.CHROME_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.BROWSER_EXECUTABLE_PATH;
  });

  it('resolves from CHROME_PATH when file exists', async () => {
    process.env.CHROME_PATH = '/chrome';
    existsSyncMock.mockImplementation((p: string) => p === '/chrome');

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBe('/chrome');
  });

  it('falls back to puppeteer executable path when env missing', async () => {
    executablePathMock.mockReturnValue('/managed-chrome');
    existsSyncMock.mockImplementation((p: string) => p === '/managed-chrome');

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBe('/managed-chrome');
  });

  it('returns undefined when no executable is available', async () => {
    executablePathMock.mockReturnValue('/none');
    existsSyncMock.mockReturnValue(false);

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBeUndefined();
  });

  it('uses cache on repeated calls', async () => {
    process.env.CHROME_PATH = '/cached';
    existsSyncMock.mockImplementation((p: string) => p === '/cached');

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBe('/cached');
    expect(findBrowserExecutable()).toBe('/cached');
    expect(existsSyncMock).toHaveBeenCalledTimes(2);
  });

  it('clearBrowserPathCache forces re-resolution', async () => {
    process.env.CHROME_PATH = '/first';
    existsSyncMock.mockImplementation((p: string) => p === '/first' || p === '/second');

    const mod = await loadModule();
    expect(mod.findBrowserExecutable()).toBe('/first');

    process.env.CHROME_PATH = '/second';
    mod.clearBrowserPathCache();
    expect(mod.findBrowserExecutable()).toBe('/second');
  });

  it('re-resolves when cached path no longer exists', async () => {
    process.env.CHROME_PATH = '/stale';
    executablePathMock.mockReturnValue('/fresh');
    existsSyncMock
      .mockReturnValueOnce(true) // first CHROME_PATH check
      .mockReturnValueOnce(false) // cached path re-check
      .mockReturnValueOnce(false) // CHROME_PATH check after cache reset
      .mockReturnValueOnce(true); // puppeteer path check

    const mod = await loadModule();
    expect(mod.findBrowserExecutable()).toBe('/stale');
    expect(mod.findBrowserExecutable()).toBe('/fresh');
  });
});

