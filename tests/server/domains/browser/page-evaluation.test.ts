import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/outputPaths', () => ({
  resolveScreenshotOutputPath: vi.fn(async (opts: any) => ({
    absolutePath: `/tmp/screenshots/${opts.fallbackName || 'page'}.${opts.type || 'png'}`,
    displayPath: `screenshots/${opts.fallbackName || 'page'}.${opts.type || 'png'}`,
    pathRewritten: !opts.requestedPath,
  })),
}));

import { PageEvaluationHandlers } from '@server/domains/browser/handlers/page-evaluation';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function createChromeDeps(overrides: Record<string, any> = {}) {
  const pageController = {
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
  } as any;

  const detailedDataManager = {
    smartHandle: vi.fn((value: unknown) => value),
    ...overrides.detailedDataManager,
  } as any;

  return {
    pageController,
    detailedDataManager,
    getActiveDriver: overrides.getActiveDriver ?? (() => 'chrome' as const),
    getCamoufoxPage: overrides.getCamoufoxPage ?? (async () => null),
  };
}

// ─── handlePageEvaluate ───

describe('PageEvaluationHandlers – handlePageEvaluate', () => {
  let handlers: PageEvaluationHandlers;
  let deps: ReturnType<typeof createChromeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createChromeDeps();
    handlers = new PageEvaluationHandlers(deps);
  });

  it('evaluates code on chrome and returns result', async () => {
    deps.pageController.evaluate.mockResolvedValueOnce({ count: 5 });
    const body = parseJson(await handlers.handlePageEvaluate({ code: 'document.title' }));
    expect(deps.pageController.evaluate).toHaveBeenCalledWith('document.title');
    expect(body.success).toBe(true);
    expect(body.result).toEqual({ count: 5 });
  });

  it('accepts script arg as an alias for code', async () => {
    deps.pageController.evaluate.mockResolvedValueOnce('title');
    const body = parseJson(await handlers.handlePageEvaluate({ script: 'document.title' }));
    expect(deps.pageController.evaluate).toHaveBeenCalledWith('document.title');
    expect(body.success).toBe(true);
  });

  it('uses detailedDataManager.smartHandle with autoSummarize=true (default)', async () => {
    deps.pageController.evaluate.mockResolvedValueOnce({ big: 'data' });
    await handlers.handlePageEvaluate({ code: '1+1' });
    expect(deps.detailedDataManager.smartHandle).toHaveBeenCalledWith({ big: 'data' }, 51200);
  });

  it('skips smartHandle when autoSummarize=false', async () => {
    deps.pageController.evaluate.mockResolvedValueOnce('raw');
    const body = parseJson(
      await handlers.handlePageEvaluate({
        code: '1+1',
        autoSummarize: false,
      })
    );
    expect(deps.detailedDataManager.smartHandle).not.toHaveBeenCalled();
    expect(body.result).toBe('raw');
  });

  it('respects custom maxSize for smartHandle', async () => {
    deps.pageController.evaluate.mockResolvedValueOnce('data');
    await handlers.handlePageEvaluate({ code: '1', maxSize: 1024 });
    expect(deps.detailedDataManager.smartHandle).toHaveBeenCalledWith('data', 1024);
  });

  it('applies fieldFilter to strip specified keys', async () => {
    deps.pageController.evaluate.mockResolvedValueOnce({
      name: 'test',
      secret: 'hidden',
      nested: { secret: 'also-hidden', visible: true },
    });
    const body = parseJson(
      await handlers.handlePageEvaluate({
        code: 'obj',
        fieldFilter: ['secret'],
        autoSummarize: false,
      })
    );
    expect(body.result.name).toBe('test');
    expect(body.result.secret).toBeUndefined();
    expect(body.result.nested.secret).toBeUndefined();
    expect(body.result.nested.visible).toBe(true);
  });

  it('strips base64 data URIs when stripBase64=true', async () => {
    deps.pageController.evaluate.mockResolvedValueOnce({
      image: 'data:image/png;base64,' + 'A'.repeat(1000),
    });
    const body = parseJson(
      await handlers.handlePageEvaluate({
        code: 'img',
        stripBase64: true,
        autoSummarize: false,
      })
    );
    expect(body.result.image).toContain('stripped');
    expect(body.result.image).not.toContain('AAAA');
  });

  it('strips bare base64 strings >500 chars when stripBase64=true', async () => {
    const longBase64 = 'A'.repeat(600);
    deps.pageController.evaluate.mockResolvedValueOnce({ data: longBase64 });
    const body = parseJson(
      await handlers.handlePageEvaluate({
        code: 'x',
        stripBase64: true,
        autoSummarize: false,
      })
    );
    expect(body.result.data).toContain('stripped');
  });

  it('does not strip short base64-like strings', async () => {
    deps.pageController.evaluate.mockResolvedValueOnce({ data: 'AAAA' });
    const body = parseJson(
      await handlers.handlePageEvaluate({
        code: 'x',
        stripBase64: true,
        autoSummarize: false,
      })
    );
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

    const body = parseJson(await handlers.handlePageEvaluate({ code: 'document.title' }));
    expect(camoPage.evaluate).toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.result).toBe('camoufox-result');
  });
});

// ─── handlePageScreenshot ───

