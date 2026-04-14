import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type {
  Browser as PuppeteerBrowser,
  CDPSession as PuppeteerCDPSession,
  Page as PuppeteerPage,
  Target as PuppeteerTarget,
} from 'rebrowser-puppeteer-core';
import type {
  Browser as PlaywrightBrowser,
  BrowserContext as PlaywrightBrowserContext,
  Page as PlaywrightPage,
} from 'playwright-core';
import { logger } from '@utils/logger';

type PuppeteerWaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
type PlaywrightWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

let electronCompatPatched = false;

function resolvePlaywrightInternalPaths() {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('playwright-core/package.json');
  const packageRoot = dirname(packageJsonPath);
  return {
    playwrightServerPath: join(packageRoot, 'lib/server/playwright.js'),
    crBrowserPath: join(packageRoot, 'lib/server/chromium/crBrowser.js'),
  };
}

function ensureElectronDownloadBehaviorCompatPatch(): void {
  if (electronCompatPatched) {
    return;
  }

  const require = createRequire(import.meta.url);
  const { playwrightServerPath, crBrowserPath } = resolvePlaywrightInternalPaths();
  const { createPlaywright } = require(playwrightServerPath) as {
    createPlaywright: (options: Record<string, unknown>) => unknown;
  };

  createPlaywright({ sdkLanguage: 'javascript', isInternalPlaywright: true });

  const { CRBrowserContext } = require(crBrowserPath) as {
    CRBrowserContext: {
      prototype: {
        _initialize: (...args: unknown[]) => Promise<unknown>;
        __jshookElectronCompatPatched?: boolean;
      };
    };
  };

  if (CRBrowserContext.prototype.__jshookElectronCompatPatched) {
    electronCompatPatched = true;
    return;
  }

  const originalInitialize = CRBrowserContext.prototype._initialize;
  CRBrowserContext.prototype._initialize = async function patchedInitialize(
    ...args: unknown[]
  ): Promise<unknown> {
    try {
      return await originalInitialize.apply(this, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Browser.setDownloadBehavior') &&
        message.includes('Browser context management is not supported')
      ) {
        logger.warn(
          '[playwright-cdp-fallback] Swallowed Browser.setDownloadBehavior for legacy Electron CDP endpoint.',
        );
        return;
      }
      throw error;
    }
  };

  Object.defineProperty(CRBrowserContext.prototype, '__jshookElectronCompatPatched', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  electronCompatPatched = true;
}

export function normalizePlaywrightConnectEndpoint(endpoint: string): string {
  // Playwright can consume ws(s) CDP endpoints directly, and rewriting them to a
  // bare browserURL loses routing information for multi-instance targets.
  return endpoint;
}

function mapWaitUntil(waitUntil?: PuppeteerWaitUntil): PlaywrightWaitUntil | undefined {
  if (waitUntil === 'networkidle0' || waitUntil === 'networkidle2') {
    return 'networkidle';
  }
  return waitUntil;
}

function getDefaultContext(browser: PlaywrightBrowser): PlaywrightBrowserContext {
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error(
      'Connected Playwright CDP browser exposes no default context. Cannot create or resolve pages.',
    );
  }
  return context;
}

