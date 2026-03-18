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
    location: ['location.href'],
    screen: ['screen.width'],
    other: ['custom.var'],
  };
}

function createEmptyDetected() {
  return {
    window: [],
    document: [],
    navigator: [],
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

describe('EnvironmentEmulatorFetch – additional coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => fn.mockReset());
    puppeteerState.launch.mockReset();
  });

  // ─── browser launch scenarios ─────────────────────────────────────

  describe('browser launch', () => {
    it('launches without executablePath when resolveExecutablePath returns undefined', async () => {
      const page = createPage({ 'window.innerWidth': 1920 });
      const browser = createBrowser(page);
      puppeteerState.launch.mockResolvedValue(browser);

      await fetchRealEnvironmentData({
        url: 'https://example.com',
        detected: createDetected(),
        depth: 2,
        resolveExecutablePath: () => undefined,
        buildManifestFromTemplate: vi.fn(),
      });

      const launchArgs = puppeteerState.launch.mock.calls[0]![0];
      expect(launchArgs.executablePath).toBeUndefined();
      expect(launchArgs.headless).toBe(true);
      expect(launchArgs.args).toContain('--no-sandbox');
    });

    it('launches with executablePath when resolveExecutablePath returns a path', async () => {
      const page = createPage({ 'window.innerWidth': 1920 });
      const browser = createBrowser(page);
      puppeteerState.launch.mockResolvedValue(browser);

      await fetchRealEnvironmentData({
        url: 'https://example.com',
        detected: createDetected(),
        depth: 2,
        resolveExecutablePath: () => '/usr/bin/chromium',
        buildManifestFromTemplate: vi.fn(),
      });

      const launchArgs = puppeteerState.launch.mock.calls[0]![0];
      expect(launchArgs.executablePath).toBe('/usr/bin/chromium');
    });

    it('does not call puppeteer.launch when browser is provided', async () => {
      const page = createPage({ 'window.innerWidth': 1920 });
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 2,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(puppeteerState.launch).not.toHaveBeenCalled();
    });
  });

  // ─── page configuration ───────────────────────────────────────────

  describe('page configuration', () => {
    it('sets a Chrome-like user agent', async () => {
      const page = createPage({});
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createEmptyDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome/120.0.0.0'));
    });

    it('calls evaluateOnNewDocument for stealth injection', async () => {
      const page = createPage({});
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createEmptyDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });

    it('navigates to the provided URL with networkidle2 and timeout', async () => {
      const page = createPage({});
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://target-site.com/page',
        detected: createEmptyDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(page.goto).toHaveBeenCalledWith('https://target-site.com/page', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
    });
  });

  // ─── data extraction ──────────────────────────────────────────────

  describe('data extraction', () => {
    it('passes all detected paths concatenated to page.evaluate', async () => {
      const detected = {
        window: ['window.innerWidth', 'window.outerWidth'],
        document: ['document.title'],
        navigator: ['navigator.userAgent'],
        location: ['location.href'],
        screen: ['screen.width'],
        other: ['custom.prop'],
      };

      const page = createPage({
        'window.innerWidth': 1920,
        'window.outerWidth': 1920,
        'document.title': 'Test',
        'navigator.userAgent': 'Mozilla',
        'location.href': 'https://test.com',
        'screen.width': 1920,
        'custom.prop': 'value',
      });
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected,
        depth: 3,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      // Verify evaluate was called with paths array and depth
      expect(page.evaluate).toHaveBeenCalledTimes(1);
      const evaluateArgs = page.evaluate.mock.calls[0]!;
      expect(evaluateArgs[1]).toEqual([
        'window.innerWidth',
        'window.outerWidth',
        'document.title',
        'navigator.userAgent',
        'location.href',
        'screen.width',
        'custom.prop',
      ]);
      expect(evaluateArgs[2]).toBe(3);

      // Verify all values made it into the manifest
      expect(result.manifest['window.innerWidth']).toBe(1920);
      expect(result.manifest['document.title']).toBe('Test');
      expect(result.manifest['custom.prop']).toBe('value');
    });

    it('handles empty detected arrays gracefully', async () => {
      const page = createPage({});
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createEmptyDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(page.evaluate).toHaveBeenCalledTimes(1);
      const evaluateArgs = page.evaluate.mock.calls[0]!;
      expect(evaluateArgs[1]).toEqual([]);
      expect(result.manifest).toEqual({});
    });

    it('merges extracted values into manifest object', async () => {
      const page = createPage({
        'window.innerWidth': 1920,
        'navigator.userAgent': 'Chrome',
        'screen.width': 2560,
      });
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 2,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.manifest).toEqual({
        'window.innerWidth': 1920,
        'navigator.userAgent': 'Chrome',
        'screen.width': 2560,
      });
    });

    it('returns the browser reference in the result', async () => {
      const page = createPage({});
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createEmptyDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.browser).toBe(browser);
    });
  });

  // ─── error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    it('falls back to template manifest when page.goto fails', async () => {
      const page = createPage({});
      page.goto.mockRejectedValueOnce(new Error('Navigation timeout'));
      const browser = createBrowser(page);
      const buildManifestFromTemplate = vi.fn(() => ({ fallbackKey: 'val' }));

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate,
      });

      expect(buildManifestFromTemplate).toHaveBeenCalledWith(createDetected(), 'chrome');
      expect(result.manifest).toEqual({ fallbackKey: 'val' });
      expect(loggerState.warn).toHaveBeenCalledWith(
        'Variable extraction failed',
        expect.any(Error)
      );
    });

    it('falls back to template manifest when page.evaluate throws', async () => {
      const page = createPage({});
      page.evaluate.mockRejectedValueOnce(new Error('evaluate error'));
      const browser = createBrowser(page);
      const buildManifestFromTemplate = vi.fn(() => ({ tmpl: true }));

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate,
      });

      expect(buildManifestFromTemplate).toHaveBeenCalledWith(createDetected(), 'chrome');
      expect(result.manifest).toEqual({ tmpl: true });
    });

    it('falls back to template manifest when newPage fails', async () => {
      const browser = {
        newPage: vi.fn().mockRejectedValue(new Error('newPage failed')),
      };
      const buildManifestFromTemplate = vi.fn(() => ({ fromTemplate: true }));

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate,
      });

      expect(buildManifestFromTemplate).toHaveBeenCalledWith(createDetected(), 'chrome');
      expect(result.manifest).toEqual({ fromTemplate: true });
    });

    it('falls back to template manifest when puppeteer.launch fails', async () => {
      puppeteerState.launch.mockRejectedValueOnce(new Error('launch failed'));
      const buildManifestFromTemplate = vi.fn(() => ({ launchFailed: true }));

      const result = await fetchRealEnvironmentData({
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: () => '/usr/bin/chrome',
        buildManifestFromTemplate,
      });

      expect(buildManifestFromTemplate).toHaveBeenCalledWith(createDetected(), 'chrome');
      expect(result.manifest).toEqual({ launchFailed: true });
    });
  });

  // ─── page cleanup ─────────────────────────────────────────────────

  describe('page cleanup', () => {
    it('always closes the page on success', async () => {
      const page = createPage({ key: 'val' });
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(page.close).toHaveBeenCalledTimes(1);
    });

    it('closes the page even when evaluate throws', async () => {
      const page = createPage({});
      page.evaluate.mockRejectedValueOnce(new Error('boom'));
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(() => ({})),
      });

      expect(page.close).toHaveBeenCalledTimes(1);
    });

    it('does not throw if page.close itself fails', async () => {
      const page = createPage({ key: 'val' });
      page.close.mockRejectedValueOnce(new Error('close failed'));
      const browser = createBrowser(page);

      // Should not throw
      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.manifest).toEqual({ key: 'val' });
    });

    it('does not attempt to close page when newPage fails (page is undefined)', async () => {
      const browser = {
        newPage: vi.fn().mockRejectedValue(new Error('newPage failed')),
      };

      // Should not throw - page will be undefined, so finally should handle gracefully
      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(() => ({ safe: true })),
      });

      expect(result.manifest).toEqual({ safe: true });
    });
  });

  // ─── depth parameter ──────────────────────────────────────────────

  describe('depth parameter', () => {
    it('passes the depth value to page.evaluate', async () => {
      const page = createPage({});
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 5,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      const evaluateArgs = page.evaluate.mock.calls[0]!;
      expect(evaluateArgs[2]).toBe(5);
    });

    it('works with depth 0', async () => {
      const page = createPage({});
      const browser = createBrowser(page);

      await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 0,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(),
      });

      const evaluateArgs = page.evaluate.mock.calls[0]!;
      expect(evaluateArgs[2]).toBe(0);
    });
  });

  // ─── launch args ──────────────────────────────────────────────────

  describe('launch args', () => {
    it('passes security-hardened launch args when launching browser', async () => {
      const page = createPage({});
      const browser = createBrowser(page);
      puppeteerState.launch.mockResolvedValue(browser);

      await fetchRealEnvironmentData({
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: () => '/chrome',
        buildManifestFromTemplate: vi.fn(),
      });

      const launchArgs = puppeteerState.launch.mock.calls[0]![0];
      expect(launchArgs.args).toContain('--no-sandbox');
      expect(launchArgs.args).toContain('--disable-setuid-sandbox');
      expect(launchArgs.args).toContain('--disable-blink-features=AutomationControlled');
      expect(launchArgs.args).toContain('--disable-extensions');
      expect(launchArgs.args).toContain('--disable-gpu');
      expect(launchArgs.args).toContain('--no-first-run');
      expect(launchArgs.args).toContain('--no-zygote');
    });
  });

  // ─── returned browser reference ───────────────────────────────────

  describe('returned browser reference', () => {
    it('returns newly-launched browser when none was provided', async () => {
      const page = createPage({});
      const browser = createBrowser(page);
      puppeteerState.launch.mockResolvedValue(browser);

      const result = await fetchRealEnvironmentData({
        url: 'https://example.com',
        detected: createEmptyDetected(),
        depth: 1,
        resolveExecutablePath: () => undefined,
        buildManifestFromTemplate: vi.fn(),
      });

      expect(result.browser).toBe(browser);
    });

    it('returns provided browser in error fallback path', async () => {
      const page = createPage({});
      page.goto.mockRejectedValueOnce(new Error('nav error'));
      const browser = createBrowser(page);

      const result = await fetchRealEnvironmentData({
        browser: browser as any,
        url: 'https://example.com',
        detected: createDetected(),
        depth: 1,
        resolveExecutablePath: vi.fn(),
        buildManifestFromTemplate: vi.fn(() => ({})),
      });

      expect(result.browser).toBe(browser);
    });
  });
});
