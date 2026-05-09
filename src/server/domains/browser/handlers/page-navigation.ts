import type { PageController } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type { TabRegistry } from '@modules/browser/TabRegistry';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { parsePageNavigationWaitUntil } from '@server/domains/browser/page-navigation-wait-until';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

interface CamoufoxPageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  reload(): Promise<unknown>;
  goBack(): Promise<unknown>;
  goForward(): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
}

interface PageNavigationHandlersDeps {
  pageController: PageController;
  consoleMonitor: ConsoleMonitor;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<unknown>;
  getTabRegistry?: () => TabRegistry;
  eventBus?: EventBus<ServerEventMap>;
}

export class PageNavigationHandlers {
  constructor(private deps: PageNavigationHandlersDeps) {}

  private syncCurrentTabMeta(page: unknown, meta: { url?: string; title?: string }): void {
    const registry = this.deps.getTabRegistry?.();
    if (!registry || !page || !meta.url || meta.title === undefined) {
      return;
    }

    const url = meta.url;
    const title = meta.title;
    const pageId = registry.upsertPage(page, { url, title });
    registry.setCurrentPageId(pageId);
  }

  private async getChromePageIfAvailable(): Promise<unknown | null> {
    const pageControllerRecord = this.deps.pageController as unknown as Record<string, unknown>;
    const getPage = pageControllerRecord['getPage'];
    if (typeof getPage !== 'function') {
      return null;
    }
    return await Reflect.apply(getPage, this.deps.pageController, []);
  }

  private async getCamoufoxTitleIfAvailable(page: unknown): Promise<string | undefined> {
    const record = page as Record<string, unknown>;
    const getTitle = record['title'];
    if (typeof getTitle !== 'function') {
      return undefined;
    }
    const title = await Reflect.apply(getTitle, page, []);
    return typeof title === 'string' ? title : undefined;
  }

  private getCamoufoxUrlIfAvailable(page: unknown): string | undefined {
    const record = page as Record<string, unknown>;
    const getUrl = record['url'];
    if (typeof getUrl !== 'function') {
      return undefined;
    }
    const url = Reflect.apply(getUrl, page, []);
    return typeof url === 'string' ? url : undefined;
  }

  async handlePageNavigate(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const url = argString(args, 'url', '');
      const waitUntil = parsePageNavigationWaitUntil(args);
      const timeout = argNumber(args, 'timeout');
      const enableNetworkMonitoring = argBool(args, 'enableNetworkMonitoring');

      // Camoufox (Playwright) path
      if (this.deps.getActiveDriver() === 'camoufox') {
        const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
        await page.goto(url, { waitUntil, timeout });

        // setPlaywrightPage must come before enable() so the Playwright path is used
        this.deps.consoleMonitor.setPlaywrightPage(page);
        if (enableNetworkMonitoring) {
          await this.deps.consoleMonitor.enable({ enableNetwork: true, enableExceptions: true });
        }

        const navigatedUrl = this.getCamoufoxUrlIfAvailable(page) ?? '';
        const title = await this.getCamoufoxTitleIfAvailable(page);
        this.syncCurrentTabMeta(page, { url: navigatedUrl, title });
        void this.deps.eventBus?.emit('browser:navigated', {
          url: navigatedUrl,
          timestamp: new Date().toISOString(),
        });

        return R.ok().build({
          driver: 'camoufox',
          url: navigatedUrl,
          title: title ?? '',
          network_monitoring: {
            enabled: this.deps.consoleMonitor.isNetworkEnabled(),
          },
        });
      }

      // Enable network monitoring for Chrome path
      if (enableNetworkMonitoring) {
        await this.deps.consoleMonitor.enable({ enableNetwork: true, enableExceptions: true });
      }

      await this.deps.pageController.navigate(url, { waitUntil, timeout });

      const page = await this.getChromePageIfAvailable();
      const currentUrl = await this.deps.pageController.getURL();
      const title = await this.deps.pageController.getTitle();
      this.syncCurrentTabMeta(page, { url: currentUrl, title });
      void this.deps.eventBus?.emit('browser:navigated', {
        url: currentUrl,
        timestamp: new Date().toISOString(),
      });

      return R.ok().build({
        url: currentUrl,
        title,
        network_monitoring: {
          enabled: this.deps.consoleMonitor.isNetworkEnabled(),
        },
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageReload(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      if (this.deps.getActiveDriver() === 'camoufox') {
        const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
        await page.reload();
        this.syncCurrentTabMeta(page, {
          url: this.getCamoufoxUrlIfAvailable(page),
          title: await this.getCamoufoxTitleIfAvailable(page),
        });
        return R.ok().build({ message: 'Page reloaded', driver: 'camoufox' });
      }

      await this.deps.pageController.reload();
      const page = await this.getChromePageIfAvailable();
      this.syncCurrentTabMeta(page, {
        url: await this.deps.pageController.getURL(),
        title: await this.deps.pageController.getTitle(),
      });

      return R.ok().build({
        message: 'Page reloaded',
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageBack(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const timeout = argNumber(args, 'timeout', 10_000);

      if (this.deps.getActiveDriver() === 'camoufox') {
        const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
        await page.goBack();
        this.syncCurrentTabMeta(page, {
          url: this.getCamoufoxUrlIfAvailable(page),
          title: await this.getCamoufoxTitleIfAvailable(page),
        });
        return R.ok().build({ url: this.getCamoufoxUrlIfAvailable(page), driver: 'camoufox' });
      }

      await this.deps.pageController.goBack(timeout);
      const page = await this.getChromePageIfAvailable();
      const url = await this.deps.pageController.getURL();
      this.syncCurrentTabMeta(page, {
        url,
        title: await this.deps.pageController.getTitle(),
      });

      return R.ok().build({
        url,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageForward(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const timeout = argNumber(args, 'timeout', 10_000);

      if (this.deps.getActiveDriver() === 'camoufox') {
        const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
        await page.goForward();
        this.syncCurrentTabMeta(page, {
          url: this.getCamoufoxUrlIfAvailable(page),
          title: await this.getCamoufoxTitleIfAvailable(page),
        });
        return R.ok().build({ url: this.getCamoufoxUrlIfAvailable(page), driver: 'camoufox' });
      }

      await this.deps.pageController.goForward(timeout);
      const page = await this.getChromePageIfAvailable();
      const url = await this.deps.pageController.getURL();
      this.syncCurrentTabMeta(page, {
        url,
        title: await this.deps.pageController.getTitle(),
      });

      return R.ok().build({
        url,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}
