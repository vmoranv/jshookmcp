import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findByTextEvaluation,
  getComputedStyleEvaluation,
  getStructureEvaluation,
  getXPathEvaluation,
} from '@modules/collector/DOMInspector.evaluations';

describe('DOMInspector.evaluations bug fixes', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><button>Click me</button></body></html>', {
      url: 'https://example.com/',
    });
    (globalThis as Record<string, unknown>).document = dom.window.document;
    (globalThis as Record<string, unknown>).window = dom.window;
    (globalThis as Record<string, unknown>).XPathResult = dom.window.XPathResult;
  });

  it('escapes quotes in searchText so XPath stays well-formed', () => {
    // Unescaped, the embedded double quotes would break the XPath literal and
    // document.evaluate would throw a syntax error.
    const elements = findByTextEvaluation('Say "hi" to Bob');
    expect(Array.isArray(elements)).toBe(true);
  });

  it('treats injection-style searchText as a literal instead of executing it', () => {
    const elements = findByTextEvaluation(`x") or 1=1 or ("x`, 'button');
    // With a single button whose text does not match, the injected predicate
    // must NOT broaden the query.
    expect(elements).toHaveLength(0);
  });

  it('keeps matching behavior for plain text', () => {
    const elements = findByTextEvaluation('Click me', 'button');
    expect(elements).toHaveLength(1);
    expect(elements[0]?.textContent).toBe('Click me');
  });

  it('returns null when document.body is missing', () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body><p>x</p></body></html>');
    (globalThis as Record<string, unknown>).document = dom.window.document;
    (globalThis as Record<string, unknown>).window = dom.window;

    dom.window.document.body?.remove();
    expect(getStructureEvaluation(3, true)).toBeNull();
  });
});

describe('DOMInspector.evaluations CSS/DOM hardening', () => {
  function installDom(html: string) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`, {
      url: 'https://example.com/',
    });
    (globalThis as Record<string, unknown>).document = dom.window.document;
    (globalThis as Record<string, unknown>).window = dom.window;
    (globalThis as Record<string, unknown>).XPathResult = dom.window.XPathResult;
    return dom;
  }

  it('reads hyphenated computed-style properties instead of returning empty strings', () => {
    installDom('<div id="styled" style="background-color: rgb(1, 2, 3); font-size: 20px"></div>');

    const styles = getComputedStyleEvaluation('#styled');

    expect(styles?.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(styles?.fontSize).toBe('20px');
    expect(styles?.display).toBe('block');
  });

  it('handles SVG className objects without throwing', () => {
    installDom('<svg><a href="#" class="svg-link">Link text</a></svg>');

    const matches = findByTextEvaluation('Link text');

    expect(matches).toHaveLength(1);
    // `a.className` is an SVGAnimatedString on SVG nodes; the selector must be
    // built from the class attribute instead.
    expect(matches[0]?.selector).toBe('a.svg-link');
  });

  it('builds a quote-safe XPath literal for ids containing a double quote', () => {
    installDom("<div id='a\"b'>target</div>");

    const xpath = getXPathEvaluation(`[id='a"b']`);

    expect(xpath).toBe(`//*[@id='a"b']`);
    expect(() =>
      document.evaluate(xpath!, document, null, XPathResult.ANY_TYPE, null),
    ).not.toThrow();
  });

  it('reports the class attribute of SVG nodes in the structure tree', () => {
    installDom('<svg class="root-svg"><circle class="dot"></circle></svg>');

    const structure = getStructureEvaluation(2, false);

    const serialized = JSON.stringify(structure);
    expect(serialized).toContain('"class":"root-svg"');
    expect(serialized).not.toContain('[object SVGAnimatedString]');
  });
});
