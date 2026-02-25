import type { PageController } from '../../../../modules/collector/PageController.js';

interface PageInteractionHandlersDeps {
  pageController: PageController;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<any>;
}

export class PageInteractionHandlers {
  constructor(private deps: PageInteractionHandlersDeps) {}

  async handlePageClick(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const button = args.button as any;
    const clickCount = args.clickCount as number;
    const delay = args.delay as number;

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = await this.deps.getCamoufoxPage();
      await page.click(selector, { button, clickCount, delay });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, driver: 'camoufox', message: `Clicked: ${selector}` },
              null,
              2
            ),
          },
        ],
      };
    }

    try {
      await this.deps.pageController.click(selector, { button, clickCount, delay });
    } catch (error: any) {
      const msg = error?.message || '';
      if (
        msg.includes('detached') ||
        msg.includes('timed out') ||
        msg.includes('Execution context was destroyed') ||
        msg.includes('callFunctionOn') ||
        msg.includes('Target closed')
      ) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Clicked ${selector} - navigation triggered`,
                  navigated: true,
                },
                null,
                2
              ),
            },
          ],
        };
      }
      throw error;
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Clicked: ${selector}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageType(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const text = args.text as string;
    const delay = args.delay as number;

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = await this.deps.getCamoufoxPage();
      await page.fill(selector, text);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, driver: 'camoufox', message: `Typed into ${selector}` },
              null,
              2
            ),
          },
        ],
      };
    }

    await this.deps.pageController.type(selector, text, { delay });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Typed into ${selector}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageSelect(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const values = args.values as string[];

    await this.deps.pageController.select(selector, ...values);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Selected in ${selector}: ${values.join(', ')}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageHover(args: Record<string, unknown>) {
    const selector = args.selector as string;

    await this.deps.pageController.hover(selector);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Hovered: ${selector}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageScroll(args: Record<string, unknown>) {
    const x = args.x as number;
    const y = args.y as number;

    await this.deps.pageController.scroll({ x, y });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Scrolled to: x=${x || 0}, y=${y || 0}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePagePressKey(args: Record<string, unknown>) {
    const key = args.key as string;

    await this.deps.pageController.pressKey(key);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              key,
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
