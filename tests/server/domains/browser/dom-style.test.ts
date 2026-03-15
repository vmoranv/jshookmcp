import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMStyleHandlers } from '@server/domains/browser/handlers/dom-style';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('DOMStyleHandlers', () => {
  let domInspector: any;
  let handlers: DOMStyleHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    domInspector = {
      getComputedStyle: vi.fn(),
      isInViewport: vi.fn(),
    };
    handlers = new DOMStyleHandlers({ domInspector });
  });

  it('returns computed styles for a selector', async () => {
    domInspector.getComputedStyle.mockResolvedValue({
      display: 'block',
      color: 'rgb(0, 0, 0)',
    });

    const body = parseJson(await handlers.handleDOMGetComputedStyle({ selector: '#hero' }));

    expect(domInspector.getComputedStyle).toHaveBeenCalledWith('#hero');
    expect(body).toEqual({
      selector: '#hero',
      styles: {
        display: 'block',
        color: 'rgb(0, 0, 0)',
      },
    });
  });

  it('returns viewport state for a selector', async () => {
    domInspector.isInViewport.mockResolvedValue(true);

    const body = parseJson(await handlers.handleDOMIsInViewport({ selector: '#cta' }));

    expect(domInspector.isInViewport).toHaveBeenCalledWith('#cta');
    expect(body).toEqual({
      selector: '#cta',
      inViewport: true,
    });
  });

  it('rethrows inspector errors from computed style lookup', async () => {
    domInspector.getComputedStyle.mockRejectedValue(new Error('style failed'));

    await expect(
      handlers.handleDOMGetComputedStyle({ selector: '#missing-style' })
    ).rejects.toThrow('style failed');
  });
});
