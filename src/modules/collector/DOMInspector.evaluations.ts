export interface DOMInspectorElementInfo {
  found: boolean;
  nodeId?: number;
  nodeName?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  visible?: boolean;
}

export interface DOMInspectorClickableElement {
  selector: string;
  text: string;
  type: 'button' | 'link' | 'input' | 'other';
  visible: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ShadowDomWalkResult {
  roots: Array<Document | ShadowRoot>;
  shadowRootCount: number;
}

export interface DOMInspectorStructureNode {
  tag: string;
  id?: string;
  class?: string;
  text?: string;
  children?: DOMInspectorStructureNode[];
}

export interface DOMObserverOptions {
  selector?: string;
  childList?: boolean;
  attributes?: boolean;
  characterData?: boolean;
  subtree?: boolean;
}

interface WindowWithDomObserver extends Window {
  __domObserver?: MutationObserver;
}

/** Cap on findByTextEvaluation XPath snapshot results. */
const XPATH_RESULT_LIMIT = 100;

/**
 * Page-side evaluations: self-contained functions serialized by
 * `page.evaluate(fn, ...args)`. Module scope is unreachable inside the page,
 * so every helper is inlined and all user data enters via evaluate arguments —
 * never interpolated into code strings.
 */

/** In-page querySelector: element info for the arg-passed selector. */
export function querySelectorInPage(selector: string): DOMInspectorElementInfo {
  // eslint-disable-next-line no-shadow, unicorn/consistent-function-scoping
  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const element = document.querySelector(selector);
  if (!element) return { found: false };
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) attributes[attr.name] = attr.value;
  const rect = element.getBoundingClientRect();
  return {
    found: true,
    nodeName: element.nodeName,
    attributes,
    textContent: element.textContent?.trim() || '',
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    visible: isVisible(element),
  };
}

/** In-page queryAll: shadow-DOM-aware element listing capped at `limit`. */
export function querySelectorAllInPage(
  selector: string,
  limit: number,
): {
  elements: DOMInspectorElementInfo[];
  diagnostics: { readyState: string; shadowRootCount: number };
} {
  // Cap on reported textContent (chars) — inlined because module constants do
  // not survive evaluate serialization.
  const TEXT_CONTENT_MAX_CHARS = 500;
  // eslint-disable-next-line no-shadow, unicorn/consistent-function-scoping
  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const roots: Array<Document | ShadowRoot> = [document];
  const queue: Array<Document | ShadowRoot> = [document];
  let shadowRootCount = 0;
  while (queue.length > 0) {
    const root = queue.shift();
    if (!root) continue;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const shadowRoot = el.shadowRoot;
      if (shadowRoot) {
        roots.push(shadowRoot);
        queue.push(shadowRoot);
        shadowRootCount += 1;
      }
    }
  }
  const seen = new Set<Element>();
  const results: DOMInspectorElementInfo[] = [];
  let totalMatches = 0;
  for (const root of roots) {
    const nodeList = Array.from(root.querySelectorAll(selector));
    totalMatches += nodeList.length;
    for (const element of nodeList) {
      if (seen.has(element)) continue;
      seen.add(element);
      const attributes: Record<string, string> = {};
      for (const attr of Array.from(element.attributes)) attributes[attr.name] = attr.value;
      const rect = element.getBoundingClientRect();
      const textContent = element.textContent?.trim() || '';
      results.push({
        found: true,
        nodeName: element.nodeName,
        attributes,
        textContent:
          textContent.length > TEXT_CONTENT_MAX_CHARS
            ? textContent.substring(0, TEXT_CONTENT_MAX_CHARS) + '...[truncated]'
            : textContent,
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: isVisible(element),
      });
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }
  if (totalMatches > limit) {
    console.warn(
      '[DOMInspector] Found ' +
        totalMatches +
        ' elements for "' +
        selector +
        '", limiting to ' +
        limit,
    );
  }
  return { elements: results, diagnostics: { readyState: document.readyState, shadowRootCount } };
}

