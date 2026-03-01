import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeFile, DependencyGraph } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

interface WorkerTrackingWindow extends Window {
  __workerUrls?: string[];
  Worker: typeof Worker;
}

export async function collectInlineScripts(
  page: Page,
  maxSingleSize: number,
  maxFilesPerCollect: number
): Promise<CodeFile[]> {
  const scripts = await page.evaluate((maxSingleSize: number) => {
    const scriptElements = Array.from(document.querySelectorAll('script')) as HTMLScriptElement[];
    return scriptElements
      .filter((script) => !script.src && script.textContent)
      .map((script, index) => {
        let content = script.textContent || '';
        const originalSize = content.length;
        let truncated = false;

        if (content.length > maxSingleSize) {
          content = content.substring(0, maxSingleSize);
          truncated = true;
        }

        return {
          url: `inline-script-${index}`,
          content,
          size: content.length,
          type: 'inline' as const,
          metadata: {
            scriptType: script.type || 'text/javascript',
            async: script.async,
            defer: script.defer,
            integrity: script.integrity || undefined,
            truncated,
            originalSize: truncated ? originalSize : undefined,
          },
        };
      });
  }, maxSingleSize);

  const limitedScripts = scripts.slice(0, maxFilesPerCollect);

  if (scripts.length > limitedScripts.length) {
    logger.warn(`Found ${scripts.length} inline scripts, limiting to ${maxFilesPerCollect}`);
  }

  const truncatedCount = limitedScripts.filter((s) => s.metadata?.truncated).length;
  if (truncatedCount > 0) {
    logger.warn(`${truncatedCount} inline scripts were truncated due to size limits`);
  }

  logger.debug(`Collected ${limitedScripts.length} inline scripts`);
  return limitedScripts;
}

export async function collectServiceWorkers(page: Page): Promise<CodeFile[]> {
  try {
    const serviceWorkers = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) {
        return [];
      }

      const registrations = await navigator.serviceWorker.getRegistrations();
      const workers: Array<{ url: string; scope: string; state: string }> = [];

      for (const registration of registrations) {
        const worker = registration.active || registration.installing || registration.waiting;
        if (worker && worker.scriptURL) {
          workers.push({
            url: worker.scriptURL,
            scope: registration.scope,
            state: worker.state,
          });
        }
      }

      return workers;
    });

    const files: CodeFile[] = [];

    for (const worker of serviceWorkers) {
      try {
        const content = await page.evaluate(async (url) => {
          const response = await fetch(url);
          return await response.text();
        }, worker.url);

        if (content) {
          files.push({
            url: worker.url,
            content,
            size: content.length,
            type: 'service-worker',
          });
          logger.debug(`Collected Service Worker: ${worker.url}`);
        }
      } catch (error) {
        logger.warn(`Failed to collect Service Worker: ${worker.url}`, error);
      }
    }

    return files;
  } catch (error) {
    logger.warn('Service Worker collection failed', error);
    return [];
  }
}

export async function collectWebWorkers(page: Page): Promise<CodeFile[]> {
  try {
    await page.evaluateOnNewDocument(() => {
      const workerWindow = window as WorkerTrackingWindow;
      const originalWorker = workerWindow.Worker;
      const workerUrls: string[] = [];

      const trackedWorker = function (scriptURL: string | URL, options?: WorkerOptions): Worker {
        const scriptUrlString = typeof scriptURL === 'string' ? scriptURL : scriptURL.toString();
        workerUrls.push(scriptUrlString);
        workerWindow.__workerUrls = workerUrls;
        return new originalWorker(scriptURL, options);
      } as unknown as typeof Worker;

      workerWindow.Worker = trackedWorker;
    });

    const workerUrls = await page.evaluate(() => {
      const workerWindow = window as WorkerTrackingWindow;
      return workerWindow.__workerUrls || [];
    });

    const files: CodeFile[] = [];

    for (const url of workerUrls) {
      try {
        const absoluteUrl = new URL(url, page.url()).href;

        const content = await page.evaluate(async (workerUrl) => {
          const response = await fetch(workerUrl);
          return await response.text();
        }, absoluteUrl);

        if (content) {
          files.push({
            url: absoluteUrl,
            content,
            size: content.length,
            type: 'web-worker',
          });
          logger.debug(`Collected Web Worker: ${absoluteUrl}`);
        }
      } catch (error) {
        logger.warn(`Failed to collect Web Worker: ${url}`, error);
      }
    }

    return files;
  } catch (error) {
    logger.warn('Web Worker collection failed', error);
    return [];
  }
}

export function analyzeDependencies(files: CodeFile[]): DependencyGraph {
  const nodes: DependencyGraph['nodes'] = [];
  const edges: DependencyGraph['edges'] = [];

  files.forEach((file) => {
    nodes.push({
      id: file.url,
      url: file.url,
      type: file.type,
    });
  });

  files.forEach((file) => {
    const dependencies = extractDependencies(file.content);

    dependencies.forEach((dep) => {
      const targetFile = files.find(
        (f) => f.url.includes(dep) || f.url.endsWith(dep) || f.url.endsWith(`${dep}.js`)
      );

      if (targetFile) {
        edges.push({
          from: file.url,
          to: targetFile.url,
          type: 'import',
        });
      }
    });
  });

  logger.debug(`Dependency graph: ${nodes.length} nodes, ${edges.length} edges`);
  return { nodes, edges };
}

export function extractDependencies(code: string): string[] {
  const dependencies: string[] = [];

  const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    if (match[1]) dependencies.push(match[1]);
  }

  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(code)) !== null) {
    if (match[1]) dependencies.push(match[1]);
  }

  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(code)) !== null) {
    if (match[1]) dependencies.push(match[1]);
  }

  return [...new Set(dependencies)];
}

export function calculatePriorityScore(file: CodeFile): number {
  let score = 0;

  if (file.type === 'inline') score += 10;
  else if (file.type === 'external') score += 5;

  if (file.size < 10 * 1024) score += 15;
  else if (file.size < 50 * 1024) score += 10;
  else if (file.size > 200 * 1024) score -= 10;

  const url = file.url.toLowerCase();
  if (url.includes('main') || url.includes('index') || url.includes('app')) score += 20;
  if (url.includes('crypto') || url.includes('encrypt') || url.includes('sign')) score += 30;
  if (url.includes('api') || url.includes('request') || url.includes('ajax')) score += 25;
  if (url.includes('core') || url.includes('common') || url.includes('util')) score += 15;

  if (
    url.includes('vendor') ||
    url.includes('lib') ||
    url.includes('jquery') ||
    url.includes('react')
  )
    score -= 20;
  if (url.includes('node_modules') || url.includes('bundle')) score -= 30;

  return score;
}