function createPageAdapter(
  playwrightPage: PlaywrightPage,
  pageCache: WeakMap<PlaywrightPage, PuppeteerPage>,
): PuppeteerPage {
  const cached = pageCache.get(playwrightPage);
  if (cached) {
    return cached;
  }

  const pageCompat = {
    async goto(url: string, options?: { waitUntil?: PuppeteerWaitUntil; timeout?: number }) {
      return await playwrightPage.goto(url, {
        ...options,
        waitUntil: mapWaitUntil(options?.waitUntil),
      });
    },
    async reload(options?: { waitUntil?: PuppeteerWaitUntil; timeout?: number }) {
      return await playwrightPage.reload({
        ...options,
        waitUntil: mapWaitUntil(options?.waitUntil),
      });
    },
    async waitForNavigation(options?: { waitUntil?: PuppeteerWaitUntil; timeout?: number }) {
      const mappedWaitUntil = mapWaitUntil(options?.waitUntil);
      if (
        typeof (playwrightPage as { waitForNavigation?: unknown }).waitForNavigation === 'function'
      ) {
        return await (
          playwrightPage as {
            waitForNavigation: (opts?: {
              waitUntil?: PlaywrightWaitUntil;
              timeout?: number;
            }) => Promise<unknown>;
          }
        ).waitForNavigation({
          ...options,
          waitUntil: mappedWaitUntil,
        });
      }

      return await playwrightPage.waitForLoadState(mappedWaitUntil ?? 'load', {
        timeout: options?.timeout,
      });
    },
    async select(selector: string, ...values: string[]) {
      return await playwrightPage.selectOption(selector, values);
    },
    async evaluateOnNewDocument(
      pageFunction: string | ((...args: never[]) => unknown),
      ...args: readonly unknown[]
    ) {
      return await playwrightPage.addInitScript(pageFunction as never, ...([...args] as never[]));
    },
    async createCDPSession(): Promise<PuppeteerCDPSession> {
      const context = playwrightPage.context() as PlaywrightBrowserContext & {
        newCDPSession?: (page: PlaywrightPage) => Promise<unknown>;
      };

      if (typeof context.newCDPSession !== 'function') {
        throw new Error(
          'Playwright BrowserContext does not expose newCDPSession() for the attached page.',
        );
      }

      return (await context.newCDPSession(playwrightPage)) as unknown as PuppeteerCDPSession;
    },
    async setUserAgent(_userAgent: string): Promise<void> {
      logger.debug(
        '[playwright-cdp-fallback] Ignoring page.setUserAgent() for attached Playwright CDP page.',
      );
    },
  };

  const proxiedPage = new Proxy(pageCompat as object, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }

      const value = Reflect.get(playwrightPage as object, prop);
      return typeof value === 'function' ? value.bind(playwrightPage) : value;
    },
  }) as unknown as PuppeteerPage;

  pageCache.set(playwrightPage, proxiedPage);
  return proxiedPage;
}

function createTargetAdapter(
  playwrightPage: PlaywrightPage,
  pageCache: WeakMap<PlaywrightPage, PuppeteerPage>,
): PuppeteerTarget {
  return {
    type: () => 'page',
    url: () => playwrightPage.url(),
    page: async () => createPageAdapter(playwrightPage, pageCache),
  } as unknown as PuppeteerTarget;
}

function createBrowserAdapter(playwrightBrowser: PlaywrightBrowser): PuppeteerBrowser {
  const pageCache = new WeakMap<PlaywrightPage, PuppeteerPage>();

  const browserCompat = {
    targets(): PuppeteerTarget[] {
      return playwrightBrowser
        .contexts()
        .flatMap((context) => context.pages())
        .map((page) => createTargetAdapter(page, pageCache));
    },
    async pages(): Promise<PuppeteerPage[]> {
      return playwrightBrowser
        .contexts()
        .flatMap((context) => context.pages())
        .map((page) => createPageAdapter(page, pageCache));
    },
    async newPage(): Promise<PuppeteerPage> {
      const context = getDefaultContext(playwrightBrowser);
      const page = await context.newPage();
      return createPageAdapter(page, pageCache);
    },
    async disconnect(): Promise<void> {
      await playwrightBrowser.close();
    },
    async close(): Promise<void> {
      await playwrightBrowser.close();
    },
  };

  return new Proxy(browserCompat as object, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }

      const value = Reflect.get(playwrightBrowser as object, prop);
      return typeof value === 'function' ? value.bind(playwrightBrowser) : value;
    },
  }) as unknown as PuppeteerBrowser;
}

export async function connectPlaywrightCdpFallback(
  endpoint: string,
  timeoutMs: number,
): Promise<PuppeteerBrowser> {
  ensureElectronDownloadBehaviorCompatPatch();

  const { chromium } = await import('playwright-core');
  const playwrightBrowser = await chromium.connectOverCDP(
    normalizePlaywrightConnectEndpoint(endpoint),
    {
      timeout: timeoutMs,
    },
  );

  return createBrowserAdapter(playwrightBrowser);
}
