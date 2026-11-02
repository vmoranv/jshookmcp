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
   * Wrap a page.evaluate() call with:
   * 1. A CDP pre-flight health check (fails fast at ~3 s instead of 30 s)
   * 2. A hard timeout (30 s) as a backstop
   *
   * Supports both string expressions and function callbacks.
   */
  async evaluateOnContextWithTimeout<Args extends readonly unknown[], Result>(
    page: Page,
    context: EvaluateContextLike,
    pageFunction: string | ((...args: never[]) => Result),
    ...args: Args
  ): Promise<Awaited<Result> | unknown> {
    const timeoutMs = this.defaultTimeoutMs;

    // Fail fast: detect zombie CDP sessions before they block evaluate().
    await this.checkPageCDPHealth(page);

    // Race evaluate against a timer; clear the timer when evaluate wins so we don't
    // leave a dangling setTimeout. NOTE: Playwright/Puppeteer don't expose a clean
    // way to cancel an in-flight evaluate(), so the JS still runs to completion in
    // the page — the timeout only protects the caller from blocking forever.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        context.evaluate(
          pageFunction as string | ((...args: never[]) => Result),
          ...([...args] as never[]),
        ),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`page.evaluate timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  async evaluateWithTimeout<Args extends readonly unknown[], Result>(
    page: Page,
    pageFunction: string | ((...args: never[]) => Result),
    ...args: Args
  ): Promise<Awaited<Result> | unknown> {
    return this.evaluateOnContextWithTimeout(
      page,
      page,
      pageFunction as any,
      ...(args as unknown as never[]),
    );
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

    return Promise.race([
      page.evaluateOnNewDocument(
        pageFunction as string | ((...args: never[]) => Result),
        ...([...args] as never[]),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`page.evaluateOnNewDocument timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Wrap page.coverage.startJSCoverage() with a timeout.
   */
  async coverageStartJSWithTimeout(
    page: CoveragePage,
    options?: { resetOnNavigation?: boolean; reportAnonymousScripts?: boolean },
  ): Promise<void> {
    const timeoutMs = this.defaultTimeoutMs;
    return Promise.race([
      page.coverage.startJSCoverage(options),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`coverage.startJSCoverage timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Wrap page.coverage.startCSSCoverage() with a timeout.
   */
  async coverageStartCSSWithTimeout(
    page: CoveragePage,
    options?: { resetOnNavigation?: boolean },
  ): Promise<void> {
    const timeoutMs = this.defaultTimeoutMs;
    return Promise.race([
      page.coverage.startCSSCoverage(options),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`coverage.startCSSCoverage timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Wrap page.coverage.stopJSCoverage() with a timeout.
   */
  async coverageStopJSWithTimeout(page: CoveragePage): Promise<unknown> {
    const timeoutMs = this.defaultTimeoutMs;
    return Promise.race([
      page.coverage.stopJSCoverage(),
      new Promise<unknown>((_, reject) =>
        setTimeout(
          () => reject(new Error(`coverage.stopJSCoverage timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Wrap page.coverage.stopCSSCoverage() with a timeout.
   */
  async coverageStopCSSWithTimeout(page: CoveragePage): Promise<unknown> {
    const timeoutMs = this.defaultTimeoutMs;
    return Promise.race([
      page.coverage.stopCSSCoverage(),
      new Promise<unknown>((_, reject) =>
        setTimeout(
          () => reject(new Error(`coverage.stopCSSCoverage timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }
}

interface EvaluateContextLike {
  evaluate<Result>(pageFunction: () => Result | Promise<Result>): Promise<Result>;
  evaluate<Arg, Result>(
    pageFunction: (arg: Arg) => Result | Promise<Result>,
    arg: Arg,
  ): Promise<Result>;
  evaluate<Args extends readonly unknown[], Result>(
    pageFunction: string | ((...args: Args) => Result | Promise<Result>),
    ...args: Args
  ): Promise<Result>;
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
  try {
    cdp = await Promise.race([page.createCDPSession(), timer as unknown as Promise<never>]);
    await Promise.race([
      cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
      timer as unknown as Promise<never>,
    ]);
  } catch (err) {
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
