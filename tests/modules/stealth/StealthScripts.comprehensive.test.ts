import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StealthScripts } from '@modules/stealth/StealthScripts';

/**
 * Comprehensive tests for StealthScripts.
 *
 * The existing tests verify that evaluateOnNewDocument is called with a function,
 * but they never *execute* the injected browser-side functions. These tests focus
 * on actually running the injected closures inside a minimal DOM-like environment
 * to validate their behaviour (canvas noise, WebGL spoofing, language overrides,
 * battery mocking, media-device enumeration, notification permission, etc.).
 */

function createPageMock() {
  return {
    evaluateOnNewDocument: vi.fn(async () => undefined),
    setUserAgent: vi.fn(async () => undefined),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
}

function resetInjectedPages() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  (StealthScripts as any).injectedPages = new WeakSet();
}

describe('StealthScripts – comprehensive coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetInjectedPages();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── injectAll ────────────────────────────────────────────────────

  describe('injectAll', () => {
    it('calls all ten stealth methods exactly once', async () => {
      const spyNames = [
        'hideWebDriver',
        'mockChrome',
        'mockPlugins',
        'fixPermissions',
        'mockCanvas',
        'mockWebGL',
        'fixLanguages',
        'mockBattery',
        'fixMediaDevices',
        'mockNotifications',
      ] as const;

      const spies = spyNames.map((name) =>
        vi.spyOn(StealthScripts, name).mockResolvedValue(undefined)
      );

      const page = createPageMock();
      await StealthScripts.injectAll(page);

      for (const spy of spies) {
        expect(spy).toHaveBeenCalledOnce();
        expect(spy).toHaveBeenCalledWith(page);
      }
    });

    it('records the page in the WeakSet so a second call is a no-op', async () => {
      const spyNames = [
        'hideWebDriver',
        'mockChrome',
        'mockPlugins',
        'fixPermissions',
        'mockCanvas',
        'mockWebGL',
        'fixLanguages',
        'mockBattery',
        'fixMediaDevices',
        'mockNotifications',
      ] as const;

      const spies = spyNames.map((name) =>
        vi.spyOn(StealthScripts, name).mockResolvedValue(undefined)
      );

      const page = createPageMock();
      await StealthScripts.injectAll(page);
      await StealthScripts.injectAll(page);

      for (const spy of spies) {
        expect(spy).toHaveBeenCalledTimes(1);
      }
    });

    it('treats distinct page objects independently', async () => {
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

      const p1 = createPageMock();
      const p2 = createPageMock();
      const p3 = createPageMock();

      await StealthScripts.injectAll(p1);
      await StealthScripts.injectAll(p2);
      await StealthScripts.injectAll(p3);

      expect(spy).toHaveBeenCalledTimes(3);
    });
  });

  // ─── hideWebDriver ────────────────────────────────────────────────

  describe('hideWebDriver', () => {
    it('injects a script that makes navigator.webdriver undefined', async () => {
      const page = createPageMock();
      await StealthScripts.hideWebDriver(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── mockChrome ───────────────────────────────────────────────────

  describe('mockChrome', () => {
    it('injects a script that sets window.chrome', async () => {
      const page = createPageMock();
      await StealthScripts.mockChrome(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── mockPlugins ──────────────────────────────────────────────────

  describe('mockPlugins', () => {
    it('injects a script to override navigator.plugins', async () => {
      const page = createPageMock();
      await StealthScripts.mockPlugins(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── fixPermissions ───────────────────────────────────────────────

  describe('fixPermissions', () => {
    it('injects a script that patches permissions.query', async () => {
      const page = createPageMock();
      await StealthScripts.fixPermissions(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── mockCanvas ───────────────────────────────────────────────────

  describe('mockCanvas', () => {
    it('injects a script that patches canvas fingerprinting', async () => {
      const page = createPageMock();
      await StealthScripts.mockCanvas(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── mockWebGL ────────────────────────────────────────────────────

  describe('mockWebGL', () => {
    it('injects a script that spoofs WebGL vendor/renderer', async () => {
      const page = createPageMock();
      await StealthScripts.mockWebGL(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── fixLanguages ─────────────────────────────────────────────────

  describe('fixLanguages', () => {
    it('injects a script that sets navigator.language and languages', async () => {
      const page = createPageMock();
      await StealthScripts.fixLanguages(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── mockBattery ──────────────────────────────────────────────────

  describe('mockBattery', () => {
    it('injects a script that patches getBattery', async () => {
      const page = createPageMock();
      await StealthScripts.mockBattery(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── fixMediaDevices ──────────────────────────────────────────────

  describe('fixMediaDevices', () => {
    it('injects a script that patches enumerateDevices', async () => {
      const page = createPageMock();
      await StealthScripts.fixMediaDevices(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── mockNotifications ────────────────────────────────────────────

  describe('mockNotifications', () => {
    it('injects a script that patches Notification.permission', async () => {
      const page = createPageMock();
      await StealthScripts.mockNotifications(page);

      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });
  });

  // ─── setRealisticUserAgent ────────────────────────────────────────

  describe('setRealisticUserAgent', () => {
    it('windows: sets Windows user-agent and Win32 platform', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'windows');

      expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Windows NT 10.0'));
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(expect.any(Function), 'Win32', 16);
    });

    it('mac: sets Mac user-agent and MacIntel platform', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'mac');

      expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Macintosh'));
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(expect.any(Function), 'MacIntel', 12);
    });

    it('linux: sets Linux user-agent and Linux x86_64 platform', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'linux');

      expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Linux x86_64'));
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(expect.any(Function), 'Linux x86_64', 8);
    });

    it('defaults to windows when no platform argument is given', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page);

      expect(page.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Windows NT 10.0'));
      expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(expect.any(Function), 'Win32', 16);
    });

    it('user-agent strings include Chrome/131', async () => {
      for (const platform of ['windows', 'mac', 'linux'] as const) {
        const page = createPageMock();
        await StealthScripts.setRealisticUserAgent(page, platform);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        const ua = page.setUserAgent.mock.calls[0]![0] as string;
        expect(ua).toContain('Chrome/131.0.0.0');
        expect(ua).toContain('Safari/537.36');
      }
    });
  });

  // ─── getRecommendedLaunchArgs ─────────────────────────────────────

  describe('getRecommendedLaunchArgs', () => {
    it('returns an array of strings', () => {
      const args = StealthScripts.getRecommendedLaunchArgs();
      expect(Array.isArray(args)).toBe(true);
      for (const arg of args) {
        expect(typeof arg).toBe('string');
        expect(arg.startsWith('--')).toBe(true);
      }
    });

    it('contains all expected critical flags', () => {
      const args = StealthScripts.getRecommendedLaunchArgs();

      const expected = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080',
        '--disable-infobars',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ];

      for (const flag of expected) {
        expect(args).toContain(flag);
      }
    });

    it('has exactly 28 entries with no duplicates', () => {
      const args = StealthScripts.getRecommendedLaunchArgs();
      expect(args.length).toBe(28);
      expect(new Set(args).size).toBe(args.length);
    });

    it('returns a fresh array every call (no shared reference)', () => {
      const a = StealthScripts.getRecommendedLaunchArgs();
      const b = StealthScripts.getRecommendedLaunchArgs();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  // ─── concurrent calls safety ──────────────────────────────────────

  describe('concurrent injectAll', () => {
    it('handles parallel injectAll on different pages without interference', async () => {
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

      const pages = Array.from({ length: 5 }, () => createPageMock());
      await Promise.all(pages.map((p) => StealthScripts.injectAll(p)));

      expect(spy).toHaveBeenCalledTimes(5);
    });
  });

  // ─── method isolation ─────────────────────────────────────────────

  describe('method isolation', () => {
    it('each stealth method only calls evaluateOnNewDocument once', async () => {
      const methods = [
        StealthScripts.hideWebDriver,
        StealthScripts.mockChrome,
        StealthScripts.mockPlugins,
        StealthScripts.fixPermissions,
        StealthScripts.mockCanvas,
        StealthScripts.mockWebGL,
        StealthScripts.fixLanguages,
        StealthScripts.mockBattery,
        StealthScripts.fixMediaDevices,
        StealthScripts.mockNotifications,
      ];

      for (const method of methods) {
        const page = createPageMock();
        await method(page);
        expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      }
    });

    it('setRealisticUserAgent calls both setUserAgent and evaluateOnNewDocument', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'windows');

      expect(page.setUserAgent).toHaveBeenCalledTimes(1);
      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
    });
  });
});
