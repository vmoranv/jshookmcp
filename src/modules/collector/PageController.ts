import type { CodeCollector } from '@modules/collector/CodeCollector';
import { logger } from '@utils/logger';
import { setTimeout as asyncSetTimeout } from 'node:timers/promises';
import type { Page } from 'rebrowser-puppeteer-core';

export interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  timeout?: number;
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

export interface TypeOptions {
  delay?: number;
}

export interface ScrollOptions {
  x?: number;
  y?: number;
}

export interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  path?: string;
  type?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  clip?: ScreenshotClip;
}

interface WaitForSelectorElement {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  attributes: Record<string, string>;
}

interface UploadableElementHandle {
  uploadFile: (...filePaths: string[]) => Promise<void>;
}

export class PageController {
  constructor(private collector: CodeCollector) {}

  async navigate(
    url: string,
    options?: NavigationOptions,
  ): Promise<{
    url: string;
    title: string;
    loadTime: number;
  }> {
    const page = await this.collector.getActivePage();
    const startTime = Date.now();

    await page.goto(url, {
      waitUntil: options?.waitUntil || 'networkidle2',
      timeout: options?.timeout || 30000,
    });

    const loadTime = Date.now() - startTime;
    const title = await page.title();
    const currentUrl = page.url();

    logger.info(`Navigated to: ${url}`);

    return {
      url: currentUrl,
      title,
      loadTime,
    };
  }

  async reload(options?: NavigationOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.reload({
      waitUntil: options?.waitUntil || 'networkidle2',
      timeout: options?.timeout || 30000,
    });
    logger.info('Page reloaded');
  }

