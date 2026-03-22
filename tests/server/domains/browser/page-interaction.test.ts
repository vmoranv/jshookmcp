import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { 
  PageClickResponse, 
  PageInteractionResponse, 
  PagePressKeyResponse, 
  PageSelectResponse, 
  PageTypeResponse 
} from '../../shared/common-test-types';

import { PageInteractionHandlers } from '@server/domains/browser/handlers/page-interaction';

interface CamoufoxPageMock {
  click: Mock<(selector: string, options: unknown) => Promise<void>>;
  fill: Mock<(selector: string, text: string) => Promise<void>>;
  hover: Mock<(selector: string) => Promise<void>>;
  selectOption: Mock<(selector: string, values: string[]) => Promise<string[]>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  evaluate: Mock<(fn: unknown, args?: unknown) => Promise<any>>;
  keyboard: {
    press: Mock<(key: string) => Promise<void>>;
  };
}

function createCamoufoxPage(): CamoufoxPageMock {
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

interface PageControllerMock {
  click: Mock<(selector: string, options: unknown) => Promise<void>>;
  type: Mock<(selector: string, text: string, options: unknown) => Promise<void>>;
  select: Mock<(selector: string, ...values: string[]) => Promise<void>>;
  hover: Mock<(selector: string) => Promise<void>>;
  scroll: Mock<(options: { x: number; y: number }) => Promise<void>>;
  pressKey: Mock<(key: string) => Promise<void>>;
}

function createPageController(overrides: Partial<PageControllerMock> = {}): PageControllerMock {
  return {
    click: vi.fn(async () => {}),
    type: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    hover: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    pressKey: vi.fn(async () => {}),
    ...overrides,
  };
}

// ─── handlePageClick ───

describe('PageInteractionHandlers – handlePageClick', () => {
  let handlers: PageInteractionHandlers;
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('clicks an element with default options', async () => {
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '#btn' }));
    expect(pageController.click).toHaveBeenCalledWith('#btn', {
      button: 'left',
      clickCount: 1,
      delay: undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('#btn');
  });

  it('passes button, clickCount, delay options', async () => {
    const body = parseJson<PageClickResponse>(
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
  });

  it('returns error when selector is empty', async () => {
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('selector parameter is required');
  });

  it('returns error when selector is whitespace-only', async () => {
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '   ' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
  });

  it('returns error when selector is missing', async () => {
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
  });

  it('treats navigation-triggering click errors as success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('Execution context was destroyed'));
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '#nav-link' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.navigated).toBe(true);
  });

  it('treats "detached" error as navigation success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('Node is detached from document'));
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '.link' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.navigated).toBe(true);
  });

  it('treats "timed out" error as navigation success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('waiting for selector timed out'));
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '.link' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.navigated).toBe(true);
  });

  it('treats "Target closed" error as navigation success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('Target closed'));
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '.link' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.navigated).toBe(true);
  });

  it('treats "callFunctionOn" error as navigation success', async () => {
    pageController.click.mockRejectedValueOnce(new Error('callFunctionOn failed'));
    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '.link' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'camoufox',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getCamoufoxPage: async () => camoPage as any,
    });

    const body = parseJson<PageClickResponse>(await handlers.handlePageClick({ selector: '#btn' }));
    expect(camoPage.click).toHaveBeenCalledWith('#btn', {
      button: 'left',
      clickCount: 1,
      delay: undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('types into a selector on chrome', async () => {
    const body = parseJson<PageTypeResponse>(
      await handlers.handlePageType({
        selector: '#input',
        text: 'hello',
        delay: 50,
      })
    );
    expect(pageController.type).toHaveBeenCalledWith('#input', 'hello', {
      delay: 50,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('#input');
  });

  it('types on camoufox using fill', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'camoufox',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getCamoufoxPage: async () => camoPage as any,
    });

    const body = parseJson<PageTypeResponse>(
      await handlers.handlePageType({ selector: '#email', text: 'test@a.com' })
    );
    expect(camoPage.fill).toHaveBeenCalledWith('#email', 'test@a.com');
    expect(pageController.type).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
  });
});

