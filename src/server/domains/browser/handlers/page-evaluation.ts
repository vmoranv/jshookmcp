import type { PageController } from '../../../../modules/collector/PageController.js';
import type { DetailedDataManager } from '../../../../utils/DetailedDataManager.js';
import { resolveScreenshotOutputPath } from '../../../../utils/outputPaths.js';

interface CamoufoxElementLike {
  screenshot(options: {
    path?: string;
    type?: 'png' | 'jpeg';
    quality?: number;
  }): Promise<Buffer>;
}

interface CamoufoxPageLike {
  evaluate<Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
  $(selector: string): Promise<CamoufoxElementLike | null>;
  screenshot(options: {
    path?: string;
    type?: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
  }): Promise<Buffer>;
}

interface PageEvaluationHandlersDeps {
  pageController: PageController;
  detailedDataManager: DetailedDataManager;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<unknown>;
}

/** Recursively remove keys listed in `fields` from any nested object/array. */
function filterFields(value: unknown, fields: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => filterFields(item, fields));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!fields.has(k)) {
        out[k] = filterFields(v, fields);
      }
    }
    return out;
  }
  return value;
}

/**
 * Recursively replace base64 payloads with a short placeholder.
 * Catches:  data:[mime];base64,<payload>  and  bare strings >500 chars of [A-Za-z0-9+/=]
 */
function stripBase64Values(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^data:[a-z+\-]+\/[a-z+\-]+;base64,/i.test(value)) {
      return `[base64 ~${Math.round(value.length / 1024)}KB stripped]`;
    }
    if (value.length > 500 && /^[A-Za-z0-9+/=\r\n]+$/.test(value.replace(/\s/g, ''))) {
      return `[base64 ~${value.length}chars stripped]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripBase64Values(item));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = stripBase64Values(v);
    }
    return out;
  }
  return value;
}

export class PageEvaluationHandlers {
  constructor(private deps: PageEvaluationHandlersDeps) {}

  async handlePageEvaluate(args: Record<string, unknown>) {
    const code = (args.script ?? args.code) as string;
    const autoSummarize = (args.autoSummarize as boolean) ?? true;
    const maxSize = (args.maxSize as number) ?? 51200;
    const fieldFilterArg = args.fieldFilter as string[] | undefined;
    const doStripBase64 = (args.stripBase64 as boolean) ?? false;

    const applyPostFilters = (raw: unknown): unknown => {
      let out = raw;
      if (fieldFilterArg && fieldFilterArg.length > 0) {
        out = filterFields(out, new Set(fieldFilterArg));
      }
      if (doStripBase64) {
        out = stripBase64Values(out);
      }
      return out;
    };

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
      const evaluateExpression = new Function(`return (${code})`) as () => unknown;
      const result = await page.evaluate(evaluateExpression);
      const processedResult = applyPostFilters(
        autoSummarize ? this.deps.detailedDataManager.smartHandle(result, maxSize) : result
      );
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

    const processedResult = applyPostFilters(
      autoSummarize ? this.deps.detailedDataManager.smartHandle(result, maxSize) : result
    );

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
    const selectorRaw = typeof args.selector === 'string' ? args.selector.trim() : '';
    const selector = selectorRaw.length > 0 && selectorRaw.toLowerCase() !== 'all' ? selectorRaw : '';

    const { absolutePath, displayPath } = await resolveScreenshotOutputPath({
      requestedPath,
      type,
      fallbackName: selector ? 'element' : 'page',
      fallbackDir: 'screenshots/manual',
    });

    if (this.deps.getActiveDriver() === 'camoufox') {
      const page = (await this.deps.getCamoufoxPage()) as CamoufoxPageLike;
      let buffer: Buffer | undefined;
      if (selector) {
        const element = await page.$(selector);
        if (!element) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: false, error: `Element not found: ${selector}` }, null, 2),
            }],
          };
        }
        buffer = await element.screenshot({ path: absolutePath, type, quality });
      } else {
        buffer = await page.screenshot({ path: absolutePath, type, quality, fullPage });
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

    let buffer: Buffer;
    if (selector) {
      const page = await this.deps.pageController.getPage();
      const element = await page.$(selector);
      if (!element) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: false, error: `Element not found: ${selector}` }, null, 2),
          }],
        };
      }
      buffer = (await element.screenshot({ path: absolutePath, type, quality })) as Buffer;
    } else {
      buffer = await this.deps.pageController.screenshot({
        path: absolutePath,
        type,
        quality,
        fullPage,
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
