/**
 * Unified Browser Manager - Provides a unified interface for both Chrome and Camoufox browsers.
 *
 * Supports:
 * - Chrome (via rebrowser-puppeteer-core) with headless: true | false | 'shell'
 * - Camoufox (Firefox via camoufox-js) with headless: true | false | 'virtual'
 * - Browser discovery to find existing browsers with debug ports
 */

import type { Browser as PuppeteerBrowser, Page as PuppeteerPage, LaunchOptions } from 'rebrowser-puppeteer-core';
import type { Browser as PlaywrightBrowser, Page as PlaywrightPage } from 'playwright-core';
import { BrowserModeManager, BrowserModeConfig } from './BrowserModeManager.js';
import { CamoufoxBrowserManager, CamoufoxBrowserConfig } from './CamoufoxBrowserManager.js';
import { BrowserDiscovery, BrowserInfo } from './BrowserDiscovery.js';
import { logger } from '../../utils/logger.js';

/**
 * Supported browser drivers
 */
export type BrowserDriver = 'chrome' | 'camoufox';

/**
 * Unified headless mode type
 * - Chrome: true | false | 'shell' (new headless mode)
 * - Camoufox: true | false | 'virtual' (virtual display for headless)
 */
export type HeadlessMode = boolean | 'shell' | 'virtual';

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/**
 * Unified browser configuration
 */
export interface UnifiedBrowserConfig {
  /** Browser driver to use */
  driver?: BrowserDriver;
  /** Headless mode: true, false, 'shell' (Chrome), or 'virtual' (Camoufox) */
  headless?: HeadlessMode;
  /** Custom browser executable path */
  executablePath?: string;
  /** Debug port for Chrome remote debugging */
  debugPort?: number;
  /** Proxy configuration */
  proxy?: ProxyConfig;
  /** Target OS fingerprint (Camoufox-specific) */
  os?: 'windows' | 'macos' | 'linux';
  /** Auto-resolve GeoIP for locale/timezone (Camoufox-specific) */
  geoip?: boolean;
  /** Humanize cursor movements (Camoufox-specific) */
  humanize?: boolean | number;
  /** Block image loading (Camoufox-specific) */
  blockImages?: boolean;
  /** Block WebRTC to prevent IP leaks (Camoufox-specific) */
  blockWebrtc?: boolean;
  /** Auto-detect and handle CAPTCHA (Chrome-specific) */
  autoDetectCaptcha?: boolean;
  /** Auto-switch from headless to headed for CAPTCHA (Chrome-specific) */
  autoSwitchHeadless?: boolean;
  /** CAPTCHA handling timeout in ms (Chrome-specific) */
  captchaTimeout?: number;
  /** Connect to existing browser via WebSocket endpoint */
  wsEndpoint?: string;
  /** Additional launch arguments for Chrome */
  args?: string[];
}

/**
 * Interface for browser managers
 */
export interface IBrowserManager {
  launch(): Promise<PuppeteerBrowser | PlaywrightBrowser>;
  newPage(): Promise<PuppeteerPage | PlaywrightPage>;
  goto(url: string, page?: PuppeteerPage | PlaywrightPage): Promise<PuppeteerPage | PlaywrightPage>;
  close(): Promise<void>;
  getBrowser(): PuppeteerBrowser | PlaywrightBrowser | null;
}

/**
 * Browser status information
 */
export interface BrowserStatus {
  driver: BrowserDriver;
  running: boolean;
  hasActivePage: boolean;
  headless?: boolean | 'shell' | 'virtual';
  debugPort?: number;
}

/**
 * Unified Browser Manager
 *
 * Provides a unified interface for launching and controlling both Chrome and Camoufox browsers.
 * Supports browser discovery, headless mode configuration, and CAPTCHA handling.
 */
export class UnifiedBrowserManager implements IBrowserManager {
  private driver: BrowserDriver;
  private config: UnifiedBrowserConfig;
  private chromeManager: BrowserModeManager | null = null;
  private camoufoxManager: CamoufoxBrowserManager | null = null;
  private browserDiscovery: BrowserDiscovery;
  private activePage: PuppeteerPage | PlaywrightPage | null = null;

  constructor(config: UnifiedBrowserConfig = {}) {
    this.config = config;
    this.driver = config.driver ?? 'chrome';
    this.browserDiscovery = new BrowserDiscovery();
  }

  /**
   * Launch browser with configured driver
   */
  async launch(): Promise<PuppeteerBrowser | PlaywrightBrowser> {
    if (this.driver === 'camoufox') {
      return this.launchCamoufox();
    }
    return this.launchChrome();
  }

