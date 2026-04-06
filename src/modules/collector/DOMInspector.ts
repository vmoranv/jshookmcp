import type { CDPSession } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import {
  buildFindClickableEvaluation,
  buildQueryAllEvaluation,
  findByTextEvaluation,
  getComputedStyleEvaluation,
  getStructureEvaluation,
  getXPathEvaluation,
  isInViewportEvaluation,
  observeDOMChangesEvaluation,
  querySelectorEvaluation,
  stopObservingDOMEvaluation,
  type DOMInspectorClickableElement,
  type DOMInspectorElementInfo,
  type DOMInspectorStructureNode,
  type DOMObserverOptions,
} from '@modules/collector/DOMInspector.evaluations';
import { logger } from '@utils/logger';

export type {
  DOMInspectorClickableElement,
  DOMInspectorElementInfo,
  ShadowDomWalkResult,
} from '@modules/collector/DOMInspector.evaluations';

export type ElementInfo = DOMInspectorElementInfo;
export type ClickableElement = DOMInspectorClickableElement;

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

type DOMStructureNode = DOMInspectorStructureNode;
type DOMEvaluationDiagnostics = Pick<DOMQueryDiagnostics, 'readyState' | 'shadowRootCount'>;
type DOMQueryAllEvaluationResult = {
  elements: ElementInfo[];
  diagnostics: DOMEvaluationDiagnostics;
};
type DOMFindClickableEvaluationResult = {
  elements: ClickableElement[];
  diagnostics: DOMEvaluationDiagnostics;
};

export class DOMInspector {
  protected cdpSession: CDPSession | null = null;

  constructor(protected collector: CodeCollector) {}

  private async waitForReadyState(
    page: { evaluate: <T>(fn: () => T) => Promise<T>; frames?: () => unknown[] },
    timeoutMs = 3000,
  ): Promise<{ readyState: string; waitedForReadyState: boolean; frameCount: number }> {
    const deadline = Date.now() + timeoutMs;
    let waitedForReadyState = false;
    let readyState = 'unknown';

    while (Date.now() <= deadline) {
      readyState = await page.evaluate(() => document.readyState).catch(() => 'unknown');
      if (readyState === 'complete') break;
      waitedForReadyState = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      readyState,
      waitedForReadyState,
      frameCount: typeof page.frames === 'function' ? page.frames().length : 1,
    };
  }

  async querySelector(selector: string, _getAttributes = true): Promise<ElementInfo> {
    try {
      const page = await this.collector.getActivePage();
      const elementInfo = await page.evaluate(querySelectorEvaluation, selector);
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
          new Function(
            buildQueryAllEvaluation(selector, limit),
          ) as () => DOMQueryAllEvaluationResult,
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
        `querySelectorAll: ${selector} - found ${result.elements.length} elements (limit: ${limit}, readyState: ${diagnostics.readyState}, shadowRoots: ${diagnostics.shadowRootCount}, retried: ${retried})`,
      );
      return { elements: result.elements, diagnostics };
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
      const structure = await page.evaluate(getStructureEvaluation, maxDepth, includeText);
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
        page.evaluate(
          new Function(
            buildFindClickableEvaluation(filterText),
          ) as () => DOMFindClickableEvaluationResult,
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
        `findClickable: found ${result.elements.length} elements${filterText ? ` (filtered by: ${filterText})` : ''} (readyState: ${diagnostics.readyState}, shadowRoots: ${diagnostics.shadowRootCount}, retried: ${retried})`,
      );
      return { elements: result.elements, diagnostics };
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
      const styles = await page.evaluate(getComputedStyleEvaluation, selector);
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

  async observeDOMChanges(options: DOMObserverOptions = {}): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate(observeDOMChangesEvaluation, options);
    logger.info('DOM change observer started');
  }

  async stopObservingDOM(): Promise<void> {
    const page = await this.collector.getActivePage();
    await page.evaluate(stopObservingDOMEvaluation);
    logger.info('DOM change observer stopped');
  }

  async findByText(text: string, tag?: string): Promise<ElementInfo[]> {
    try {
      const page = await this.collector.getActivePage();
      const elements = await page.evaluate(findByTextEvaluation, text, tag);
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
      const xpath = await page.evaluate(getXPathEvaluation, selector);
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
      const inViewport = await page.evaluate(isInViewportEvaluation, selector);
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
