import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { 
  PageEvaluateResponse, 
  PageInjectScriptResponse, 
  PageScreenshotResponse, 
  PageWaitForSelectorResponse 
} from '../../shared/common-test-types';

vi.mock('@utils/outputPaths', () => ({
  resolveScreenshotOutputPath: vi.fn(async (opts: unknown) => ({
    absolutePath: `/tmp/screenshots/${opts.fallbackName || 'page'}.${opts.type || 'png'}`,
    displayPath: `screenshots/${opts.fallbackName || 'page'}.${opts.type || 'png'}`,
    pathRewritten: !opts.requestedPath,
  })),
}));

import { PageEvaluationHandlers } from '@server/domains/browser/handlers/page-evaluation';

interface PageControllerMock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  evaluate: Mock<(code: string) => Promise<any>>;
  screenshot: Mock<(options?: unknown) => Promise<Buffer>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  getPage: Mock<() => Promise<any>>;
  injectScript: Mock<(script: string) => Promise<void>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  waitForSelector: Mock<(selector: string, timeout?: number) => Promise<any>>;
}

interface DetailedDataManagerMock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  smartHandle: Mock<(value: unknown, maxSize: number) => any>;
}

function createChromeDeps(overrides: {
  pageController?: Partial<PageControllerMock>;
  detailedDataManager?: Partial<DetailedDataManagerMock>;
  getActiveDriver?: () => 'chrome' | 'camoufox';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  getCamoufoxPage?: () => Promise<any>;
} = {}) {
  const pageController: PageControllerMock = {
    evaluate: vi.fn(async () => ({ result: 42 })),
    screenshot: vi.fn(async () => Buffer.from('png-data')),
    getPage: vi.fn(async () => ({
      $: vi.fn(async () => ({
        screenshot: vi.fn(async () => Buffer.from('element-png')),
      })),
    })),
    injectScript: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => ({
      success: true,
      message: 'found',
    })),
    ...overrides.pageController,
  };

  const detailedDataManager: DetailedDataManagerMock = {
    smartHandle: vi.fn((value: unknown) => value),
    ...overrides.detailedDataManager,
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pageController: pageController as any,
    detailedDataManager: detailedDataManager as unknown,
    getActiveDriver: overrides.getActiveDriver ?? (() => 'chrome' as const),
    getCamoufoxPage: overrides.getCamoufoxPage ?? (async () => null),
  };
}

// ─── handlePageEvaluate ───

