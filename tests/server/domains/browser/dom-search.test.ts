import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMSearchHandlers } from '@server/domains/browser/handlers/dom-search';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

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

    const body = parseJson(await handlers.handleDOMFindByText({ text: 'Continue' }));

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
    domInspector.findByText.mockResolvedValue([{ selector: 'button.primary', text: 'Save' }]);

    const body = parseJson(await handlers.handleDOMFindByText({ text: 'Save', tag: 'button' }));

    expect(domInspector.findByText).toHaveBeenCalledWith('Save', 'button');
    expect(body.count).toBe(1);
  });

  it('returns selector and xpath for DOM xpath lookup', async () => {
    domInspector.getXPath.mockResolvedValue('//*[@id="submit"]');

    const body = parseJson(await handlers.handleDOMGetXPath({ selector: '#submit' }));

    expect(domInspector.getXPath).toHaveBeenCalledWith('#submit');
    expect(body).toEqual({
      selector: '#submit',
      xpath: '//*[@id="submit"]',
    });
  });

  it('rethrows inspector errors from xpath lookup', async () => {
    domInspector.getXPath.mockRejectedValue(new Error('xpath failed'));

    await expect(handlers.handleDOMGetXPath({ selector: '#bad' })).rejects.toThrow('xpath failed');
  });
});
