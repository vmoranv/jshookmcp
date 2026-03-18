import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StealthScripts } from '@modules/stealth/StealthScripts';

function createPageMock() {
  return {
    evaluateOnNewDocument: vi.fn(async (_fn: Function, ..._args: any[]) => undefined),
    setUserAgent: vi.fn(async () => undefined),
  } as any;
}

function resetInjectedPages() {
  (StealthScripts as any).injectedPages = new WeakSet();
}

function getInjectedFn(page: any): { fn: Function; extraArgs: any[] } {
  const call = page.evaluateOnNewDocument.mock.calls[0]!;
  return { fn: call[0] as Function, extraArgs: call.slice(1) };
}

describe('StealthScripts injected browser-side scripts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetInjectedPages();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hideWebDriver injected script', () => {
    it('patches Object.getOwnPropertyNames to filter webdriver', async () => {
      const page = createPageMock();
      await StealthScripts.hideWebDriver(page);
      const { fn } = getInjectedFn(page);
      const orig = Object.getOwnPropertyNames;
      expect(() => fn()).not.toThrow();
      const props = Object.getOwnPropertyNames({ webdriver: true, foo: 'bar' });
      expect(props).not.toContain('webdriver');
      expect(props).toContain('foo');
      Object.getOwnPropertyNames = orig;
    });
  });

  describe('mockChrome injected script', () => {
    it('sets window.chrome with runtime loadTimes csi', async () => {
      const page = createPageMock();
      await StealthScripts.mockChrome(page);
      const { fn } = getInjectedFn(page);
      const ow = (globalThis as any).window;
      (globalThis as any).window = {};
      try {
        fn();
        const win = (globalThis as any).window;
        expect(win.chrome).toBeDefined();
        expect(typeof win.chrome.runtime.connect).toBe('function');
        expect(typeof win.chrome.runtime.sendMessage).toBe('function');
        expect(typeof win.chrome.runtime.onMessage.addListener).toBe('function');
        const lt = win.chrome.loadTimes();
        expect(lt).toHaveProperty('connectionInfo', 'http/1.1');
        expect(lt).toHaveProperty('navigationType', 'Other');
        expect(lt).toHaveProperty('wasAlternateProtocolAvailable', false);
        const cs = win.chrome.csi();
        expect(cs).toHaveProperty('tran', 15);
        expect(typeof cs.onloadT).toBe('number');
        expect(win.chrome.app).toEqual({});
      } finally {
        if (ow === undefined) delete (globalThis as any).window;
        else (globalThis as any).window = ow;
      }
    });
  });

  describe('mockPlugins injected script', () => {
    it('overrides navigator.plugins with 3 entries', async () => {
      const page = createPageMock();
      await StealthScripts.mockPlugins(page);
      getInjectedFn(page).fn();
      const d = Object.getOwnPropertyDescriptor(navigator, 'plugins');
      if (d?.get) {
        const plugins = d.get();
        expect(plugins).toHaveLength(3);
        expect(plugins[0].name).toBe('Chrome PDF Plugin');
        expect(plugins[1].name).toBe('Chrome PDF Viewer');
        expect(plugins[2].name).toBe('Native Client');
      }
    });
  });

  describe('fixLanguages injected script', () => {
    it('overrides navigator.language and languages', async () => {
      const page = createPageMock();
      await StealthScripts.fixLanguages(page);
      getInjectedFn(page).fn();
      const ld = Object.getOwnPropertyDescriptor(navigator, 'language');
      if (ld?.get) expect(ld.get()).toBe('en-US');
      const lsd = Object.getOwnPropertyDescriptor(navigator, 'languages');
      if (lsd?.get) expect(lsd.get()).toEqual(['en-US', 'en']);
    });
  });

  describe('mockBattery injected script', () => {
    it('does not throw when getBattery does not exist', async () => {
      const page = createPageMock();
      await StealthScripts.mockBattery(page);
      expect(() => getInjectedFn(page).fn()).not.toThrow();
    });
    it('wraps getBattery when it exists', async () => {
      const page = createPageMock();
      await StealthScripts.mockBattery(page);
      const { fn } = getInjectedFn(page);
      const orig = (navigator as any).getBattery;
      (navigator as any).getBattery = () =>
        Promise.resolve({ charging: false, chargingTime: 100, dischargingTime: 500, level: 0.5 });
      fn();
      const bat = await (navigator as any).getBattery();
      expect(bat).toBeDefined();
      if (orig) (navigator as any).getBattery = orig;
      else delete (navigator as any).getBattery;
    });
  });

  describe('mockNotifications injected script', () => {
    it('patches when Notification exists in window', async () => {
      const page = createPageMock();
      await StealthScripts.mockNotifications(page);
      const { fn } = getInjectedFn(page);
      const ow = (globalThis as any).window;
      const oNotif = (globalThis as any).Notification;
      const NotifCtor = function N() {};
      (globalThis as any).window = { Notification: NotifCtor };
      (globalThis as any).Notification = NotifCtor;
      try {
        expect(() => fn()).not.toThrow();
      } finally {
        if (ow === undefined) delete (globalThis as any).window;
        else (globalThis as any).window = ow;
        if (oNotif === undefined) delete (globalThis as any).Notification;
        else (globalThis as any).Notification = oNotif;
      }
    });
    it('does nothing when Notification not in window', async () => {
      const page = createPageMock();
      await StealthScripts.mockNotifications(page);
      const { fn } = getInjectedFn(page);
      const ow = (globalThis as any).window;
      (globalThis as any).window = {};
      try {
        expect(() => fn()).not.toThrow();
      } finally {
        if (ow === undefined) delete (globalThis as any).window;
        else (globalThis as any).window = ow;
      }
    });
  });

  describe('setRealisticUserAgent injected script', () => {
    it('overrides navigator properties for windows', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'windows');
      const { fn, extraArgs } = getInjectedFn(page);
      expect(extraArgs[0]).toBe('Win32');
      fn(extraArgs[0]);
      const pd = Object.getOwnPropertyDescriptor(navigator, 'platform');
      if (pd?.get) expect(pd.get()).toBe('Win32');
      const vd = Object.getOwnPropertyDescriptor(navigator, 'vendor');
      if (vd?.get) expect(vd.get()).toBe('Google Inc.');
      const cd = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
      if (cd?.get) expect(cd.get()).toBe(8);
      const md = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');
      if (md?.get) expect(md.get()).toBe(8);
    });
    it('sets MacIntel for mac', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'mac');
      expect(getInjectedFn(page).extraArgs[0]).toBe('MacIntel');
    });
    it('sets Linux x86_64 for linux', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'linux');
      expect(getInjectedFn(page).extraArgs[0]).toBe('Linux x86_64');
    });
  });

  describe('injectAll edge cases', () => {
    it('marks page and skips on re-call', async () => {
      const methods = [
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
      const spies = methods.map((m) => vi.spyOn(StealthScripts, m).mockResolvedValue(undefined));
      const page = createPageMock();
      await StealthScripts.injectAll(page);
      for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
      await StealthScripts.injectAll(page);
      for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    });
    it('allows injection after WeakSet reset', async () => {
      const spy = vi.spyOn(StealthScripts, 'hideWebDriver').mockResolvedValue(undefined);
      [
        'mockChrome',
        'mockPlugins',
        'fixPermissions',
        'mockCanvas',
        'mockWebGL',
        'fixLanguages',
        'mockBattery',
        'fixMediaDevices',
        'mockNotifications',
      ].forEach((m) => vi.spyOn(StealthScripts, m as any).mockResolvedValue(undefined));
      const page = createPageMock();
      await StealthScripts.injectAll(page);
      expect(spy).toHaveBeenCalledTimes(1);
      resetInjectedPages();
      await StealthScripts.injectAll(page);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('simple checks', () => {
    it('fixPermissions is a valid function', async () => {
      const p = createPageMock();
      await StealthScripts.fixPermissions(p);
      expect(typeof getInjectedFn(p).fn).toBe('function');
    });
    it('mockCanvas is a valid function', async () => {
      const p = createPageMock();
      await StealthScripts.mockCanvas(p);
      expect(typeof getInjectedFn(p).fn).toBe('function');
    });
    it('mockWebGL is a valid function', async () => {
      const p = createPageMock();
      await StealthScripts.mockWebGL(p);
      expect(typeof getInjectedFn(p).fn).toBe('function');
    });
    it('fixMediaDevices does not throw', async () => {
      const p = createPageMock();
      await StealthScripts.fixMediaDevices(p);
      expect(() => getInjectedFn(p).fn()).not.toThrow();
    });
    it('getRecommendedLaunchArgs includes critical flags', () => {
      const args = StealthScripts.getRecommendedLaunchArgs();
      expect(args).toContain('--disable-blink-features=AutomationControlled');
      expect(args).toContain('--no-first-run');
      for (const a of args) expect(a.startsWith('--')).toBe(true);
    });
  });
});
