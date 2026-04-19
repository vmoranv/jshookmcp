import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMSearchHandlers } from '@server/domains/browser/handlers/dom-search';

describe('DOMSearchHandlers', () => {
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
    domInspector.findByText.mockResolvedValue([
      { selector: 'button.primary', text: 'Continue' },
      { selector: 'a.cta', text: 'Continue' },
    ]);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleDOMFindByText({ text: 'Continue' }),
    );

    expect(domInspector.findByText).toHaveBeenCalledWith('Continue', undefined);
    expect(body).toEqual({
      success: true,
      count: 2,
      elements: [
        { selector: 'button.primary', text: 'Continue' },
        { selector: 'a.cta', text: 'Continue' },
      ],
    });
  });

  it('finds elements by text with an explicit tag filter', async () => {
    domInspector.findByText.mockResolvedValue([{ selector: 'button.primary', text: 'Save' }]);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleDOMFindByText({ text: 'Save', tag: 'button' }),
    );

    expect(domInspector.findByText).toHaveBeenCalledWith('Save', 'button');
    expect(body.count).toBe(1);
  });

  it('returns selector and xpath for DOM xpath lookup', async () => {
    domInspector.getXPath.mockResolvedValue('//*[@id="submit"]');

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleDOMGetXPath({ selector: '#submit' }),
    );

    expect(domInspector.getXPath).toHaveBeenCalledWith('#submit');
    expect(body).toEqual({
      success: true,
      selector: '#submit',
      xpath: '//*[@id="submit"]',
    });
  });

  it('returns failure response from xpath lookup error', async () => {
    domInspector.getXPath.mockRejectedValue(new Error('xpath failed'));

    const response = await handlers.handleDOMGetXPath({ selector: '#bad' });
    const body = parseJson<BrowserStatusResponse>(response);
    expect(body.success).toBe(false);
    expect(body.message).toContain('xpath failed');
  });
});