/** In-page findClickable: shadow-DOM-aware clickable element discovery. */
export function findClickableInPage(filterText: string | undefined): {
  elements: DOMInspectorClickableElement[];
  diagnostics: { readyState: string; shadowRootCount: number };
} {
  const normalizedFilter = filterText?.toLowerCase();
  const results: DOMInspectorClickableElement[] = [];
  const seen = new Set<Element>();
  const isVisibleInPage = (el: Element): boolean => {
    void normalizedFilter;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  // `element.className` is an SVGAnimatedString on SVG nodes and ids/classes are
  // not necessarily valid CSS identifiers without escaping.
  const escapeIdentInPage = (value: string): string => {
    void normalizedFilter;
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
  };
  const firstClassOfInPage = (el: Element): string => {
    void normalizedFilter;
    const classAttr = (el.getAttribute('class') || '').trim();
    return classAttr.split(/\s+/).filter(Boolean)[0] || '';
  };
  const roots: Array<Document | ShadowRoot> = [document];
  const queue: Array<Document | ShadowRoot> = [document];
  let shadowRootCount = 0;
  while (queue.length > 0) {
    const root = queue.shift();
    if (!root) continue;
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const shadowRoot = el.shadowRoot;
      if (shadowRoot) {
        roots.push(shadowRoot);
        queue.push(shadowRoot);
        shadowRootCount += 1;
      }
    }
  }
  const appendClickable = (
    element: Element,
    type: 'button' | 'link',
    fallbackSelector: string,
  ): void => {
    if (seen.has(element)) return;
    seen.add(element);
    const text =
      element.textContent?.trim() || ((element as HTMLInputElement).value ?? '').trim() || '';
    if (normalizedFilter && !text.toLowerCase().includes(normalizedFilter)) return;
    const rect = element.getBoundingClientRect();
    let selector = fallbackSelector;
    if (element.id) selector = '#' + escapeIdentInPage(element.id);
    else {
      const firstClass = firstClassOfInPage(element);
      if (firstClass) selector = fallbackSelector + '.' + escapeIdentInPage(firstClass);
    }
    results.push({
      selector,
      text,
      type,
      visible: isVisibleInPage(element) && rect.width > 0 && rect.height > 0,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  };
  for (const root of roots) {
    root
      .querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]')
      .forEach((button) => appendClickable(button, 'button', button.tagName.toLowerCase()));
    root.querySelectorAll('a[href]').forEach((link) => appendClickable(link, 'link', 'a'));
  }
  return { elements: results, diagnostics: { readyState: document.readyState, shadowRootCount } };
}

/** In-page findByText: XPath text search (XPath 1.0 result cap 100). */
export function findByTextInPage(
  searchText: string,
  tagName?: string,
): Array<DOMInspectorElementInfo & { selector: string }> {
  // Everything below must stay self-contained: this function is serialized by
  // page.evaluate, where module-scope helpers are not defined.
  // eslint-disable-next-line no-shadow, unicorn/consistent-function-scoping
  const xpathStringLiteral = (value: string): string => {
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('"')) return `"${value}"`;
    return `concat('${value.replace(/'/g, `', "'", '`)}')`;
  };
  // eslint-disable-next-line no-shadow, unicorn/consistent-function-scoping
  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };
  const escapeIdentInPage = (value: string): string => {
    void searchText;
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : value.replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
  };
  const firstClassOfInPage = (el: Element): string => {
    void searchText;
    const classAttr = (el.getAttribute('class') || '').trim();
    return classAttr.split(/\s+/).filter(Boolean)[0] || '';
  };
  // tagName flows into the XPath expression: restrict it to a valid HTML tag
  // name so it cannot inject predicates.
  const safeTag = tagName && /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tagName) ? tagName : '*';
  const xpath = `//${safeTag}[contains(text(), ${xpathStringLiteral(searchText)})]`;
  const result = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );
  const matchedElements: Array<DOMInspectorElementInfo & { selector: string }> = [];
  for (let i = 0; i < Math.min(result.snapshotLength, 100); i++) {
    const element = result.snapshotItem(i) as Element | null;
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    let selector = element.tagName.toLowerCase();
    if (element.id) selector = `#${escapeIdentInPage(element.id)}`;
    else {
      const firstClass = firstClassOfInPage(element);
      if (firstClass)
        selector = `${element.tagName.toLowerCase()}.${escapeIdentInPage(firstClass)}`;
    }
    matchedElements.push({
      found: true,
      nodeName: element.tagName,
      textContent: element.textContent?.trim(),
      selector,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: isVisible(element),
    });
  }
  return matchedElements;
}

/** Node-side visibility check used by direct (non-injected) evaluation calls. */

/** Node-side visibility check used by direct (non-injected) evaluation calls. */
function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

export function getStructureEvaluation(
  depth: number,
  withText: boolean,
): DOMInspectorStructureNode | null {
  if (!document.body) {
    return null;
  }
  const buildTree = (node: Element, currentDepth: number): DOMInspectorStructureNode | null => {
    if (currentDepth > depth) return null;
    // `node.className` is an SVGAnimatedString for SVG elements, which would put
    // a non-string into the serialized result.
    const classAttr = (node.getAttribute('class') || '').trim();
    const result: DOMInspectorStructureNode = {
      tag: node.tagName,
      id: node.id || undefined,
      class: classAttr || undefined,
    };
    if (withText && node.childNodes.length === 1 && node.childNodes[0]?.nodeType === 3) {
      result.text = node.textContent?.trim();
    }
    const children = Array.from(node.children)
      .map((child) => buildTree(child, currentDepth + 1))
      .filter((child): child is DOMInspectorStructureNode => child !== null);
    if (children.length > 0) result.children = children;
    return result;
  };
  return buildTree(document.body, 0);
}

