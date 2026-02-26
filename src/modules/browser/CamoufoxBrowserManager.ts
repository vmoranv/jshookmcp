import { logger } from '../../utils/logger.js';

export interface CamoufoxPageLike {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  context(): {
    newCDPSession(page: CamoufoxPageLike): Promise<unknown>;
  };
}

export interface CamoufoxBrowserLike {
  newPage(): Promise<CamoufoxPageLike>;
  close(): Promise<void>;
  isConnected(): boolean;
}

export interface CamoufoxBrowserServerLike {
  wsEndpoint(): string;
  close(): Promise<void>;
}

/**
 * Firefox-based anti-detect browser manager using camoufox-js.
 * Uses C++ engine-level fingerprint spoofing (vs JS-level patches in puppeteer-stealth).
 *
 * Requires camoufox binaries:
 *   npx camoufox-js fetch
 */
export interface CamoufoxBrowserConfig {
  /** Target OS fingerprint to spoof */
  os?: 'windows' | 'macos' | 'linux';
  /** Enable headless mode */
  headless?: boolean | 'virtual';
  /** Auto-resolve GeoIP for locale/timezone */
  geoip?: boolean;
  /** Humanize cursor movements */
  humanize?: boolean | number;
  /** HTTP/SOCKS proxy */
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
  /** Block image loading for performance */
  blockImages?: boolean;
  /** Block WebRTC to prevent IP leaks */
  blockWebrtc?: boolean;
}

export class CamoufoxBrowserManager {
  private browser: CamoufoxBrowserLike | null = null;
  private browserServer: CamoufoxBrowserServerLike | null = null;
  private config: CamoufoxBrowserConfig;

  constructor(config: CamoufoxBrowserConfig = {}) {
    this.config = {
      os: config.os ?? 'windows',
      headless: config.headless ?? true,
      geoip: config.geoip ?? false,
      humanize: config.humanize ?? false,
      blockImages: config.blockImages ?? false,
      blockWebrtc: config.blockWebrtc ?? false,
      proxy: config.proxy,
    };
  }

  async launch(): Promise<CamoufoxBrowserLike> {
    logger.info(
      `Launching Camoufox (Firefox) [os=${this.config.os}, headless=${this.config.headless}]...`
    );

    const { Camoufox } = await import('camoufox-js');

    this.browser = (await Camoufox({
      os: this.config.os,
      headless: this.config.headless,
      geoip: this.config.geoip,
      humanize: this.config.humanize,
      proxy: this.config.proxy,
      block_images: this.config.blockImages,
      block_webrtc: this.config.blockWebrtc,
    })) as CamoufoxBrowserLike;

    logger.info('Camoufox browser launched');
    return this.browser;
  }

  async newPage(): Promise<CamoufoxPageLike> {
    if (!this.browser) {
      await this.launch();
    }

    const page = await this.browser!.newPage();
    logger.info('New Camoufox page created');
    return page;
  }

  async goto(url: string, page?: CamoufoxPageLike): Promise<CamoufoxPageLike> {
    const targetPage = page ?? (await this.newPage());

    logger.info(`Navigating to: ${url}`);
    await targetPage.goto(url, { waitUntil: 'networkidle' });
    return targetPage;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Camoufox browser closed');
    }
  }

  /**
   * Launch a Camoufox WebSocket server that remote clients can connect to.
   * Returns the WebSocket endpoint URL (e.g. ws://127.0.0.1:8888/<path>).
   *
   * Usage:
   *   const endpoint = await manager.launchAsServer(8888, '/camoufox');
   *   // In another process: firefox.connect(endpoint)
   */
  async launchAsServer(port?: number, ws_path?: string): Promise<string> {
    logger.info(`Launching Camoufox server [os=${this.config.os}, port=${port ?? 'auto'}]...`);

    const { launchServer } = await import('camoufox-js');

    this.browserServer = await launchServer({
      os: this.config.os,
      headless: this.config.headless,
      geoip: this.config.geoip,
      humanize: this.config.humanize,
      proxy: this.config.proxy,
      block_images: this.config.blockImages,
      block_webrtc: this.config.blockWebrtc,
      port,
      ws_path,
    } as any);

    const endpoint = this.browserServer.wsEndpoint();
    logger.info(`Camoufox server listening on: ${endpoint}`);
    return endpoint;
  }

  /**
   * Connect to an existing Camoufox WebSocket server.
   * The returned browser/pages operate identically to a locally launched browser.
   */
  async connectToServer(wsEndpoint: string): Promise<CamoufoxBrowserLike> {
    logger.info(`Connecting to Camoufox server: ${wsEndpoint}`);

    const playwrightModule = await import('playwright-core' as string);
    const firefox = (playwrightModule as { firefox: { connect: (endpoint: string) => Promise<unknown> } }).firefox;
    this.browser = (await firefox.connect(wsEndpoint)) as CamoufoxBrowserLike;

    logger.info('Connected to Camoufox server');
    return this.browser;
  }

  /** Close the WebSocket server (does not close connected clients). */
  async closeBrowserServer(): Promise<void> {
    if (this.browserServer) {
      await this.browserServer.close();
      this.browserServer = null;
      logger.info('Camoufox server closed');
    }
  }

  /** Returns the WebSocket endpoint if a server is currently running. */
  getBrowserServerEndpoint(): string | null {
    return this.browserServer ? this.browserServer.wsEndpoint() : null;
  }

  getBrowser(): CamoufoxBrowserLike | null {
    return this.browser;
  }

  /**
   * Get the Playwright CDPSession for a page.
   * Note: camoufox uses Firefox (Juggler protocol), CDP may be limited.
   * Use this only for Chrome-compatible operations.
   */
  async getCDPSession(page: CamoufoxPageLike) {
    logger.warn(
      'CDP sessions on camoufox (Firefox) have limited support — consider using Chrome driver for CDP-heavy operations'
    );
    const context = page.context();
    return context.newCDPSession(page);
  }
}