  /**
   * Launch Chrome browser
   */
  private async launchChrome(): Promise<PuppeteerBrowser> {
    logger.info(`Launching Chrome [headless=${this.config.headless ?? true}]...`);

    const modeConfig: BrowserModeConfig = {
      autoDetectCaptcha: this.config.autoDetectCaptcha,
      autoSwitchHeadless: this.config.autoSwitchHeadless,
      captchaTimeout: this.config.captchaTimeout,
      defaultHeadless: this.getHeadlessBoolean(),
    };

    const launchOptions: LaunchOptions = {
      headless: this.normalizeChromeHeadless(),
      executablePath: this.config.executablePath,
      args: this.config.args,
    };

    // Add proxy configuration
    if (this.config.proxy) {
      const proxyArgs = [`--proxy-server=${this.config.proxy.server}`];
      launchOptions.args = [...(launchOptions.args || []), ...proxyArgs];
    }

    // Add debug port
    if (this.config.debugPort) {
      launchOptions.args = [...(launchOptions.args || []), `--remote-debugging-port=${this.config.debugPort}`];
    }

    this.chromeManager = new BrowserModeManager(modeConfig, launchOptions);
    const browser = await this.chromeManager.launch();

    logger.info('Chrome browser launched successfully');
    return browser;
  }

  /**
   * Launch Camoufox browser
   */
  private async launchCamoufox(): Promise<PlaywrightBrowser> {
    const headless = this.normalizeCamoufoxHeadless();
    logger.info(`Launching Camoufox (Firefox) [os=${this.config.os ?? 'windows'}, headless=${headless}]...`);

    const camoufoxConfig: CamoufoxBrowserConfig = {
      headless,
      os: this.config.os,
      geoip: this.config.geoip,
      humanize: this.config.humanize,
      proxy: this.config.proxy,
      blockImages: this.config.blockImages,
      blockWebrtc: this.config.blockWebrtc,
    };

    this.camoufoxManager = new CamoufoxBrowserManager(camoufoxConfig);
    const browser = await this.camoufoxManager.launch();

    logger.info('Camoufox browser launched successfully');
    return browser;
  }

  /**
   * Connect to existing browser
   */
  async connect(wsEndpoint: string): Promise<PuppeteerBrowser | PlaywrightBrowser> {
    if (this.driver === 'camoufox') {
      return this.connectCamoufox(wsEndpoint);
    }
    return this.connectChrome(wsEndpoint);
  }

