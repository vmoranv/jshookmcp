import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMSearchHandlers } from '@server/domains/browser/handlers/dom-search';



describe('DOMSearchHandlers', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  let domInspector: any;
  let handlers: DOMSearchHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    domInspector = {
      findByText: vi.fn(),
      getXPath: vi.fn(),
    };
    handlers = new DOMSearchHandlers({ domInspector });
  });

  it('finds elements by text and forwards an omitted tag as undefined', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    domInspector.findByText.mockResolvedValue([
      { selector: 'button.primary', text: 'Continue' },
      { selector: 'a.cta', text: 'Continue' },
    ]);

    const body = parseJson<BrowserStatusResponse>(await handlers.handleDOMFindByText({ text: 'Continue' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(domInspector.findByText).toHaveBeenCalledWith('Continue', undefined);
    expect(body).toEqual({
      count: 2,
      elements: [
        { selector: 'button.primary', text: 'Continue' },
        { selector: 'a.cta', text: 'Continue' },
      ],
    });
  });

  it('finds elements by text with an explicit tag filter', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    domInspector.findByText.mockResolvedValue([{ selector: 'button.primary', text: 'Save' }]);

    const body = parseJson<BrowserStatusResponse>(await handlers.handleDOMFindByText({ text: 'Save', tag: 'button' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(domInspector.findByText).toHaveBeenCalledWith('Save', 'button');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.count).toBe(1);
  });

  it('returns selector and xpath for DOM xpath lookup', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    domInspector.getXPath.mockResolvedValue('//*[@id="submit"]');

    const body = parseJson<BrowserStatusResponse>(await handlers.handleDOMGetXPath({ selector: '#submit' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(domInspector.getXPath).toHaveBeenCalledWith('#submit');
    expect(body).toEqual({
      selector: '#submit',
      xpath: '//*[@id="submit"]',
    });
  });

  it('rethrows inspector errors from xpath lookup', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    domInspector.getXPath.mockRejectedValue(new Error('xpath failed'));

    await expect(handlers.handleDOMGetXPath({ selector: '#bad' })).rejects.toThrow('xpath failed');
  });
});
