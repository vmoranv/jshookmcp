import puppeteer from 'rebrowser-puppeteer-core';
import type { Browser, Page } from 'rebrowser-puppeteer-core';
import type { DetectedEnvironmentVariables } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

type ManifestRecord = Record<string, unknown>;

interface FetchRealEnvironmentParams {
  browser?: Browser;
  url: string;
  detected: DetectedEnvironmentVariables;
  depth: number;
  resolveExecutablePath: () => string | undefined;
  buildManifestFromTemplate: (
    detected: DetectedEnvironmentVariables,
    browserType: string
  ) => ManifestRecord;
}

export async function fetchRealEnvironmentData(
  params: FetchRealEnvironmentParams
): Promise<{ manifest: ManifestRecord; browser?: Browser }> {
  const { url, detected, depth, resolveExecutablePath, buildManifestFromTemplate } = params;
  const manifest: ManifestRecord = {};

  let browser = params.browser;
  let page: Page | undefined;

  try {
    if (!browser) {
      const executablePath = resolveExecutablePath();
      const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-extensions',
          '--disable-component-extensions-with-background-pages',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
        ],
      };
      if (executablePath) {
        launchOptions.executablePath = executablePath;
      }
      browser = await puppeteer.launch(launchOptions);
    }

    page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.evaluateOnNewDocument(() => {
      type ChromeLike = {
        runtime: {
          connect: () => void;
          sendMessage: () => void;
          onMessage: {
            addListener: () => void;
            removeListener: () => void;
          };
        };
        loadTimes: () => Record<string, string | number | boolean>;
        csi: () => {
          onloadT: number;
          pageT: number;
          startE: number;
          tran: number;
        };
        app: {
          isInstalled: boolean;
          InstallState: {
            DISABLED: string;
            INSTALLED: string;
            NOT_INSTALLED: string;
          };
          RunningState: {
            CANNOT_RUN: string;
            READY_TO_RUN: string;
            RUNNING: string;
          };
        };
      };

      type PermissionsQuery = (
        parameters: PermissionDescriptor
      ) => Promise<PermissionStatus | { state: PermissionState | NotificationPermission }>;

      type WindowWithExtensions = Window & {
        chrome?: ChromeLike;
        _sdkGlueVersionMap?: Record<string, unknown>;
        requestAnimationFrame?: (callback: FrameRequestCallback) => number;
        cancelAnimationFrame?: (id: number) => void;
      };

      const typedWindow = window as WindowWithExtensions;

      const setChromeObject = (target: WindowWithExtensions): void => {
        target.chrome = {
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
              commitLoadTime: Date.now() / 1000 - Math.random() * 10,
              connectionInfo: 'http/1.1',
              finishDocumentLoadTime: Date.now() / 1000 - Math.random() * 5,
              finishLoadTime: Date.now() / 1000 - Math.random() * 3,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: Date.now() / 1000 - Math.random() * 8,
              navigationType: 'Other',
              npnNegotiatedProtocol: 'http/1.1',
              requestTime: Date.now() / 1000 - Math.random() * 15,
              startLoadTime: Date.now() / 1000 - Math.random() * 12,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: false,
              wasNpnNegotiated: true,
            };
          },
          csi: function () {
            return {
              onloadT: Date.now(),
              pageT: Math.random() * 1000,
              startE: Date.now() - Math.random() * 5000,
              tran: 15,
            };
          },
          app: {
            isInstalled: false,
            InstallState: {
              DISABLED: 'disabled',
              INSTALLED: 'installed',
              NOT_INSTALLED: 'not_installed',
            },
            RunningState: {
              CANNOT_RUN: 'cannot_run',
              READY_TO_RUN: 'ready_to_run',
              RUNNING: 'running',
            },
          },
        };
      };

      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      setChromeObject(typedWindow);

      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const pluginArray = [
            {
              0: {
                type: 'application/x-google-chrome-pdf',
                suffixes: 'pdf',
                description: 'Portable Document Format',
                enabledPlugin: null,
              },
              description: 'Portable Document Format',
              filename: 'internal-pdf-viewer',
              length: 1,
              name: 'Chrome PDF Plugin',
            },
            {
              0: {
                type: 'application/pdf',
                suffixes: 'pdf',
                description: '',
                enabledPlugin: null,
              },
              description: '',
              filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
              length: 1,
              name: 'Chrome PDF Viewer',
            },
            {
              0: {
                type: 'application/x-nacl',
                suffixes: '',
                description: 'Native Client Executable',
                enabledPlugin: null,
              },
              1: {
                type: 'application/x-pnacl',
                suffixes: '',
                description: 'Portable Native Client Executable',
                enabledPlugin: null,
              },
              description: '',
              filename: 'internal-nacl-plugin',
              length: 2,
              name: 'Native Client',
            },
          ];
          return pluginArray;
        },
        configurable: true,
      });

      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en-US', 'en'],
        configurable: true,
      });

      const permissions = window.navigator.permissions as Omit<Permissions, 'query'> & {
        query: PermissionsQuery;
      };
      const originalQuery: PermissionsQuery = permissions.query.bind(permissions);
      permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);

      if (!typedWindow.requestAnimationFrame) {
        typedWindow.requestAnimationFrame = function (callback: FrameRequestCallback) {
          return window.setTimeout(() => callback(performance.now()), 16);
        };
      }

      if (!typedWindow.cancelAnimationFrame) {
        typedWindow.cancelAnimationFrame = function (id: number) {
          window.clearTimeout(id);
        };
      }

      typedWindow._sdkGlueVersionMap = typedWindow._sdkGlueVersionMap || {};
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const allPaths = [
      ...detected.window,
      ...detected.document,
      ...detected.navigator,
      ...detected.location,
      ...detected.screen,
      ...detected.other,
    ];

    const extractedValues = await page.evaluate(
      (paths: string[], maxDepth: number) => {
        type SerializedValue =
          | string
          | number
          | boolean
          | null
          | undefined
          | SerializedValue[]
          | { [key: string]: SerializedValue };

        const result: Record<string, SerializedValue> = {};
        const seen = new WeakSet<object>();

        const isObjectLike = (value: unknown): value is object =>
          typeof value === 'object' && value !== null;

        function extractValue(path: string): SerializedValue {
          try {
            const parts = path.split('.');
            let current: unknown = window;

            for (const part of parts) {
              if (isObjectLike(current) && part in current) {
                current = (current as Record<string, unknown>)[part];
              } else {
                return undefined;
              }
            }

            return serializeValue(current, maxDepth, seen);
          } catch (error) {
            return `[Error: ${(error as Error).message}]`;
          }
        }

        function serializeValue(
          value: unknown,
          depth: number,
          seenObjects: WeakSet<object>
        ): SerializedValue {
          if (depth <= 0) return '[Max Depth]';

          if (value === null) return null;
          if (value === undefined) return undefined;

          const type = typeof value;

          if (type === 'string' || type === 'number' || type === 'boolean') {
            return value as string | number | boolean;
          }

          if (type === 'function') {
            const fn = value as Function;
            try {
              return {
                __type: 'Function',
                name: fn.name || 'anonymous',
                toString: fn.toString().substring(0, 200),
              };
            } catch {
              return '[Function]';
            }
          }

          if (isObjectLike(value) && seenObjects.has(value)) {
            return '[Circular Reference]';
          }

          if (Array.isArray(value)) {
            seenObjects.add(value);
            const arr = value
              .slice(0, 20)
              .map((item) => serializeValue(item, depth - 1, seenObjects));
            if (value.length > 20) {
              arr.push(`[... ${value.length - 20} more items]`);
            }
            return arr;
          }

          if (isObjectLike(value)) {
            seenObjects.add(value);
            const serialized: { [key: string]: SerializedValue } = {};

            const allKeys = Object.getOwnPropertyNames(value);
            const limitedKeys = allKeys.slice(0, 100);

            for (const key of limitedKeys) {
              try {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);

                if (descriptor) {
                  if (descriptor.get) {
                    try {
                      serialized[key] = serializeValue(
                        (value as Record<string, unknown>)[key],
                        depth - 1,
                        seenObjects
                      );
                    } catch {
                      serialized[key] = '[Getter Error]';
                    }
                  } else if (descriptor.value !== undefined) {
                    serialized[key] = serializeValue(descriptor.value, depth - 1, seenObjects);
                  }
                }
              } catch (e) {
                serialized[key] = `[Error: ${(e as Error).message}]`;
              }
            }

            if (allKeys.length > 100) {
              serialized['__more'] = `[... ${allKeys.length - 100} more properties]`;
            }

            return serialized;
          }

          try {
            return String(value);
          } catch {
            return '[Unserializable]';
          }
        }

        for (const path of paths) {
          result[path] = extractValue(path);
        }

        const commonAntiCrawlVars = [
          'navigator.userAgent',
          'navigator.platform',
          'navigator.vendor',
          'navigator.hardwareConcurrency',
          'navigator.deviceMemory',
          'navigator.maxTouchPoints',
          'navigator.language',
          'navigator.languages',
          'navigator.onLine',
          'navigator.cookieEnabled',
          'navigator.doNotTrack',
          'screen.width',
          'screen.height',
          'screen.availWidth',
          'screen.availHeight',
          'screen.colorDepth',
          'screen.pixelDepth',
          'screen.orientation.type',
          'window.innerWidth',
          'window.innerHeight',
          'window.outerWidth',
          'window.outerHeight',
          'window.devicePixelRatio',
          'window.screenX',
          'window.screenY',
          'document.referrer',
          'document.cookie',
          'document.title',
          'document.URL',
          'document.documentURI',
          'document.domain',
          'location.href',
          'location.protocol',
          'location.host',
          'location.hostname',
          'location.port',
          'location.pathname',
          'location.search',
          'location.hash',
          'location.origin',
        ];

        for (const varPath of commonAntiCrawlVars) {
          if (!result[varPath]) {
            result[varPath] = extractValue(varPath);
          }
        }

        return result;
      },
      allPaths,
      depth
    );

    Object.assign(manifest, extractedValues);

    logger.info(`  ${Object.keys(manifest).length} `);
  } catch (error) {
    logger.warn('Variable extraction failed', error);
    return { manifest: buildManifestFromTemplate(detected, 'chrome'), browser };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore page close errors
      }
    }
  }

  return { manifest, browser };
}
