import type { PageController } from '../../../../modules/collector/PageController.js';

interface CamoufoxPageLike {
  click(
    selector: string,
    options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number; delay?: number }
  ): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
}

interface PageInteractionHandlersDeps {
  pageController: PageController;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<unknown>;
}

export class PageInteractionHandlers {
  constructor(private deps: PageInteractionHandlersDeps) {}

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return typeof error === 'string' ? error : '';
  }

  private parseNumberArg(
    value: unknown,
    options: { defaultValue?: number; min?: number; max?: number; integer?: boolean } = {}
  ): number | undefined {
    let parsed: number | undefined;

    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        const n = Number(trimmed);
        if (Number.isFinite(n)) {
          parsed = n;
        }
      }
    }

    if (parsed === undefined) {
      parsed = options.defaultValue;
    }
    if (parsed === undefined) {
      return undefined;
    }

    if (options.integer) {
      parsed = Math.trunc(parsed);
    }
    if (typeof options.min === 'number') {
      parsed = Math.max(options.min, parsed);
    }
    if (typeof options.max === 'number') {
      parsed = Math.min(options.max, parsed);
    }
    return parsed;
  }

  private parseMouseButton(value: unknown): 'left' | 'right' | 'middle' {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'left' || normalized === 'right' || normalized === 'middle') {
        return normalized;
      }
    }
    return 'left';
  }

  async handlePageClick(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const button = this.parseMouseButton(args.button);
    const clickCount = this.parseNumberArg(args.clickCount, {
      defaultValue: 1,
      min: 1,
      max: 10,
      integer: true,
    });
    const delay = this.parseNumberArg(args.delay, {
      min: 0,
      max: 60000,
      integer: true,
    });

    if (!selector || typeof selector !== 'string' || selector.trim().length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                message: 'selector parameter is required',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
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
    } catch (error: unknown) {
      const msg = this.toErrorMessage(error);
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
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
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
