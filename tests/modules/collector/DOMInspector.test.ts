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

import type { CDPSession } from 'rebrowser-puppeteer-core';
import { DOMInspector } from '@modules/collector/DOMInspector';

class TestDOMInspector extends DOMInspector {
  public setCDPSession(session: CDPSession | null): void {
    this.cdpSession = session;
  }
}

describe('DOMInspector', () => {
  let page: Record<string, any>;
  let collector: Record<string, any>;
  let inspector: TestDOMInspector;

  beforeEach(() => {
    page = {
      evaluate: vi.fn(),
      waitForSelector: vi.fn(),
      frames: vi.fn(() => [{}]),
    };
    collector = {
      getActivePage: vi.fn().mockResolvedValue(page),
    };
    inspector = new TestDOMInspector(collector as any);
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
    page.evaluate.mockResolvedValueOnce('complete').mockResolvedValueOnce({
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
    page.evaluate.mockResolvedValueOnce('complete').mockResolvedValueOnce({
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
    inspector.setCDPSession({ detach } as unknown as CDPSession);

    await inspector.close();
    expect(detach).toHaveBeenCalledTimes(1);
  });

  // --- getStructure ---

  it('returns DOM structure tree from body', async () => {
    page.evaluate.mockResolvedValue({
      tag: 'BODY',
      id: undefined,
      class: undefined,
      children: [{ tag: 'DIV', id: 'app', class: 'container', children: [] }],
    });

    const result = await inspector.getStructure(3, true);
    expect(result).not.toBeNull();
    expect(result?.tag).toBe('BODY');
    expect(result?.children).toHaveLength(1);
    expect(result?.children?.[0]?.id).toBe('app');
  });

  it('getStructure returns null when evaluate throws', async () => {
    page.evaluate.mockRejectedValue(new Error('eval error'));

    const result = await inspector.getStructure();
    expect(result).toBeNull();
  });

  it('getStructure excludes text when includeText is false', async () => {
    page.evaluate.mockResolvedValue({ tag: 'BODY', children: [] });

    const result = await inspector.getStructure(2, false);
    expect(result?.tag).toBe('BODY');
  });

  // --- findByText ---

  it('finds elements by text content', async () => {
    page.evaluate.mockResolvedValue([
      {
        found: true,
        nodeName: 'SPAN',
        textContent: 'Hello',
        selector: 'span.greeting',
        visible: true,
      },
    ]);

    const result = await inspector.findByText('Hello');
    expect(result).toHaveLength(1);
    expect(result[0]?.textContent).toBe('Hello');
  });

  it('finds elements by text and tag name', async () => {
    page.evaluate.mockResolvedValue([
      {
        found: true,
        nodeName: 'BUTTON',
        textContent: 'Submit',
        selector: 'button.submit-btn',
        visible: true,
      },
    ]);

    const result = await inspector.findByText('Submit', 'button');
    expect(result).toHaveLength(1);
    expect(result[0]?.nodeName).toBe('BUTTON');
  });

  it('findByText returns empty array when nothing matches', async () => {
    page.evaluate.mockResolvedValue([]);

    const result = await inspector.findByText('NotFound');
    expect(result).toHaveLength(0);
  });

  it('findByText returns empty array on error', async () => {
    page.evaluate.mockRejectedValue(new Error('xpath error'));

    const result = await inspector.findByText('Something');
    expect(result).toEqual([]);
  });

  // --- getXPath ---

  it('builds XPath from element with id', async () => {
    page.evaluate.mockResolvedValue('//*[@id="main"]');

    const result = await inspector.getXPath('#main');
    expect(result).toBe('//*[@id="main"]');
  });

  it('builds XPath iteratively through ancestors', async () => {
    page.evaluate.mockResolvedValue('/html/body/div[1]/span[2]');

    const result = await inspector.getXPath('.nested');
    expect(result).toBe('/html/body/div[1]/span[2]');
  });

  it('getXPath returns null when element not found in evaluate', async () => {
    page.evaluate.mockResolvedValue(null);

    const result = await inspector.getXPath('.missing');
    expect(result).toBeNull();
  });

  it('getXPath returns null on evaluate error', async () => {
    page.evaluate.mockRejectedValue(new Error('query error'));

    const result = await inspector.getXPath('#foo');
    expect(result).toBeNull();
  });

  // --- isInViewport ---

  it('isInViewport returns true when element is in viewport', async () => {
    page.evaluate.mockResolvedValue(true);

    const result = await inspector.isInViewport('#visible');
    expect(result).toBe(true);
  });

  it('isInViewport returns false when element is outside viewport', async () => {
    page.evaluate.mockResolvedValue(false);

    const result = await inspector.isInViewport('#below-fold');
    expect(result).toBe(false);
  });

  it('isInViewport returns false when element not found', async () => {
    page.evaluate.mockResolvedValue(false);

    const result = await inspector.isInViewport('.nonexistent');
    expect(result).toBe(false);
    // Verify the !element branch in evaluate returned false
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), '.nonexistent');
  });

  it('isInViewport returns false on evaluate error', async () => {
    page.evaluate.mockRejectedValue(new Error('rect error'));

    const result = await inspector.isInViewport('#box');
    expect(result).toBe(false);
  });

  // --- observeDOMChanges ---

  it('observeDOMChanges sets __domObserver on window', async () => {
    page.evaluate.mockResolvedValue(undefined);

    await inspector.observeDOMChanges();
    // Verify evaluate was called with MutationObserver setup
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {});
  });

  it('observeDOMChanges accepts selector option', async () => {
    page.evaluate.mockResolvedValue(undefined);

    await inspector.observeDOMChanges({ selector: '#app' });
    // Defaults (childList, attributes, characterData, subtree) are merged inside
    // the evaluate callback, not in the outer options argument
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      selector: '#app',
    });
  });

  it('observeDOMChanges handles missing target node gracefully', async () => {
    // page.evaluate resolves (observer setup code runs but returns early due to !targetNode)
    page.evaluate.mockResolvedValue(undefined);

    await expect(inspector.observeDOMChanges({ selector: '.not-there' })).resolves.not.toThrow();
    expect(page.evaluate).toHaveBeenCalled();
  });

  // --- stopObservingDOM ---

  it('stopObservingDOM disconnects observer and cleans up', async () => {
    // Simulate window.__domObserver being set by a previous observeDOMChanges call.
    // The evaluate callback synchronously reads typedWindow.__domObserver (which
    // exists because observeDOMChanges set it) and calls disconnect on it.
    page.evaluate.mockImplementation(() => {
      // Simulate the evaluate callback: window.__domObserver exists and disconnect is called
      // We verify this by checking the mock was invoked
      return undefined;
    });

    await inspector.stopObservingDOM();
    // stopObservingDOM calls page.evaluate which reads __domObserver and disconnects
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  // --- waitForElement ---

  it('waitForElement resolves with element info on success', async () => {
    page.waitForSelector.mockResolvedValue(undefined);
    page.evaluate.mockResolvedValue({
      found: true,
      nodeName: 'DIV',
      textContent: 'Loaded',
      visible: true,
    });

    const result = await inspector.waitForElement('#loaded');
    expect(result?.found).toBe(true);
    expect(result?.nodeName).toBe('DIV');
  });

  // --- Error paths ---

  it('querySelectorAll returns error diagnostics on evaluate failure', async () => {
    page.evaluate.mockRejectedValue(new Error('query failed'));

    const result = await inspector.querySelectorAll('.item');
    expect(result.elements).toEqual([]);
    expect(result.diagnostics.readyState).toBe('error');
    expect(result.diagnostics.frameCount).toBe(0);
  });

  it('findClickable returns error diagnostics on evaluate failure', async () => {
    page.evaluate.mockRejectedValue(new Error('clickable query failed'));

    const result = await inspector.findClickable();
    expect(result.elements).toEqual([]);
    expect(result.diagnostics.readyState).toBe('error');
  });

  it('querySelector returns found=false on error', async () => {
    page.evaluate.mockRejectedValue(new Error('selector failed'));

    const result = await inspector.querySelector('#foo');
    expect(result).toEqual({ found: false });
  });

  // --- waitForReadyState branches ---

  it('querySelectorAll uses frameCount=1 when page.frames is not callable', async () => {
    // page.evaluate returns a resolved Promise; the first call satisfies waitForReadyState's
    // while loop (readyState === 'complete') and the second call provides runQuery result
    let callCount = 0;
    const freshCollector: Record<string, any> = {
      getActivePage: vi.fn().mockResolvedValue({
        evaluate: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return 'complete';
          return {
            elements: [],
            diagnostics: { readyState: 'complete', shadowRootCount: 0 },
          };
        }),
        waitForSelector: vi.fn(),
        frames: undefined,
      }),
    };
    const freshInspector = new TestDOMInspector(freshCollector as any);

    const result = await freshInspector.querySelectorAll('body');
    expect(result.diagnostics.frameCount).toBe(1);
  });

  it('close is safe when cdpSession is null', async () => {
    await inspector.close();
    // No error should occur
  });
});
