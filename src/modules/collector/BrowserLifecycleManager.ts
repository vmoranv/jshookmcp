import type { Browser } from 'rebrowser-puppeteer-core';
import { logger } from '@utils/logger';
import { existsSync } from 'node:fs';
import { ENV_KEYS, findBrowserExecutableAsync } from '@utils/browserExecutable';
import { PrerequisiteError } from '@errors/PrerequisiteError';
import {
  resolveChromeLaunchOptions,
  sameChromeLaunchOptions,
  type ChromeLaunchOverrides,
  type ResolvedChromeLaunchOptions,
} from '@modules/collector/CodeCollectorLaunchOptions';
import type { PuppeteerConfig } from '@internal-types/index';
import { BROWSER_IDLE_TIMEOUT_MS, BROWSER_PROTOCOL_TIMEOUT_MS } from '@src/constants';
import { beginStderrCapture, installLaunchSignals } from '@utils/launchSignals';

export interface CodeCollectorLaunchResult {
  action: 'launched' | 'relaunched' | 'reused';
  launchOptions: ResolvedChromeLaunchOptions;
  reason?: 'replacing-existing-browser-connection' | 'launch-options-changed';
}

export interface BrowserLifecycleOptions {
  idleTimeoutMs?: number;
}

/**
 * Manages browser lifecycle (launch, connect, close) for CodeCollector.
 * Extracted from CodeCollector to reduce class complexity.
 */
export class BrowserLifecycleManager {
  private readonly config: PuppeteerConfig;
  private readonly viewport: { width: number; height: number };
  private readonly onDisconnected: () => void;
  private browser: Browser | null = null;
  private chromePid: number | null = null;
  private currentLaunchOptions: ResolvedChromeLaunchOptions | null = null;
  private connectedToExistingBrowser: boolean = false;
  private currentHeadless: boolean | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closePromise: Promise<void> | null = null;
  private readonly idleTimeoutMs: number;

  private static readonly BROWSER_CLOSE_TIMEOUT_MS = 5000;

  constructor(
    config: PuppeteerConfig,
    viewport: { width: number; height: number },
    onDisconnected: () => void,
    options?: BrowserLifecycleOptions,
  ) {
    this.config = config;
    this.viewport = viewport;
    this.onDisconnected = onDisconnected;
    const configuredTimeout = options?.idleTimeoutMs ?? BROWSER_IDLE_TIMEOUT_MS;
    this.idleTimeoutMs = Number.isFinite(configuredTimeout) ? Math.max(0, configuredTimeout) : 0;
  }

