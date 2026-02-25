import type { CodeCollector } from '../../../../modules/collector/CodeCollector.js';
import type { PageController } from '../../../../modules/collector/PageController.js';
import type { ConsoleMonitor } from '../../../../modules/monitor/ConsoleMonitor.js';
import type { CamoufoxBrowserManager } from '../../../../modules/browser/CamoufoxBrowserManager.js';
import { logger } from '../../../../utils/logger.js';

interface BrowserControlHandlersDeps {
  collector: CodeCollector;
  pageController: PageController;
  consoleMonitor: ConsoleMonitor;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxManager: () => CamoufoxBrowserManager | null;
  getCamoufoxPage: () => Promise<any>;
}

export class BrowserControlHandlers {
  constructor(private deps: BrowserControlHandlersDeps) {}

  async handleBrowserLaunch(args: Record<string, unknown>) {
    const driver = (args.driver as string) || 'chrome';

    if (driver === 'camoufox') {
      const mode = (args.mode as string) ?? 'launch';

      if (mode === 'connect') {
        const wsEndpoint = args.wsEndpoint as string | undefined;
        if (!wsEndpoint) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error:
                      'wsEndpoint is required for connect mode. Use camoufox_server_launch first to get a wsEndpoint.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
        // Note: camoufoxManager is managed by parent class
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  driver: 'camoufox',
                  mode: 'connect',
                  wsEndpoint,
                  message: 'Connected to Camoufox server. Use page_navigate to begin.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'camoufox',
                mode: 'launch',
                message: 'Camoufox (Firefox) browser launched',
                note: 'Use page_navigate to begin. CDP debugger is limited in Firefox; network_enable and console_enable use Playwright events and are fully supported.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const mode = (args.mode as string) ?? 'launch';
    if (mode === 'connect') {
      const browserURL = args.browserURL as string | undefined;
      const wsEndpoint = args.wsEndpoint as string | undefined;
      const endpoint = browserURL || wsEndpoint;

      if (!endpoint) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: 'browserURL or wsEndpoint is required for chrome connect mode.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      await this.deps.collector.connect(endpoint);
      const status = await this.deps.collector.getStatus();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'chrome',
                mode: 'connect',
                endpoint,
                message: 'Connected to existing Chrome browser successfully',
                status,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const chromeHeadless =
      args.headless !== undefined ? (args.headless as boolean) : undefined;
    await this.deps.collector.init(chromeHeadless);
    const status = await this.deps.collector.getStatus();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              driver: 'chrome',
              message: 'Browser launched successfully',
              status,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleBrowserClose(_args: Record<string, unknown>) {
    await this.deps.collector.close();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Browser closed successfully',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handleBrowserStatus(_args: Record<string, unknown>) {
    const status = await this.deps.collector.getStatus();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ driver: 'chrome', ...status }, null, 2),
        },
      ],
    };
  }

  async handleBrowserListTabs(args: Record<string, unknown>) {
    try {
      const browserURL = args.browserURL as string | undefined;
      if (browserURL) {
        await this.deps.collector.connect(browserURL);
      }

      const pages = await this.deps.collector.listPages();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                count: pages.length,
                pages,
                hint: 'Use browser_select_tab(index=N) to switch to a specific tab',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to list tabs:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                hint: 'Make sure browser is attached via browser_attach first, or provide browserURL parameter',
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleBrowserSelectTab(args: Record<string, unknown>) {
    try {
      const index = args.index as number | undefined;
      const urlPattern = args.urlPattern as string | undefined;
      const titlePattern = args.titlePattern as string | undefined;

      if (index !== undefined) {
        await this.deps.collector.selectPage(index);
        const pages = await this.deps.collector.listPages();
        const selected = pages[index];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  selectedIndex: index,
                  url: selected?.url,
                  title: selected?.title,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const pages = await this.deps.collector.listPages();
      let matchIndex = -1;
      for (const page of pages) {
        if (urlPattern && page.url.includes(urlPattern)) {
          matchIndex = page.index;
          break;
        }
        if (titlePattern && page.title.includes(titlePattern)) {
          matchIndex = page.index;
          break;
        }
      }

      if (matchIndex === -1) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: 'No matching tab found',
                  availablePages: pages,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      await this.deps.collector.selectPage(matchIndex);
      const selected = pages[matchIndex];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                selectedIndex: matchIndex,
                url: selected?.url,
                title: selected?.title,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to select tab:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }

  async handleBrowserAttach(args: Record<string, unknown>) {
    try {
      const browserURL = args.browserURL as string | undefined;
      const wsEndpoint = args.wsEndpoint as string | undefined;
      const endpoint = browserURL || wsEndpoint;

      if (!endpoint) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { success: false, error: 'browserURL or wsEndpoint is required' },
                null,
                2
              ),
            },
          ],
        };
      }

      await this.deps.collector.connect(endpoint);
      const status = await this.deps.collector.getStatus();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Attached to existing browser successfully',
                endpoint,
                status,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to attach to browser:', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}
