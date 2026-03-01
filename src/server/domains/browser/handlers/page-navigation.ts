import type { PageController } from '../../../../modules/collector/PageController.js';
import type { ConsoleMonitor } from '../../../../modules/monitor/ConsoleMonitor.js';

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
}

export class PageNavigationHandlers {
  constructor(private deps: PageNavigationHandlersDeps) {}

  async handlePageNavigate(args: Record<string, unknown>) {
    const url = args.url as string;
    const rawWaitUntil = (args.waitUntil as string) || 'networkidle';
    const timeout = args.timeout as number | undefined;
    const enableNetworkMonitoring = args.enableNetworkMonitoring as boolean | undefined;

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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'camoufox',
                captcha_detected: false,
                url: page.url(),
                title: await page.title(),
                network_monitoring: {
                  enabled: this.deps.consoleMonitor.isNetworkEnabled(),
                },
              },
              null,
              2
            ),
          },
        ],
      };
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

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              captcha_detected: false,
              url: currentUrl,
              title,
              network_monitoring: {
                enabled: this.deps.consoleMonitor.isNetworkEnabled(),
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageReload(_args: Record<string, unknown>) {
    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
      await page.reload();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, message: 'Page reloaded', driver: 'camoufox' },
              null,
              2
            ),
          },
        ],
      };
    }

    await this.deps.pageController.reload();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Page reloaded',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageBack(_args: Record<string, unknown>) {
    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
      await page.goBack();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, url: page.url(), driver: 'camoufox' },
              null,
              2
            ),
          },
        ],
      };
    }

    await this.deps.pageController.goBack();
    const url = await this.deps.pageController.getURL();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              url,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageForward(_args: Record<string, unknown>) {
    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
      await page.goForward();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, url: page.url(), driver: 'camoufox' },
              null,
              2
            ),
          },
        ],
      };
    }

    await this.deps.pageController.goForward();
    const url = await this.deps.pageController.getURL();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              url,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
