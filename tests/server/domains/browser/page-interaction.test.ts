import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageInteractionHandlers } from '@server/domains/browser/handlers/page-interaction';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

function createCamoufoxPage() {
  return {
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    selectOption: vi.fn(async () => ['primary']),
    evaluate: vi.fn(async () => undefined),
    keyboard: {
      press: vi.fn(async () => {}),
    },
  };
}

function createPageController(overrides: Record<string, any> = {}) {
  return {
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    pressKey: vi.fn(async () => {}),
    ...overrides,
  } as any;
}

// ─── handlePageClick ───

describe('PageInteractionHandlers – handlePageClick', () => {
  let handlers: PageInteractionHandlers;
  let pageController: ReturnType<typeof createPageController>;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('clicks an element with default options', async () => {
    const body = parseJson(await handlers.handlePageClick({ selector: '#btn' }));
    expect(pageController.click).toHaveBeenCalledWith('#btn', {
      button: 'left',
      clickCount: 1,
      delay: undefined,
    });
    expect(body.success).toBe(true);
    expect(body.message).toContain('#btn');
  });

  it('passes button, clickCount, delay options', async () => {
    const body = parseJson(
      await handlers.handlePageClick({
        selector: '.item',
        button: 'right',
        clickCount: 2,
        delay: 100,
      })
    );
    expect(pageController.click).toHaveBeenCalledWith('.item', {
      button: 'right',
      clickCount: 2,
      delay: 100,
    });
    expect(body.success).toBe(true);
  });

  it('returns error when selector is empty', async () => {
    const body = parseJson(await handlers.handlePageClick({ selector: '' }));
    expect(body.success).toBe(false);
    expect(body.message).toContain('selector parameter is required');
  });

  it('returns error when selector is whitespace-only', async () => {
    const body = parseJson(await handlers.handlePageClick({ selector: '   ' }));
    expect(body.success).toBe(false);
  });

  it('returns error when selector is missing', async () => {
    const body = parseJson(await handlers.handlePageClick({}));
    expect(body.success).toBe(false);
  });

  it('treats navigation-triggering click errors as success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('Execution context was destroyed'));
    const body = parseJson(await handlers.handlePageClick({ selector: '#nav-link' }));
    expect(body.success).toBe(true);
    expect(body.navigated).toBe(true);
  });

  it('treats "detached" error as navigation success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('Node is detached from document'));
    const body = parseJson(await handlers.handlePageClick({ selector: '.link' }));
    expect(body.success).toBe(true);
    expect(body.navigated).toBe(true);
  });

  it('treats "timed out" error as navigation success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('waiting for selector timed out'));
    const body = parseJson(await handlers.handlePageClick({ selector: '.link' }));
    expect(body.success).toBe(true);
    expect(body.navigated).toBe(true);
  });

  it('treats "Target closed" error as navigation success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('Target closed'));
    const body = parseJson(await handlers.handlePageClick({ selector: '.link' }));
    expect(body.success).toBe(true);
    expect(body.navigated).toBe(true);
  });

  it('treats "callFunctionOn" error as navigation success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('callFunctionOn failed'));
    const body = parseJson(await handlers.handlePageClick({ selector: '.link' }));
    expect(body.success).toBe(true);
    expect(body.navigated).toBe(true);
  });

  it('re-throws non-navigation errors', async () => {
    pageController.click.mockRejectedValueOnce(new Error('Element not visible'));
    await expect(handlers.handlePageClick({ selector: '#hidden' })).rejects.toThrow(
      'Element not visible'
    );
  });

  it('clicks on camoufox driver', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });

    const body = parseJson(await handlers.handlePageClick({ selector: '#btn' }));
    expect(camoPage.click).toHaveBeenCalledWith('#btn', {
      button: 'left',
      clickCount: 1,
      delay: undefined,
    });
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });

  it('parses button value case-insensitively', async () => {
    await handlers.handlePageClick({ selector: '#x', button: 'RIGHT' });
    expect(pageController.click).toHaveBeenCalledWith('#x', {
      button: 'right',
      clickCount: 1,
      delay: undefined,
    });
  });

  it('defaults invalid button to left', async () => {
    await handlers.handlePageClick({ selector: '#x', button: 'invalid' });
    expect(pageController.click).toHaveBeenCalledWith('#x', {
      button: 'left',
      clickCount: 1,
      delay: undefined,
    });
  });

  it('clamps clickCount to min 1', async () => {
    await handlers.handlePageClick({ selector: '#x', clickCount: -5 });
    expect(pageController.click).toHaveBeenCalledWith(
      '#x',
      expect.objectContaining({ clickCount: 1 })
    );
  });

  it('clamps clickCount to max 10', async () => {
    await handlers.handlePageClick({ selector: '#x', clickCount: 100 });
    expect(pageController.click).toHaveBeenCalledWith(
      '#x',
      expect.objectContaining({ clickCount: 10 })
    );
  });

  it('parses string clickCount', async () => {
    await handlers.handlePageClick({ selector: '#x', clickCount: '3' });
    expect(pageController.click).toHaveBeenCalledWith(
      '#x',
      expect.objectContaining({ clickCount: 3 })
    );
  });

  it('clamps delay to min 0', async () => {
    await handlers.handlePageClick({ selector: '#x', delay: -100 });
    expect(pageController.click).toHaveBeenCalledWith('#x', expect.objectContaining({ delay: 0 }));
  });

  it('clamps delay to max 60000', async () => {
    await handlers.handlePageClick({ selector: '#x', delay: 999999 });
    expect(pageController.click).toHaveBeenCalledWith(
      '#x',
      expect.objectContaining({ delay: 60000 })
    );
  });

  it('truncates clickCount to integer', async () => {
    await handlers.handlePageClick({ selector: '#x', clickCount: 2.7 });
    expect(pageController.click).toHaveBeenCalledWith(
      '#x',
      expect.objectContaining({ clickCount: 2 })
    );
  });

  it('truncates delay to integer', async () => {
    await handlers.handlePageClick({ selector: '#x', delay: 50.9 });
    expect(pageController.click).toHaveBeenCalledWith('#x', expect.objectContaining({ delay: 50 }));
  });
});

