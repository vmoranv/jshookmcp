import type { Page } from 'rebrowser-puppeteer-core';
import { setTimeout as asyncSetTimeout } from 'node:timers/promises';

/**
 * Unified CDP timeout guard for PageController operations.
 * Wraps page.evaluate, page.evaluateOnNewDocument, and coverage operations
 * with pre-flight health checks and hard timeouts.
 */
export class PageCDPTimeoutGuard {
  private readonly defaultTimeoutMs = 30000;

  /**
   * Race `promise` against a timer, clearing the timer on every outcome so the
   * process is not kept alive (and the losing rejection stays handled).
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    void promise.catch(() => undefined);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
          timeoutId.unref?.();
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  /**
   * Pre-flight CDP health check: verify the page CDP target is responsive.
   * After debugger enable + pause/resume, the Playwright CDP session can enter
   * a zombie state where Runtime.evaluate hangs indefinitely without firing
   * 'disconnected'. Without this check, page.evaluate() blocks for the full 30 s
   * timeout — with this check we fail fast (~3 s) with a clear message.
   */
  async checkPageCDPHealth(page: Page, timeoutMs = 500): Promise<void> {
    return checkPageCDPHealth(page, timeoutMs);
  }

  /**
   * Wrap a page.evaluateOnNewDocument() call with:
   * 1. A CDP pre-flight health check
   * 2. A hard timeout (30 s) as a backstop
   */
  async evaluateOnNewDocumentWithTimeout<Args extends readonly unknown[], Result>(
    page: Page,
    pageFunction: string | ((...args: never[]) => Result),
    ...args: Args
  ): Promise<unknown> {
    const timeoutMs = this.defaultTimeoutMs;

    // Fail fast: detect zombie CDP sessions before they block evaluateOnNewDocument().
    await this.checkPageCDPHealth(page);

    return this.withTimeout(
      page.evaluateOnNewDocument(
        pageFunction as string | ((...args: never[]) => Result),
        ...([...args] as never[]),
      ),
      timeoutMs,
      'page.evaluateOnNewDocument',
    );
  }

  /**
   * Wrap page.coverage.startJSCoverage() with a timeout.
   */
  async coverageStartJSWithTimeout(
    page: CoveragePage,
    options?: { resetOnNavigation?: boolean; reportAnonymousScripts?: boolean },
  ): Promise<void> {
    return this.withTimeout(
      page.coverage.startJSCoverage(options),
      this.defaultTimeoutMs,
      'coverage.startJSCoverage',
    );
  }

  /**
   * Wrap page.coverage.startCSSCoverage() with a timeout.
   */
  async coverageStartCSSWithTimeout(
    page: CoveragePage,
    options?: { resetOnNavigation?: boolean },
  ): Promise<void> {
    return this.withTimeout(
      page.coverage.startCSSCoverage(options),
      this.defaultTimeoutMs,
      'coverage.startCSSCoverage',
    );
  }

  /**
   * Wrap page.coverage.stopJSCoverage() with a timeout.
   */
  async coverageStopJSWithTimeout(page: CoveragePage): Promise<unknown> {
    return this.withTimeout(
      page.coverage.stopJSCoverage(),
      this.defaultTimeoutMs,
      'coverage.stopJSCoverage',
    );
  }

  /**
   * Wrap page.coverage.stopCSSCoverage() with a timeout.
   */
  async coverageStopCSSWithTimeout(page: CoveragePage): Promise<unknown> {
    return this.withTimeout(
      page.coverage.stopCSSCoverage(),
      this.defaultTimeoutMs,
      'coverage.stopCSSCoverage',
    );
  }
}

/** Structural type for pages with coverage API (Puppeteer / rebrowser-puppeteer). */
interface CoveragePage {
  coverage: {
    startJSCoverage(options?: {
      resetOnNavigation?: boolean;
      reportAnonymousScripts?: boolean;
    }): Promise<void>;
    stopJSCoverage(): Promise<unknown>;
    startCSSCoverage(options?: { resetOnNavigation?: boolean }): Promise<void>;
    stopCSSCoverage(): Promise<unknown>;
  };
}

/**
 * Pre-flight CDP health check (standalone form).
 *
 * Same behaviour as {@link PageCDPTimeoutGuard.checkPageCDPHealth}, exposed as
 * a plain function so callers that already hold a Page — PageController's
 * evaluate wrappers — do not need to instantiate the guard.
 */
export async function checkPageCDPHealth(page: Page, timeoutMs = 500): Promise<void> {
  // Use AbortSignal-based timeout so the interrupt is truly async at the node level.
  const ac = new AbortController();
  const timer = asyncSetTimeout(timeoutMs, undefined, { signal: ac.signal }).then(() => {
    throw new Error('cdp_unreachable');
  });
  let cdp: import('rebrowser-puppeteer-core').CDPSession | null = null;
  const createPromise = page.createCDPSession();
  try {
    cdp = await Promise.race([createPromise, timer as unknown as Promise<never>]);
    await Promise.race([
      cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
      timer as unknown as Promise<never>,
    ]);
  } catch (err) {
    if (!cdp) {
      // We gave up before createCDPSession() settled: if it resolves later, the
      // native session must be detached or every health check leaks one.
      void createPromise
        .then((orphan) => orphan.detach().catch(() => undefined))
        .catch(() => undefined);
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'cdp_unreachable') {
      throw new Error(
        'CDP session unresponsive — the debugger may be blocking page evaluation. ' +
          "Call debugger_lifecycle({ action: 'disable' })() before this tool, or run it before " +
          "debugger_lifecycle({ action: 'enable' })().",
        { cause: err },
      );
    }
    throw err;
  } finally {
    ac.abort();
    if (cdp) {
      try {
        await cdp.detach();
      } catch {
        // Best-effort detach — session may already be closed
      }
    }
  }
}
