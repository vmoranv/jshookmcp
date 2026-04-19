import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMStyleHandlers } from '@server/domains/browser/handlers/dom-style';

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

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleDOMGetComputedStyle({ selector: '#hero' }),
    );

    expect(domInspector.getComputedStyle).toHaveBeenCalledWith('#hero');
    expect(body).toEqual({
      success: true,
      selector: '#hero',
      styles: {
        display: 'block',
        color: 'rgb(0, 0, 0)',
      },
    });
  });

  it('returns viewport state for a selector', async () => {
    domInspector.isInViewport.mockResolvedValue(true);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleDOMIsInViewport({ selector: '#cta' }),
    );

    expect(domInspector.isInViewport).toHaveBeenCalledWith('#cta');
    expect(body).toEqual({
      success: true,
      selector: '#cta',
      inViewport: true,
    });
  });

  it('returns failure response from computed style lookup error', async () => {
    domInspector.getComputedStyle.mockRejectedValue(new Error('style failed'));

    const response = await handlers.handleDOMGetComputedStyle({ selector: '#missing-style' });
    const body = parseJson<BrowserStatusResponse>(response);
    expect(body.success).toBe(false);
    expect(body.message).toContain('style failed');
  });
});
