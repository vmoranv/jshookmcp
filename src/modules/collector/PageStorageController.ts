/**
 * Cookie / Web Storage operations for a managed page.
 *
 * Extracted from `PageController` so storage semantics (CDP cookie shape,
 * attached-browser guards) have one owner and can be tested without the rest of
 * the page API.
 */
import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { logger } from '@utils/logger';

export interface CookieReadOptions {
  urls?: string[];
}

export type PageCookie = Awaited<ReturnType<Page['cookies']>>[number];

/** A cookie as CDP announces it (Network.getAllCookies). */
interface RawCdpCookie {
  name: string;
  domain?: string;
  path?: string;
  partitionKey?: { topLevelSite?: string; hasCrossSiteAncestor?: boolean } | string;
}

/**
 * Turn read-back cookies into `page.deleteCookie` requests.
 *
 * `page.deleteCookie()` forwards each cookie OBJECT verbatim to CDP, and Chromium
 * accepts exactly `{ name, url?, domain?, path?, partitionKey? }` there. A cookie
 * from `Network.getAllCookies` carries far more, so its `partitionKey` arrives
 * as `{ topLevelSite, hasCrossSiteAncestor }` and Chromium rejects the whole
 * call. A partition key with no `topLevelSite` must be omitted rather than sent
 * as `{}`.
 */
function toDeleteCookieRequests(
  cookies: readonly RawCdpCookie[],
): Array<{ name: string; domain?: string; path?: string; partitionKey?: string }> {
  return cookies.map((cookie) => {
    const partitionSite =
      typeof cookie.partitionKey === 'string'
        ? cookie.partitionKey
        : cookie.partitionKey?.topLevelSite;
    return {
      name: cookie.name,
      ...(cookie.domain ? { domain: cookie.domain } : {}),
      ...(cookie.path ? { path: cookie.path } : {}),
      ...(partitionSite ? { partitionKey: partitionSite } : {}),
    };
  });
}

export class PageStorageController {
  private readonly collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  async setCookies(
    cookies: Array<{
      name: string;
      value: string;
      domain?: string;
      path?: string;
      url?: string;
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
    await page.deleteCookie(...toDeleteCookieRequests(cookies as unknown as RawCdpCookie[]));
    logger.info('All cookies cleared');
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
}