// ─── handlePageSelect ───

describe('PageInteractionHandlers – handlePageSelect', () => {
  let handlers: PageInteractionHandlers;
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('selects options on chrome', async () => {
    const body = parseJson<PageSelectResponse>(
      await handlers.handlePageSelect({
        selector: '#dropdown',
        values: ['opt1', 'opt2'],
      })
    );
    expect(pageController.select).toHaveBeenCalledWith('#dropdown', 'opt1', 'opt2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('#dropdown');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('opt1');
  });

  it('selects on camoufox using selectOption', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'camoufox',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getCamoufoxPage: async () => camoPage as any,
    });

    const body = parseJson<PageSelectResponse>(
      await handlers.handlePageSelect({
        selector: '#plan',
        values: ['premium'],
      })
    );
    expect(camoPage.selectOption).toHaveBeenCalledWith('#plan', ['premium']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
  });
});

// ─── handlePageHover ───

describe('PageInteractionHandlers – handlePageHover', () => {
  let handlers: PageInteractionHandlers;
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('hovers on chrome', async () => {
    const body = parseJson<PageInteractionResponse>(await handlers.handlePageHover({ selector: '#menu' }));
    expect(pageController.hover).toHaveBeenCalledWith('#menu');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('#menu');
  });

  it('hovers on camoufox', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'camoufox',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getCamoufoxPage: async () => camoPage as any,
    });

    const body = parseJson<PageInteractionResponse>(await handlers.handlePageHover({ selector: '.tooltip' }));
    expect(camoPage.hover).toHaveBeenCalledWith('.tooltip');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
  });
});

// ─── handlePageScroll ───

describe('PageInteractionHandlers – handlePageScroll', () => {
  let handlers: PageInteractionHandlers;
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('scrolls on chrome', async () => {
    const body = parseJson<PageInteractionResponse>(await handlers.handlePageScroll({ x: 0, y: 500 }));
    expect(pageController.scroll).toHaveBeenCalledWith({ x: 0, y: 500 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('y=500');
  });

  it('scrolls on camoufox via page.evaluate', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'camoufox',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getCamoufoxPage: async () => camoPage as any,
    });

    const body = parseJson<PageInteractionResponse>(await handlers.handlePageScroll({ x: 10, y: 200 }));
    expect(camoPage.evaluate).toHaveBeenCalledTimes(1);
    expect(camoPage.evaluate.mock.calls[0]?.[1]).toEqual({
      x: 10,
      y: 200,
    });
    expect(pageController.scroll).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
  });

  it('defaults missing coordinates to 0', async () => {
    const body = parseJson<PageInteractionResponse>(await handlers.handlePageScroll({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('x=0');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('y=0');
  });
});

// ─── handlePagePressKey ───

describe('PageInteractionHandlers – handlePagePressKey', () => {
  let handlers: PageInteractionHandlers;
  let pageController: PageControllerMock;

  beforeEach(() => {
    vi.clearAllMocks();
    pageController = createPageController();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'chrome',
      getCamoufoxPage: async () => null,
    });
  });

  it('presses a key on chrome', async () => {
    const body = parseJson<PagePressKeyResponse>(await handlers.handlePagePressKey({ key: 'Enter' }));
    expect(pageController.pressKey).toHaveBeenCalledWith('Enter');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.key).toBe('Enter');
  });

  it('presses a key on camoufox', async () => {
    const camoPage = createCamoufoxPage();
    handlers = new PageInteractionHandlers({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: pageController as any,
      getActiveDriver: () => 'camoufox',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getCamoufoxPage: async () => camoPage as any,
    });

    const body = parseJson<PagePressKeyResponse>(await handlers.handlePagePressKey({ key: 'Escape' }));
    expect(camoPage.keyboard.press).toHaveBeenCalledWith('Escape');
    expect(pageController.pressKey).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.key).toBe('Escape');
  });
});
