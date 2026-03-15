import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMQueryHandlers } from '@server/domains/browser/handlers/dom-query';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('DOMQueryHandlers', () => {
  let domInspector: any;
  let handlers: DOMQueryHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    domInspector = {
      querySelector: vi.fn(),
      querySelectorAll: vi.fn(),
      getStructure: vi.fn(),
      findClickable: vi.fn(),
    };
    handlers = new DOMQueryHandlers({ domInspector });
  });

  it('defaults getAttributes to true for selector queries', async () => {
    domInspector.querySelector.mockResolvedValue({
      selector: '#submit',
      tagName: 'button',
    });

    const body = parseJson(await handlers.handleDOMQuerySelector({ selector: '#submit' }));

    expect(domInspector.querySelector).toHaveBeenCalledWith('#submit', true);
    expect(body).toEqual({
      selector: '#submit',
      tagName: 'button',
    });
  });

  it('passes explicit getAttributes=false for selector queries', async () => {
    domInspector.querySelector.mockResolvedValue({
      selector: '#submit',
      attributes: {},
    });

    await handlers.handleDOMQuerySelector({
      selector: '#submit',
      getAttributes: false,
    });

    expect(domInspector.querySelector).toHaveBeenCalledWith('#submit', false);
  });

  it('defaults query all limit to 100 and returns diagnostics', async () => {
    domInspector.querySelectorAll.mockResolvedValue({
      elements: [{ selector: '.card' }, { selector: '.card:nth-child(2)' }],
      diagnostics: { truncated: false },
    });

    const body = parseJson(await handlers.handleDOMQueryAll({ selector: '.card' }));

    expect(domInspector.querySelectorAll).toHaveBeenCalledWith('.card', 100);
    expect(body).toEqual({
      count: 2,
      elements: [{ selector: '.card' }, { selector: '.card:nth-child(2)' }],
      diagnostics: { truncated: false },
    });
  });

  it('defaults DOM structure args to depth 3 with text included', async () => {
    domInspector.getStructure.mockResolvedValue({
      tagName: 'body',
      children: [{ tagName: 'main' }],
    });

    const body = parseJson(await handlers.handleDOMGetStructure({}));

    expect(domInspector.getStructure).toHaveBeenCalledWith(3, true);
    expect(body.children).toHaveLength(1);
  });

  it('finds clickable elements and forwards optional filter text', async () => {
    domInspector.findClickable.mockResolvedValue({
      elements: [{ text: 'Save', selector: 'button.primary' }],
      diagnostics: { scanned: 4 },
    });

    const body = parseJson(await handlers.handleDOMFindClickable({ filterText: 'Save' }));

    expect(domInspector.findClickable).toHaveBeenCalledWith('Save');
    expect(body).toEqual({
      count: 1,
      elements: [{ text: 'Save', selector: 'button.primary' }],
      diagnostics: { scanned: 4 },
    });
  });

  it('rethrows inspector errors from selector queries', async () => {
    domInspector.querySelector.mockRejectedValue(new Error('query failed'));

    await expect(handlers.handleDOMQuerySelector({ selector: '#missing' })).rejects.toThrow(
      'query failed'
    );
  });
});
