import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { DOMInspector } from '../../../src/modules/collector/DOMInspector.js';

describe('DOMInspector', () => {
  let page: any;
  let collector: any;
  let inspector: DOMInspector;

  beforeEach(() => {
    page = {
      evaluate: vi.fn(),
      waitForSelector: vi.fn(),
    };
    collector = {
      getActivePage: vi.fn().mockResolvedValue(page),
    };
    inspector = new DOMInspector(collector);
  });

  it('returns selector metadata when element exists', async () => {
    page.evaluate.mockResolvedValue({
      found: true,
      nodeName: 'BUTTON',
      textContent: 'Submit',
      visible: true,
    });

    const result = await inspector.querySelector('#submit');
    expect(result.found).toBe(true);
    expect(result.nodeName).toBe('BUTTON');
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('returns found=false when querySelector evaluation fails', async () => {
    page.evaluate.mockRejectedValue(new Error('eval failed'));

    const result = await inspector.querySelector('.missing');
    expect(result).toEqual({ found: false });
  });

  it('returns list of elements from querySelectorAll', async () => {
    page.evaluate.mockResolvedValue([
      { found: true, nodeName: 'DIV', textContent: 'A' },
      { found: true, nodeName: 'DIV', textContent: 'B' },
    ]);

    const result = await inspector.querySelectorAll('.item', 2);
    expect(result).toHaveLength(2);
    expect(result[1]?.textContent).toBe('B');
  });

  it('waitForElement returns null on timeout error', async () => {
    page.waitForSelector.mockRejectedValue(new Error('timeout'));

    const result = await inspector.waitForElement('#slow', 5);
    expect(result).toBeNull();
  });

  it('returns null when computed style query throws', async () => {
    page.evaluate.mockRejectedValue(new Error('style error'));

    await expect(inspector.getComputedStyle('.btn')).resolves.toBeNull();
  });

  it('closes and detaches cdp session when present', async () => {
    const detach = vi.fn().mockResolvedValue(undefined);
    (inspector as any).cdpSession = { detach };

    await inspector.close();
    expect(detach).toHaveBeenCalledTimes(1);
  });
});

