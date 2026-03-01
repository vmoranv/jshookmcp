import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from './CodeCollector.js';
import { logger } from '../../utils/logger.js';

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

  async querySelectorAll(selector: string, limit = 50): Promise<ElementInfo[]> {
    try {
      const page = await this.collector.getActivePage();

      const elements = await page.evaluate(
        (sel, maxLimit) => {
          const nodeList = document.querySelectorAll(sel);

          if (nodeList.length > maxLimit) {
            console.warn(
              `[DOMInspector] Found ${nodeList.length} elements for "${sel}", limiting to ${maxLimit}`
            );
          }

          const results: ElementInfo[] = [];

          for (let i = 0; i < Math.min(nodeList.length, maxLimit); i++) {
            const element = nodeList[i];
            if (!element) continue;

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
                style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
            });
          }

          return results;
        },
        selector,
        limit
      );

      logger.info(
        `querySelectorAll: ${selector} - found ${elements.length} elements (limit: ${limit})`
      );
      return elements;
    } catch (error) {
      logger.error(`querySelectorAll failed for ${selector}:`, error);
      return [];
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

  async findClickable(filterText?: string): Promise<ClickableElement[]> {
    try {
      const page = await this.collector.getActivePage();

      const clickableElements = await page.evaluate((filter) => {
        const results: ClickableElement[] = [];

        const buttons = document.querySelectorAll(
          'button, input[type="button"], input[type="submit"]'
        );
        buttons.forEach((btn) => {
          const text = btn.textContent?.trim() || (btn as HTMLInputElement).value || '';
          if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
            return;
          }

          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0;

          let selector = btn.tagName.toLowerCase();
          if (btn.id) {
            selector = `#${btn.id}`;
          } else if (btn.className) {
            selector = `${btn.tagName.toLowerCase()}.${btn.className.split(' ')[0]}`;
          }

          results.push({
            selector,
            text,
            type: 'button',
            visible,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          });
        });

        const links = document.querySelectorAll('a[href]');
        links.forEach((link) => {
          const text = link.textContent?.trim() || '';
          if (filter && !text.toLowerCase().includes(filter.toLowerCase())) {
            return;
          }

          const rect = link.getBoundingClientRect();
          const style = window.getComputedStyle(link);
          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0;

          let selector = 'a';
          if (link.id) {
            selector = `#${link.id}`;
          } else if (link.className) {
            selector = `a.${link.className.split(' ')[0]}`;
          }

          results.push({
            selector,
            text,
            type: 'link',
            visible,
            boundingBox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
          });
        });

        return results;
      }, filterText);

      logger.info(
        `findClickable: found ${clickableElements.length} elements${filterText ? ` (filtered by: ${filterText})` : ''}`
      );
      return clickableElements;
    } catch (error) {
      logger.error('findClickable failed:', error);
      return [];
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
