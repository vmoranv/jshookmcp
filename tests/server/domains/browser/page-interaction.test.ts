import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageInteractionHandlers } from '@server/domains/browser/handlers/page-interaction';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('PageInteractionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('routes page_select to camoufox when camoufox is active', async () => {
    const page = createCamoufoxPage();
    const pageController = { select: vi.fn() } as any;
    const handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => page,
    });

    const body = parseJson(
      await handlers.handlePageSelect({ selector: '#plan', values: ['primary'] })
    );

    expect(page.selectOption).toHaveBeenCalledWith('#plan', ['primary']);
    expect(pageController.select).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });

  it('routes page_hover to camoufox when camoufox is active', async () => {
    const page = createCamoufoxPage();
    const pageController = { hover: vi.fn() } as any;
    const handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => page,
    });

    const body = parseJson(await handlers.handlePageHover({ selector: '#menu' }));

    expect(page.hover).toHaveBeenCalledWith('#menu');
    expect(pageController.hover).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });

  it('routes page_scroll to camoufox when camoufox is active', async () => {
    const page = createCamoufoxPage();
    const pageController = { scroll: vi.fn() } as any;
    const handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => page,
    });

    const body = parseJson(await handlers.handlePageScroll({ x: 10, y: 20 }));

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect((page.evaluate as any).mock.calls[0]?.[1]).toEqual({ x: 10, y: 20 });
    expect(pageController.scroll).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });

  it('routes page_press_key to camoufox keyboard when camoufox is active', async () => {
    const page = createCamoufoxPage();
    const pageController = { pressKey: vi.fn() } as any;
    const handlers = new PageInteractionHandlers({
      pageController,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => page,
    });

    const body = parseJson(await handlers.handlePagePressKey({ key: 'Enter' }));

    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    expect(pageController.pressKey).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
  });
});
