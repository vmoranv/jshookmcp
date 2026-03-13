import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageEvaluationHandlers } from '@server/domains/browser/handlers/page-evaluation';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('PageEvaluationHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('waits for selector through camoufox page when camoufox is active', async () => {
    const page = {
      waitForSelector: vi.fn(async () => {}),
      evaluate: vi.fn(async () => ({
        tagName: 'button',
        id: 'submit',
        className: 'primary',
        textContent: 'Submit',
        attributes: { type: 'submit' },
      })),
    };

    const pageController = {
      waitForSelector: vi.fn(),
    } as any;

    const handlers = new PageEvaluationHandlers({
      pageController,
      detailedDataManager: { smartHandle: vi.fn((value: unknown) => value) } as any,
      getActiveDriver: () => 'camoufox',
      getCamoufoxPage: async () => page,
    });

    const body = parseJson(
      await handlers.handlePageWaitForSelector({ selector: '#submit', timeout: 1500 })
    );

    expect(page.waitForSelector).toHaveBeenCalledWith('#submit', { timeout: 1500 });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(pageController.waitForSelector).not.toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.element?.id).toBe('submit');
  });
});
