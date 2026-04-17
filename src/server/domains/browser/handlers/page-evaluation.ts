import type { PageController } from '@server/domains/shared/modules';
import type { FrameResolveOptions } from '@modules/collector/PageController';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { resolveScreenshotOutputPath } from '@utils/outputPaths';
import {
  argString,
  argNumber,
  argBool,
  argObject,
  argStringArray,
} from '@server/domains/shared/parse-args';
import { applyEvaluationPostFilters } from '@server/domains/browser/handlers/evaluation-utils';

interface CamoufoxElementLike {
  screenshot(options: { path?: string; type?: 'png' | 'jpeg'; quality?: number }): Promise<Buffer>;
}

interface CamoufoxEvaluateContextLike {
  evaluate<Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
  evaluate<Arg, Result>(
    pageFunction: (arg: Arg) => Result | Promise<Result>,
    arg: Arg,
  ): Promise<Result>;
}

interface CamoufoxFrameLike extends CamoufoxEvaluateContextLike {
  url(): string;
}

interface CamoufoxPageLike extends CamoufoxEvaluateContextLike {
  $(selector: string): Promise<CamoufoxElementLike | null>;
  screenshot(options: {
    path?: string;
    type?: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
  }): Promise<Buffer>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  frames(): CamoufoxFrameLike[];
  mainFrame(): CamoufoxFrameLike;
}

interface PageEvaluationHandlersDeps {
  pageController: PageController;
  detailedDataManager: DetailedDataManager;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<unknown>;
}

export class PageEvaluationHandlers {
  constructor(private deps: PageEvaluationHandlersDeps) {}

  private async getCamoufoxEvaluationContext(
    frameOptions?: FrameResolveOptions,
  ): Promise<CamoufoxEvaluateContextLike> {
    const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
    if (!frameOptions?.frameUrl && !frameOptions?.frameSelector) {
      return page;
    }
    return (await this.deps.pageController.resolveFrame(
      page as any,
      frameOptions,
    )) as unknown as CamoufoxEvaluateContextLike;
  }

