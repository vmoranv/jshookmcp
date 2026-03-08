import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { logger } from '@utils/logger';

export interface ElementInfo {
  found: boolean;
  nodeId?: number;
  nodeName?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visible?: boolean;
}

export interface ClickableElement {
  selector: string;
  text: string;
  type: 'button' | 'link' | 'input' | 'other';
  visible: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface DOMQueryDiagnostics {
  readyState: string;
  frameCount: number;
  shadowRootCount: number;
  retried: boolean;
  waitedForReadyState: boolean;
}

export interface DOMQueryAllResult {
  elements: ElementInfo[];
  diagnostics: DOMQueryDiagnostics;
}

export interface DOMFindClickableResult {
  elements: ClickableElement[];
  diagnostics: DOMQueryDiagnostics;
}

interface DOMStructureNode {
  tag: string;
  id?: string;
  class?: string;
  text?: string;
  children?: DOMStructureNode[];
}

interface WindowWithDomObserver extends Window {
  __domObserver?: MutationObserver;
}

export class DOMInspector {
  private cdpSession: CDPSession | null = null;

  constructor(private collector: CodeCollector) {}

  private async waitForReadyState(
    page: { evaluate: <T>(fn: () => T) => Promise<T>; frames?: () => unknown[] },
    timeoutMs = 3000,
  ): Promise<{ readyState: string; waitedForReadyState: boolean; frameCount: number }> {
    const deadline = Date.now() + timeoutMs;
    let waitedForReadyState = false;
    let readyState = 'unknown';

    while (Date.now() <= deadline) {
      readyState = await page.evaluate(() => document.readyState).catch(() => 'unknown');
      if (readyState === 'complete') {
        break;
      }
      waitedForReadyState = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const frameCount = typeof page.frames === 'function' ? page.frames().length : 1;
    return { readyState, waitedForReadyState, frameCount };
  }

  async querySelector(selector: string, _getAttributes = true): Promise<ElementInfo> {
    try {
      const page = await this.collector.getActivePage();

      const elementInfo = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return { found: false };
        }

        const attributes: Record<string, string> = {};
        const attrs = element.attributes;
        for (let i = 0; i < attrs.length; i++) {
          const attr = attrs[i];
          if (attr) {
            attributes[attr.name] = attr.value;
          }
        }

        const rect = element.getBoundingClientRect();
        const boundingBox = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };

        const style = window.getComputedStyle(element);
        const visible =
          style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

        return {
          found: true,
          nodeName: element.nodeName,
          attributes,
          textContent: element.textContent?.trim() || '',
          boundingBox,
          visible,
        };
      }, selector);