// ─── handlePageType ───

describe('PageInteractionHandlers – handlePageType', () => {
  let handlers: PageInteractionHandlers;
  let pageController: ReturnType<typeof createPageController>;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('types into a selector on chrome', async () => {
    const body = parseJson(
      await handlers.handlePageType({
        selector: '#input',
        text: 'hello',
        delay: 50,
      })
    );
    expect(pageController.type).toHaveBeenCalledWith('#input', 'hello', {
      delay: 50,
    });
    expect(body.success).toBe(true);
    expect(body.message).toContain('#input');
  });

  it('types on camoufox using fill', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });

    const body = parseJson(
      await handlers.handlePageType({ selector: '#email', text: 'test@a.com' })
    );
    expect(camoPage.fill).toHaveBeenCalledWith('#email', 'test@a.com');
    expect(pageController.type).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });
});

// ─── handlePageSelect ───

describe('PageInteractionHandlers – handlePageSelect', () => {
  let handlers: PageInteractionHandlers;
  let pageController: ReturnType<typeof createPageController>;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('selects options on chrome', async () => {
    const body = parseJson(
      await handlers.handlePageSelect({
        selector: '#dropdown',
        values: ['opt1', 'opt2'],
      })
    );
    expect(pageController.select).toHaveBeenCalledWith('#dropdown', 'opt1', 'opt2');
    expect(body.success).toBe(true);
    expect(body.message).toContain('#dropdown');
    expect(body.message).toContain('opt1');
  });

  it('selects on camoufox using selectOption', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });

    const body = parseJson(
      await handlers.handlePageSelect({
        selector: '#plan',
        values: ['premium'],
      })
    );
    expect(camoPage.selectOption).toHaveBeenCalledWith('#plan', ['premium']);
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });
});

// ─── handlePageHover ───

describe('PageInteractionHandlers – handlePageHover', () => {
  let handlers: PageInteractionHandlers;
  let pageController: ReturnType<typeof createPageController>;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('hovers on chrome', async () => {
    const body = parseJson(await handlers.handlePageHover({ selector: '#menu' }));
    expect(pageController.hover).toHaveBeenCalledWith('#menu');
    expect(body.success).toBe(true);
    expect(body.message).toContain('#menu');
  });

  it('hovers on camoufox', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });

    const body = parseJson(await handlers.handlePageHover({ selector: '.tooltip' }));
    expect(camoPage.hover).toHaveBeenCalledWith('.tooltip');
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });
});

// ─── handlePageScroll ───

describe('PageInteractionHandlers – handlePageScroll', () => {
  let handlers: PageInteractionHandlers;
  let pageController: ReturnType<typeof createPageController>;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('scrolls on chrome', async () => {
    const body = parseJson(await handlers.handlePageScroll({ x: 0, y: 500 }));
    expect(pageController.scroll).toHaveBeenCalledWith({ x: 0, y: 500 });
    expect(body.success).toBe(true);
    expect(body.message).toContain('y=500');
  });

  it('scrolls on camoufox via page.evaluate', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });

    const body = parseJson(await handlers.handlePageScroll({ x: 10, y: 200 }));
    expect(camoPage.evaluate).toHaveBeenCalledTimes(1);
    expect((camoPage.evaluate as any).mock.calls[0]?.[1]).toEqual({
      x: 10,
      y: 200,
    });
    expect(pageController.scroll).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });

  it('defaults missing coordinates to 0', async () => {
    const body = parseJson(await handlers.handlePageScroll({}));
    expect(body.success).toBe(true);
    expect(body.message).toContain('x=0');
    expect(body.message).toContain('y=0');
  });
});

// ─── handlePagePressKey ───

describe('PageInteractionHandlers – handlePagePressKey', () => {
  let handlers: PageInteractionHandlers;
  let pageController: ReturnType<typeof createPageController>;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('presses a key on chrome', async () => {
    const body = parseJson(await handlers.handlePagePressKey({ key: 'Enter' }));
    expect(pageController.pressKey).toHaveBeenCalledWith('Enter');
    expect(body.success).toBe(true);
    expect(body.key).toBe('Enter');
  });

  it('presses a key on camoufox', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => camoPage,
    });

    const body = parseJson(await handlers.handlePagePressKey({ key: 'Escape' }));
    expect(camoPage.keyboard.press).toHaveBeenCalledWith('Escape');
    expect(pageController.pressKey).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.key).toBe('Escape');
  });
});
