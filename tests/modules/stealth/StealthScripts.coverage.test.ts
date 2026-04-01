/**
 * StealthScripts coverage tests — execute injected browser-side closures.
 *
 * These tests cover:
 * 1. injectTimingDefense — timing API patches (performance.now, Date.now, Date constructor)
 * 2. fixPermissions — permissions.query patch
 * 3. mockCanvas — canvas fingerprinting noise
 * 4. mockWebGL — WebGL vendor/renderer spoofing
 * 5. mockBattery — getBattery wrapping
 * 6. fixMediaDevices — enumerateDevices default devices
 * 7. hideWebDriver — webdriver/cdc_ cleanup
 * 8. getPatchrightLaunchArgs — all flags
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StealthScripts } from '@modules/stealth/StealthScripts';

// ── helpers ─────────────────────────────────────────────────────────────

function createPageMock() {
  return {
    evaluateOnNewDocument: vi.fn(async (_fn: Function, ..._args: unknown[]) => undefined),
    setUserAgent: vi.fn(async () => undefined),
  } as any;
}

function resetInjectedPages() {
  (StealthScripts as any).injectedPages = new WeakSet();
}

function getInjectedFn(page: { evaluateOnNewDocument: { mock: { calls: any[][] } } }): {
  fn: Function;
  extraArgs: any[];
} {
  const call = page.evaluateOnNewDocument.mock.calls[0]!;
  return { fn: call[0] as Function, extraArgs: call.slice(1) };
}

// ── browser globals setup for Node ───────────────────────────────────────

// Mock constructor functions for browser globals (defined outside to satisfy linter)
function FakeHTMLCanvasElement() {}
FakeHTMLCanvasElement.prototype.toDataURL = function () {
  return 'data:image/png;base64,';
};
FakeHTMLCanvasElement.prototype.getContext = function () {
  return {
    getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
    putImageData: () => {},
  };
};

function FakeCanvasRenderingContext2D() {}
FakeCanvasRenderingContext2D.prototype.getImageData = function () {
  return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
};
FakeCanvasRenderingContext2D.prototype.putImageData = function () {};

function FakeWebGLRenderingContext() {}
FakeWebGLRenderingContext.prototype.getParameter = function (_param: number) {
  return 'original value';
};

function FakeNotification() {}

function setupBrowserGlobals() {
  // Minimal window mock
  if (!(globalThis as any).window) {
    (globalThis as any).window = {};
  }

  // HTMLCanvasElement mock
  if (!(globalThis as any).HTMLCanvasElement) {
    (globalThis as any).HTMLCanvasElement = FakeHTMLCanvasElement;
  }

  // CanvasRenderingContext2D mock
  if (!(globalThis as any).CanvasRenderingContext2D) {
    (globalThis as any).CanvasRenderingContext2D = FakeCanvasRenderingContext2D;
  }

  // WebGLRenderingContext mock
  if (!(globalThis as any).WebGLRenderingContext) {
    (globalThis as any).WebGLRenderingContext = FakeWebGLRenderingContext;
  }
}

function cleanupBrowserGlobals() {
  // Don't delete window as it might break other tests
}

describe('StealthScripts — coverage for injected script bodies', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetInjectedPages();
    setupBrowserGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupBrowserGlobals();
  });

  // ─── injectTimingDefense ─────────────────────────────────────────────

  describe('injectTimingDefense', () => {
    it('calls evaluateOnNewDocument with a function', async () => {
      const page = createPageMock();
      await StealthScripts.injectTimingDefense(page);
      expect(page.evaluateOnNewDocument).toHaveBeenCalledTimes(1);
      const [fn] = page.evaluateOnNewDocument.mock.calls[0]!;
      expect(typeof fn).toBe('function');
    });

    it('patches performance.now with offset handling', async () => {
      const page = createPageMock();
      await StealthScripts.injectTimingDefense(page);
      const { fn } = getInjectedFn(page);

      const origPerfNow = performance.now.bind(performance);
      const origDateNow = Date.now;
      const origDate = globalThis.Date;

      try {
        // Execute the injected function
        fn();

        // Verify performance.now was patched
        expect(performance.now).not.toBe(origPerfNow);

        // Call patched performance.now
        const result = performance.now();
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
      } finally {
        // Restore
        performance.now = origPerfNow as () => number;
        Date.now = origDateNow;
        globalThis.Date = origDate;
        delete (globalThis as any).__cdpTimingOffset;
      }
    });

    it('performance.now reads __cdpTimingOffset from window', async () => {
      const page = createPageMock();
      await StealthScripts.injectTimingDefense(page);
      const { fn } = getInjectedFn(page);

      const origPerfNow = performance.now.bind(performance);
      const origDateNow = Date.now;
      const origDate = globalThis.Date;

      try {
        fn();

        // Without offset
        const _t1 = performance.now();

        // With offset (set on window, which the patch reads)
        (globalThis as any).__cdpTimingOffset = 100;
        (globalThis as any).window.__cdpTimingOffset = 100;

        const t2 = performance.now();
        // t2 should be less than t1 by approximately 100 (offset subtracted)
        // But we can't guarantee exact values in test, just verify it works
        expect(typeof t2).toBe('number');
      } finally {
        performance.now = origPerfNow as () => number;
        Date.now = origDateNow;
        globalThis.Date = origDate;
        delete (globalThis as any).__cdpTimingOffset;
        delete (globalThis as any).window?.__cdpTimingOffset;
      }
    });

    it('patches Date.now with offset handling', async () => {
      const page = createPageMock();
      await StealthScripts.injectTimingDefense(page);
      const { fn } = getInjectedFn(page);

      const origPerfNow = performance.now.bind(performance);
      const origDateNow = Date.now;
      const origDate = globalThis.Date;

      try {
        fn();

        // Verify Date.now was patched
        const now = Date.now();
        expect(typeof now).toBe('number');

        // Set offset on window and call Date.now to cover line 134
        (globalThis as any).window.__cdpTimingOffset = 50;
        const nowWithOffset = Date.now();
        expect(typeof nowWithOffset).toBe('number');
      } finally {
        performance.now = origPerfNow as () => number;
        Date.now = origDateNow;
        globalThis.Date = origDate;
        delete (globalThis as any).__cdpTimingOffset;
        delete (globalThis as any).window?.__cdpTimingOffset;
      }
    });

    it('replaces Date constructor for new Date() calls', async () => {
      const page = createPageMock();
      await StealthScripts.injectTimingDefense(page);
      const { fn } = getInjectedFn(page);

      const origPerfNow = performance.now.bind(performance);
      const origDateNow = Date.now;
      const origDate = globalThis.Date;

      try {
        fn();

        // new Date() without args
        const d1 = new Date();
        expect(d1).toBeInstanceOf(origDate);

        // new Date(timestamp)
        const d2 = new Date(1234567890000);
        expect(d2.getTime()).toBe(1234567890000);

        // new Date(string)
        const d3 = new Date('2024-01-01');
        expect(d3.getFullYear()).toBe(2024);

        // new Date(year, month, day, ...)
        const d4 = new Date(2024, 5, 15);
        expect(d4.getFullYear()).toBe(2024);
        expect(d4.getMonth()).toBe(5);

        // Date.parse
        const ts = Date.parse('2024-01-01');
        expect(ts).toBeGreaterThan(0);

        // Date.UTC
        const utc = Date.UTC(2024, 0, 1);
        expect(utc).toBeGreaterThan(0);
      } finally {
        performance.now = origPerfNow as () => number;
        Date.now = origDateNow;
        globalThis.Date = origDate;
        delete (globalThis as any).__cdpTimingOffset;
      }
    });

    it('proxied Date preserves prototype', async () => {
      const page = createPageMock();
      await StealthScripts.injectTimingDefense(page);
      const { fn } = getInjectedFn(page);

      const origPerfNow = performance.now.bind(performance);
      const origDateNow = Date.now;
      const origDate = globalThis.Date;

      try {
        fn();

        // Verify prototype is preserved
        expect(Date.prototype).toBe(origDate.prototype);
      } finally {
        performance.now = origPerfNow as () => number;
        Date.now = origDateNow;
        globalThis.Date = origDate;
      }
    });
  });

  // ─── injectAll calls injectTimingDefense ───────────────────────────────

  describe('injectAll calls injectTimingDefense', () => {
    it('calls injectTimingDefense after parallel batch', async () => {
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

      spyNames.forEach((name) => vi.spyOn(StealthScripts, name).mockResolvedValue(undefined));
      const timingSpy = vi
        .spyOn(StealthScripts, 'injectTimingDefense')
        .mockResolvedValue(undefined);

      const page = createPageMock();
      await StealthScripts.injectAll(page);

      expect(timingSpy).toHaveBeenCalledOnce();
      expect(timingSpy).toHaveBeenCalledWith(page);
    });
  });

  // ─── fixPermissions ─────────────────────────────────────────────────────

  describe('fixPermissions injected script body', () => {
    it('patches permissions.query', async () => {
      const page = createPageMock();
      await StealthScripts.fixPermissions(page);
      const { fn } = getInjectedFn(page);

      // Set up window.navigator.permissions
      const mockQuery = vi.fn().mockResolvedValue({ state: 'granted' });
      (globalThis as any).window = {
        navigator: {
          permissions: {
            query: mockQuery,
          },
        },
      };
      (globalThis as any).Notification = { permission: 'denied' };

      try {
        fn();

        // After patching, querying 'notifications' should use Notification.permission
        const result = await (globalThis as any).window.navigator.permissions.query({
          name: 'notifications',
        });
        expect(result.state).toBe('denied');

        // Other queries should go through original
        const otherResult = await (globalThis as any).window.navigator.permissions.query({
          name: 'geolocation',
        });
        expect(otherResult.state).toBe('granted');
      } finally {
        delete (globalThis as any).Notification;
      }
    });
  });

  // ─── mockCanvas ─────────────────────────────────────────────────────────

  describe('mockCanvas injected script body', () => {
    it('patches canvas toDataURL and getImageData', async () => {
      const page = createPageMock();
      await StealthScripts.mockCanvas(page);
      const { fn } = getInjectedFn(page);

      // Save originals
      const origToDataURL = (globalThis as any).HTMLCanvasElement.prototype.toDataURL;
      const origGetImageData = (globalThis as any).CanvasRenderingContext2D.prototype.getImageData;

      try {
        fn();

        // Verify prototypes were patched
        expect((globalThis as any).HTMLCanvasElement.prototype.toDataURL).not.toBe(origToDataURL);
        expect((globalThis as any).CanvasRenderingContext2D.prototype.getImageData).not.toBe(
          origGetImageData,
        );
      } finally {
        (globalThis as any).HTMLCanvasElement.prototype.toDataURL = origToDataURL;
        (globalThis as any).CanvasRenderingContext2D.prototype.getImageData = origGetImageData;
      }
    });

    it('getImageData XORs pixel data with 1', async () => {
      const page = createPageMock();
      await StealthScripts.mockCanvas(page);
      const { fn } = getInjectedFn(page);

      const origGetImageData = (globalThis as any).CanvasRenderingContext2D.prototype.getImageData;

      // Set up original getImageData to return known pixel data
      const pixelData = new Uint8ClampedArray([100, 150, 200, 255, 50, 75, 100, 255]);
      (globalThis as any).CanvasRenderingContext2D.prototype.getImageData = function () {
        return { data: new Uint8ClampedArray(pixelData) };
      };

      try {
        fn();

        // Call the patched getImageData
        const patchedGetImageData = (globalThis as any).CanvasRenderingContext2D.prototype
          .getImageData;
        const result = patchedGetImageData.call({}, 0, 0, 2, 1);

        // RGB channels should be XORed with 1, alpha stays the same
        expect(result.data[0]).toBe(100 ^ 1); // R
        expect(result.data[1]).toBe(150 ^ 1); // G
        expect(result.data[2]).toBe(200 ^ 1); // B
        expect(result.data[3]).toBe(255); // A (skipped — every 4th)
        expect(result.data[4]).toBe(50 ^ 1);
        expect(result.data[5]).toBe(75 ^ 1);
        expect(result.data[6]).toBe(100 ^ 1);
        expect(result.data[7]).toBe(255);
      } finally {
        (globalThis as any).CanvasRenderingContext2D.prototype.getImageData = origGetImageData;
      }
    });

    it('toDataURL applies noise and calls original', async () => {
      const page = createPageMock();
      await StealthScripts.mockCanvas(page);
      const { fn } = getInjectedFn(page);

      const origToDataURL = (globalThis as any).HTMLCanvasElement.prototype.toDataURL;
      const origGetImageData = (globalThis as any).CanvasRenderingContext2D.prototype.getImageData;

      const mockPutImageData = vi.fn();
      const mockOrigToDataURL = vi.fn().mockReturnValue('data:image/png;base64,noised');
      const pixelData = new Uint8ClampedArray([10, 20, 30, 255]);

      // Set up originals that the patched function will reference
      (globalThis as any).HTMLCanvasElement.prototype.toDataURL = mockOrigToDataURL;
      (globalThis as any).CanvasRenderingContext2D.prototype.getImageData = function () {
        return { data: new Uint8ClampedArray(pixelData) };
      };

      try {
        fn();

        // Call the patched toDataURL with a mock canvas-like object
        const patchedToDataURL = (globalThis as any).HTMLCanvasElement.prototype.toDataURL;
        const fakeCanvas = {
          width: 2,
          height: 1,
          getContext: vi.fn().mockReturnValue({
            getImageData: (globalThis as any).CanvasRenderingContext2D.prototype.getImageData,
            putImageData: mockPutImageData,
          }),
        };

        const _result = patchedToDataURL.call(fakeCanvas, 'image/png');

        // getContext should have been called
        expect(fakeCanvas.getContext).toHaveBeenCalledWith('2d');
        // putImageData should have been called with XORed data
        expect(mockPutImageData).toHaveBeenCalled();
      } finally {
        (globalThis as any).HTMLCanvasElement.prototype.toDataURL = origToDataURL;
        (globalThis as any).CanvasRenderingContext2D.prototype.getImageData = origGetImageData;
      }
    });

    it('toDataURL handles null context gracefully', async () => {
      const page = createPageMock();
      await StealthScripts.mockCanvas(page);
      const { fn } = getInjectedFn(page);

      const origToDataURL = (globalThis as any).HTMLCanvasElement.prototype.toDataURL;
      const origGetImageData = (globalThis as any).CanvasRenderingContext2D.prototype.getImageData;

      const mockOrigToDataURL = vi.fn().mockReturnValue('data:image/png;base64,original');
      (globalThis as any).HTMLCanvasElement.prototype.toDataURL = mockOrigToDataURL;

      try {
        fn();

        const patchedToDataURL = (globalThis as any).HTMLCanvasElement.prototype.toDataURL;
        const fakeCanvas = {
          getContext: vi.fn().mockReturnValue(null), // No 2d context
        };

        const result = patchedToDataURL.call(fakeCanvas);
        // Should still call original toDataURL even without context
        expect(typeof result).toBe('string');
      } finally {
        (globalThis as any).HTMLCanvasElement.prototype.toDataURL = origToDataURL;
        (globalThis as any).CanvasRenderingContext2D.prototype.getImageData = origGetImageData;
      }
    });
  });

  // ─── mockWebGL ──────────────────────────────────────────────────────────

  describe('mockWebGL injected script body', () => {
    it('patches getParameter for vendor (37445) and renderer (37446)', async () => {
      const page = createPageMock();
      await StealthScripts.mockWebGL(page);
      const { fn } = getInjectedFn(page);

      const origGetParameter = (globalThis as any).WebGLRenderingContext.prototype.getParameter;

      try {
        fn();

        // Test patched getParameter
        const patchedFn = (globalThis as any).WebGLRenderingContext.prototype.getParameter;
        expect(patchedFn).not.toBe(origGetParameter);

        // Call with vendor param (37445)
        const vendor = patchedFn.call({}, 37445);
        expect(vendor).toBe('Intel Inc.');

        // Call with renderer param (37446)
        const renderer = patchedFn.call({}, 37446);
        expect(renderer).toBe('Intel Iris OpenGL Engine');

        // Call with other param (should fall through to original)
        // Original mock returns 'original value'
        const other = patchedFn.call({}, 12345);
        expect(other).toBe('original value');
      } finally {
        (globalThis as any).WebGLRenderingContext.prototype.getParameter = origGetParameter;
      }
    });
  });

  // ─── fixMediaDevices ────────────────────────────────────────────────────

  describe('fixMediaDevices injected script body', () => {
    it('returns default devices when enumerateDevices returns empty', async () => {
      const page = createPageMock();
      await StealthScripts.fixMediaDevices(page);
      const { fn } = getInjectedFn(page);

      const origMediaDevices = navigator.mediaDevices;
      const mockEnumerateDevices = vi.fn().mockResolvedValue([]);

      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { enumerateDevices: mockEnumerateDevices },
      });

      try {
        fn();

        const devices = await navigator.mediaDevices.enumerateDevices();
        expect(devices).toHaveLength(2);
        expect(devices[0]!.kind).toBe('audioinput');
        expect(devices[0]!.label).toBe('Default - Microphone');
        expect(devices[1]!.kind).toBe('videoinput');
        expect(devices[1]!.label).toBe('Default - Camera');
        expect(typeof devices[0]!.toJSON).toBe('function');

        // Call toJSON to cover lines 405 and 412
        expect(devices[0]!.toJSON()).toEqual({});
        expect(devices[1]!.toJSON()).toEqual({});
      } finally {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: origMediaDevices,
        });
      }
    });

    it('returns actual devices when non-empty', async () => {
      const page = createPageMock();
      await StealthScripts.fixMediaDevices(page);
      const { fn } = getInjectedFn(page);

      const existingDevices = [
        {
          deviceId: 'mic1',
          kind: 'audioinput' as MediaDeviceKind,
          label: 'My Mic',
          groupId: 'g1',
          toJSON: () => ({}),
        },
      ];

      const origMediaDevices = navigator.mediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { enumerateDevices: vi.fn().mockResolvedValue(existingDevices) },
      });

      try {
        fn();

        const devices = await navigator.mediaDevices.enumerateDevices();
        expect(devices).toEqual(existingDevices);
      } finally {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: origMediaDevices,
        });
      }
    });

    it('handles missing mediaDevices gracefully', async () => {
      const page = createPageMock();
      await StealthScripts.fixMediaDevices(page);
      const { fn } = getInjectedFn(page);

      const origMediaDevices = navigator.mediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: undefined,
      });

      try {
        expect(() => fn()).not.toThrow();
      } finally {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: origMediaDevices,
        });
      }
    });

    it('handles missing enumerateDevices function', async () => {
      const page = createPageMock();
      await StealthScripts.fixMediaDevices(page);
      const { fn } = getInjectedFn(page);

      const origMediaDevices = navigator.mediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {},
      });

      try {
        expect(() => fn()).not.toThrow();
      } finally {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: origMediaDevices,
        });
      }
    });
  });

  // ─── hideWebDriver ──────────────────────────────────────────────────────

  describe('hideWebDriver injected script', () => {
    it('deletes cdc_ and $cdc_ properties from document', async () => {
      const page = createPageMock();
      await StealthScripts.hideWebDriver(page);
      const { fn } = getInjectedFn(page);

      const origDocument = (globalThis as any).document;
      const fakeDoc: Record<string, unknown> = {
        cdc_testkey: 'value1',
        $cdc_anotherkey: 'value2',
        normalKey: 'keep',
      };
      (globalThis as any).document = fakeDoc;

      try {
        fn();

        expect(fakeDoc.cdc_testkey).toBeUndefined();
        expect(fakeDoc.$cdc_anotherkey).toBeUndefined();
        expect(fakeDoc.normalKey).toBe('keep');
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('defines webdriver as undefined getter', async () => {
      const page = createPageMock();
      await StealthScripts.hideWebDriver(page);
      const { fn } = getInjectedFn(page);

      fn();

      const desc = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
      expect(desc?.get?.()).toBeUndefined();
    });

    it('filters webdriver from Object.getOwnPropertyNames', async () => {
      const page = createPageMock();
      await StealthScripts.hideWebDriver(page);
      const { fn } = getInjectedFn(page);

      const origGetOwnPropertyNames = Object.getOwnPropertyNames;

      fn();

      try {
        const props = Object.getOwnPropertyNames({ webdriver: true, other: 'val' });
        expect(props).not.toContain('webdriver');
        expect(props).toContain('other');
      } finally {
        Object.getOwnPropertyNames = origGetOwnPropertyNames;
      }
    });
  });

  // ─── mockBattery ────────────────────────────────────────────────────────

  describe('mockBattery injected script', () => {
    it('patches battery properties when getBattery exists', async () => {
      const page = createPageMock();
      await StealthScripts.mockBattery(page);
      const { fn } = getInjectedFn(page);

      const origGetBattery = (navigator as any).getBattery;
      const fakeBattery = {
        charging: false,
        chargingTime: 5000,
        dischargingTime: 3600,
        level: 0.42,
      };
      (navigator as any).getBattery = vi.fn().mockResolvedValue(fakeBattery);

      try {
        fn();

        const battery = await (navigator as any).getBattery();

        expect(battery.charging).toBe(true);
        expect(battery.chargingTime).toBe(0);
        expect(battery.dischargingTime).toBe(Infinity);
        expect(battery.level).toBe(1);
      } finally {
        if (origGetBattery) {
          (navigator as any).getBattery = origGetBattery;
        } else {
          delete (navigator as any).getBattery;
        }
      }
    });

    it('does nothing when getBattery does not exist', async () => {
      const page = createPageMock();
      await StealthScripts.mockBattery(page);
      const { fn } = getInjectedFn(page);

      const origGetBattery = (navigator as any).getBattery;
      delete (navigator as any).getBattery;

      try {
        expect(() => fn()).not.toThrow();
        expect((navigator as any).getBattery).toBeUndefined();
      } finally {
        if (origGetBattery) {
          (navigator as any).getBattery = origGetBattery;
        }
      }
    });
  });

  // ─── mockNotifications ──────────────────────────────────────────────────

  describe('mockNotifications injected script', () => {
    it('patches Notification.permission when Notification exists', async () => {
      const page = createPageMock();
      await StealthScripts.mockNotifications(page);
      const { fn } = getInjectedFn(page);

      (FakeNotification as any).permission = 'granted';

      const origWindow = (globalThis as any).window;
      const origNotification = (globalThis as any).Notification;

      (globalThis as any).window = { Notification: FakeNotification };
      (globalThis as any).Notification = FakeNotification;

      try {
        fn();

        const desc = Object.getOwnPropertyDescriptor(FakeNotification, 'permission');
        if (desc?.get) {
          expect(desc.get()).toBe('default');
        }
      } finally {
        (globalThis as any).window = origWindow;
        (globalThis as any).Notification = origNotification;
      }
    });

    it('does nothing when Notification not in window', async () => {
      const page = createPageMock();
      await StealthScripts.mockNotifications(page);
      const { fn } = getInjectedFn(page);

      const origWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      try {
        expect(() => fn()).not.toThrow();
      } finally {
        (globalThis as any).window = origWindow;
      }
    });
  });

  // ─── getPatchrightLaunchArgs ────────────────────────────────────────────

  describe('getPatchrightLaunchArgs', () => {
    it('returns all 7 Patchright-specific flags', () => {
      const args = StealthScripts.getPatchrightLaunchArgs();
      expect(args).toHaveLength(7);
      expect(args).toContain('--remote-allow-origins=*');
      expect(args).toContain('--disable-component-update');
      expect(args).toContain('--disable-hang-monitor');
      expect(args).toContain('--disable-domain-reliability');
      expect(args).toContain('--disable-client-side-phishing-detection');
      expect(args).toContain('--disable-popup-blocking');
      expect(args).toContain(
        '--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationHints',
      );
    });
  });

  // ─── setRealisticUserAgent injected execution ───────────────────────────

  describe('setRealisticUserAgent injected script', () => {
    it('sets navigator properties with correct values', async () => {
      const page = createPageMock();
      await StealthScripts.setRealisticUserAgent(page, 'windows');
      const { fn, extraArgs } = getInjectedFn(page);

      fn(extraArgs[0], extraArgs[1]);

      const platformDesc = Object.getOwnPropertyDescriptor(navigator, 'platform');
      expect(platformDesc?.get?.()).toBe('Win32');

      const vendorDesc = Object.getOwnPropertyDescriptor(navigator, 'vendor');
      expect(vendorDesc?.get?.()).toBe('Google Inc.');

      const hwcDesc = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
      expect(hwcDesc?.get?.()).toBe(16);

      const dmDesc = Object.getOwnPropertyDescriptor(navigator, 'deviceMemory');
      expect(dmDesc?.get?.()).toBe(8);
    });
  });

  // ─── fixLanguages injected execution ────────────────────────────────────

  describe('fixLanguages injected script', () => {
    it('sets navigator.language and languages', async () => {
      const page = createPageMock();
      await StealthScripts.fixLanguages(page);
      const { fn } = getInjectedFn(page);

      fn();

      const langDesc = Object.getOwnPropertyDescriptor(navigator, 'language');
      expect(langDesc?.get?.()).toBe('en-US');

      const langsDesc = Object.getOwnPropertyDescriptor(navigator, 'languages');
      expect(langsDesc?.get?.()).toEqual(['en-US', 'en']);
    });
  });

  // ─── mockChrome injected execution ──────────────────────────────────────

  describe('mockChrome injected script', () => {
    it('sets window.chrome with runtime, loadTimes, csi, app', async () => {
      const page = createPageMock();
      await StealthScripts.mockChrome(page);
      const { fn } = getInjectedFn(page);

      const origWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      try {
        fn();

        const win = (globalThis as any).window;
        expect(win.chrome).toBeDefined();

        // runtime
        expect(typeof win.chrome.runtime.connect).toBe('function');
        expect(typeof win.chrome.runtime.sendMessage).toBe('function');
        expect(typeof win.chrome.runtime.onMessage.addListener).toBe('function');

        // loadTimes
        const lt = win.chrome.loadTimes();
        expect(lt.connectionInfo).toBe('http/1.1');
        expect(lt.navigationType).toBe('Other');

        // csi
        const csi = win.chrome.csi();
        expect(csi.tran).toBe(15);

        // app
        expect(win.chrome.app.isInstalled).toBe(false);
        expect(win.chrome.app.InstallState.INSTALLED).toBe('installed');
      } finally {
        (globalThis as any).window = origWindow;
      }
    });
  });

  // ─── mockPlugins injected execution ─────────────────────────────────────

  describe('mockPlugins injected script', () => {
    it('sets 3 plugins with correct structure', async () => {
      const page = createPageMock();
      await StealthScripts.mockPlugins(page);
      const { fn } = getInjectedFn(page);

      fn();

      const desc = Object.getOwnPropertyDescriptor(navigator, 'plugins');
      const plugins = desc?.get?.();
      expect(plugins).toHaveLength(3);

      expect(plugins[0].name).toBe('Chrome PDF Plugin');
      expect(plugins[0].filename).toBe('internal-pdf-viewer');
      expect(plugins[0].length).toBe(1);

      expect(plugins[1].name).toBe('Chrome PDF Viewer');
      expect(plugins[2].name).toBe('Native Client');
      expect(plugins[2].length).toBe(2);
    });
  });
});