  /**
   * Connect to existing Chrome browser via WebSocket
   */
  private async connectChrome(wsEndpoint: string): Promise<PuppeteerBrowser> {
    logger.info(`Connecting to Chrome browser: ${wsEndpoint}`);

    const puppeteer = await import('rebrowser-puppeteer-core');
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
    });

    // Create a minimal manager wrapper for the connected browser
    this.chromeManager = new BrowserModeManager({}, {});
    // Access internal browser reference
    (this.chromeManager as any).browser = browser;

    logger.info('Connected to Chrome browser successfully');
    return browser;
  }

  /**
   * Connect to existing Camoufox browser via WebSocket
   */
  private async connectCamoufox(wsEndpoint: string): Promise<PlaywrightBrowser> {
    logger.info(`Connecting to Camoufox browser: ${wsEndpoint}`);

    this.camoufoxManager = new CamoufoxBrowserManager({});
    const browser = await this.camoufoxManager.connectToServer(wsEndpoint);

    logger.info('Connected to Camoufox browser successfully');
    return browser;
  }

  /**
   * Create a new page
   */
  async newPage(): Promise<PuppeteerPage | PlaywrightPage> {
    if (this.driver === 'camoufox') {
      if (!this.camoufoxManager) {
        await this.launchCamoufox();
      }
      this.activePage = await this.camoufoxManager!.newPage();
      return this.activePage;
    }

    if (!this.chromeManager) {
      await this.launchChrome();
    }
    this.activePage = await this.chromeManager!.newPage();
    return this.activePage;
  }

  /**
   * Navigate to URL
   */
  async goto(
    url: string,
    page?: PuppeteerPage | PlaywrightPage
  ): Promise<PuppeteerPage | PlaywrightPage> {
    const targetPage = page ?? this.activePage;

    if (this.driver === 'camoufox') {
      if (!this.camoufoxManager) {
        await this.launchCamoufox();
      }
      return this.camoufoxManager!.goto(url, targetPage as PlaywrightPage);
    }

    if (!this.chromeManager) {
      await this.launchChrome();
    }
    return this.chromeManager!.goto(url, targetPage as PuppeteerPage);
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.driver === 'camoufox' && this.camoufoxManager) {
      await this.camoufoxManager.close();
      this.camoufoxManager = null;
      this.activePage = null;
      logger.info('Camoufox browser closed');
      return;
    }

    if (this.chromeManager) {
      await this.chromeManager.close();
      this.chromeManager = null;
      this.activePage = null;
      logger.info('Chrome browser closed');
    }
  }

  /**
   * Get browser instance
   */
  getBrowser(): PuppeteerBrowser | PlaywrightBrowser | null {
    if (this.driver === 'camoufox') {
      return this.camoufoxManager?.getBrowser() ?? null;
    }
    return this.chromeManager?.getBrowser() ?? null;
  }

  /**
   * Get active page
   */
  getActivePage(): PuppeteerPage | PlaywrightPage | null {
    return this.activePage;
  }

  /**
   * Get current driver
   */
  getDriver(): BrowserDriver {
    return this.driver;
  }

  /**
   * Set driver (will require restart)
   */
  setDriver(driver: BrowserDriver): void {
    this.driver = driver;
  }

  /**
   * Get browser status
   */
  getStatus(): BrowserStatus {
    const browser = this.getBrowser();
    const running = browser !== null && browser.isConnected();

    return {
      driver: this.driver,
      running,
      hasActivePage: this.activePage !== null,
      headless: this.config.headless,
      debugPort: this.config.debugPort,
    };
  }

  /**
   * Discover running browsers
   */
  async discoverBrowsers(): Promise<BrowserInfo[]> {
    return this.browserDiscovery.discoverBrowsers();
  }

  /**
   * Find existing Chrome browser with debug port
   */
  async findChromeWithDebugPort(preferredPorts: number[] = [9222, 9229, 9333]): Promise<BrowserInfo | null> {
    const browsers = await this.discoverBrowsers();
    const chromeBrowsers = browsers.filter(b => b.type === 'chrome' || b.type === 'edge');

    for (const browser of chromeBrowsers) {
      if (browser.debugPort && preferredPorts.includes(browser.debugPort)) {
        return browser;
      }
    }

    return null;
  }

  /**
   * Attach to existing Chrome browser if found
   */
  async attachToExistingChrome(preferredPorts: number[] = [9222, 9229, 9333]): Promise<PuppeteerBrowser | null> {
    const browserInfo = await this.findChromeWithDebugPort(preferredPorts);

    if (!browserInfo || !browserInfo.debugPort) {
      logger.info('No existing Chrome browser with debug port found');
      return null;
    }

    const wsEndpoint = `ws://127.0.0.1:${browserInfo.debugPort}`;
    logger.info(`Found existing Chrome browser on port ${browserInfo.debugPort}, connecting...`);

    try {
      return await this.connectChrome(wsEndpoint);
    } catch (error) {
      logger.error('Failed to connect to existing Chrome browser', error);
      return null;
    }
  }

  /**
   * Normalize headless mode for Chrome
   * - true -> true (old headless)
   * - false -> false (headed)
   * - 'shell' -> 'shell' (new headless)
   * - 'virtual' -> true (virtual is Camoufox-specific)
   */
  private normalizeChromeHeadless(): boolean | 'shell' {
    const headless = this.config.headless;

    if (headless === 'virtual') {
      // 'virtual' is Camoufox-specific, fallback to true for Chrome
      return true;
    }

    if (headless === 'shell') {
      return 'shell';
    }

    return headless ?? true;
  }

  /**
   * Normalize headless mode for Camoufox
   * - true -> true
   * - false -> false
   * - 'virtual' -> 'virtual'
   * - 'shell' -> true ('shell' is Chrome-specific)
   */
  private normalizeCamoufoxHeadless(): boolean | 'virtual' {
    const headless = this.config.headless;

    if (headless === 'shell') {
      // 'shell' is Chrome-specific, fallback to true for Camoufox
      return true;
    }

    if (headless === 'virtual') {
      return 'virtual';
    }

    return headless ?? true;
  }

  /**
   * Get boolean headless value for mode config
   */
  private getHeadlessBoolean(): boolean {
    const headless = this.config.headless;
    if (headless === 'shell' || headless === 'virtual') {
      return true;
    }
    return headless ?? true;
  }
}

// Re-export types and classes
export { BrowserModeManager } from './BrowserModeManager.js';
export type { BrowserModeConfig } from './BrowserModeManager.js';
export { CamoufoxBrowserManager } from './CamoufoxBrowserManager.js';
export type { CamoufoxBrowserConfig } from './CamoufoxBrowserManager.js';
export { BrowserDiscovery } from './BrowserDiscovery.js';
export type { BrowserInfo, BrowserSignature } from './BrowserDiscovery.js';