  /** Mark browser activity and move the idle reclamation deadline. */
  touch(): void {
    if (!this.browser || this.idleTimeoutMs <= 0 || this.closePromise) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.closeIdleBrowser();
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async closeIdleBrowser(): Promise<void> {
    if (!this.browser || this.closePromise) return;
    const attached = this.connectedToExistingBrowser;
    logger.info(
      `[browser] idle for ${this.idleTimeoutMs}ms; ${attached ? 'disconnecting attached browser' : 'closing launched browser'}`,
    );
    try {
      await this.disposeCurrentBrowser(false, async () => {});
    } catch (error) {
      logger.warn('[browser] idle reclamation failed:', error);
    } finally {
      this.onDisconnected();
    }
  }

  getBrowser(): Browser | null {
    return this.browser;
  }

  isExistingBrowserConnection(): boolean {
    return this.connectedToExistingBrowser;
  }

  getChromePid(): number | null {
    return this.chromePid;
  }

  getCurrentHeadless(): boolean | null {
    return this.currentHeadless;
  }

  getCurrentLaunchOptions(): ResolvedChromeLaunchOptions | null {
    return this.currentLaunchOptions;
  }

  async launch(
    overrides?: ChromeLaunchOverrides,
    initPromise?: Promise<void> | null,
  ): Promise<CodeCollectorLaunchResult> {
    if (initPromise) {
      await initPromise;
    }

    // Path resolution happens BEFORE launchInner, so a configured-but-missing
    // executable throws out here and would bypass the enrichment inside it.
    // Same class of failure (no usable browser), same actionable error.
    let executablePath: string | undefined;
    try {
      executablePath = await this.resolveExecutablePath();
    } catch (error) {
      throw this.enrichLaunchError(error);
    }
    const launchOptions = resolveChromeLaunchOptions(
      this.config,
      overrides,
      executablePath,
      this.viewport,
    );

    // Internal callers such as collector.init() only need "a browser".
    // If one already exists, do not silently relaunch it with default config.
    if (this.browser && overrides === undefined) {
      return {
        action: 'reused',
        launchOptions: this.currentLaunchOptions ?? launchOptions,
      };
    }

    if (
      this.browser &&
      !this.connectedToExistingBrowser &&
      sameChromeLaunchOptions(this.currentLaunchOptions, launchOptions)
    ) {
      return {
        action: 'reused',
        launchOptions,
      };
    }

    const action: CodeCollectorLaunchResult['action'] = this.browser ? 'relaunched' : 'launched';
    const reason = this.browser
      ? this.connectedToExistingBrowser
        ? 'replacing-existing-browser-connection'
        : 'launch-options-changed'
      : undefined;

    await this.launchInner(launchOptions);

    return {
      action,
      launchOptions,
      ...(reason ? { reason } : {}),
    };
  }

  private async launchInner(launchOptions: ResolvedChromeLaunchOptions): Promise<void> {
    if (this.browser) {
      await this.disposeCurrentBrowser(false, async () => {});
    }

    const browserLaunchOptions: Parameters<typeof import('rebrowser-puppeteer-core').launch>[0] = {
      headless: launchOptions.headless,
      args: launchOptions.args,
      defaultViewport: this.viewport,
      protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS,
    };
    if (launchOptions.executablePath) {
      browserLaunchOptions.executablePath = launchOptions.executablePath;
    }
    logger.info('Initializing browser with anti-detection...');
    const puppeteer = await import('rebrowser-puppeteer-core');
    const launchFn = puppeteer.default?.launch ?? puppeteer.launch;
    // stderr attribution: capture only the launch window, only the byte count.
    // A failure WITH stderr means the binary ran and refused; with EMPTY stderr
    // nothing executed (missing binary / permission / arch). The two have
    // different owners, and without the flag they collapse into one number.
    // `dumpio` is what makes the count observable at all: without it puppeteer
    // gives the browser an ignore-mode stderr and nothing reaches this process.
    // The text itself is never stored — only how many bytes arrived.
    const stderrCapture = beginStderrCapture();
    let stderrByteCount: number | null = null;
    try {
      this.browser = await launchFn({ ...browserLaunchOptions, dumpio: true });
      stderrByteCount = stderrCapture.bytesSoFar();
    } catch (error) {
      stderrCapture.markFailed();
      throw this.enrichLaunchError(error);
    } finally {
      stderrCapture.stop();
    }
    this.connectedToExistingBrowser = false;
    this.chromePid = this.browser.process()?.pid ?? null;
    if (this.chromePid) {
      logger.debug(`Chrome child process PID: ${this.chromePid}`);
    }
    this.currentHeadless = launchOptions.headless;
    this.currentLaunchOptions = launchOptions;
    // stderr is only readable at the moment the browser is up: puppeteer
    // closes its pipe once launch resolves. So the count is captured HERE,
    // into the same record the tool-call attribution reads.
    installLaunchSignals({
      stderrByteCount: () => stderrByteCount,
      browserMode: () => 'launch',
    });
    const browser = this.browser;
    browser.on('disconnected', () => {
      this.handleBrowserDisconnected(browser);
    });
    this.touch();
    logger.success('Browser initialized with enhanced anti-detection');
  }

  /**
   * Turn "no browser could be resolved" into a PrerequisiteError that names the
   * probed sources and the fix.
   *
   * Only the missing-executable case is rewritten. Any other launch failure
   * (crashed binary, port conflict, permission denied) is passed through
   * untouched — rewriting those would hide the real cause behind a routing hint.
   */
  private enrichLaunchError(error: unknown): unknown {
    const message = error instanceof Error ? error.message : String(error);
    // Two shapes reach here: puppeteer-core's own "no executablePath or
    // channel" assert (nothing resolved at all), and resolveExecutablePath's
    // "Configured browser executable was not found" (a path was configured but
    // does not exist). Both mean the same thing to the caller.
    if (
      !/executablePath.*channel.*must be specified|Could not find (Chrome|Chromium|browser)|Configured browser executable was not found/i.test(
        message,
      )
    ) {
      return error;
    }
    const envHint = ENV_KEYS.join(' / ');
    return new PrerequisiteError(
      `No browser executable found (${message}). ` +
        `Fix: pass \`executablePath\` or \`channel\` to browser_launch, or set ${envHint} to a Chrome/Chromium binary. ` +
        'Probed: the configured executablePath, ' +
        `${envHint}, and Puppeteer's managed download cache.`,
    );
  }

  private async resolveExecutablePath(): Promise<string | undefined> {
    const configuredPath = this.config.executablePath?.trim();
    if (configuredPath) {
      if (existsSync(configuredPath)) {
        return configuredPath;
      }
      throw new Error(
        `Configured browser executable was not found: ${configuredPath}. ` +
          'Set a valid executablePath or configure CHROME_PATH / PUPPETEER_EXECUTABLE_PATH / BROWSER_EXECUTABLE_PATH.',
      );
    }
    const detectedPath = await findBrowserExecutableAsync();
    if (detectedPath) {
      return detectedPath;
    }
    logger.info(
      'No explicit browser executable configured. Falling back to Puppeteer-managed browser resolution.',
    );
    return undefined;
  }

  private handleBrowserDisconnected(browser: Browser | null): void {
    if (!browser || this.browser !== browser) return;
    logger.warn('Browser disconnected');
    this.clearIdleTimer();
    this.browser = null;
    this.currentHeadless = null;
    this.currentLaunchOptions = null;
    this.connectedToExistingBrowser = false;
    this.chromePid = null;
    this.onDisconnected();
  }

  private async disposeCurrentBrowser(
    _markExplicitlyClosed: boolean,
    clearAllData: () => Promise<void>,
  ): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const run = this.disposeCurrentBrowserInner(clearAllData);
    this.closePromise = run;
    try {
      await run;
    } finally {
      if (this.closePromise === run) this.closePromise = null;
    }
  }

