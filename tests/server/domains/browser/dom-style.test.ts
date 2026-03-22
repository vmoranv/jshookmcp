import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMStyleHandlers } from '@server/domains/browser/handlers/dom-style';



describe('DOMStyleHandlers', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    domInspector.getComputedStyle.mockResolvedValue({
      display: 'block',
      color: 'rgb(0, 0, 0)',
    });

    const body = parseJson<BrowserStatusResponse>(await handlers.handleDOMGetComputedStyle({ selector: '#hero' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    domInspector.isInViewport.mockResolvedValue(true);

    const body = parseJson<BrowserStatusResponse>(await handlers.handleDOMIsInViewport({ selector: '#cta' }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(domInspector.isInViewport).toHaveBeenCalledWith('#cta');
    expect(body).toEqual({
      selector: '#cta',
      inViewport: true,
    });
  });

  it('rethrows inspector errors from computed style lookup', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    domInspector.getComputedStyle.mockRejectedValue(new Error('style failed'));

    await expect(
      handlers.handleDOMGetComputedStyle({ selector: '#missing-style' })
    ).rejects.toThrow('style failed');
  });
});
