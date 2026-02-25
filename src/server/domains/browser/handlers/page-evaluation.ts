import type { PageController } from '../../../../modules/collector/PageController.js';
import type { DetailedDataManager } from '../../../../utils/DetailedDataManager.js';
import { resolveScreenshotOutputPath } from '../../../../utils/outputPaths.js';

interface PageEvaluationHandlersDeps {
  pageController: PageController;
  detailedDataManager: DetailedDataManager;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<any>;
}

export class PageEvaluationHandlers {
  constructor(private deps: PageEvaluationHandlersDeps) {}

  async handlePageEvaluate(args: Record<string, unknown>) {
    const code = (args.script ?? args.code) as string;
    const autoSummarize = (args.autoSummarize as boolean) ?? true;
    const maxSize = (args.maxSize as number) ?? 51200;

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = await this.deps.getCamoufoxPage();
      const result = await page.evaluate(new Function(`return (${code})`) as any);
      const processedResult = autoSummarize
        ? this.deps.detailedDataManager.smartHandle(result, maxSize)
        : result;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, driver: 'camoufox', result: processedResult },
              null,
              2
            ),
          },
        ],
      };
    }

    const result = await this.deps.pageController.evaluate(code);

    const processedResult = autoSummarize
      ? this.deps.detailedDataManager.smartHandle(result, maxSize)
      : result;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              result: processedResult,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageScreenshot(args: Record<string, unknown>) {
    const requestedPath = args.path as string | undefined;
    const type = ((args.type as 'png' | 'jpeg') || 'png') as 'png' | 'jpeg';
    const quality = args.quality as number;
    const fullPage = args.fullPage as boolean;
    const { absolutePath, displayPath } = await resolveScreenshotOutputPath({
      requestedPath,
      type,
      fallbackName: 'page',
      fallbackDir: 'screenshots/manual',
    });

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = await this.deps.getCamoufoxPage();
      const buffer = await page.screenshot({ path: absolutePath, type, quality, fullPage });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'camoufox',
                message: `Screenshot taken: ${displayPath}`,
                path: displayPath,
                size: buffer?.length ?? 0,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const buffer = await this.deps.pageController.screenshot({
      path: absolutePath,
      type,
      quality,
      fullPage,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: `Screenshot taken: ${displayPath}`,
              path: displayPath,
              size: buffer.length,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageInjectScript(args: Record<string, unknown>) {
    const script = args.script as string;

    await this.deps.pageController.injectScript(script);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              message: 'Script injected',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  async handlePageWaitForSelector(args: Record<string, unknown>) {
    const selector = args.selector as string;
    const timeout = args.timeout as number;

    const result = await this.deps.pageController.waitForSelector(selector, timeout);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
}
