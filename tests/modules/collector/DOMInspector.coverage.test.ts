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

function NoopMutationObserver() {}

class TestDOMInspector extends DOMInspector {
  public setCDPSession(session: CDPSession | null): void {
    this.cdpSession = session;
  }
  public getCDPSession(): CDPSession | null {
    return this.cdpSession;
  }
}

type AnyRecord = Record<string, any>;

function withStubbedGlobals<T>(globals: AnyRecord, run: () => Promise<T> | T): Promise<T> | T {
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const restore = () => {
    for (const [key, descriptor] of previous.entries()) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as AnyRecord)[key];
      }
    }
  };

  try {
    const result = run();
    if (result && typeof (result as Promise<T>).then === 'function') {
      return (result as Promise<T>).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function createExecutingPage(globals: () => AnyRecord): Record<string, any> {
  return {
    evaluate: vi.fn(async (callback: (...args: any[]) => any, ...args: any[]) =>
      withStubbedGlobals(globals(), () => callback(...args)),
    ),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    frames: vi.fn(() => [{}]),
  };
}

function createElement(options: {
  className?: string;
  id?: string;
  nodeName?: string;
  tagName?: string;
  textContent?: string;
  attributes?: Array<{ name: string; value: string }>;
  value?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: any[];
  childNodes?: any[];
  parentElement?: any;
  shadowRoot?: any;
  href?: string;
}): any {
  const {
    tagName = 'DIV',
    nodeName = tagName,
    className = '',
    id = '',
    textContent = '',
    attributes = [],
    value = '',
    width = 100,
    height = 40,
    x = 0,
    y = 0,
    children = [],
    childNodes = [],
    parentElement,
    shadowRoot,
    href,
  } = options;

  return {
    tagName,
    nodeName,
    className,
    id,
    textContent,
    attributes,
    value,
    href,
    children,
    childNodes,
    parentElement,
    shadowRoot,
    getBoundingClientRect: () => ({
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      bottom: y + height,
      right: x + width,
    }),
    querySelectorAll: vi.fn(() => []),
  };
}

function createComputedStyle(overrides: Partial<Record<string, string>> = {}) {
  const defaults: Record<string, string> = {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    position: 'relative',
    zIndex: 'auto',
    width: '100px',
    height: '40px',
    top: '0px',
    left: '0px',
    right: 'auto',
    bottom: 'auto',
    color: 'rgb(0, 0, 0)',
    backgroundColor: 'transparent',
    fontSize: '16px',
    fontFamily: 'sans-serif',
    border: '0px none rgb(0, 0, 0)',
    padding: '0px',
    margin: '0px',
    overflow: 'visible',
  };
  const values = { ...defaults, ...overrides };

  return {
    ...values,
    getPropertyValue: (prop: string) => values[prop] ?? '',
  };
}

describe('DOMInspector – additional coverage', () => {
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
    vi.unstubAllGlobals();
  });

  it('executes querySelector DOM logic for found and missing elements', async () => {
    const button = createElement({
      nodeName: 'BUTTON',
      tagName: 'BUTTON',
      id: 'submit',
      textContent: ' Submit ',
      attributes: [{ name: 'type', value: 'submit' }],
      x: 12,
      y: 24,
    });
    const documentLike = {
      querySelector: vi.fn((selector: string) => (selector === '#submit' ? button : null)),
    };
    const windowLike = {
      getComputedStyle: vi.fn(() => createComputedStyle()),
    };

    page = createExecutingPage(() => ({ document: documentLike, window: windowLike }));
    collector.getActivePage = vi.fn().mockResolvedValue(page);
    inspector = new TestDOMInspector(collector as any);

    const found = await inspector.querySelector('#submit');
    const missing = await inspector.querySelector('.missing');

    expect(found).toMatchObject({
      found: true,
      nodeName: 'BUTTON',
      textContent: 'Submit',
      visible: true,
      attributes: { type: 'submit' },
      boundingBox: { x: 12, y: 24, width: 100, height: 40 },
    });
    expect(missing).toEqual({ found: false });
    expect(documentLike.querySelector).toHaveBeenCalledWith('#submit');
    expect(documentLike.querySelector).toHaveBeenCalledWith('.missing');
  });

  it('executes querySelectorAll with ready-state waiting, retry, shadow DOM, and truncation', async () => {
    vi.useFakeTimers();

    const shadowItem = createElement({
      nodeName: 'SPAN',
      tagName: 'SPAN',
      className: 'shadow-item',
      textContent: 'shadow child text',
      attributes: [{ name: 'data-role', value: 'shadow' }],
      x: 2,
      y: 2,
    });
    const host = createElement({
      nodeName: 'DIV',
      tagName: 'DIV',
      className: 'host',
      shadowRoot: {
        querySelectorAll: vi.fn((selector: string) => {
          if (selector === '*') {
            return [shadowItem];
          }
          if (selector === '.item') {
            return queryAttempts < 2 ? [] : [shadowItem];
          }
          return [];
        }),
      },
    });
    const longText = 'x'.repeat(520);
    const hydratedItem = createElement({
      nodeName: 'DIV',
      tagName: 'DIV',
      className: 'item hydrated',
      textContent: longText,
      attributes: [{ name: 'data-id', value: 'primary' }],
      x: 10,
      y: 20,
    });
    let readyChecks = 0;
    let queryAttempts = 0;
    const documentLike = {
      get readyState() {
        readyChecks += 1;
        return readyChecks < 3 ? 'loading' : 'complete';
      },
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === '*') {
          return [host];
        }
        if (selector === '.item') {
          queryAttempts += 1;
          return queryAttempts === 1 ? [] : [hydratedItem];
        }
        return [];
      }),
    };
    const windowLike = {
      getComputedStyle: vi.fn(() => createComputedStyle()),
    };

    page = createExecutingPage(() => ({ document: documentLike, window: windowLike }));
    page.frames = vi.fn(() => [{}, {}]);
    collector.getActivePage = vi.fn().mockResolvedValue(page);
    inspector = new TestDOMInspector(collector as any);

    const resultPromise = inspector.querySelectorAll('.item', 1);
    await vi.advanceTimersByTimeAsync(700);
    const result = await resultPromise;

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.textContent).toBe(`${longText.slice(0, 500)}...[truncated]`);
    expect(result.diagnostics).toMatchObject({
      readyState: 'complete',
      frameCount: 2,
      shadowRootCount: 1,
      retried: true,
      waitedForReadyState: true,
    });
    expect(documentLike.querySelectorAll).toHaveBeenCalledWith('*');
    expect(documentLike.querySelectorAll).toHaveBeenCalledWith('.item');
  });

  // ─── getStructure ────────────────────────────────────────────────
  describe('getStructure', () => {
    it('returns DOM structure tree successfully', async () => {
      const mockStructure = {
        tag: 'BODY',
        id: 'main',
        class: 'container',
        children: [
          {
            tag: 'DIV',
            id: 'header',
            class: 'header-class',
            children: [],
          },
        ],
      };
      page.evaluate.mockResolvedValue(mockStructure);

      const result = await inspector.getStructure(3, true);

      expect(result).toEqual(mockStructure);
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 3, true);
    });

    it('returns structure without text when includeText is false', async () => {
      page.evaluate.mockResolvedValue({ tag: 'BODY' });

      const result = await inspector.getStructure(2, false);

      expect(result).toEqual({ tag: 'BODY' });
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 2, false);
    });

    it('returns null when getStructure fails', async () => {
      page.evaluate.mockRejectedValue(new Error('structure error'));

      const result = await inspector.getStructure();

      expect(result).toBeNull();
    });

    it('uses default values for maxDepth and includeText', async () => {
      page.evaluate.mockResolvedValue({ tag: 'BODY' });

      await inspector.getStructure();

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 3, true);
    });
  });

  // ─── findClickable ───────────────────────────────────────────────
  describe('findClickable', () => {
    it('returns empty elements with error diagnostics when error occurs', async () => {
      page.evaluate
        .mockResolvedValueOnce('complete')
        .mockRejectedValueOnce(new Error('clickable error'));

      const result = await inspector.findClickable();

      expect(result.elements).toHaveLength(0);
      expect(result.diagnostics).toEqual({
        readyState: 'error',
        frameCount: 0,
        shadowRootCount: 0,
        retried: false,
        waitedForReadyState: false,
      });
    });

    it('retries findClickable when result is empty on complete readyState', async () => {
      vi.useFakeTimers();
      page.evaluate
        .mockResolvedValueOnce('complete')
        .mockResolvedValueOnce({
          elements: [],
          diagnostics: { readyState: 'complete', shadowRootCount: 0 },
        })
        .mockResolvedValueOnce({
          elements: [{ selector: '#btn', text: 'Click', type: 'button', visible: true }],
          diagnostics: { readyState: 'complete', shadowRootCount: 1 },
        });

      const resultPromise = inspector.findClickable();
      await vi.advanceTimersByTimeAsync(600);
      const result = await resultPromise;

      expect(result.elements).toHaveLength(1);
      expect(result.diagnostics.retried).toBe(true);
    });

    it('returns clickable elements without filter', async () => {
      page.evaluate.mockResolvedValueOnce('complete').mockResolvedValueOnce({
        elements: [
          { selector: '#submit', text: 'Submit', type: 'button', visible: true },
          { selector: 'a.link', text: 'Click here', type: 'link', visible: true },
        ],
        diagnostics: { readyState: 'complete', shadowRootCount: 0 },
      });

      const result = await inspector.findClickable();

      expect(result.elements).toHaveLength(2);
      expect(result.diagnostics.readyState).toBe('complete');
    });
  });

  it('executes getStructure, observeDOMChanges, stopObservingDOM, and findClickable internals', async () => {
    const textNode = { nodeType: 3 };
    const childSection = createElement({
      nodeName: 'SECTION',
      tagName: 'SECTION',
      id: 'child',
      className: 'child-class',
      childNodes: [textNode],
      children: [],
      textContent: 'Child content',
    });
    const body = createElement({
      nodeName: 'BODY',
      tagName: 'BODY',
      id: 'main',
      className: 'container',
      childNodes: [textNode],
      children: [childSection],
      textContent: 'Body content',
    });
    childSection.parentElement = body;

    const hiddenButton = createElement({
      nodeName: 'BUTTON',
      tagName: 'BUTTON',
      className: 'cta primary',
      textContent: 'Hidden action',
      width: 0,
      height: 0,
    });
    const submitButton = createElement({
      nodeName: 'BUTTON',
      tagName: 'BUTTON',
      id: 'submit',
      textContent: 'Submit button',
      attributes: [{ name: 'type', value: 'submit' }],
    });
    const docsLink = createElement({
      nodeName: 'A',
      tagName: 'A',
      id: 'docs',
      textContent: 'Read docs',
      href: 'https://example.com/docs',
    });

    const observerInstances: Array<{ observe: any; disconnect: any }> = [];
    class MockMutationObserver {
      constructor() {
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        observerInstances.push(this as any);
      }

      observe: any;
      disconnect: any;
    }

    const documentLike = {
      body,
      querySelector: vi.fn((selector: string) => {
        if (selector === '#body-target') {
          return body;
        }
        if (selector === '#submit') {
          return submitButton;
        }
        if (selector === '#docs') {
          return docsLink;
        }
        if (selector === '.hidden') {
          return hiddenButton;
        }
        if (selector === '#missing') {
          return null;
        }
        return body;
      }),
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === '*') {
          return [body, childSection, submitButton, hiddenButton, docsLink];
        }
        if (
          selector === 'button, input[type="button"], input[type="submit"], input[type="reset"]'
        ) {
          return [submitButton, hiddenButton];
        }
        if (selector === 'a[href]') {
          return [docsLink];
        }
        return [];
      }),
    };
    const windowLike = {
      getComputedStyle: vi.fn((element: any) =>
        createComputedStyle(
          element === hiddenButton
            ? { display: 'none', visibility: 'hidden', opacity: '0' }
            : { display: 'block', visibility: 'visible', opacity: '1' },
        ),
      ),
      __domObserver: undefined,
    };

    page = createExecutingPage(() => ({
      document: documentLike,
      window: windowLike,
      MutationObserver: MockMutationObserver,
    }));
    collector.getActivePage = vi.fn().mockResolvedValue(page);
    inspector = new TestDOMInspector(collector as any);

    const structure = await inspector.getStructure(1, true);
    expect(structure).toMatchObject({
      tag: 'BODY',
      id: 'main',
      class: 'container',
      text: 'Body content',
      children: [
        {
          tag: 'SECTION',
          id: 'child',
          class: 'child-class',
          text: 'Child content',
        },
      ],
    });

    const shallow = await inspector.getStructure(0, false);
    expect(shallow).toMatchObject({ tag: 'BODY', id: 'main', class: 'container' });
    expect(shallow?.children).toBeUndefined();

    await inspector.observeDOMChanges({ selector: '#body-target' });
    expect(observerInstances).toHaveLength(1);
    expect(observerInstances[0]?.observe).toHaveBeenCalledWith(body, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });
    expect(windowLike.__domObserver).toBe(observerInstances[0]);

    await inspector.stopObservingDOM();
    expect(observerInstances[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(windowLike.__domObserver).toBeUndefined();

    const clickable = await inspector.findClickable('submit');
    expect(clickable.elements).toHaveLength(1);
    expect(clickable.elements[0]).toMatchObject({
      selector: '#submit',
      text: 'Submit button',
      type: 'button',
      visible: true,
    });

    const allClickable = await inspector.findClickable();
    expect(allClickable.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: '#submit', text: 'Submit button' }),
        expect.objectContaining({
          selector: 'button.cta',
          text: 'Hidden action',
          visible: false,
        }),
        expect.objectContaining({ selector: '#docs', text: 'Read docs', type: 'link' }),
      ]),
    );
  });

  // ─── getComputedStyle ────────────────────────────────────────────
  describe('getComputedStyle', () => {
    it('returns computed style properties when element exists', async () => {
      page.evaluate.mockResolvedValue({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: 'relative',
        zIndex: '10',
        width: '100px',
        height: '50px',
      });

      const result = await inspector.getComputedStyle('.btn');

      expect(result).not.toBeNull();
      expect(result?.display).toBe('block');
      expect(result?.visibility).toBe('visible');
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), '.btn');
    });

    it('returns null when element is not found', async () => {
      page.evaluate.mockResolvedValue(null);

      const result = await inspector.getComputedStyle('.nonexistent');

      expect(result).toBeNull();
    });
  });

  it('executes getComputedStyle, findByText, getXPath, and isInViewport internals', async () => {
    const visibleElement = createElement({
      nodeName: 'BUTTON',
      tagName: 'BUTTON',
      id: 'cta',
      textContent: 'Click me',
      width: 60,
      height: 20,
      x: 10,
      y: 15,
    });
    const hiddenElement = createElement({
      nodeName: 'DIV',
      tagName: 'DIV',
      className: 'hidden',
      textContent: 'Hidden text',
      width: 10,
      height: 10,
      x: 500,
      y: 500,
    });
    const siblingOne = createElement({ nodeName: 'SPAN', tagName: 'SPAN', textContent: 'First' });
    const siblingTwo = createElement({
      nodeName: 'SPAN',
      tagName: 'SPAN',
      className: 'nested',
      textContent: 'Second',
    });
    const parent = createElement({
      nodeName: 'DIV',
      tagName: 'DIV',
      children: [siblingOne, siblingTwo],
    });
    siblingOne.parentElement = parent;
    siblingTwo.parentElement = parent;
    const root = createElement({
      nodeName: 'BODY',
      tagName: 'BODY',
      children: [parent],
    });
    parent.parentElement = root;

    const windowLike = {
      innerHeight: 300,
      innerWidth: 400,
      getComputedStyle: vi.fn((element: any) =>
        createComputedStyle(
          element === hiddenElement
            ? { display: 'none', visibility: 'hidden', opacity: '0' }
            : { display: 'block', visibility: 'visible', opacity: '1' },
        ),
      ),
    };
    const documentLike = {
      querySelector: vi.fn((selector: string) => {
        if (selector === '#cta') return visibleElement;
        if (selector === '.hidden') return hiddenElement;
        if (selector === '.nested') return siblingTwo;
        return null;
      }),
      documentElement: { clientHeight: 300, clientWidth: 400 },
      body: root,
      evaluate: vi.fn((xpath: string) => {
        if (xpath.includes('contains(text(), "Click")')) {
          return {
            snapshotLength: 2,
            snapshotItem: (index: number) => (index === 0 ? visibleElement : hiddenElement),
          };
        }
        if (xpath.includes('contains(text(), "Link")')) {
          return {
            snapshotLength: 1,
            snapshotItem: () => siblingTwo,
          };
        }
        return {
          snapshotLength: 0,
          snapshotItem: () => null,
        };
      }),
    };

    page = createExecutingPage(() => ({
      document: documentLike,
      window: windowLike,
      XPathResult: { ORDERED_NODE_SNAPSHOT_TYPE: 7 },
    }));
    collector.getActivePage = vi.fn().mockResolvedValue(page);
    inspector = new TestDOMInspector(collector as any);

    const styles = await inspector.getComputedStyle('#cta');
    expect(styles).toMatchObject({
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      width: '100px',
    });
    expect(await inspector.getComputedStyle('.missing')).toBeNull();

    const texts = await inspector.findByText('Click');
    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatchObject({
      found: true,
      nodeName: 'BUTTON',
      selector: '#cta',
      visible: true,
    });

    const tagged = await inspector.findByText('Link', 'a');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toMatchObject({
      selector: 'span.nested',
      nodeName: 'SPAN',
    });
    expect(await inspector.findByText('Missing')).toEqual([]);

    expect(await inspector.getXPath('.nested')).toBe('/html/body/div[1]/span[2]');
    expect(await inspector.getXPath('#cta')).toBe('//*[@id="cta"]');
    expect(await inspector.getXPath('.missing')).toBeNull();

    expect(await inspector.isInViewport('#cta')).toBe(true);
    expect(await inspector.isInViewport('.hidden')).toBe(false);
  });

  it('covers DOM observer no-target and no-op stop paths', async () => {
    const documentLike = {
      querySelector: vi.fn(() => null),
      body: null,
    };
    const windowLike = {
      __domObserver: undefined,
    };

    page = createExecutingPage(() => ({
      document: documentLike,
      window: windowLike,
      MutationObserver: NoopMutationObserver,
    }));
    collector.getActivePage = vi.fn().mockResolvedValue(page);
    inspector = new TestDOMInspector(collector as any);

    await expect(inspector.observeDOMChanges({ selector: '#missing' })).resolves.toBeUndefined();
    await expect(inspector.stopObservingDOM()).resolves.toBeUndefined();
    expect(windowLike.__domObserver).toBeUndefined();
  });

  // ─── waitForElement ──────────────────────────────────────────────
  describe('waitForElement', () => {
    it('returns element info when element appears', async () => {
      page.waitForSelector.mockResolvedValue({});
      page.evaluate.mockResolvedValue({
        found: true,
        nodeName: 'INPUT',
        textContent: '',
        visible: true,
      });

      const result = await inspector.waitForElement('#input', 5000);

      expect(result).not.toBeNull();
      expect(result?.found).toBe(true);
      expect(result?.nodeName).toBe('INPUT');
      expect(page.waitForSelector).toHaveBeenCalledWith('#input', { timeout: 5000 });
    });

    it('uses default timeout when not specified', async () => {
      page.waitForSelector.mockResolvedValue({});
      page.evaluate.mockResolvedValue({ found: true });

      await inspector.waitForElement('#element');

      expect(page.waitForSelector).toHaveBeenCalledWith('#element', { timeout: 30000 });
    });
  });

  // ─── observeDOMChanges ───────────────────────────────────────────
  describe('observeDOMChanges', () => {
    it('observes DOM changes with default options', async () => {
      page.evaluate.mockResolvedValue(undefined);

      await inspector.observeDOMChanges();

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {});
    });

    it('observes DOM changes with custom selector and options', async () => {
      page.evaluate.mockResolvedValue(undefined);
      const options = {
        selector: '#container',
        childList: true,
        attributes: true,
        characterData: false,
        subtree: true,
      };

      await inspector.observeDOMChanges(options);

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), options);
    });
  });

  // ─── stopObservingDOM ────────────────────────────────────────────
  describe('stopObservingDOM', () => {
    it('stops observing DOM changes', async () => {
      page.evaluate.mockResolvedValue(undefined);

      await inspector.stopObservingDOM();

      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ─── findByText ──────────────────────────────────────────────────
  describe('findByText', () => {
    it('returns elements containing the text', async () => {
      page.evaluate.mockResolvedValue([
        {
          found: true,
          nodeName: 'BUTTON',
          textContent: 'Click me',
          selector: '#btn',
          visible: true,
          boundingBox: { x: 0, y: 0, width: 100, height: 50 },
        },
      ]);

      const result = await inspector.findByText('Click');

      expect(result).toHaveLength(1);
      expect(result[0]?.nodeName).toBe('BUTTON');
      expect(result[0]?.textContent).toBe('Click me');
    });

    it('returns elements filtered by tag name', async () => {
      page.evaluate.mockResolvedValue([
        {
          found: true,
          nodeName: 'A',
          textContent: 'Link text',
          selector: 'a.link',
          visible: true,
        },
      ]);

      const result = await inspector.findByText('Link', 'a');

      expect(result).toHaveLength(1);
      expect(result[0]?.nodeName).toBe('A');
      expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 'Link', 'a');
    });

    it('returns empty array on error', async () => {
      page.evaluate.mockRejectedValue(new Error('findByText error'));

      const result = await inspector.findByText('test');

      expect(result).toEqual([]);
    });
  });

  // ─── getXPath ────────────────────────────────────────────────────
  describe('getXPath', () => {
    it('returns XPath for element with id', async () => {
      page.evaluate.mockResolvedValue('//*[@id="main"]');

      const result = await inspector.getXPath('#main');

      expect(result).toBe('//*[@id="main"]');
    });

    it('returns XPath for nested element', async () => {
      page.evaluate.mockResolvedValue('/html/body/div[1]/span[2]');

      const result = await inspector.getXPath('.nested');

      expect(result).toBe('/html/body/div[1]/span[2]');
    });

    it('returns null when element is not found', async () => {
      page.evaluate.mockResolvedValue(null);

      const result = await inspector.getXPath('.nonexistent');

      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      page.evaluate.mockRejectedValue(new Error('xpath error'));

      const result = await inspector.getXPath('.error');

      expect(result).toBeNull();
    });
  });

  // ─── isInViewport ────────────────────────────────────────────────
  describe('isInViewport', () => {
    it('returns true when element is fully in viewport', async () => {
      page.evaluate.mockResolvedValue(true);

      const result = await inspector.isInViewport('#visible');

      expect(result).toBe(true);
    });

    it('returns false when element is outside viewport', async () => {
      page.evaluate.mockResolvedValue(false);

      const result = await inspector.isInViewport('#hidden');

      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      page.evaluate.mockRejectedValue(new Error('viewport error'));

      const result = await inspector.isInViewport('.error');

      expect(result).toBe(false);
    });
  });

  // ─── close ───────────────────────────────────────────────────────
  describe('close', () => {
    it('does nothing when no CDP session exists', async () => {
      // No session set, should not throw
      await expect(inspector.close()).resolves.toBeUndefined();
      expect(inspector.getCDPSession()).toBeNull();
    });

    it('detaches and clears CDP session when present', async () => {
      const detach = vi.fn().mockResolvedValue(undefined);
      inspector.setCDPSession({ detach } as unknown as CDPSession);

      await inspector.close();

      expect(detach).toHaveBeenCalledTimes(1);
      expect(inspector.getCDPSession()).toBeNull();
    });
  });

  // ─── querySelectorAll error handling ─────────────────────────────
  describe('querySelectorAll error handling', () => {
    it('returns error diagnostics when evaluation fails', async () => {
      page.evaluate.mockRejectedValue(new Error('evaluation failed'));

      const result = await inspector.querySelectorAll('.test');

      expect(result.elements).toEqual([]);
      expect(result.diagnostics.readyState).toBe('error');
      expect(result.diagnostics.frameCount).toBe(0);
    });
  });

  // ─── waitForReadyState timeout behavior ──────────────────────────
  describe('waitForReadyState timeout', () => {
    it('times out and continues with last readyState', async () => {
      vi.useFakeTimers();

      // Mock readyState that never reaches 'complete'
      page.evaluate
        .mockResolvedValueOnce('loading')
        .mockResolvedValueOnce('loading')
        .mockResolvedValueOnce('loading')
        .mockResolvedValueOnce('loading')
        .mockResolvedValue({
          elements: [],
          diagnostics: { readyState: 'loading', shadowRootCount: 0 },
        });

      const resultPromise = inspector.querySelectorAll('input');
      // Advance past the timeout (3000ms)
      await vi.advanceTimersByTimeAsync(4000);
      const result = await resultPromise;

      expect(result.diagnostics.waitedForReadyState).toBe(true);
    });
  });

  // ─── page.frames handling ────────────────────────────────────────
  describe('page.frames handling', () => {
    it('handles pages without frames method', async () => {
      const pageWithoutFrames = {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce('complete')
          .mockResolvedValueOnce({
            elements: [{ found: true }],
            diagnostics: { readyState: 'complete', shadowRootCount: 0 },
          }),
      };
      collector.getActivePage.mockResolvedValue(pageWithoutFrames);

      const result = await inspector.querySelectorAll('div');

      expect(result.diagnostics.frameCount).toBe(1);
    });

    it('counts multiple frames correctly', async () => {
      const pageWithFrames = {
        evaluate: vi
          .fn()
          .mockResolvedValueOnce('complete')
          .mockResolvedValueOnce({
            elements: [{ found: true }],
            diagnostics: { readyState: 'complete', shadowRootCount: 0 },
          }),
        frames: vi.fn(() => [{}, {}, {}]),
      };
      collector.getActivePage.mockResolvedValue(pageWithFrames);

      const result = await inspector.querySelectorAll('div');

      expect(result.diagnostics.frameCount).toBe(3);
    });
  });
});
