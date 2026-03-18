import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const puppeteerState = vi.hoisted(() => ({
  launch: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    launch: puppeteerState.launch,
  },
}));

import { fetchRealEnvironmentData } from '@modules/emulator/EnvironmentEmulatorFetch';

function createDetected() {
  return {
    window: ['window.innerWidth'],
    document: ['document.title'],
    navigator: ['navigator.userAgent'],
    location: [],
    screen: [],
    other: [],
  };
}

function createPage(extractedValues: Record<string, unknown>) {
  return {
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(extractedValues),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createBrowser(page: ReturnType<typeof createPage>) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
  };
}

describe('EnvironmentEmulatorFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => fn.mockReset());
    puppeteerState.launch.mockReset();
  });

  it('launches a browser when none is provided and merges extracted values into the manifest', async () => {
    const page = createPage({
      'window.innerWidth': 1920,
      'document.title': 'Example',
    });
    const browser = createBrowser(page);
    const resolveExecutablePath = vi.fn(() => 'C:/Browsers/chrome.exe');
    const buildManifestFromTemplate = vi.fn();

    puppeteerState.launch.mockResolvedValue(browser);

    const result = await fetchRealEnvironmentData({
      url: 'https://example.com',
      detected: createDetected(),
      depth: 2,
      resolveExecutablePath,
      buildManifestFromTemplate,
    });

    expect(resolveExecutablePath).toHaveBeenCalledTimes(1);
    expect(puppeteerState.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        executablePath: 'C:/Browsers/chrome.exe',
      })
    );
    expect(browser.newPage).toHaveBeenCalledTimes(1);
    expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/120.0.0.0'));
    expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(buildManifestFromTemplate).not.toHaveBeenCalled();
    expect(result).toEqual({
      manifest: {
        'window.innerWidth': 1920,
        'document.title': 'Example',
      },
      browser,
    });
  });

  it('reuses a provided browser without launching a new one', async () => {
    const page = createPage({
      'navigator.userAgent': 'Mozilla/5.0',
    });
    const browser = createBrowser(page);

    const result = await fetchRealEnvironmentData({
      browser: browser as any,
      url: 'https://example.com',
      detected: createDetected(),
      depth: 1,
      resolveExecutablePath: vi.fn(() => 'ignored'),
      buildManifestFromTemplate: vi.fn(() => ({ fallback: true })),
    });

    expect(puppeteerState.launch).not.toHaveBeenCalled();
    expect(browser.newPage).toHaveBeenCalledTimes(1);
    expect(result.browser).toBe(browser);
    expect(result.manifest).toEqual({
      'navigator.userAgent': 'Mozilla/5.0',
    });
  });

  it('falls back to the template manifest when extraction fails and still closes the page', async () => {
    const page = createPage({});
    page.evaluate.mockRejectedValueOnce(new Error('evaluate failed'));
    const browser = createBrowser(page);
    const buildManifestFromTemplate = vi.fn(() => ({ fallback: true }));

    const result = await fetchRealEnvironmentData({
      browser: browser as any,
      url: 'https://example.com',
      detected: createDetected(),
      depth: 1,
      resolveExecutablePath: vi.fn(),
      buildManifestFromTemplate,
    });

    expect(buildManifestFromTemplate).toHaveBeenCalledWith(createDetected(), 'chrome');
    expect(page.close).toHaveBeenCalledTimes(1);
    expect(loggerState.warn).toHaveBeenCalledWith('Variable extraction failed', expect.any(Error));
    expect(result).toEqual({
      manifest: { fallback: true },
      browser,
    });
  });
});
