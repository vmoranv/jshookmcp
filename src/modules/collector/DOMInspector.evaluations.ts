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

/** In-page visibility check (display/visibility/opacity). */
function isVisibleInPage(element: Element): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/** In-page shadow-DOM walk shared by the query-all / find-clickable scans. */
function walkShadowRootsInPage(): { roots: Array<Document | ShadowRoot>; shadowRootCount: number } {
  const roots: Array<Document | ShadowRoot> = [document];
  const queue: Array<Document | ShadowRoot> = [document];
  let shadowRootCount = 0;
  while (queue.length > 0) {
    const root = queue.shift();
    if (!root) continue;
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const shadowRoot = element.shadowRoot;
      if (shadowRoot) {
        roots.push(shadowRoot);
        queue.push(shadowRoot);
        shadowRootCount += 1;
      }
    }
  }
  return { roots, shadowRootCount };
}

/** In-page querySelector: element info for the arg-passed selector. */
export function querySelectorInPage(selector: string): DOMInspectorElementInfo {
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
    visible: isVisibleInPage(element),
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
  const seen = new Set<Element>();
  const results: DOMInspectorElementInfo[] = [];
  let totalMatches = 0;
  const { roots, shadowRootCount } = walkShadowRootsInPage();
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
        visible: isVisibleInPage(element),
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
  const { roots, shadowRootCount } = walkShadowRootsInPage();
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
    if (element.id) selector = '#' + element.id;
    else if (element.className) selector = fallbackSelector + '.' + element.className.split(' ')[0];
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

/** In-page XPath string literal builder (quote-safe embedding of user text). */
function xpathStringLiteralInPage(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replace(/'/g, `', "'", '`)}')`;
}

/** In-page findByText: XPath text search (XPath 1.0 result cap 100). */
export function findByTextInPage(
  searchText: string,
  tagName?: string,
): Array<DOMInspectorElementInfo & { selector: string }> {
  // tagName flows into the XPath expression: restrict it to a valid HTML tag
  // name so it cannot inject predicates.
  const safeTag = tagName && /^[a-zA-Z][a-zA-Z0-9-]*$/.test(tagName) ? tagName : '*';
  const xpath = `//${safeTag}[contains(text(), ${xpathStringLiteralInPage(searchText)})]`;
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
    if (element.id) selector = `#${element.id}`;
    else if (element.className) {
      const classes = element.className.split(' ').filter(Boolean);
      if (classes.length > 0) selector = `${element.tagName.toLowerCase()}.${classes[0]}`;
    }
    matchedElements.push({
      found: true,
      nodeName: element.tagName,
      textContent: element.textContent?.trim(),
      selector,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: isVisibleInPage(element),
    });
  }
  return matchedElements;
}

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
    const result: DOMInspectorStructureNode = {
      tag: node.tagName,
      id: node.id || undefined,
      class: node.className || undefined,
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
  for (const prop of [
    'display',
    'visibility',
    'opacity',
    'position',
    'zIndex',
    'width',
    'height',
    'top',
    'left',
    'right',
    'bottom',
    'color',
    'backgroundColor',
    'fontSize',
    'fontFamily',
    'border',
    'padding',
    'margin',
    'overflow',
  ]) {
    result[prop] = computed.getPropertyValue(prop);
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
    if (element.id) selector = `#${element.id}`;
    else if (element.className) {
      const classes = element.className.split(' ').filter(Boolean);
      if (classes.length > 0) selector = `${element.tagName.toLowerCase()}.${classes[0]}`;
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
      parts.unshift(`//*[@id="${current.id}"]`);
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