  async goBack(): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.goBack();
    logger.info('Navigated back');
  }

  async goForward(): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.goForward();
    logger.info('Navigated forward');
  }

  async click(selector: string, options?: ClickOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.click(selector, {
      button: options?.button || 'left',
      clickCount: options?.clickCount || 1,
      delay: options?.delay,
    });
    logger.info(`Clicked: ${selector}`);
  }

  async type(selector: string, text: string, options?: TypeOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.type(selector, text, {
      delay: options?.delay,
    });
    logger.info(`Typed into ${selector}: ${text.substring(0, 20)}...`);
  }

  async select(selector: string, ...values: string[]): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.select(selector, ...values);
    logger.info(`Selected in ${selector}: ${values.join(', ')}`);
  }

  async hover(selector: string): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.hover(selector);
    logger.info(`Hovered: ${selector}`);
  }

  async scroll(options: ScrollOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate((opts) => {
      window.scrollTo(opts.x || 0, opts.y || 0);
    }, options);
    logger.info(`Scrolled to: x=${options.x || 0}, y=${options.y || 0}`);
  }

  async waitForSelector(
    selector: string,
    timeout?: number,
  ): Promise<{
    success: boolean;
    element?: WaitForSelectorElement | null;
    message: string;
  }> {
    try {
      const page = await this.collector.getActivePage();

      await page.waitForSelector(selector, {
        timeout: timeout || 30000,
      });

      const element = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;

        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          textContent: el.textContent?.trim().substring(0, 100) || undefined,
          attributes: Array.from(el.attributes).reduce(
            (acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            },
            {} as Record<string, string>,
          ),
        };
      }, selector);

      logger.info(`Selector appeared: ${selector}`);

      return {
        success: true,
        element,
        message: `Selector appeared: ${selector}`,
      };
    } catch (error: unknown) {
      logger.error(`waitForSelector timeout for ${selector}:`, error);
      return {
        success: false,
        message: `Timeout waiting for selector: ${selector}`,
      };
    }
  }

  async waitForNavigation(timeout?: number): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: timeout || 30000,
    });
    logger.info('Navigation completed');
  }

  async evaluate<T>(code: string): Promise<T> {
    const page = await this.collector.getActivePage();
    const result = await evaluateWithTimeout(page, code);
    logger.info('JavaScript executed');
    return result as T;
  }

  async getURL(): Promise<string> {
    const page = await this.collector.getActivePage();
    return page.url();
  }

  async getTitle(): Promise<string> {
    const page = await this.collector.getActivePage();
    return await page.title();
  }

  async getContent(): Promise<string> {
    const page = await this.collector.getActivePage();
    return await page.content();
  }

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const page = await this.collector.getActivePage();
    const screenshotOpts: Record<string, unknown> = {
      path: options?.path,
      type: options?.type || 'png',
      quality: options?.quality,
      fullPage: options?.fullPage || false,
    };
    if (options?.clip) {
      screenshotOpts.clip = options.clip;
      screenshotOpts.fullPage = false;
    }
    const buffer = await page.screenshot(screenshotOpts);
    logger.info(`Screenshot taken${options?.path ? `: ${options.path}` : ''}`);
    return buffer as Buffer;
  }

  async getPerformanceMetrics() {
    const page = await this.collector.getActivePage();

    const metrics = await evaluateWithTimeout(page, () => {
      const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

      return {
        domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
        loadComplete: perf.loadEventEnd - perf.loadEventStart,

        dns: perf.domainLookupEnd - perf.domainLookupStart,
        tcp: perf.connectEnd - perf.connectStart,
        request: perf.responseStart - perf.requestStart,
        response: perf.responseEnd - perf.responseStart,

        total: perf.loadEventEnd - perf.fetchStart,

        resources: performance.getEntriesByType('resource').length,
      };
    });

    logger.info('Performance metrics retrieved');
    return metrics;
  }

  async injectScript(scriptContent: string): Promise<void> {
    const page = await this.collector.getActivePage();

    await evaluateWithTimeout(
      page,
      (script: string) => {
        const scriptElement = document.createElement('script');
        scriptElement.textContent = script;
        document.head.appendChild(scriptElement);
      },
      scriptContent,
    );

    logger.info('Script injected into page');
  }

  async setCookies(
    cookies: Array<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
      expires?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: 'Strict' | 'Lax' | 'None';
    }>,
  ): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.setCookie(...cookies);
    logger.info(`Set ${cookies.length} cookies`);
  }

  async getCookies() {
    const page = await this.collector.getActivePage();
    const cookies = await page.cookies();
    logger.info(`Retrieved ${cookies.length} cookies`);
    return cookies;
  }

  async clearCookies(): Promise<void> {
    const page = await this.collector.getActivePage();
    const cookies = await page.cookies();
    await page.deleteCookie(...cookies);
    logger.info('All cookies cleared');
  }

  async setViewport(width: number, height: number): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.setViewport({ width, height });
    logger.info(`Viewport set to ${width}x${height}`);
  }

  async emulateDevice(deviceName: string): Promise<'iPhone' | 'iPad' | 'Android'> {
    const page = await this.collector.getActivePage();

    const devices = {
      iPhone: {
        viewport: { width: 375, height: 812, isMobile: true },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      iPad: {
        viewport: { width: 768, height: 1024, isMobile: true },
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
      },
      Android: {
        viewport: { width: 360, height: 640, isMobile: true },
        userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120',
      },
    };

    const normalized = String(deviceName || '')
      .trim()
      .toLowerCase();
    let resolvedDevice: 'iPhone' | 'iPad' | 'Android' | null = null;
    if (normalized.includes('iphone')) {
      resolvedDevice = 'iPhone';
    } else if (normalized.includes('ipad')) {
      resolvedDevice = 'iPad';
    } else if (normalized.includes('android') || normalized.includes('pixel')) {
      resolvedDevice = 'Android';
    }

    if (!resolvedDevice) {
      throw new Error(
        `Unsupported device "${deviceName}". Supported values include: iPhone, iPad, Android (aliases like "iPhone 13" are accepted).`,
      );
    }

    const device = devices[resolvedDevice];
    await page.setViewport(device.viewport);
    await page.setUserAgent(device.userAgent);

    logger.info(`Emulating ${resolvedDevice} (input: ${deviceName})`);
    return resolvedDevice;
  }

  async waitForNetworkIdle(timeout = 30000): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.waitForNetworkIdle({ timeout });
    logger.info('Network is idle');
  }

  async getLocalStorage(): Promise<Record<string, string>> {
    const page = await this.collector.getActivePage();

    const storage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          items[key] = localStorage.getItem(key) || '';
        }
      }
      return items;
    });

    logger.info(`Retrieved ${Object.keys(storage).length} localStorage items`);
    return storage;
  }

  async setLocalStorage(key: string, value: string): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate(
      (k, v) => {
        localStorage.setItem(k, v);
      },
      key,
      value,
    );

    logger.info(`Set localStorage: ${key}`);
  }

  async clearLocalStorage(): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate(() => {
      localStorage.clear();
    });

    logger.info('LocalStorage cleared');
  }

  async pressKey(key: string): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.keyboard.press(key as Parameters<typeof page.keyboard.press>[0]);
    logger.info(`Pressed key: ${key}`);
  }

  async uploadFile(selector: string, filePath: string): Promise<void> {
    const page = await this.collector.getActivePage();
    const input = await page.$(selector);

    if (!input) {
      throw new Error(`File input not found: ${selector}`);
    }

    await (input as unknown as UploadableElementHandle).uploadFile(filePath);
    logger.info(`File uploaded: ${filePath}`);
  }

  async getAllLinks(): Promise<Array<{ text: string; href: string }>> {
    const page = await this.collector.getActivePage();

    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll('a[href]');
      const result: Array<{ text: string; href: string }> = [];

      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i] as HTMLAnchorElement;
        result.push({
          text: anchor.textContent?.trim() || '',
          href: anchor.href,
        });
      }

      return result;
    });

    logger.info(`Found ${links.length} links`);
    return links;
  }

  async getPage() {
    return await this.collector.getActivePage();
  }
}

