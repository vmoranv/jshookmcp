import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { DOMQueryHandlers } from '@server/domains/browser/handlers/dom-query';

interface DOMInspectorMock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  querySelector: Mock<(selector: string, getAttributes: boolean) => Promise<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  querySelectorAll: Mock<(selector: string, limit: number) => Promise<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  getStructure: Mock<(depth: number, includeText: boolean) => Promise<any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  findClickable: Mock<(filterText?: string) => Promise<any>>;
}

describe('DOMQueryHandlers', () => {
  let domInspector: DOMInspectorMock;
  let handlers: DOMQueryHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    domInspector = {
      querySelector: vi.fn(),
      querySelectorAll: vi.fn(),
      getStructure: vi.fn(),
      findClickable: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlers = new DOMQueryHandlers({ domInspector: domInspector as any });
  });

  it('defaults getAttributes to true for selector queries', async () => {
    domInspector.querySelector.mockResolvedValue({
      selector: '#submit',
      tagName: 'button',
    });

    const body = parseJson<{ selector: string; tagName: string }>(
      await handlers.handleDOMQuerySelector({ selector: '#submit' })
    );

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<{ count: number; elements: any[]; diagnostics: any }>(
      await handlers.handleDOMQueryAll({ selector: '.card' })
    );

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<{ tagName: string; children: any[] }>(await handlers.handleDOMGetStructure({}));

    expect(domInspector.getStructure).toHaveBeenCalledWith(3, true);
    expect(body.children).toHaveLength(1);
  });

  it('finds clickable elements and forwards optional filter text', async () => {
    domInspector.findClickable.mockResolvedValue({
      elements: [{ text: 'Save', selector: 'button.primary' }],
      diagnostics: { scanned: 4 },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const body = parseJson<{ count: number; elements: any[]; diagnostics: any }>(
      await handlers.handleDOMFindClickable({ filterText: 'Save' })
    );

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
