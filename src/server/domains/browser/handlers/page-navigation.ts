import type { PageController } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/domains/shared/ResponseBuilder';

type ChromeNavigationWaitUntil = NonNullable<
  Parameters<PageController['navigate']>[1]
>['waitUntil'];

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
  eventBus?: EventBus<ServerEventMap>;
}

export class PageNavigationHandlers {
  constructor(private deps: PageNavigationHandlersDeps) {}

  async handlePageNavigate(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const url = argString(args, 'url', '');
      const rawWaitUntil = argString(args, 'waitUntil', 'networkidle');
      const timeout = argNumber(args, 'timeout');
      const enableNetworkMonitoring = argBool(args, 'enableNetworkMonitoring');

      // Camoufox (Playwright) path
      if (this.deps.getActiveDriver() === 'camoufox') {
        const playwrightWaitUntil = rawWaitUntil === 'networkidle2' ? 'networkidle' : rawWaitUntil;
        const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
        await page.goto(url, { waitUntil: playwrightWaitUntil, timeout });

        // setPlaywrightPage must come before enable() so the Playwright path is used
        this.deps.consoleMonitor.setPlaywrightPage(page);
        if (enableNetworkMonitoring) {
          await this.deps.consoleMonitor.enable({ enableNetwork: true, enableExceptions: true });
        }

        const navigatedUrl = page.url();
        void this.deps.eventBus?.emit('browser:navigated', {
          url: navigatedUrl,
          timestamp: new Date().toISOString(),
        });

        return R.ok().build({
          driver: 'camoufox',
          url: navigatedUrl,
          title: await page.title(),
          network_monitoring: {
            enabled: this.deps.consoleMonitor.isNetworkEnabled(),
          },
        });
      }

      // Enable network monitoring for Chrome path
      if (enableNetworkMonitoring) {
        await this.deps.consoleMonitor.enable({ enableNetwork: true, enableExceptions: true });
      }

      const waitUntilMap: Record<string, string> = {
        networkidle: 'networkidle2',
        commit: 'load',
      };
      const waitUntil = (waitUntilMap[rawWaitUntil] || rawWaitUntil) as ChromeNavigationWaitUntil;

      await this.deps.pageController.navigate(url, { waitUntil, timeout });

      const currentUrl = await this.deps.pageController.getURL();
      const title = await this.deps.pageController.getTitle();
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
        return R.ok().build({ message: 'Page reloaded', driver: 'camoufox' });
      }

      await this.deps.pageController.reload();

      return R.ok().build({
        message: 'Page reloaded',
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageBack(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      if (this.deps.getActiveDriver() === 'camoufox') {
        const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
        await page.goBack();
        return R.ok().build({ url: page.url(), driver: 'camoufox' });
      }

      await this.deps.pageController.goBack();
      const url = await this.deps.pageController.getURL();

      return R.ok().build({
        url,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }

  async handlePageForward(_args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      if (this.deps.getActiveDriver() === 'camoufox') {
        const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
        await page.goForward();
        return R.ok().build({ url: page.url(), driver: 'camoufox' });
      }

      await this.deps.pageController.goForward();
      const url = await this.deps.pageController.getURL();

      return R.ok().build({
        url,
      });
    } catch (e) {
      return R.fail(e).build();
    }
  }
}