/**
 * Pre-flight CDP health check: verify the page CDP target is responsive.
 * After debugger enable + pause/resume, the Playwright CDP session can enter
 * a zombie state where Runtime.evaluate hangs indefinitely without firing
 * 'disconnected'. Without this check, page.evaluate() blocks for the full 30 s
 * timeout — with this check we fail fast (~3 s) with a clear message.
 */
async function checkPageCDPHealth(page: Page, timeoutMs = 500): Promise<void> {
  // Use AbortSignal-based timeout so the interrupt is truly async at the node level.
  const ac = new AbortController();
  const timer = asyncSetTimeout(timeoutMs, undefined, { signal: ac.signal }).then(() => {
    throw new Error('cdp_unreachable');
  });
  try {
    const cdp = await Promise.race([page.createCDPSession(), timer as unknown as Promise<never>]);
    await Promise.race([
      cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
      timer as unknown as Promise<never>,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'cdp_unreachable') {
      throw new Error(
        'CDP session unresponsive — the debugger may be blocking page evaluation. ' +
          'Call debugger_disable() before this tool, or run it before debugger_enable().',
        { cause: err },
      );
    }
    throw err;
  } finally {
    ac.abort();
  }
}

/**
 * Wrap a page.evaluate() call with:
 * 1. A CDP pre-flight health check (fails fast at ~3 s instead of 30 s)
 * 2. A hard timeout (30 s) as a backstop
 *
 * Supports both string expressions and function callbacks.
 */
export async function evaluateWithTimeout<Args extends readonly unknown[], Result>(
  page: Page,
  pageFunction: (...args: Args) => Result,
  ...args: Args
): Promise<Awaited<Result>>;
export async function evaluateWithTimeout(
  page: Page,
  pageFunction: string,
  ...args: readonly unknown[]
): Promise<unknown>;
export async function evaluateWithTimeout<Args extends readonly unknown[], Result>(
  page: Page,
  pageFunction: string | ((...args: never[]) => Result),
  ...args: Args
): Promise<Awaited<Result> | unknown> {
  const timeoutMs = 30000;

  // Fail fast: detect zombie CDP sessions before they block page.evaluate().
  await checkPageCDPHealth(page);

  return Promise.race([
    page.evaluate(
      pageFunction as string | ((...args: never[]) => Result),
      ...([...args] as never[]),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`page.evaluate timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Wrap a page.evaluateOnNewDocument() call with:
 * 1. A CDP pre-flight health check
 * 2. A hard timeout (30 s) as a backstop
 */
export async function evaluateOnNewDocumentWithTimeout<Args extends readonly unknown[], Result>(
  page: Page,
  pageFunction: string | ((...args: never[]) => Result),
  ...args: Args
): Promise<unknown> {
  const timeoutMs = 30000;

  // Fail fast: detect zombie CDP sessions before they block evaluateOnNewDocument().
  await checkPageCDPHealth(page);

  return Promise.race([
    page.evaluateOnNewDocument(
      pageFunction as string | ((...args: never[]) => Result),
      ...([...args] as never[]),
    ),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`page.evaluateOnNewDocument timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Wrap page.coverage.startJSCoverage() with a timeout.
 */
export async function coverageStartJSWithTimeout(
  page: any,
  options?: { resetOnNavigation?: boolean; reportAnonymousScripts?: boolean },
): Promise<void> {
  const timeoutMs = 30000;
  return Promise.race([
    page.coverage.startJSCoverage(options),
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`coverage.startJSCoverage timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Wrap page.coverage.startCSSCoverage() with a timeout.
 */
export async function coverageStartCSSWithTimeout(
  page: any,
  options?: { resetOnNavigation?: boolean },
): Promise<void> {
  const timeoutMs = 30000;
  return Promise.race([
    page.coverage.startCSSCoverage(options),
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`coverage.startCSSCoverage timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Wrap page.coverage.stopJSCoverage() with a timeout.
 */
export async function coverageStopJSWithTimeout(page: any): Promise<unknown> {
  const timeoutMs = 30000;
  return Promise.race([
    page.coverage.stopJSCoverage(),
    new Promise<unknown>((_, reject) =>
      setTimeout(
        () => reject(new Error(`coverage.stopJSCoverage timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}

/**
 * Wrap page.coverage.stopCSSCoverage() with a timeout.
 */
export async function coverageStopCSSWithTimeout(page: any): Promise<unknown> {
  const timeoutMs = 30000;
  return Promise.race([
    page.coverage.stopCSSCoverage(),
    new Promise<unknown>((_, reject) =>
      setTimeout(
        () => reject(new Error(`coverage.stopCSSCoverage timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}
