import type { CodeCollector } from '@modules/collector/CodeCollector';
import { logger } from '@utils/logger';
import { PAGE_FRAME_SELECTOR_TIMEOUT_MS, PAGE_NETWORK_IDLE_TIMEOUT_MS } from '@src/constants';
import { setTimeout as asyncSetTimeout } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import type { Page, Frame, NewDocumentScriptEvaluation } from 'rebrowser-puppeteer-core';
import type { BrowserTargetInfo } from '@modules/browser/BrowserTargetSessionManager.shared';
import {
  toChromeCompatibleWaitUntil,
  type PageNavigationWaitUntil,
} from '@modules/browser/navigation-wait-until';

export interface FrameResolveOptions {
  /** URL substring to match against frame URLs */
  frameUrl?: string;
  /** CSS selector of the iframe element whose content frame to use */
  frameSelector?: string;
}

export interface NavigationOptions {
  waitUntil?: PageNavigationWaitUntil;
  timeout?: number;
}

export interface CookieReadOptions {
  urls?: string[];
}

type PageCookie = Awaited<ReturnType<Page['cookies']>>[number];

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  offset?: { x: number; y: number };
  timeout?: number;
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

interface UploadContextLike {
  $(selector: string): Promise<UploadableElementHandle | null>;
}

export class PageController {
  private pagePersistentScripts = new WeakMap<
    Page,
    Map<string, { source: string; identifier: string }>
  >();

  constructor(private collector: CodeCollector) {}

  private getChromeNavigationWaitUntil(
    waitUntil: PageNavigationWaitUntil = 'networkidle',
  ): ReturnType<typeof toChromeCompatibleWaitUntil> {
    return toChromeCompatibleWaitUntil(waitUntil);
  }

  async getBrowser(): Promise<ReturnType<CodeCollector['getBrowser']>> {
    return this.collector.getBrowser();
  }

  hasAttachedTargetSession(): boolean {
    return this.collector.getAttachedTargetSession() !== null;
  }

  getAttachedTargetInfo(): BrowserTargetInfo | null {
    return this.collector.getAttachedTargetInfo();
  }

  async evaluateAttachedTarget<T = unknown>(
    code: string,
    options?: { returnByValue?: boolean; awaitPromise?: boolean },
  ): Promise<T> {
    return (await this.collector.getBrowserTargetSessionManager().evaluate(code, options)) as T;
  }

  async addScriptToAttachedTarget(source: string): Promise<unknown> {
    return await this.collector
      .getBrowserTargetSessionManager()
      .addScriptToEvaluateOnNewDocument(source);
  }

  async addPersistentScriptToManagedTargets(
    source: string,
    options?: { id?: string; targetTypes?: string[]; evaluateNow?: boolean },
  ): Promise<{ identifier: string; appliedTargets: number }> {
    return await this.collector
      .getBrowserTargetSessionManager()
      .registerPersistentScript(source, options);
  }

  async addScriptToPageEvaluateOnNewDocument(
    source: string,
    options?: { id?: string },
  ): Promise<NewDocumentScriptEvaluation | { identifier: string; reused: true }> {
    const page = await this.collector.getActivePage();
    if (!options?.id) {
      return (await evaluateOnNewDocumentWithTimeout(page, source)) as NewDocumentScriptEvaluation;
    }

    const registry = this.getPagePersistentScriptRegistry(page);
    const existing = registry.get(options.id);
    if (existing?.source === source) {
      return {
        identifier: existing.identifier,
        reused: true,
      };
    }

    if (existing?.identifier) {
      await page.removeScriptToEvaluateOnNewDocument(existing.identifier).catch(() => {
        // Ignore stale identifier races; replacement registration below is the source of truth.
      });
    }

    const registration = (await evaluateOnNewDocumentWithTimeout(
      page,
      source,
    )) as NewDocumentScriptEvaluation;
    registry.set(options.id, {
      source,
      identifier: registration.identifier,
    });
    return registration;
  }

