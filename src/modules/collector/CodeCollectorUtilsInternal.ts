import type { Page } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';

export function shouldCollectUrlImpl(url: string, filterRules?: string[]): boolean {
  if (!filterRules || filterRules.length === 0) {
    return true;
  }

  for (const rule of filterRules) {
    const regex = new RegExp(rule.replace(/\*/g, '.*'));
    if (regex.test(url)) {
      return true;
    }
  }

  return false;
}

export async function navigateWithRetryImpl(
  page: Page,
  url: string,
  options: Parameters<Page['goto']>[1],
  maxRetries = 3
): Promise<void> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await page.goto(url, options);
      return;
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Navigation attempt ${i + 1}/${maxRetries} failed: ${error}`);
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }

  throw lastError || new Error('Navigation failed after retries');
}

export async function getPerformanceMetricsImpl(page: Page): Promise<Record<string, number>> {
  try {
    const metrics = await page.evaluate(() => {
      const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: perf.domContentLoadedEventEnd - perf.domContentLoadedEventStart,
        loadComplete: perf.loadEventEnd - perf.loadEventStart,
        domInteractive: perf.domInteractive - perf.fetchStart,
        totalTime: perf.loadEventEnd - perf.fetchStart,
      };
    });
    return metrics;
  } catch (error) {
    logger.warn('Failed to get performance metrics', error);
    return {};
  }
}

export async function collectPageMetadataImpl(page: Page): Promise<Record<string, unknown>> {
  try {
    const metadata = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        userAgent: navigator.userAgent,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        cookies: document.cookie,
        localStorage: Object.keys(localStorage).length,
        sessionStorage: Object.keys(sessionStorage).length,
      };
    });
    return metadata;
  } catch (error) {
    logger.warn('Failed to collect page metadata', error);
    return {};
  }
}
