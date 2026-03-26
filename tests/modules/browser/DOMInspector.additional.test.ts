import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DOMInspector } from '@modules/collector/DOMInspector';

function createMockPage(overrides: Record<string, unknown> = {}) {
  return {
    evaluate: vi.fn(),
    waitForSelector: vi.fn(),
    frames: vi.fn(() => [{}]),
    ...overrides,
  };
}

function createMockCollector(page: ReturnType<typeof createMockPage>) {
  return {
    getActivePage: vi.fn(async () => page),
  } as unknown as ConstructorParameters<typeof DOMInspector>[0];
}

describe('DOMInspector – additional coverage', () => {
  let page: ReturnType<typeof createMockPage>;
  let inspector: DOMInspector;

  beforeEach(() => {
    page = createMockPage();
    inspector = new DOMInspector(createMockCollector(page));
  });

  describe('querySelector', () => {
    it('returns element info when element is found', async () => {
      page.evaluate.mockResolvedValue({
        found: true,
        nodeName: 'DIV',
        attributes: { id: 'main', class: 'container' },
        textContent: 'Hello World',
        boundingBox: { x: 0, y: 0, width: 100, height: 50 },
        visible: true,
      });

      const result = await inspector.querySelector('#main');

      expect(result.found).toBe(true);
      expect(result.nodeName).toBe('DIV');
      expect(result.attributes?.id).toBe('main');
      expect(result.visible).toBe(true);
    });

    it('returns found:false when element is not found', async () => {
      page.evaluate.mockResolvedValue({ found: false });

      const result = await inspector.querySelector('.nonexistent');

      expect(result.found).toBe(false);
    });

    it('returns found:false on error', async () => {
      page.evaluate.mockRejectedValue(new Error('page crashed'));

      const result = await inspector.querySelector('#test');

      expect(result.found).toBe(false);
    });
  });

  describe('querySelectorAll', () => {
    it('returns multiple elements with diagnostics', async () => {
      page.evaluate
        .mockResolvedValueOnce('complete') // waitForReadyState
        .mockResolvedValueOnce({
          elements: [
            {
              found: true,
              nodeName: 'LI',
              attributes: {},
              textContent: 'Item 1',
              boundingBox: { x: 0, y: 0, width: 100, height: 20 },
              visible: true,
            },
            {
              found: true,
              nodeName: 'LI',
              attributes: {},
              textContent: 'Item 2',
              boundingBox: { x: 0, y: 20, width: 100, height: 20 },
              visible: true,
            },
          ],
          diagnostics: {
            readyState: 'complete',
            shadowRootCount: 0,
          },
        });

      const result = await inspector.querySelectorAll('li', 10);

      expect(result.elements).toHaveLength(2);
      expect(result.diagnostics.readyState).toBe('complete');
      expect(result.diagnostics.frameCount).toBe(1);
    });

    it('retries when no elements found and readyState is complete', async () => {
      // waitForReadyState calls page.evaluate first to check readyState
      page.evaluate
        .mockResolvedValueOnce('complete') // waitForReadyState check
        .mockResolvedValueOnce({
          // first runQuery
          elements: [],
          diagnostics: { readyState: 'complete', shadowRootCount: 0 },
        })
        .mockResolvedValueOnce({
          // retry runQuery
          elements: [
            {
              found: true,
              nodeName: 'DIV',
              attributes: {},
              textContent: 'Appeared',
              boundingBox: { x: 0, y: 0, width: 100, height: 50 },
              visible: true,
            },
          ],
          diagnostics: { readyState: 'complete', shadowRootCount: 0 },
        });

      const result = await inspector.querySelectorAll('.dynamic');

      expect(result.diagnostics.retried).toBe(true);
      expect(result.elements).toHaveLength(1);
    });

    it('returns error diagnostics on failure', async () => {
      page.evaluate.mockRejectedValue(new Error('evaluate failed'));

      const result = await inspector.querySelectorAll('div');

      expect(result.elements).toHaveLength(0);
      expect(result.diagnostics.readyState).toBe('error');
    });
  });

  describe('getStructure', () => {
    it('returns DOM structure tree', async () => {
      page.evaluate.mockResolvedValue({
        tag: 'BODY',
        children: [{ tag: 'DIV', id: 'main', children: [{ tag: 'P', text: 'Hello' }] }],
      });

      const result = await inspector.getStructure(3, true);

      expect(result).not.toBeNull();
      expect(result!.tag).toBe('BODY');
      expect(result!.children).toHaveLength(1);
    });

    it('returns null on error', async () => {
      page.evaluate.mockRejectedValue(new Error('failed'));

      const result = await inspector.getStructure();

      expect(result).toBeNull();
    });
  });

  describe('findClickable', () => {
    it('returns clickable elements', async () => {
      page.evaluate
        .mockResolvedValueOnce('complete') // waitForReadyState
        .mockResolvedValueOnce({
          elements: [
            {
              selector: '#btn',
              text: 'Click Me',
              type: 'button',
              visible: true,
              boundingBox: { x: 10, y: 10, width: 80, height: 30 },
            },
            {
              selector: 'a',
              text: 'Home',
              type: 'link',
              visible: true,
              boundingBox: { x: 10, y: 50, width: 60, height: 20 },
            },
          ],
          diagnostics: { readyState: 'complete', shadowRootCount: 0 },
        });

      const result = await inspector.findClickable();

      expect(result.elements).toHaveLength(2);
      expect(result.elements[0]!.type).toBe('button');
      expect(result.elements[1]!.type).toBe('link');
    });

    it('supports text filter', async () => {
      page.evaluate
        .mockResolvedValueOnce('complete') // waitForReadyState
        .mockResolvedValueOnce({
          elements: [
            {
              selector: '#submit',
              text: 'Submit',
              type: 'button',
              visible: true,
              boundingBox: { x: 10, y: 10, width: 80, height: 30 },
            },
          ],
          diagnostics: { readyState: 'complete', shadowRootCount: 0 },
        });

      const result = await inspector.findClickable('Submit');

      expect(result.elements).toHaveLength(1);
    });

    it('retries on empty results with complete readyState', async () => {
      page.evaluate
        .mockResolvedValueOnce('complete') // waitForReadyState check
        .mockResolvedValueOnce({
          // first runQuery
          elements: [],
          diagnostics: { readyState: 'complete', shadowRootCount: 0 },
        })
        .mockResolvedValueOnce({
          // retry runQuery
          elements: [
            {
              selector: 'button',
              text: 'Late Button',
              type: 'button',
              visible: true,
              boundingBox: { x: 0, y: 0, width: 50, height: 30 },
            },
          ],
          diagnostics: { readyState: 'complete', shadowRootCount: 0 },
        });

      const result = await inspector.findClickable();

      expect(result.diagnostics.retried).toBe(true);
      expect(result.elements).toHaveLength(1);
    });

    it('returns error diagnostics on failure', async () => {
      page.evaluate.mockRejectedValue(new Error('click scan failed'));

      const result = await inspector.findClickable();

      expect(result.elements).toHaveLength(0);
      expect(result.diagnostics.readyState).toBe('error');
    });
  });

  describe('getComputedStyle', () => {
    it('returns style object for found element', async () => {
      page.evaluate.mockResolvedValue({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        color: 'rgb(0, 0, 0)',
      });

      const result = await inspector.getComputedStyle('#styled');

      expect(result).not.toBeNull();
      expect(result!.display).toBe('block');
    });

    it('returns null when element not found', async () => {
      page.evaluate.mockResolvedValue(null);

      const result = await inspector.getComputedStyle('.missing');

      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      page.evaluate.mockRejectedValue(new Error('eval failed'));

      const result = await inspector.getComputedStyle('#broken');

      expect(result).toBeNull();
    });
  });

  describe('waitForElement', () => {
    it('returns element info after waiting', async () => {
      page.waitForSelector.mockResolvedValue(undefined);
      page.evaluate.mockResolvedValue({
        found: true,
        nodeName: 'SPAN',
        attributes: { class: 'loaded' },
        textContent: 'Ready',
        boundingBox: { x: 0, y: 0, width: 50, height: 20 },
        visible: true,
      });

      const result = await inspector.waitForElement('.loaded', 5000);

      expect(result).not.toBeNull();
      expect(result!.found).toBe(true);
      expect(page.waitForSelector).toHaveBeenCalledWith('.loaded', { timeout: 5000 });
    });

    it('returns null on timeout', async () => {
      page.waitForSelector.mockRejectedValue(new Error('timeout'));

      const result = await inspector.waitForElement('.never-appears', 100);

      expect(result).toBeNull();
    });
  });

  describe('findByText', () => {
    it('returns elements matching text content', async () => {
      page.evaluate.mockResolvedValue([
        {
          found: true,
          nodeName: 'P',
          textContent: 'Hello World',
          selector: 'p.greeting',
          boundingBox: { x: 0, y: 0, width: 200, height: 30 },
          visible: true,
        },
      ]);

      const result = await inspector.findByText('Hello');

      expect(result).toHaveLength(1);
      expect(result[0]!.textContent).toBe('Hello World');
    });

    it('supports tag filter', async () => {
      page.evaluate.mockResolvedValue([]);

      const result = await inspector.findByText('Search', 'button');

      expect(result).toHaveLength(0);
      // Should have been called with both text and tag
      expect(page.evaluate).toHaveBeenCalled();
    });

    it('returns empty array on error', async () => {
      page.evaluate.mockRejectedValue(new Error('xpath failed'));

      const result = await inspector.findByText('broken');

      expect(result).toHaveLength(0);
    });
  });

  describe('getXPath', () => {
    it('returns xpath string for found element', async () => {
      page.evaluate.mockResolvedValue('//*[@id="main"]');

      const result = await inspector.getXPath('#main');

      expect(result).toBe('//*[@id="main"]');
    });

    it('returns null when element not found', async () => {
      page.evaluate.mockResolvedValue(null);

      const result = await inspector.getXPath('.missing');

      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      page.evaluate.mockRejectedValue(new Error('eval crashed'));

      const result = await inspector.getXPath('#bad');

      expect(result).toBeNull();
    });
  });

  describe('isInViewport', () => {
    it('returns true when element is in viewport', async () => {
      page.evaluate.mockResolvedValue(true);

      const result = await inspector.isInViewport('#visible');

      expect(result).toBe(true);
    });

    it('returns false when element is not in viewport', async () => {
      page.evaluate.mockResolvedValue(false);

      const result = await inspector.isInViewport('#offscreen');

      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      page.evaluate.mockRejectedValue(new Error('page not ready'));

      const result = await inspector.isInViewport('#broken');

      expect(result).toBe(false);
    });
  });

  describe('observeDOMChanges', () => {
    it('calls page.evaluate with observation options', async () => {
      page.evaluate.mockResolvedValue(undefined);

      await inspector.observeDOMChanges({
        selector: '#target',
        childList: true,
        attributes: true,
      });

      expect(page.evaluate).toHaveBeenCalled();
    });

    it('uses default options when none provided', async () => {
      page.evaluate.mockResolvedValue(undefined);

      await inspector.observeDOMChanges();

      expect(page.evaluate).toHaveBeenCalled();
    });
  });

  describe('stopObservingDOM', () => {
    it('disconnects the observer', async () => {
      page.evaluate.mockResolvedValue(undefined);

      await inspector.stopObservingDOM();

      expect(page.evaluate).toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('detaches CDP session when set', async () => {
      const mockCdpSession = { detach: vi.fn(async () => undefined) };
      (inspector as any).cdpSession = mockCdpSession;

      await inspector.close();

      expect(mockCdpSession.detach).toHaveBeenCalled();
      expect((inspector as any).cdpSession).toBeNull();
    });

    it('no-ops when no CDP session is set', async () => {
      await expect(inspector.close()).resolves.toBeUndefined();
    });
  });

  describe('waitForReadyState', () => {
    it('waits until readyState is complete', async () => {
      let callCount = 0;
      page.evaluate.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) return 'loading';
        return 'complete';
      });

      // Access private method via querySelectorAll which calls waitForReadyState
      page.evaluate
        .mockResolvedValueOnce('loading')
        .mockResolvedValueOnce('loading')
        .mockResolvedValueOnce('complete')
        .mockResolvedValue({
          elements: [],
          diagnostics: { readyState: 'complete', shadowRootCount: 0 },
        });

      const result = await inspector.querySelectorAll('.test');
      expect(result.diagnostics).toBeDefined();
    });
  });
});