  private async disposeCurrentBrowserInner(clearAllData: () => Promise<void>): Promise<void> {
    this.clearIdleTimer();
    await clearAllData();

    const browser = this.browser;
    const disconnectOnly = this.connectedToExistingBrowser;
    const pid = this.chromePid;
    this.browser = null;
    this.currentHeadless = null;
    this.currentLaunchOptions = null;
    this.connectedToExistingBrowser = false;
    this.chromePid = null;

    if (browser) {
      if (disconnectOnly) {
        await browser.disconnect();
      } else {
        await this.closeBrowserWithForceKill(browser, pid);
      }
    }
  }

  async close(clearAllData: () => Promise<void>): Promise<void> {
    await this.disposeCurrentBrowser(true, clearAllData);
    logger.info('Browser closed and all data cleared');
  }

  /**
   * Close browser with a timeout guard. If browser.close() hangs or fails,
   * force-kill the Chrome child process by PID to prevent zombie processes.
   */
  async closeBrowserWithForceKill(browser: Browser, pid: number | null): Promise<void> {
    try {
      await Promise.race([
        browser.close(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('browser.close() timed out')),
            BrowserLifecycleManager.BROWSER_CLOSE_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (error) {
      logger.warn('browser.close() failed or timed out, attempting force-kill:', error);
      BrowserLifecycleManager.forceKillPid(pid);
    }
  }

  /** Force-kill a process by PID. Safe to call with null/invalid PIDs. */
  static forceKillPid(pid: number | null): void {
    if (!pid) return;
    try {
      process.kill(pid, 'SIGKILL');
      logger.info(`Force-killed Chrome process PID ${pid}`);
    } catch (error) {
      // ESRCH = process already exited, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        logger.warn(`Failed to force-kill Chrome PID ${pid}:`, error);
      }
    }
  }

  async connect(
    connectOptions: { browserWSEndpoint?: string; browserURL?: string },
    connectWithTimeout: (
      connectOptions: { browserWSEndpoint?: string; browserURL?: string },
      target: string,
    ) => Promise<Browser>,
    target: string,
  ): Promise<void> {
    if (this.browser) {
      await this.disposeCurrentBrowser(false, async () => {});
    }
    logger.info(`Connecting to existing browser: ${target}`);
    this.browser = await connectWithTimeout(connectOptions, target);
    this.connectedToExistingBrowser = true;
    this.currentLaunchOptions = null;
    const browser = this.browser;
    browser.on('disconnected', () => {
      this.handleBrowserDisconnected(browser);
    });
    this.touch();
    logger.success('Connected to existing browser successfully');
  }
}