      logger.info(`querySelector: ${selector} - ${elementInfo.found ? 'found' : 'not found'}`);
      return elementInfo;
    } catch (error) {
      logger.error(`querySelector failed for ${selector}:`, error);
      return { found: false };
    }
  }

  async querySelectorAll(selector: string, limit = 50): Promise<DOMQueryAllResult> {
    try {
      const page = await this.collector.getActivePage();
      const readyStateStatus = await this.waitForReadyState(page);

      const runQuery = async () =>
        page.evaluate(
          (sel, maxLimit) => {
            const collectRoots = () => {
              const roots: Array<Document | ShadowRoot> = [document];
              const queue: Array<Document | ShadowRoot> = [document];
              let shadowRootCount = 0;

              while (queue.length > 0) {
                const root = queue.shift();
                if (!root) continue;
                const elements = Array.from(root.querySelectorAll('*'));
                for (const element of elements) {
                  const shadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null })
                    .shadowRoot;
                  if (shadowRoot) {
                    roots.push(shadowRoot);
                    queue.push(shadowRoot);
                    shadowRootCount += 1;
                  }
                }
              }

              return { roots, shadowRootCount };
            };

            const { roots, shadowRootCount } = collectRoots();
            const seen = new Set<Element>();
            const results: ElementInfo[] = [];
            let totalMatches = 0;

            for (const root of roots) {
              const nodeList = Array.from(root.querySelectorAll(sel));
              totalMatches += nodeList.length;
              for (const element of nodeList) {
                if (seen.has(element)) {
                  continue;
                }
                seen.add(element);

                const attributes: Record<string, string> = {};
                const attrs = element.attributes;
                for (let j = 0; j < attrs.length; j++) {
                  const attr = attrs[j];
                  if (attr) {
                    attributes[attr.name] = attr.value;
                  }
                }

                const rect = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                const textContent = element.textContent?.trim() || '';
                const truncatedText =
                  textContent.length > 500
                    ? textContent.substring(0, 500) + '...[truncated]'
                    : textContent;

                results.push({
                  found: true,
                  nodeName: element.nodeName,
                  attributes,
                  textContent: truncatedText,
                  boundingBox: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                  },
                  visible:
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0',
                });

                if (results.length >= maxLimit) {
                  break;
                }
              }

              if (results.length >= maxLimit) {
                break;
              }
            }

            if (totalMatches > maxLimit) {
              console.warn(
                `[DOMInspector] Found ${totalMatches} elements for "${sel}", limiting to ${maxLimit}`,
              );
            }

            return {
              elements: results,
              diagnostics: {
                readyState: document.readyState,
                shadowRootCount,
              },
            };
          },
          selector,
          limit,
        );

      let result = await runQuery();
      let retried = false;

      if (result.elements.length === 0 && result.diagnostics.readyState === 'complete') {
        retried = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = await runQuery();
      }

      const diagnostics: DOMQueryDiagnostics = {
        readyState: result.diagnostics.readyState ?? readyStateStatus.readyState,
        frameCount: readyStateStatus.frameCount,
        shadowRootCount: result.diagnostics.shadowRootCount ?? 0,
        retried,
        waitedForReadyState: readyStateStatus.waitedForReadyState,
      };

      logger.info(
        `querySelectorAll: ${selector} - found ${result.elements.length} elements (limit: ${limit}, readyState: ${diagnostics.readyState}, shadowRoots: ${diagnostics.shadowRootCount}, retried: ${retried})`
      );
      return {
        elements: result.elements,
        diagnostics,
      };
    } catch (error) {
      logger.error(`querySelectorAll failed for ${selector}:`, error);
      return {
        elements: [],
        diagnostics: {
          readyState: 'error',
          frameCount: 0,
          shadowRootCount: 0,
          retried: false,
          waitedForReadyState: false,
        },
      };
    }
  }

  async getStructure(maxDepth = 3, includeText = true): Promise<DOMStructureNode | null> {
    try {
      const page = await this.collector.getActivePage();

      const structure = await page.evaluate(
        (depth, withText) => {
          function buildTree(node: Element, currentDepth: number): DOMStructureNode | null {
            if (currentDepth > depth) {
              return null;
            }

            const result: DOMStructureNode = {
              tag: node.tagName,
              id: node.id || undefined,
              class: node.className || undefined,
            };

            if (withText && node.childNodes.length === 1) {
              const firstChild = node.childNodes[0];
              if (firstChild && firstChild.nodeType === 3) {
                result.text = node.textContent?.trim();
              }
            }

            const children: DOMStructureNode[] = [];
            const childElements = node.children;
            for (let i = 0; i < childElements.length; i++) {
              const child = childElements[i];
              if (child) {
                const childTree = buildTree(child, currentDepth + 1);
                if (childTree) {
                  children.push(childTree);
                }
              }
            }

            if (children.length > 0) {
              result.children = children;
            }

            return result;
          }

          return buildTree(document.body, 0);
        },
        maxDepth,
        includeText
      );

      logger.info('DOM structure retrieved');
      return structure;
    } catch (error) {
      logger.error('getStructure failed:', error);
      return null;
    }
  }

  async findClickable(filterText?: string): Promise<DOMFindClickableResult> {
    try {
      const page = await this.collector.getActivePage();
      const readyStateStatus = await this.waitForReadyState(page);

      const runQuery = async () =>
        page.evaluate((filter) => {
          const collectRoots = () => {
            const roots: Array<Document | ShadowRoot> = [document];
            const queue: Array<Document | ShadowRoot> = [document];
            let shadowRootCount = 0;

            while (queue.length > 0) {
              const root = queue.shift();
              if (!root) continue;
              const elements = Array.from(root.querySelectorAll('*'));
              for (const element of elements) {
                const shadowRoot = (element as Element & { shadowRoot?: ShadowRoot | null })
                  .shadowRoot;
                if (shadowRoot) {
                  roots.push(shadowRoot);
                  queue.push(shadowRoot);
                  shadowRootCount += 1;
                }
              }
            }

            return { roots, shadowRootCount };
          };

          const { roots, shadowRootCount } = collectRoots();
          const results: ClickableElement[] = [];
          const seen = new Set<Element>();
          const normalizedFilter = filter?.toLowerCase();

          const appendClickable = (
            element: Element,
            type: ClickableElement['type'],
            fallbackSelector: string,
          ) => {
            if (seen.has(element)) {
              return;
            }
            seen.add(element);

            const text =
              element.textContent?.trim() ||
              ((element as HTMLInputElement).value ?? '').trim() ||
              '';
            if (normalizedFilter && !text.toLowerCase().includes(normalizedFilter)) {
              return;
            }

            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const visible =
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0' &&
              rect.width > 0 &&
              rect.height > 0;

            let selector = fallbackSelector;
            if (element.id) {
              selector = `#${element.id}`;
            } else if (element.className) {
              selector = `${fallbackSelector}.${element.className.split(' ')[0]}`;
            }

            results.push({
              selector,
              text,
              type,
              visible,
              boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
            });
          };

          for (const root of roots) {
            const buttons = root.querySelectorAll(
              'button, input[type="button"], input[type="submit"], input[type="reset"]',
            );
            buttons.forEach((btn) => appendClickable(btn, 'button', btn.tagName.toLowerCase()));

            const links = root.querySelectorAll('a[href]');
            links.forEach((link) => appendClickable(link, 'link', 'a'));
          }

          return {
            elements: results,
            diagnostics: {
              readyState: document.readyState,
              shadowRootCount,
            },
          };
        }, filterText);

      let result = await runQuery();
      let retried = false;

      if (result.elements.length === 0 && result.diagnostics.readyState === 'complete') {
        retried = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = await runQuery();
      }

      const diagnostics: DOMQueryDiagnostics = {
        readyState: result.diagnostics.readyState ?? readyStateStatus.readyState,
        frameCount: readyStateStatus.frameCount,
        shadowRootCount: result.diagnostics.shadowRootCount ?? 0,
        retried,
        waitedForReadyState: readyStateStatus.waitedForReadyState,
      };

      logger.info(
        `findClickable: found ${result.elements.length} elements${filterText ? ` (filtered by: ${filterText})` : ''} (readyState: ${diagnostics.readyState}, shadowRoots: ${diagnostics.shadowRootCount}, retried: ${retried})`
      );
      return {
        elements: result.elements,
        diagnostics,
      };
    } catch (error) {
      logger.error('findClickable failed:', error);
      return {
        elements: [],
        diagnostics: {
          readyState: 'error',
          frameCount: 0,
          shadowRootCount: 0,
          retried: false,
          waitedForReadyState: false,
        },
      };
    }
  }

  async getComputedStyle(selector: string): Promise<Record<string, string> | null> {
    try {
      const page = await this.collector.getActivePage();

      const styles = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return null;
        }

        const computed = window.getComputedStyle(element);
        const result: Record<string, string> = {};

        const importantProps = [
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
        ];

        for (const prop of importantProps) {
          result[prop] = computed.getPropertyValue(prop);
        }

        return result;
      }, selector);

      logger.info(`getComputedStyle: ${selector} - ${styles ? 'found' : 'not found'}`);
      return styles;
    } catch (error) {
      logger.error(`getComputedStyle failed for ${selector}:`, error);
      return null;
    }
  }

  async waitForElement(selector: string, timeout = 30000): Promise<ElementInfo | null> {
    try {
      const page = await this.collector.getActivePage();

      await page.waitForSelector(selector, { timeout });

      return await this.querySelector(selector);
    } catch (error) {
      logger.error(`waitForElement timeout for ${selector}:`, error);
      return null;
    }
  }

  async observeDOMChanges(
    options: {
      selector?: string;
      childList?: boolean;
      attributes?: boolean;
      characterData?: boolean;
      subtree?: boolean;
    } = {}
  ): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate((opts) => {
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

      const typedWindow = window as WindowWithDomObserver;
      typedWindow.__domObserver = observer;
    }, options);

    logger.info('DOM change observer started');
  }

  async stopObservingDOM(): Promise<void> {
    const page = await this.collector.getActivePage();

    await page.evaluate(() => {
      const typedWindow = window as WindowWithDomObserver;
      const observer = typedWindow.__domObserver;
      if (observer) {
        observer.disconnect();
        delete typedWindow.__domObserver;
      }
    });

    logger.info('DOM change observer stopped');
  }

  async findByText(text: string, tag?: string): Promise<ElementInfo[]> {
    try {
      const page = await this.collector.getActivePage();

      const elements = await page.evaluate(
        (searchText, tagName) => {
          const xpath = tagName
            ? `//${tagName}[contains(text(), "${searchText}")]`
            : `//*[contains(text(), "${searchText}")]`;

          const result = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null
          );

          const elements: Array<ElementInfo & { selector: string }> = [];
          for (let i = 0; i < Math.min(result.snapshotLength, 100); i++) {
            const element = result.snapshotItem(i) as Element;
            if (!element) continue;

            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            let selector = element.tagName.toLowerCase();
            if (element.id) {
              selector = `#${element.id}`;
            } else if (element.className) {
              const classes = element.className.split(' ').filter((c) => c);
              if (classes.length > 0) {
                selector = `${element.tagName.toLowerCase()}.${classes[0]}`;
              }
            }

            elements.push({
              found: true,
              nodeName: element.tagName,
              textContent: element.textContent?.trim(),
              selector,
              boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              visible:
                style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
            });
          }

          return elements;
        },
        text,
        tag
      );

      logger.info(`findByText: "${text}" - found ${elements.length} elements`);
      return elements;
    } catch (error) {
      logger.error(`findByText failed for "${text}":`, error);
      return [];
    }
  }

  async getXPath(selector: string): Promise<string | null> {
    try {
      const page = await this.collector.getActivePage();

      const xpath = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return null;
        }

        function getElementXPath(el: Element): string {
          if (el.id) {
            return `//*[@id="${el.id}"]`;
          }

          if (el === document.body) {
            return '/html/body';
          }

          let ix = 0;
          const siblings = el.parentNode?.children;
          if (siblings) {
            for (let i = 0; i < siblings.length; i++) {
              const sibling = siblings[i];
              if (!sibling) continue;

              if (sibling === el) {
                const parentPath = el.parentElement ? getElementXPath(el.parentElement) : '';
                return `${parentPath}/${el.tagName.toLowerCase()}[${ix + 1}]`;
              }
              if (sibling.tagName === el.tagName) {
                ix++;
              }
            }
          }

          return '';
        }

        return getElementXPath(element);
      }, selector);

      logger.info(`getXPath: ${selector} -> ${xpath}`);
      return xpath;
    } catch (error) {
      logger.error(`getXPath failed for ${selector}:`, error);
      return null;
    }
  }

  async isInViewport(selector: string): Promise<boolean> {
    try {
      const page = await this.collector.getActivePage();

      const inViewport = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return (
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
          rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
      }, selector);

      logger.info(`isInViewport: ${selector} - ${inViewport}`);
      return inViewport;
    } catch (error) {
      logger.error(`isInViewport failed for ${selector}:`, error);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.cdpSession) {
      await this.cdpSession.detach();
      this.cdpSession = null;
      logger.info('DOM Inspector CDP session closed');
    }
  }
}
