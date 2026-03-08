import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { DOMInspector } from '@modules/collector/DOMInspector';

describe('DOMInspector', () => {
  let page: any;
  let collector: any;
  let inspector: DOMInspector;

  beforeEach(() => {
    page = {
      evaluate: vi.fn(),
      waitForSelector: vi.fn(),
      frames: vi.fn(() => [{}]),
    };
    collector = {
      getActivePage: vi.fn().mockResolvedValue(page),
    };
    inspector = new DOMInspector(collector);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('returns elements with diagnostics from querySelectorAll', async () => {
    page.evaluate
      .mockResolvedValueOnce('complete')
      .mockResolvedValueOnce({
        elements: [
          { found: true, nodeName: 'DIV', textContent: 'A' },
          { found: true, nodeName: 'DIV', textContent: 'B' },
        ],
        diagnostics: { readyState: 'complete', shadowRootCount: 0 },
      });

    const result = await inspector.querySelectorAll('.item', 2);
    expect(result.elements).toHaveLength(2);
    expect(result.elements[1]?.textContent).toBe('B');
    expect(result.diagnostics).toMatchObject({
      readyState: 'complete',
      frameCount: 1,
      shadowRootCount: 0,
      retried: false,
      waitedForReadyState: false,
    });
  });

  it('waits for document readyState before querying', async () => {
    vi.useFakeTimers();
    page.evaluate
      .mockResolvedValueOnce('loading')
      .mockResolvedValueOnce('interactive')
      .mockResolvedValueOnce('complete')
      .mockResolvedValueOnce({
        elements: [{ found: true, nodeName: 'INPUT', textContent: '' }],
        diagnostics: { readyState: 'complete', shadowRootCount: 0 },
      });

    const resultPromise = inspector.querySelectorAll('input', 5);
    await vi.advanceTimersByTimeAsync(300);
    const result = await resultPromise;

    expect(result.elements).toHaveLength(1);
    expect(result.diagnostics.waitedForReadyState).toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it('retries once when querySelectorAll is empty after hydration', async () => {
    vi.useFakeTimers();
    page.evaluate
      .mockResolvedValueOnce('complete')
      .mockResolvedValueOnce({
        elements: [],
        diagnostics: { readyState: 'complete', shadowRootCount: 0 },
      })
      .mockResolvedValueOnce({
        elements: [{ found: true, nodeName: 'INPUT', textContent: 'email' }],
        diagnostics: { readyState: 'complete', shadowRootCount: 1 },
      });

    const resultPromise = inspector.querySelectorAll('input', 5);
    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    expect(result.elements).toHaveLength(1);
    expect(result.diagnostics.retried).toBe(true);
    expect(result.diagnostics.shadowRootCount).toBe(1);
  });

  it('returns clickable elements with shadow DOM diagnostics', async () => {
    page.evaluate
      .mockResolvedValueOnce('complete')
      .mockResolvedValueOnce({
        elements: [
          {
            selector: '#submit',
            text: 'Submit',
            type: 'button',
            visible: true,
          },
        ],
        diagnostics: { readyState: 'complete', shadowRootCount: 2 },
      });

    const result = await inspector.findClickable('submit');
    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.selector).toBe('#submit');
    expect(result.diagnostics).toMatchObject({
      readyState: 'complete',
      shadowRootCount: 2,
      retried: false,
    });
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