  private getPagePersistentScriptRegistry(
    page: Page,
  ): Map<string, { source: string; identifier: string }> {
    let registry = this.pagePersistentScripts.get(page);
    if (!registry) {
      registry = new Map<string, { source: string; identifier: string }>();
      this.pagePersistentScripts.set(page, registry);
    }
    return registry;
  }

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
      waitUntil: this.getChromeNavigationWaitUntil(options?.waitUntil),
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
      waitUntil: this.getChromeNavigationWaitUntil(options?.waitUntil),
      timeout: options?.timeout || 30000,
    });
    logger.info('Page reloaded');
  }

  async goBack(timeout = 10_000): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.goBack({ waitUntil: 'domcontentloaded', timeout });
    logger.info('Navigated back');
  }

  async goForward(timeout = 10_000): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.goForward({ waitUntil: 'domcontentloaded', timeout });
    logger.info('Navigated forward');
  }

  async click(
    selector: string,
    options?: ClickOptions,
    frameOptions?: FrameResolveOptions,
  ): Promise<void> {
    const page = await this.collector.getActivePage();
    const context = await this.resolveFrame(page, frameOptions);
    const timeout = options?.timeout;
    const clickOptions: ClickOptions = {
      button: options?.button || 'left',
      clickCount: options?.clickCount || 1,
      delay: options?.delay,
    };
    if (options?.offset) {
      clickOptions.offset = options.offset;
    }
    if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
      page.setDefaultTimeout(timeout);
      try {
        await context.click(selector, clickOptions);
      } finally {
        page.setDefaultTimeout(this.collector['config']?.timeout ?? 30000);
      }
    } else {
      await context.click(selector, clickOptions);
    }
    logger.info(
      `Clicked: ${selector}${frameOptions?.frameUrl || frameOptions?.frameSelector ? ' (in frame)' : ''}`,
    );
  }

  async type(
    selector: string,
    text: string,
    options?: TypeOptions,
    frameOptions?: FrameResolveOptions,
  ): Promise<void> {
    const page = await this.collector.getActivePage();
    const context = await this.resolveFrame(page, frameOptions);
    await context.type(selector, text, {
      delay: options?.delay,
    });
    logger.info(`Typed into ${selector}: ${text.substring(0, 20)}...`);
  }

  async select(
    selector: string,
    values: string[],
    frameOptions?: FrameResolveOptions,
  ): Promise<void> {
    const page = await this.collector.getActivePage();
    const context = await this.resolveFrame(page, frameOptions);
    await context.select(selector, ...values);
    logger.info(`Selected in ${selector}: ${values.join(', ')}`);
  }

  async hover(selector: string, frameOptions?: FrameResolveOptions): Promise<void> {
    const page = await this.collector.getActivePage();
    const context = await this.resolveFrame(page, frameOptions);
    await context.hover(selector);
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
      waitUntil: this.getChromeNavigationWaitUntil(),
      timeout: timeout || 30000,
    });
    logger.info('Navigation completed');
  }

  async evaluate<T>(code: string, frameOptions?: FrameResolveOptions): Promise<T> {
    const page = await this.collector.getActivePage();
    if (frameOptions?.frameUrl || frameOptions?.frameSelector) {
      const frame = await this.resolveFrame(page, frameOptions);
      const result = await evaluateOnContextWithTimeout(page, frame, code);
      logger.info('JavaScript executed (in frame)');
      return result as T;
    }
    const result = await evaluateWithTimeout(page, code);
    logger.info('JavaScript executed');
    return result as T;
  }

  /**
   * Resolve a child frame from the active page.
   * When no options are provided (or both fields are undefined), returns page.mainFrame().
   */
  async resolveFrame(page: Page, options?: FrameResolveOptions): Promise<Frame> {
    if (!options) return page.mainFrame();

    if (options.frameUrl) {
      const frames = page.frames();
      const frame = frames.find((f) => f.url().includes(options.frameUrl!));
      if (!frame) {
        const available = frames.map((f) => f.url()).filter((u) => u && u !== 'about:blank');
        throw new Error(
          `No frame matching URL substring "${options.frameUrl}". Available frames: ` +
            `${available.join(', ') || '(none)'}`,
        );
      }
      return frame;
    }

    if (options.frameSelector) {
      await page
        .waitForSelector(options.frameSelector, { timeout: PAGE_FRAME_SELECTOR_TIMEOUT_MS })
        .catch(() => null);
      const handle = await page.$(options.frameSelector);
      if (!handle) {
        throw new Error(`No element found for iframe selector: ${options.frameSelector}`);
      }
      const frame = await handle.contentFrame();
      if (!frame) {
        throw new Error(
          `Element "${options.frameSelector}" exists but has no content frame (not an iframe or not yet loaded).`,
        );
      }
      return frame;
    }

    return page.mainFrame();
  }

  /** List all frames in the active page with URL and name info. */
  async listFrames(): Promise<
    Array<{
      frameId: string;
      url: string;
      name: string;
      parentFrameId: string | null;
      parentUrl: string | null;
      isMainFrame: boolean;
      crossOrigin: boolean;
    }>
  > {
    const page = await this.collector.getActivePage();
    const mainFrame = page.mainFrame();
    const frames = page.frames();
    const mainOrigin = safeFrameOrigin(mainFrame.url());

    return frames.map((frame) => {
      const frameId =
        ((frame as unknown as Record<string, unknown>)['_id'] as string | undefined) || frame.url();
      const parent = frame.parentFrame();
      const parentId = parent
        ? ((parent as unknown as Record<string, unknown>)['_id'] as string | undefined) ||
          parent.url()
        : null;
      const frameOrigin = safeFrameOrigin(frame.url());

      return {
        frameId,
        url: frame.url(),
        name: frame.name() || '',
        parentFrameId: parentId,
        parentUrl: parent?.url() || null,
        isMainFrame: frame === mainFrame,
        crossOrigin: Boolean(
          frame !== mainFrame && frameOrigin && mainOrigin && frameOrigin !== mainOrigin,
        ),
      };
    });
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
    // Prefer CDP path: avoids the Network.enable timeout that page.screenshot()
    // triggers on WebGL/Canvas-heavy tabs.
    if (this.hasAttachedTargetSession()) {
      const mgr = this.collector.getBrowserTargetSessionManager();
      if (mgr) {
        const buf = await mgr.captureScreenshot({
          format: options?.type ?? 'png',
          quality: options?.quality,
          clip: options?.clip,
        });
        logger.info(`Screenshot taken via CDP${options?.path ? `: ${options.path}` : ''}`);
        if (options?.path) {
          await writeFile(options.path, buf);
        }
        return buf;
      }
    }

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

  async getCookies(options: CookieReadOptions = {}): Promise<PageCookie[]> {
    const page = await this.collector.getActivePage();
    const urls = options.urls?.filter((url) => url.length > 0);
    if (urls && urls.length > 0) {
      const cookies = await page.cookies(...urls);
      logger.info(`Retrieved ${cookies.length} cookies for ${urls.length} URL(s)`);
      return cookies;
    }

    let cdp: Awaited<ReturnType<Page['createCDPSession']>> | undefined;
    try {
      cdp = await page.createCDPSession();
      const result = (await cdp.send('Network.getAllCookies')) as { cookies?: PageCookie[] };
      if (Array.isArray(result.cookies)) {
        logger.info(`Retrieved ${result.cookies.length} cookies across all origins`);
        return result.cookies;
      }
    } catch (error) {
      logger.warn(
        `Falling back to page-scoped cookie read: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      const detach = (cdp as { detach?: () => Promise<void> } | undefined)?.detach;
      if (typeof detach === 'function') {
        await detach.call(cdp).catch(() => undefined);
      }
    }

    const cookies = await page.cookies();
    logger.info(`Retrieved ${cookies.length} cookies`);
    return cookies;
  }

  async clearCookies(): Promise<void> {
    if (this.collector.isExistingBrowserConnection()) {
      throw new Error(
        'Cannot clear cookies on an attached browser. ' +
          'This operation is restricted to browsers launched by jshook to prevent accidental modification of user data.',
      );
    }
    const page = await this.collector.getActivePage();
    const cookies = await this.getCookies();
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
        `Unsupported device "${deviceName}". Supported values include: iPhone, iPad, Android (aliases like "iPhone ` +
          `13" are accepted).`,
      );
    }

    const device = devices[resolvedDevice];
    await page.setViewport(device.viewport);
    await page.setUserAgent(device.userAgent);

    logger.info(`Emulating ${resolvedDevice} (input: ${deviceName})`);
    return resolvedDevice;
  }

  async waitForNetworkIdle(timeout = PAGE_NETWORK_IDLE_TIMEOUT_MS): Promise<void> {
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
    if (this.collector.isExistingBrowserConnection()) {
      throw new Error(
        'Cannot clear localStorage on an attached browser. ' +
          'This operation is restricted to browsers launched by jshook to prevent accidental modification of user data.',
      );
    }
    const page = await this.collector.getActivePage();

    await page.evaluate(() => {
      localStorage.clear();
    });

    logger.info('LocalStorage cleared');
  }

  // ── sessionStorage ──

  async getSessionStorage(): Promise<Record<string, string>> {
    const page = await this.collector.getActivePage();
    const storage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) items[key] = sessionStorage.getItem(key) || '';
      }
      return items;
    });
    logger.info(`Retrieved ${Object.keys(storage).length} sessionStorage items`);
    return storage;
  }

  async setSessionStorage(key: string, value: string): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate(
      (k, v) => {
        sessionStorage.setItem(k, v);
      },
      key,
      value,
    );
    logger.info(`Set sessionStorage: ${key}`);
  }

  async clearSessionStorage(): Promise<void> {
    if (this.collector.isExistingBrowserConnection()) {
      throw new Error(
        'Cannot clear sessionStorage on an attached browser. ' +
          'This operation is restricted to browsers launched by jshook to prevent accidental modification of user data.',
      );
    }
    const page = await this.collector.getActivePage();
    await page.evaluate(() => {
      sessionStorage.clear();
    });
    logger.info('SessionStorage cleared');
  }

  // ── WebAuthn passkey seeding ──

  async seedWebAuthnCredential(options: {
    relyingPartyId: string;
    credentialId: string;
    userHandle: string;
    privateKey: string;
    publicKey?: string;
    userDisplayName?: string;
  }): Promise<{ authenticatorId: string; credentialId: string }> {
    const page = await this.collector.getActivePage();
    const cdp = await page.createCDPSession();
    try {
      await cdp.send('WebAuthn.enable', { enableUI: true });
      const authResult = (await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      })) as { authenticatorId: string };
      await cdp.send('WebAuthn.addCredential', {
        authenticatorId: authResult.authenticatorId,
        credential: {
          credentialId: options.credentialId,
          isResidentCredential: true,
          privateKey: options.privateKey,
          signCount: 0,
          rpId: options.relyingPartyId,
          userHandle: options.userHandle,
          userDisplayName: options.userDisplayName ?? 'jshook user',
          ...(options.publicKey ? { publicKey: options.publicKey } : {}),
        },
      });
      logger.info(`Seeded WebAuthn credential for ${options.relyingPartyId}`);
      return { authenticatorId: authResult.authenticatorId, credentialId: options.credentialId };
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  async pressKey(key: string): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.keyboard.press(key as Parameters<typeof page.keyboard.press>[0]);
    logger.info(`Pressed key: ${key}`);
  }

  async uploadFile(
    selector: string,
    filePath: string | string[],
    frameOptions?: FrameResolveOptions,
  ): Promise<void> {
    const page = await this.collector.getActivePage();
    const context = frameOptions
      ? ((await this.resolveFrame(page, frameOptions)) as unknown as UploadContextLike)
      : (page as unknown as UploadContextLike);
    const input = await context.$(selector);

    if (!input) {
      throw new Error(`File input not found: ${selector}`);
    }

    const filePaths = Array.isArray(filePath) ? filePath : [filePath];
    await (input as unknown as UploadableElementHandle).uploadFile(...filePaths);
    logger.info(`File uploaded: ${filePaths.join(', ')}`);
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

  async getActivePage() {
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
  let cdp: import('rebrowser-puppeteer-core').CDPSession | null = null;
  try {
    cdp = await Promise.race([page.createCDPSession(), timer as unknown as Promise<never>]);
    await Promise.race([
      cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
      timer as unknown as Promise<never>,
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'cdp_unreachable') {
      throw new Error(
        'CDP session unresponsive — the debugger may be blocking page evaluation. ' +
          "Call debugger_lifecycle({ action: 'disable' })() before this tool, or run it before " +
          "debugger_lifecycle({ action: 'enable' })().",
        { cause: err },
      );
    }
    throw err;
  } finally {
    ac.abort();
    if (cdp) {
      try {
        await cdp.detach();
      } catch {
        // Best-effort detach — session may already be closed
      }
    }
  }
}

interface EvaluateContextLike {
  evaluate<Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
  evaluate<Arg, Result>(
    pageFunction: (arg: Arg) => Result | Promise<Result>,
    arg: Arg,
  ): Promise<Result>;
  evaluate<Args extends readonly unknown[], Result>(
    pageFunction: string | ((...args: Args) => Result | Promise<Result>),
    ...args: Args
  ): Promise<Result>;
}

/**
 * Wrap a page.evaluate() call with:
 * 1. A CDP pre-flight health check (fails fast at ~3 s instead of 30 s)
 * 2. A hard timeout (30 s) as a backstop
 *
 * Supports both string expressions and function callbacks.
 */
export async function evaluateOnContextWithTimeout<Args extends readonly unknown[], Result>(
  page: Page,
  context: EvaluateContextLike,
  pageFunction: (...args: Args) => Result,
  ...args: Args
): Promise<Awaited<Result>>;
export async function evaluateOnContextWithTimeout(
  page: Page,
  context: EvaluateContextLike,
  pageFunction: string,
  ...args: readonly unknown[]
): Promise<unknown>;
export async function evaluateOnContextWithTimeout<Args extends readonly unknown[], Result>(
  page: Page,
  context: EvaluateContextLike,
  pageFunction: string | ((...args: never[]) => Result),
  ...args: Args
): Promise<Awaited<Result> | unknown> {
  const timeoutMs = 30000;

  // Fail fast: detect zombie CDP sessions before they block evaluate().
  await checkPageCDPHealth(page);

  // Race evaluate against a timer; clear the timer when evaluate wins so we don't
  // leave a dangling setTimeout. NOTE: Playwright/Puppeteer don't expose a clean
  // way to cancel an in-flight evaluate(), so the JS still runs to completion in
  // the page — the timeout only protects the caller from blocking forever.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      context.evaluate(
        pageFunction as string | ((...args: never[]) => Result),
        ...([...args] as never[]),
      ),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`page.evaluate timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

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
  return evaluateOnContextWithTimeout(
    page,
    page,
    pageFunction as any,
    ...(args as unknown as never[]),
  );
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

function safeFrameOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Structural type for pages with coverage API (Puppeteer / rebrowser-puppeteer). */
interface CoveragePage {
  coverage: {
    startJSCoverage(options?: {
      resetOnNavigation?: boolean;
      reportAnonymousScripts?: boolean;
    }): Promise<void>;
    stopJSCoverage(): Promise<unknown>;
    startCSSCoverage(options?: { resetOnNavigation?: boolean }): Promise<void>;
    stopCSSCoverage(): Promise<unknown>;
  };
}

/**
 * Wrap page.coverage.startJSCoverage() with a timeout.
 */
export async function coverageStartJSWithTimeout(
  page: CoveragePage,
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
  page: CoveragePage,
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
export async function coverageStopJSWithTimeout(page: CoveragePage): Promise<unknown> {
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
export async function coverageStopCSSWithTimeout(page: CoveragePage): Promise<unknown> {
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
