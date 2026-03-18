import { logger } from '@utils/logger';
import { PrerequisiteError } from '@errors/PrerequisiteError';

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
  private isClosing = false;
  private launchPromise?: Promise<CamoufoxBrowserLike>;

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
    // Early return if browser already connected
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    if (this.isClosing) {
      throw new Error('Cannot launch browser while closing');
    }

    // Prevent concurrent launch race condition with promise lock
    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = this.doLaunch();
    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = undefined;
    }
  }

  private async doLaunch(): Promise<CamoufoxBrowserLike> {
    // Close existing browser before relaunch to prevent multiple instances
    if (this.browser) {
      logger.info('Closing existing Camoufox browser before relaunch');
      await this.browser
        .close()
        .catch((err) => logger.warn('Failed to close previous browser:', err));
      this.browser = null;
    }

    logger.info(
      `Launching Camoufox (Firefox) [os=${this.config.os}, headless=${this.config.headless}]...`
    );

    let Camoufox: typeof import('camoufox-js').Camoufox;
    try {
      ({ Camoufox } = await import('camoufox-js'));
    } catch (error) {
      throw new PrerequisiteError(
        `camoufox-js is not installed or its binaries are missing. Run \`pnpm run install:full\` or \`pnpm exec camoufox-js fetch\` before using the Camoufox driver. Root cause: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    this.browser = (await Camoufox({
      os: this.config.os,
      headless: this.config.headless,
      geoip: this.config.geoip,
      humanize: this.config.humanize,
      proxy: this.config.proxy,
      block_images: this.config.blockImages,
      block_webrtc: this.config.blockWebrtc,
    })) as CamoufoxBrowserLike;

    if (this.isClosing) {
      await this.browser.close().catch((error) => {
        logger.warn('Failed to close Camoufox browser launched during shutdown:', error);
      });
      this.browser = null;
      throw new Error('Camoufox launch aborted because close was requested');
    }

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
    this.isClosing = true;

    const pendingLaunch = this.launchPromise;
    if (pendingLaunch) {
      void pendingLaunch
        .catch(() => undefined)
        .finally(() => {
          void this.finalizeClose();
        });
      return;
    }

    await this.finalizeClose();
  }

  private async finalizeClose(): Promise<void> {
    try {
      const browser = this.browser;
      this.browser = null;

      if (browser) {
        await browser.close();
        logger.info('Camoufox browser closed');
      }
    } finally {
      this.isClosing = false;
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

    let launchServer: typeof import('camoufox-js').launchServer;
    try {
      ({ launchServer } = await import('camoufox-js'));
    } catch (error) {
      throw new PrerequisiteError(
        `camoufox-js server support is unavailable. Run \`pnpm run install:full\` or \`pnpm exec camoufox-js fetch\` before launching a Camoufox WebSocket server. Root cause: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const serverOptions = {
      os: this.config.os,
      headless: this.config.headless,
      geoip: this.config.geoip,
      humanize: this.config.humanize,
      proxy: this.config.proxy,
      block_images: this.config.blockImages,
      block_webrtc: this.config.blockWebrtc,
      port,
      ws_path,
    } as unknown as Parameters<typeof launchServer>[0];

    // Close existing server before relaunch to prevent multiple instances
    if (this.browserServer) {
      logger.info('Closing existing Camoufox server before relaunch');
      await this.browserServer
        .close()
        .catch((err) => logger.warn('Failed to close previous server:', err));
      this.browserServer = null;
    }

    const server = await launchServer(serverOptions);
    this.browserServer = server;

    const endpoint = server.wsEndpoint();
    logger.info(`Camoufox server listening on: ${endpoint}`);
    return endpoint;
  }

  /**
   * Connect to an existing Camoufox WebSocket server.
   * The returned browser/pages operate identically to a locally launched browser.
   */
  async connectToServer(wsEndpoint: string): Promise<CamoufoxBrowserLike> {
    logger.info(`Connecting to Camoufox server: ${wsEndpoint}`);

    // Close existing browser before connecting to new server
    if (this.browser) {
      logger.info('Disconnecting existing browser before new connection');
      await this.browser
        .close()
        .catch((err) => logger.warn('Failed to close previous browser:', err));
      this.browser = null;
    }

    const playwrightModule = await import('playwright-core' as string);
    const firefox = (
      playwrightModule as { firefox: { connect: (endpoint: string) => Promise<unknown> } }
    ).firefox;
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