describe('PageEvaluationHandlers – handlePageEvaluate', () => {
  let handlers: PageEvaluationHandlers;
  let deps: ReturnType<typeof createChromeDeps>;
  let pageController: PageControllerMock;
  let detailedDataManager: DetailedDataManagerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createChromeDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pageController = deps.pageController as any;
    detailedDataManager = deps.detailedDataManager as unknown;
    handlers = new PageEvaluationHandlers(deps);
  });

  it('evaluates code on chrome and returns result', async () => {
    pageController.evaluate.mockResolvedValueOnce({ count: 5 });
    const body = parseJson<PageEvaluateResponse>(await handlers.handlePageEvaluate({ code: 'document.title' }));
    expect(pageController.evaluate).toHaveBeenCalledWith('document.title');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result).toEqual({ count: 5 });
  });

  it('accepts script arg as an alias for code', async () => {
    pageController.evaluate.mockResolvedValueOnce('title');
    const body = parseJson<PageEvaluateResponse>(await handlers.handlePageEvaluate({ script: 'document.title' }));
    expect(pageController.evaluate).toHaveBeenCalledWith('document.title');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
  });

  it('uses detailedDataManager.smartHandle with autoSummarize=true (default)', async () => {
    pageController.evaluate.mockResolvedValueOnce({ big: 'data' });
    await handlers.handlePageEvaluate({ code: '1+1' });
    expect(detailedDataManager.smartHandle).toHaveBeenCalledWith({ big: 'data' }, 51200);
  });

  it('skips smartHandle when autoSummarize=false', async () => {
    pageController.evaluate.mockResolvedValueOnce('raw');
    const body = parseJson<PageEvaluateResponse>(
      await handlers.handlePageEvaluate({
        code: '1+1',
        autoSummarize: false,
      })
    );
    expect(detailedDataManager.smartHandle).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result).toBe('raw');
  });

  it('respects custom maxSize for smartHandle', async () => {
    pageController.evaluate.mockResolvedValueOnce('data');
    await handlers.handlePageEvaluate({ code: '1', maxSize: 1024 });
    expect(detailedDataManager.smartHandle).toHaveBeenCalledWith('data', 1024);
  });

  it('applies fieldFilter to strip specified keys', async () => {
    pageController.evaluate.mockResolvedValueOnce({
      name: 'test',
      secret: 'hidden',
      nested: { secret: 'also-hidden', visible: true },
    });
    const body = parseJson<PageEvaluateResponse>(
      await handlers.handlePageEvaluate({
        code: 'obj',
        fieldFilter: ['secret'],
        autoSummarize: false,
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result.name).toBe('test');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result.secret).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result.nested.secret).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result.nested.visible).toBe(true);
  });

  it('strips base64 data URIs when stripBase64=true', async () => {
    pageController.evaluate.mockResolvedValueOnce({
      image: 'data:image/png;base64,' + 'A'.repeat(1000),
    });
    const body = parseJson<PageEvaluateResponse>(
      await handlers.handlePageEvaluate({
        code: 'img',
        stripBase64: true,
        autoSummarize: false,
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result.image).toContain('stripped');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result.image).not.toContain('AAAA');
  });

  it('strips bare base64 strings >500 chars when stripBase64=true', async () => {
    const longBase64 = 'A'.repeat(600);
    pageController.evaluate.mockResolvedValueOnce({ data: longBase64 });
    const body = parseJson<PageEvaluateResponse>(
      await handlers.handlePageEvaluate({
        code: 'x',
        stripBase64: true,
        autoSummarize: false,
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result.data).toContain('stripped');
  });

  it('does not strip short base64-like strings', async () => {
    pageController.evaluate.mockResolvedValueOnce({ data: 'AAAA' });
    const body = parseJson<PageEvaluateResponse>(
      await handlers.handlePageEvaluate({
        code: 'x',
        stripBase64: true,
        autoSummarize: false,
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result.data).toBe('AAAA');
  });

  it('evaluates on camoufox driver', async () => {
    const camoPage = {
      evaluate: vi.fn(async () => 'camoufox-result'),
    };
    deps = createChromeDeps({
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });
    handlers = new PageEvaluationHandlers(deps);

    const body = parseJson<PageEvaluateResponse>(await handlers.handlePageEvaluate({ code: 'document.title' }));
    expect(camoPage.evaluate).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.result).toBe('camoufox-result');
  });
});

// ─── handlePageScreenshot ───

describe('PageEvaluationHandlers – handlePageScreenshot', () => {
  let handlers: PageEvaluationHandlers;
  let deps: ReturnType<typeof createChromeDeps>;
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createChromeDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pageController = deps.pageController as any;
    handlers = new PageEvaluationHandlers(deps);
  });

  it('takes a full-page screenshot with defaults', async () => {
    pageController.screenshot.mockResolvedValueOnce(Buffer.from('png-bytes'));
    const body = parseJson<PageScreenshotResponse>(await handlers.handlePageScreenshot({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.path).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.size).toBeGreaterThan(0);
  });

  it('takes an element screenshot when selector is provided', async () => {
    const elementMock = {
      screenshot: vi.fn(async () => Buffer.from('el-data')),
    };
    pageController.getPage.mockResolvedValueOnce({
      $: vi.fn(async () => elementMock),
    });

    const body = parseJson<PageScreenshotResponse>(await handlers.handlePageScreenshot({ selector: '#header' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.selector).toBe('#header');
  });

  it('returns error when element not found for selector', async () => {
    pageController.getPage.mockResolvedValueOnce({
      $: vi.fn(async () => null),
    });

    const body = parseJson<PageScreenshotResponse>(await handlers.handlePageScreenshot({ selector: '#missing' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Element not found');
  });

  it('uses clip option when provided', async () => {
    const clip = { x: 10, y: 20, width: 100, height: 50 };
    pageController.screenshot.mockResolvedValueOnce(Buffer.from('clip-data'));

    const body = parseJson<PageScreenshotResponse>(await handlers.handlePageScreenshot({ clip }));

    expect(pageController.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        clip,
        fullPage: false,
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
  });

  it('ignores selector value "all" (case-insensitive)', async () => {
    pageController.screenshot.mockResolvedValueOnce(Buffer.from('png-data'));

    const body = parseJson<PageScreenshotResponse>(await handlers.handlePageScreenshot({ selector: 'ALL' }));

    // Should treat as no selector (page screenshot)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.selector).toBeUndefined();
  });

  it('handles batch mode with multiple selectors', async () => {
    const elementMock = {
      screenshot: vi.fn(async () => Buffer.from('batch-el')),
    };
    pageController.getPage.mockResolvedValue({
      $: vi.fn(async () => elementMock),
    });

    const body = parseJson<PageScreenshotResponse>(
      await handlers.handlePageScreenshot({
        selector: ['#a', '#b'],
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.mode).toBe('batch');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.total).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.succeeded).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.results).toHaveLength(2);
  });

  it('batch mode records errors for missing elements', async () => {
    const pageObj = {
      $: vi
        .fn()
        .mockResolvedValueOnce({
          screenshot: vi.fn(async () => Buffer.from('ok')),
        })
        .mockResolvedValueOnce(null),
    };
    pageController.getPage.mockResolvedValue(pageObj);

    const body = parseJson<PageScreenshotResponse>(
      await handlers.handlePageScreenshot({
        selector: ['#found', '#missing'],
      })
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.total).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.succeeded).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    if (body.results) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.results[0].success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.results[1].success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.results[1].error).toContain('Element not found');
    }
  });

  it('takes screenshot on camoufox page (no selector)', async () => {
    const camoPage = {
      screenshot: vi.fn(async () => Buffer.from('camo-png')),
      $: vi.fn(),
    };
    deps = createChromeDeps({
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });
    handlers = new PageEvaluationHandlers(deps);

    const body = parseJson<PageScreenshotResponse>(await handlers.handlePageScreenshot({}));
    expect(camoPage.screenshot).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
  });

  it('takes element screenshot on camoufox page', async () => {
    const elMock = {
      screenshot: vi.fn(async () => Buffer.from('camo-el')),
    };
    const camoPage = {
      screenshot: vi.fn(),
      $: vi.fn(async () => elMock),
    };
    deps = createChromeDeps({
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });
    handlers = new PageEvaluationHandlers(deps);

    const body = parseJson<PageScreenshotResponse>(await handlers.handlePageScreenshot({ selector: '.btn' }));
    expect(camoPage.$).toHaveBeenCalledWith('.btn');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
  });

  it('returns error for missing element on camoufox', async () => {
    const camoPage = {
      screenshot: vi.fn(),
      $: vi.fn(async () => null),
    };
    deps = createChromeDeps({
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });
    handlers = new PageEvaluationHandlers(deps);

    const body = parseJson<PageScreenshotResponse>(await handlers.handlePageScreenshot({ selector: '#gone' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('Element not found');
  });
});

// ─── handlePageInjectScript ───

describe('PageEvaluationHandlers – handlePageInjectScript', () => {
  let handlers: PageEvaluationHandlers;
  let deps: ReturnType<typeof createChromeDeps>;
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createChromeDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pageController = deps.pageController as any;
    handlers = new PageEvaluationHandlers(deps);
  });

  it('injects a script and returns success', async () => {
    const body = parseJson<PageInjectScriptResponse>(await handlers.handlePageInjectScript({ script: 'console.log("hi")' }));
    expect(pageController.injectScript).toHaveBeenCalledWith('console.log("hi")');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toBe('Script injected');
  });
});

// ─── handlePageWaitForSelector ───

describe('PageEvaluationHandlers – handlePageWaitForSelector', () => {
  let handlers: PageEvaluationHandlers;
  let deps: ReturnType<typeof createChromeDeps>;
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createChromeDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    pageController = deps.pageController as any;
    handlers = new PageEvaluationHandlers(deps);
  });

  it('waits for selector via chrome pageController', async () => {
    pageController.waitForSelector.mockResolvedValueOnce({
      success: true,
      message: 'found #btn',
    });
    const body = parseJson<PageWaitForSelectorResponse>(
      await handlers.handlePageWaitForSelector({
        selector: '#btn',
        timeout: 5000,
      })
    );
    expect(pageController.waitForSelector).toHaveBeenCalledWith('#btn', 5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
  });

  it('waits for selector on camoufox and returns element info', async () => {
    const camoPage = {
      waitForSelector: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({
        tagName: 'div',
        id: 'main',
        className: 'container',
        textContent: 'Hello',
        attributes: { id: 'main' },
      })),
    };
    deps = createChromeDeps({
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });
    handlers = new PageEvaluationHandlers(deps);

    const body = parseJson<PageWaitForSelectorResponse>(
      await handlers.handlePageWaitForSelector({
        selector: '#main',
        timeout: 2000,
      })
    );

    expect(camoPage.waitForSelector).toHaveBeenCalledWith('#main', {
      timeout: 2000,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    if (body.element) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.element.tagName).toBe('div');
    }
  });

  it('uses default 30s timeout on camoufox when none provided', async () => {
    const camoPage = {
      waitForSelector: vi.fn(async () => {}),
      evaluate: vi.fn(async () => null),
    };
    deps = createChromeDeps({
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });
    handlers = new PageEvaluationHandlers(deps);

    await handlers.handlePageWaitForSelector({ selector: '.x' });
    expect(camoPage.waitForSelector).toHaveBeenCalledWith('.x', {
      timeout: 30000,
    });
  });

  it('returns timeout error on camoufox when waitForSelector throws', async () => {
    const camoPage = {
      waitForSelector: vi.fn(async () => {
        throw new Error('timeout');
      }),
      evaluate: vi.fn(),
    };
    deps = createChromeDeps({
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });
    handlers = new PageEvaluationHandlers(deps);

    const body = parseJson<PageWaitForSelectorResponse>(
      await handlers.handlePageWaitForSelector({
        selector: '#nope',
        timeout: 100,
      })
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('Timeout');
  });
});
