import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StealthScripts } from '@modules/stealth/StealthScripts';

function createPageMock() {
  return {
    evaluateOnNewDocument: vi.fn(async () => undefined),
    setUserAgent: vi.fn(async () => undefined),
  } as any;
}

/**
 * Reset the private static WeakSet between tests so the idempotency guard
 * does not carry state across test cases.
 */
function resetInjectedPages() {
  (StealthScripts as any).injectedPages = new WeakSet();
}

describe('StealthScripts – additional coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetInjectedPages();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── idempotency guard ──────────────────────────────────────────────
  describe('injectAll idempotency', () => {
    it('skips injection when the same page is injected twice', async () => {
      const page = createPageMock();
      const spy = vi.spyOn(StealthScripts, 'hideWebDriver').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockChrome').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockPlugins').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'fixPermissions').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockCanvas').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockWebGL').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'fixLanguages').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockBattery').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'fixMediaDevices').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockNotifications').mockResolvedValue(undefined);

      await StealthScripts.injectAll(page);
      await StealthScripts.injectAll(page);

      // Each sub-method should only be called once despite two injectAll calls
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('injects separately for different page objects', async () => {
      const page1 = createPageMock();
      const page2 = createPageMock();
      const spy = vi.spyOn(StealthScripts, 'hideWebDriver').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockChrome').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockPlugins').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'fixPermissions').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockCanvas').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockWebGL').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'fixLanguages').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockBattery').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'fixMediaDevices').mockResolvedValue(undefined);
      vi.spyOn(StealthScripts, 'mockNotifications').mockResolvedValue(undefined);

      await StealthScripts.injectAll(page1);
      await StealthScripts.injectAll(page2);

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  // ── individual script injection methods ────────────────────────────
  describe('mockChrome', () => {
    it('calls evaluateOnNewDocument with a function', async () => {
      const page = createPageMock();
      await StealthScripts.mockChrome(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [script] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof script).toBe('function');
    });
  });

  describe('mockPlugins', () => {
    it('calls evaluateOnNewDocument with a function', async () => {
      const page = createPageMock();
      await StealthScripts.mockPlugins(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [script] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof script).toBe('function');
    });
  });

  describe('mockCanvas', () => {
    it('calls evaluateOnNewDocument with a function', async () => {
      const page = createPageMock();
      await StealthScripts.mockCanvas(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [script] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof script).toBe('function');
    });
  });

  describe('mockWebGL', () => {
    it('calls evaluateOnNewDocument with a function', async () => {
      const page = createPageMock();
      await StealthScripts.mockWebGL(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [script] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof script).toBe('function');
    });
  });

  describe('fixLanguages', () => {
    it('calls evaluateOnNewDocument with a function', async () => {
      const page = createPageMock();
      await StealthScripts.fixLanguages(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [script] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof script).toBe('function');
    });
  });

  describe('mockBattery', () => {
    it('calls evaluateOnNewDocument with a function', async () => {
      const page = createPageMock();
      await StealthScripts.mockBattery(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [script] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof script).toBe('function');
    });
  });

  describe('mockNotifications', () => {
    it('calls evaluateOnNewDocument with a function', async () => {
      const page = createPageMock();
      await StealthScripts.mockNotifications(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [script] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof script).toBe('function');
    });
  });

  // ── setRealisticUserAgent platform variants ────────────────────────
  describe('setRealisticUserAgent', () => {
    it('uses linux user agent and platform', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'linux');

      expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Linux x86_64'));
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(expect.any(Function), 'Linux x86_64');
    });

    it('passes a function and platform string to evaluateOnNewDocument', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'mac');

      const [script, platformValue] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof script).toBe('function');
      expect(platformValue).toBe('MacIntel');
    });
  });

  // ── getRecommendedLaunchArgs ───────────────────────────────────────
  describe('getRecommendedLaunchArgs', () => {
    it('returns an array with expected security-related flags', () => {
      const args = StealthScripts.getRecommendedLaunchArgs();

      expect(Array.isArray(args)).toBe(true);
      expect(args.length).toBeGreaterThan(0);
      expect(args).toContain('--disable-gpu');
      expect(args).toContain('--disable-extensions');
      expect(args).toContain('--mute-audio');
      expect(args).toContain('--disable-web-security');
      expect(args).toContain('--disable-renderer-backgrounding');
    });

    it('contains no duplicate entries', () => {
      const args = StealthScripts.getRecommendedLaunchArgs();
      expect(new Set(args).size).toBe(args.length);
    });
  });
});