describe('PageEvaluationHandlers – handlePageScreenshot', () => {
  let handlers: PageEvaluationHandlers;
  let deps: ReturnType<typeof createChromeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createChromeDeps();
    handlers = new PageEvaluationHandlers(deps);
  });

  it('takes a full-page screenshot with defaults', async () => {
    deps.pageController.screenshot.mockResolvedValueOnce(Buffer.from('png-bytes'));
    const body = parseJson(await handlers.handlePageScreenshot({}));
    expect(body.success).toBe(true);
    expect(body.path).toBeDefined();
    expect(body.size).toBeGreaterThan(0);
  });

  it('takes an element screenshot when selector is provided', async () => {
    const elementMock = {
      screenshot: vi.fn(async () => Buffer.from('el-data')),
    };
    deps.pageController.getPage.mockResolvedValueOnce({
      $: vi.fn(async () => elementMock),
    });

    const body = parseJson(await handlers.handlePageScreenshot({ selector: '#header' }));

    expect(body.success).toBe(true);
    expect(body.selector).toBe('#header');
  });

  it('returns error when element not found for selector', async () => {
    deps.pageController.getPage.mockResolvedValueOnce({
      $: vi.fn(async () => null),
    });

    const body = parseJson(await handlers.handlePageScreenshot({ selector: '#missing' }));

    expect(body.success).toBe(false);
    expect(body.error).toContain('Element not found');
  });

  it('uses clip option when provided', async () => {
    const clip = { x: 10, y: 20, width: 100, height: 50 };
    deps.pageController.screenshot.mockResolvedValueOnce(Buffer.from('clip-data'));

    const body = parseJson(await handlers.handlePageScreenshot({ clip }));

    expect(deps.pageController.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({
        clip,
        fullPage: false,
      })
    );
    expect(body.success).toBe(true);
  });

  it('ignores selector value "all" (case-insensitive)', async () => {
    deps.pageController.screenshot.mockResolvedValueOnce(Buffer.from('png-data'));

    const body = parseJson(await handlers.handlePageScreenshot({ selector: 'ALL' }));

    // Should treat as no selector (page screenshot)
    expect(body.success).toBe(true);
    expect(body.selector).toBeUndefined();
  });

  it('handles batch mode with multiple selectors', async () => {
    const elementMock = {
      screenshot: vi.fn(async () => Buffer.from('batch-el')),
    };
    deps.pageController.getPage.mockResolvedValue({
      $: vi.fn(async () => elementMock),
    });

    const body = parseJson(
      await handlers.handlePageScreenshot({
        selector: ['#a', '#b'],
      })
    );

    expect(body.success).toBe(true);
    expect(body.mode).toBe('batch');
    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(2);
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
    deps.pageController.getPage.mockResolvedValue(pageObj);

    const body = parseJson(
      await handlers.handlePageScreenshot({
        selector: ['#found', '#missing'],
      })
    );

    expect(body.total).toBe(2);
    expect(body.succeeded).toBe(1);
    expect(body.results[0].success).toBe(true);
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].error).toContain('Element not found');
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

    const body = parseJson(await handlers.handlePageScreenshot({}));
    expect(camoPage.screenshot).toHaveBeenCalled();
    expect(body.success).toBe(true);
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

    const body = parseJson(await handlers.handlePageScreenshot({ selector: '.btn' }));
    expect(camoPage.$).toHaveBeenCalledWith('.btn');
    expect(body.success).toBe(true);
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

    const body = parseJson(await handlers.handlePageScreenshot({ selector: '#gone' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('Element not found');
  });
});

// ─── handlePageInjectScript ───

describe('PageEvaluationHandlers – handlePageInjectScript', () => {
  let handlers: PageEvaluationHandlers;
  let deps: ReturnType<typeof createChromeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createChromeDeps();
    handlers = new PageEvaluationHandlers(deps);
  });

  it('injects a script and returns success', async () => {
    const body = parseJson(await handlers.handlePageInjectScript({ script: 'console.log("hi")' }));
    expect(deps.pageController.injectScript).toHaveBeenCalledWith('console.log("hi")');
    expect(body.success).toBe(true);
    expect(body.message).toBe('Script injected');
  });
});

// ─── handlePageWaitForSelector ───

describe('PageEvaluationHandlers – handlePageWaitForSelector', () => {
  let handlers: PageEvaluationHandlers;
  let deps: ReturnType<typeof createChromeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createChromeDeps();
    handlers = new PageEvaluationHandlers(deps);
  });

  it('waits for selector via chrome pageController', async () => {
    deps.pageController.waitForSelector.mockResolvedValueOnce({
      success: true,
      message: 'found #btn',
    });
    const body = parseJson(
      await handlers.handlePageWaitForSelector({
        selector: '#btn',
        timeout: 5000,
      })
    );
    expect(deps.pageController.waitForSelector).toHaveBeenCalledWith('#btn', 5000);
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

    const body = parseJson(
      await handlers.handlePageWaitForSelector({
        selector: '#main',
        timeout: 2000,
      })
    );

    expect(camoPage.waitForSelector).toHaveBeenCalledWith('#main', {
      timeout: 2000,
    });
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.element.tagName).toBe('div');
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

    const body = parseJson(
      await handlers.handlePageWaitForSelector({
        selector: '#nope',
        timeout: 100,
      })
    );
    expect(body.success).toBe(false);
    expect(body.driver).toBe('camoufox');
    expect(body.message).toContain('Timeout');
  });
});