export function getComputedStyleEvaluation(selector: string): Record<string, string> | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const computed = window.getComputedStyle(element);
  const result: Record<string, string> = {};
  // getPropertyValue() only accepts hyphenated CSS property names — the
  // camelCase form silently returns ''. Keys stay camelCase for the tool API.
  const properties: ReadonlyArray<readonly [reportKey: string, cssName: string]> = [
    ['display', 'display'],
    ['visibility', 'visibility'],
    ['opacity', 'opacity'],
    ['position', 'position'],
    ['zIndex', 'z-index'],
    ['width', 'width'],
    ['height', 'height'],
    ['top', 'top'],
    ['left', 'left'],
    ['right', 'right'],
    ['bottom', 'bottom'],
    ['color', 'color'],
    ['backgroundColor', 'background-color'],
    ['fontSize', 'font-size'],
    ['fontFamily', 'font-family'],
    ['border', 'border'],
    ['padding', 'padding'],
    ['margin', 'margin'],
    ['overflow', 'overflow'],
  ];
  for (const [reportKey, cssName] of properties) {
    result[reportKey] = computed.getPropertyValue(cssName);
  }
  return result;
}

export function observeDOMChangesEvaluation(opts: DOMObserverOptions): void {
  const targetNode = opts.selector ? document.querySelector(opts.selector) : document.body;
  if (!targetNode) {
    console.error('Target node not found for MutationObserver');
    return;
  }
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      console.warn('[DOM Change]', {
        type: mutation.type,
        target: mutation.target,
        addedNodes: mutation.addedNodes.length,
        removedNodes: mutation.removedNodes.length,
        attributeName: mutation.attributeName,
      });
    });
  });
  observer.observe(targetNode, {
    childList: opts.childList !== false,
    attributes: opts.attributes !== false,
    characterData: opts.characterData !== false,
    subtree: opts.subtree !== false,
  });
  (window as WindowWithDomObserver).__domObserver = observer;
}

export function stopObservingDOMEvaluation(): void {
  const typedWindow = window as WindowWithDomObserver;
  if (typedWindow.__domObserver) {
    typedWindow.__domObserver.disconnect();
    delete typedWindow.__domObserver;
  }
}

/** Build an XPath 1.0 string literal that embeds `value` verbatim. */
function xpathStringLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes('"')) {
    return `"${value}"`;
  }
  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

/** Escape a CSS identifier/class for use in a selector (node-side helpers). */
function escapeCssIdentifier(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS;
  if (css && typeof css.escape === 'function') {
    return css.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/** Node-side findByText (jsdom/tests): shares the in-page XPath semantics. */
export function findByTextEvaluation(
  searchText: string,
  tagName?: string,
): Array<DOMInspectorElementInfo & { selector: string }> {
  // tagName flows into the XPath expression: restrict it to a valid HTML tag
  // name so it cannot inject predicates.
  const safeTag = tagName && /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tagName) ? tagName : '*';
  const xpath = `//${safeTag}[contains(text(), ${xpathStringLiteral(searchText)})]`;
  const result = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );
  const matchedElements: Array<DOMInspectorElementInfo & { selector: string }> = [];
  for (let i = 0; i < Math.min(result.snapshotLength, XPATH_RESULT_LIMIT); i++) {
    const element = result.snapshotItem(i) as Element | null;
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    let selector = element.tagName.toLowerCase();
    if (element.id) selector = `#${escapeCssIdentifier(element.id)}`;
    else {
      const classAttr = (element.getAttribute('class') || '').trim();
      const firstClass = classAttr.split(/\s+/).filter(Boolean)[0];
      if (firstClass)
        selector = `${element.tagName.toLowerCase()}.${escapeCssIdentifier(firstClass)}`;
    }
    matchedElements.push({
      found: true,
      nodeName: element.tagName,
      textContent: element.textContent?.trim(),
      selector,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: isVisible(element),
    });
  }
  return matchedElements;
}

export function getXPathEvaluation(selector: string): string | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    if (current.id) {
      // Build the literal quote-safely: an id containing `"` is legal HTML and
      // would otherwise produce a malformed XPath (or inject a predicate).
      let idLiteral: string;
      if (!current.id.includes('"')) {
        idLiteral = `"${current.id}"`;
      } else if (!current.id.includes("'")) {
        idLiteral = `'${current.id}'`;
      } else {
        idLiteral = `concat('${current.id.replace(/'/g, `', "'", '`)}')`;
      }
      parts.unshift(`//*[@id=${idLiteral}]`);
      return parts.join('');
    }
    let ix = 0;
    const siblings: HTMLCollection | undefined = current.parentElement?.children;
    if (siblings) {
      for (let i = 0; i < siblings.length; i++) {
        const sibling: Element | undefined = siblings[i];
        if (!sibling) continue;
        if (sibling === current) break;
        if (sibling.tagName === current.tagName) ix += 1;
      }
    }
    parts.unshift(`/${current.tagName.toLowerCase()}[${ix + 1}]`);
    current = current.parentElement;
  }
  return '/html/body' + parts.join('');
}

export function isInViewportEvaluation(selector: string): boolean {
  const element = document.querySelector(selector);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}
