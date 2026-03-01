import { Page } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';

type PermissionQueryInput = Parameters<Permissions['query']>[0];

type NotificationWithPermission = typeof Notification & {
  permission: NotificationPermission;
};

type BatteryLike = {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
};

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryLike>;
};

type ChromeRuntimeLike = {
  connect: () => void;
  sendMessage: () => void;
  onMessage: {
    addListener: () => void;
    removeListener: () => void;
  };
};

type ChromeLike = {
  runtime: ChromeRuntimeLike;
  loadTimes: () => {
    commitLoadTime: number;
    connectionInfo: string;
    finishDocumentLoadTime: number;
    finishLoadTime: number;
    firstPaintAfterLoadTime: number;
    firstPaintTime: number;
    navigationType: string;
    npnNegotiatedProtocol: string;
    requestTime: number;
    startLoadTime: number;
    wasAlternateProtocolAvailable: boolean;
    wasFetchedViaSpdy: boolean;
    wasNpnNegotiated: boolean;
  };
  csi: () => {
    onloadT: number;
    pageT: number;
    startE: number;
    tran: number;
  };
  app: Record<string, never>;
};

type WindowWithChrome = Window & {
  chrome?: ChromeLike;
};

export class StealthScripts {
  static async injectAll(page: Page): Promise<void> {
    logger.info('Injecting modern stealth scripts...');

    await Promise.all([
      this.hideWebDriver(page),
      this.mockChrome(page),
      this.mockPlugins(page),
      this.fixPermissions(page),
      this.mockCanvas(page),
      this.mockWebGL(page),
      this.fixLanguages(page),
      this.mockBattery(page),
      this.fixMediaDevices(page),
      this.mockNotifications(page),
    ]);

    logger.info(' ');
  }

  static async hideWebDriver(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const originalNavigator = navigator;
      const navigatorPrototype = Object.getPrototypeOf(originalNavigator) as {
        webdriver?: unknown;
      };
      delete navigatorPrototype.webdriver;

      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      const originalGetOwnPropertyNames = Object.getOwnPropertyNames;
      Object.getOwnPropertyNames = function (obj: object) {
        const props = originalGetOwnPropertyNames(obj);
        return props.filter((prop) => prop !== 'webdriver');
      };
    });
  }

  static async mockChrome(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const win = window as WindowWithChrome;
      win.chrome = {
        runtime: {
          connect: () => {},
          sendMessage: () => {},
          onMessage: {
            addListener: () => {},
            removeListener: () => {},
          },
        },
        loadTimes: function () {
          return {
            commitLoadTime: Date.now() / 1000,
            connectionInfo: 'http/1.1',
            finishDocumentLoadTime: Date.now() / 1000,
            finishLoadTime: Date.now() / 1000,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: Date.now() / 1000,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'unknown',
            requestTime: 0,
            startLoadTime: Date.now() / 1000,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: false,
            wasNpnNegotiated: false,
          };
        },
        csi: function () {
          return {
            onloadT: Date.now(),
            pageT: Date.now(),
            startE: Date.now(),
            tran: 15,
          };
        },
        app: {},
      };
    });
  }

  static async mockPlugins(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          {
            0: {
              type: 'application/pdf',
              suffixes: 'pdf',
              description: 'Portable Document Format',
            },
            description: 'Portable Document Format',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Plugin',
          },
          {
            0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: '' },
            description: '',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Viewer',
          },
          {
            0: {
              type: 'application/x-nacl',
              suffixes: '',
              description: 'Native Client Executable',
            },
            1: {
              type: 'application/x-pnacl',
              suffixes: '',
              description: 'Portable Native Client Executable',
            },
            description: '',
            filename: 'internal-nacl-plugin',
            length: 2,
            name: 'Native Client',
          },
        ],
      });
    });
  }

  static async fixPermissions(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      const notification = Notification as NotificationWithPermission;
      window.navigator.permissions.query = (parameters: PermissionQueryInput) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: notification.permission } as PermissionStatus)
          : originalQuery(parameters);
    });
  }

  static async mockCanvas(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

      const addNoise = (imageData: ImageData) => {
        const data = imageData.data;
        if (data) {
          for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i]! ^ 1;
            data[i + 1] = data[i + 1]! ^ 1;
            data[i + 2] = data[i + 2]! ^ 1;
          }
        }
        return imageData;
      };

      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        const context = this.getContext('2d');
        if (context) {
          const imageData = context.getImageData(0, 0, this.width, this.height);
          addNoise(imageData);
          context.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, args);
      };

      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        const imageData = originalGetImageData.apply(this, args);
        return addNoise(imageData);
      };
    });
  }

  static async mockWebGL(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        if (parameter === 37446) {
          return 'Intel Iris OpenGL Engine';
        }
        return getParameter.apply(this, [parameter]);
      };
    });
  }

  static async fixLanguages(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'language', {
        get: () => 'en-US',
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });
  }

  static async mockBattery(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      const navigatorWithBattery = navigator as NavigatorWithBattery;
      if (typeof navigatorWithBattery.getBattery === 'function') {
        const originalGetBattery = navigatorWithBattery.getBattery;
        navigatorWithBattery.getBattery = function () {
          return originalGetBattery.call(navigator).then((battery: BatteryLike) => {
            Object.defineProperty(battery, 'charging', { get: () => true });
            Object.defineProperty(battery, 'chargingTime', { get: () => 0 });
            Object.defineProperty(battery, 'dischargingTime', { get: () => Infinity });
            Object.defineProperty(battery, 'level', { get: () => 1 });
            return battery;
          });
        };
      }
    });
  }

  static async fixMediaDevices(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = function () {
          return originalEnumerateDevices.call(navigator.mediaDevices).then((devices) => {
            if (devices.length === 0) {
              return [
                {
                  deviceId: 'default',
                  kind: 'audioinput' as MediaDeviceKind,
                  label: 'Default - Microphone',
                  groupId: 'default',
                  toJSON: () => ({}),
                },
                {
                  deviceId: 'default',
                  kind: 'videoinput' as MediaDeviceKind,
                  label: 'Default - Camera',
                  groupId: 'default',
                  toJSON: () => ({}),
                },
              ];
            }
            return devices;
          });
        };
      }
    });
  }

  static async mockNotifications(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      if ('Notification' in window) {
        Object.defineProperty(Notification, 'permission', {
          get: () => 'default',
        });
      }
    });
  }

  static async setRealisticUserAgent(
    page: Page,
    platform: 'windows' | 'mac' | 'linux' = 'windows'
  ): Promise<void> {
    const userAgents = {
      windows:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      linux:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    const platformMap = {
      windows: 'Win32',
      mac: 'MacIntel',
      linux: 'Linux x86_64',
    };

    await page.setUserAgent(userAgents[platform]);

    await page.evaluateOnNewDocument((platformValue) => {
      Object.defineProperty(navigator, 'platform', {
        get: () => platformValue,
      });
      Object.defineProperty(navigator, 'vendor', {
        get: () => 'Google Inc.',
      });
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
      });
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
      });
    }, platformMap[platform]);
  }

  static getRecommendedLaunchArgs(): string[] {
    return [
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
  }
}