  async handlePageEvaluate(args: Record<string, unknown>) {
    const code = argString(args, 'script', '') || argString(args, 'code', '');
    const autoSummarize = argBool(args, 'autoSummarize', true);
    const maxSize = argNumber(args, 'maxSize', 51200);
    const fieldFilterArg = argStringArray(args, 'fieldFilter');
    const doStripBase64 = argBool(args, 'stripBase64', false);
    const frameUrl = argString(args, 'frameUrl');
    const frameSelector = argString(args, 'frameSelector');

    const frameOptions: FrameResolveOptions | undefined =
      frameUrl || frameSelector
        ? { frameUrl: frameUrl || undefined, frameSelector: frameSelector || undefined }
        : undefined;

    if (this.deps.getActiveDriver() === 'camoufox') {
      const context = await this.getCamoufoxEvaluationContext(frameOptions);
      const evaluateExpression = new Function(`return (${code})`) as () => unknown;
      const result = await context.evaluate(evaluateExpression);
      const processedResult = applyEvaluationPostFilters(result, this.deps.detailedDataManager, {
        autoSummarize,
        maxSize,
        fieldFilter: fieldFilterArg ?? undefined,
        stripBase64: doStripBase64,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'camoufox',
                ...(frameOptions ? { frame: frameOptions } : {}),
                result: processedResult,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const result = frameOptions
      ? await this.deps.pageController.evaluate(code, frameOptions)
      : await this.deps.pageController.evaluate(code);

    const processedResult = applyEvaluationPostFilters(result, this.deps.detailedDataManager, {
      autoSummarize,
      maxSize,
      fieldFilter: fieldFilterArg ?? undefined,
      stripBase64: doStripBase64,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              ...(frameOptions ? { frame: frameOptions } : {}),
              result: processedResult,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handlePageScreenshot(args: Record<string, unknown>) {
    const requestedPath = argString(args, 'path');
    const type = argString(args, 'type', 'png') as 'png' | 'jpeg';
    const quality = argNumber(args, 'quality');
    const fullPage = argBool(args, 'fullPage', false);
    const clipArg = argObject(args, 'clip') as
      | { x: number; y: number; width: number; height: number }
      | undefined;

    // Normalise selector: string | string[] | undefined
    const rawSelector = args.selector;
    const selectors: string[] = [];
    if (Array.isArray(rawSelector)) {
      for (const s of rawSelector) {
        const trimmed = typeof s === 'string' ? s.trim() : '';
        if (trimmed.length > 0 && trimmed.toLowerCase() !== 'all') selectors.push(trimmed);
      }
    } else if (typeof rawSelector === 'string') {
      const trimmed = rawSelector.trim();
      if (trimmed.length > 0 && trimmed.toLowerCase() !== 'all') selectors.push(trimmed);
    }

    // ── Batch mode: multiple selectors ──
    if (selectors.length > 1) {
      return this._screenshotBatch(selectors, requestedPath, type, quality);
    }

    // ── Single-selector / clip / full-page ──
    const selector = selectors[0] ?? '';

    const { absolutePath, displayPath, pathRewritten } = await resolveScreenshotOutputPath({
      requestedPath,
      type,
      fallbackName: selector ? 'element' : clipArg ? 'region' : 'page',
      fallbackDir: 'screenshots/manual',
    });

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
      let buffer: Buffer | undefined;
      if (selector) {
        const element = await page.$(selector);
        if (!element) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { success: false, error: `Element not found: ${selector}` },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        buffer = await element.screenshot({ path: absolutePath, type, quality });
      } else {
        // Camoufox page.screenshot doesn't expose clip natively; pass what we can
        buffer = await page.screenshot({
          path: absolutePath,
          type,
          quality,
          fullPage: clipArg ? false : fullPage,
        });
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'camoufox',
                selector: selector || undefined,
                clip: clipArg || undefined,
                message: `Screenshot taken: ${displayPath}`,
                path: displayPath,
                pathRewritten,
                size: buffer?.length ?? 0,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    let buffer: Buffer;
    if (selector) {
      const page = await this.deps.pageController.getPage();
      const element = await page.$(selector);
      if (!element) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { success: false, error: `Element not found: ${selector}` },
                null,
                2,
              ),
            },
          ],
        };
      }
      buffer = (await element.screenshot({ path: absolutePath, type, quality })) as Buffer;
    } else {
      buffer = await this.deps.pageController.screenshot({
        path: absolutePath,
        type,
        quality,
        fullPage: clipArg ? false : fullPage,
        clip: clipArg,
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              selector: selector || undefined,
              clip: clipArg || undefined,
              message: `Screenshot taken: ${displayPath}`,
              path: displayPath,
              pathRewritten,
              size: buffer.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  /** Take one screenshot per selector and return all results. */
  private async _screenshotBatch(
    selectors: string[],
    requestedPath: string | undefined,
    type: 'png' | 'jpeg',
    quality: number | undefined,
  ) {
    const isCamoufox = this.deps.getActiveDriver() === 'camoufox';
    const results: {
      selector: string;
      success: boolean;
      path?: string;
      size?: number;
      error?: string;
    }[] = [];

    for (const selector of selectors) {
      const { absolutePath, displayPath } = await resolveScreenshotOutputPath({
        requestedPath: requestedPath
          ? requestedPath.replace(/(\.\w+)$/, `-${selector.replace(/[^a-zA-Z0-9]/g, '_')}$1`)
          : undefined,
        type,
        fallbackName: `element-${selector.replace(/[^a-zA-Z0-9]/g, '_')}`,
        fallbackDir: 'screenshots/manual',
      });

      try {
        let size = 0;
        if (isCamoufox) {
          const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
          const element = await page.$(selector);
          if (!element) {
            results.push({ selector, success: false, error: `Element not found: ${selector}` });
            continue;
          }
          const buf = await element.screenshot({ path: absolutePath, type, quality });
          size = buf?.length ?? 0;
        } else {
          const page = await this.deps.pageController.getPage();
          const element = await page.$(selector);
          if (!element) {
            results.push({ selector, success: false, error: `Element not found: ${selector}` });
            continue;
          }
          const buf = (await element.screenshot({ path: absolutePath, type, quality })) as Buffer;
          size = buf.length;
        }
        results.push({ selector, success: true, path: displayPath, size });
      } catch (err) {
        results.push({ selector, success: false, error: String(err) });
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              mode: 'batch',
              total: selectors.length,
              succeeded: results.filter((r) => r.success).length,
              results,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async handlePageInjectScript(args: Record<string, unknown>) {
    const script = argString(args, 'script', '');

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
            2,
          ),
        },
      ],
    };
  }

  async handlePageWaitForSelector(args: Record<string, unknown>) {
    const selector = argString(args, 'selector', '');
    const timeout = argNumber(args, 'timeout');

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;

      try {
        await page.waitForSelector(selector, { timeout: timeout || 30000 });

        const element = await page.evaluate((sel: string) => {
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  driver: 'camoufox',
                  element,
                  message: `Selector appeared: ${selector}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  driver: 'camoufox',
                  message: `Timeout waiting for selector: ${selector}`,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    }

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
