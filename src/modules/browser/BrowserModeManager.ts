import { existsSync } from 'fs';
import puppeteer, { Browser, Page, LaunchOptions } from 'rebrowser-puppeteer-core';
import { logger } from '../../utils/logger.js';
import { findBrowserExecutable } from '../../utils/browserExecutable.js';
import { CaptchaDetector, CaptchaDetectionResult } from '../captcha/CaptchaDetector.js';

export interface BrowserModeConfig {
  autoDetectCaptcha?: boolean;
  autoSwitchHeadless?: boolean;
  captchaTimeout?: number;
  defaultHeadless?: boolean;
  askBeforeSwitchBack?: boolean;
}

export class BrowserModeManager {
  private browser: Browser | null = null;
  private currentPage: Page | null = null;
  private isHeadless: boolean = true;
  private config: Required<BrowserModeConfig>;
  private captchaDetector: CaptchaDetector;
  private launchOptions: LaunchOptions;
  private sessionData: {
    cookies?: any[];
    localStorage?: Record<string, string>;
    sessionStorage?: Record<string, string>;
  } = {};

  constructor(config: BrowserModeConfig = {}, launchOptions: LaunchOptions = {}) {
    this.config = {
      autoDetectCaptcha: config.autoDetectCaptcha ?? true,
      autoSwitchHeadless: config.autoSwitchHeadless ?? true,
      captchaTimeout: config.captchaTimeout ?? 300000,
      defaultHeadless: config.defaultHeadless ?? true,
      askBeforeSwitchBack: config.askBeforeSwitchBack ?? true,
    };

    this.isHeadless = this.config.defaultHeadless;
    this.captchaDetector = new CaptchaDetector();
    this.launchOptions = launchOptions;
  }

  async launch(): Promise<Browser> {
    const headlessMode = this.isHeadless;
    const executablePath = this.resolveExecutablePath();
    logger.info(`Launching browser (${headlessMode ? 'headless' : 'headed'} mode)...`);

    const options: LaunchOptions = {
      ...this.launchOptions,
      headless: headlessMode,
      args: [
        ...(this.launchOptions.args || []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-component-extensions-with-background-pages',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    };
    if (executablePath) {
      options.executablePath = executablePath;
    }

    this.browser = await puppeteer.launch(options);

    logger.info('Browser launched successfully');

    return this.browser;
  }

  private resolveExecutablePath(): string | undefined {
    const configuredPath = this.launchOptions.executablePath?.trim();
    if (configuredPath) {
      if (existsSync(configuredPath)) {
        return configuredPath;
      }
      throw new Error(
        `Configured browser executable was not found: ${configuredPath}. ` +
          'Set a valid executablePath or configure CHROME_PATH / PUPPETEER_EXECUTABLE_PATH / BROWSER_EXECUTABLE_PATH.'
      );
    }

    const detectedPath = findBrowserExecutable();
    if (detectedPath) {
      return detectedPath;
    }

    logger.info(
      'No explicit browser executable configured. Falling back to Puppeteer-managed browser resolution.'
    );
    return undefined;
  }

  async newPage(): Promise<Page> {
    if (!this.browser) {
      await this.launch();
    }

    const page = await this.browser!.newPage();
    this.currentPage = page;

    await this.injectAntiDetectionScripts(page);

    if (this.sessionData.cookies && this.sessionData.cookies.length > 0) {
      await page.setCookie(...this.sessionData.cookies);
    }

    return page;
  }

  async goto(url: string, page?: Page): Promise<Page> {
    const targetPage = page || this.currentPage;

    if (!targetPage) {
      throw new Error('No page available. Call newPage() first.');
    }

    logger.info(` : ${url}`);

    await targetPage.goto(url, { waitUntil: 'networkidle2' });

    if (this.config.autoDetectCaptcha) {
      await this.checkAndHandleCaptcha(targetPage, url);
    }

    return targetPage;
  }

  async checkAndHandleCaptcha(page: Page, originalUrl: string): Promise<void> {
    const captchaResult = await this.captchaDetector.detect(page);

    if (captchaResult.detected) {
      logger.warn(
        `CAPTCHA detected (type: ${captchaResult.type}, confidence: ${captchaResult.confidence}%)`
      );

      if (captchaResult.vendor) {
        logger.warn(`   : ${captchaResult.vendor}`);
      }

      if (this.config.autoSwitchHeadless && this.isHeadless) {
        await this.switchToHeaded(page, originalUrl, captchaResult);
      } else {
        logger.info(' : ');
        await this.captchaDetector.waitForCompletion(page, this.config.captchaTimeout);
      }
    }
  }

  private async switchToHeaded(
    currentPage: Page,
    url: string,
    captchaInfo: CaptchaDetectionResult
  ): Promise<void> {
    logger.info(' ...');

    await this.saveSessionData(currentPage);

    await this.browser?.close();

    this.isHeadless = false;
    await this.launch();

    const newPage = await this.newPage();

    await newPage.goto(url, { waitUntil: 'networkidle2' });

    this.showCaptchaPrompt(captchaInfo);

    const completed = await this.captchaDetector.waitForCompletion(
      newPage,
      this.config.captchaTimeout
    );

    if (completed) {
      logger.info('Switching to headed mode for CAPTCHA...');

      if (this.config.askBeforeSwitchBack && this.config.defaultHeadless) {
        logger.info('Switched to headed mode successfully');
      }
    } else {
      logger.error(' ');
      throw new Error('Captcha completion timeout');
    }
  }

  private showCaptchaPrompt(captchaInfo: CaptchaDetectionResult): void {
    const lines = [
      '',
      '='.repeat(60),
      'CAPTCHA detected. Please solve it manually.',
      '='.repeat(60),
      `Type: ${captchaInfo.type}`,
      ...(captchaInfo.vendor ? [`Vendor: ${captchaInfo.vendor}`] : []),
      `Confidence: ${captchaInfo.confidence}%`,
      '',
      'Please:',
      '  1. Complete the CAPTCHA in the visible browser window.',
      '  2. Keep this process running.',
      '  3. The script will continue automatically after completion.',
      `  4. Timeout: ${this.config.captchaTimeout / 1000}s`,
      '='.repeat(60),
      '',
    ];

    for (const line of lines) {
      process.stderr.write(`${line}\n`);
    }
  }

  private async saveSessionData(page: Page): Promise<void> {
    try {
      this.sessionData.cookies = await page.cookies();

      const storageData = await page.evaluate(() => {
        const local: Record<string, string> = {};
        const session: Record<string, string> = {};

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            local[key] = localStorage.getItem(key) || '';
          }
        }

        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) {
            session[key] = sessionStorage.getItem(key) || '';
          }
        }

        return { local, session };
      });

      this.sessionData.localStorage = storageData.local;
      this.sessionData.sessionStorage = storageData.session;

      logger.info(' ');
    } catch (error) {
      logger.error('', error);
    }
  }

  private async injectAntiDetectionScripts(page: Page): Promise<void> {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      (window as any).chrome = {
        runtime: {
          connect: () => {},
          sendMessage: () => {},
          onMessage: {
            addListener: () => {},
            removeListener: () => {},
          },
        },
        loadTimes: function () {
          return {
            commitLoadTime: Date.now() / 1000,
            connectionInfo: 'http/1.1',
            finishDocumentLoadTime: Date.now() / 1000,
            finishLoadTime: Date.now() / 1000,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: Date.now() / 1000,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'unknown',
            requestTime: 0,
            startLoadTime: Date.now() / 1000,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: false,
            wasNpnNegotiated: false,
          };
        },
        csi: function () {
          return {
            onloadT: Date.now(),
            pageT: Date.now(),
            startE: Date.now(),
            tran: 15,
          };
        },
      };

      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          {
            0: {
              type: 'application/pdf',
              suffixes: 'pdf',
              description: 'Portable Document Format',
            },
            description: 'Portable Document Format',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Plugin',
          },
          {
            0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: '' },
            description: '',
            filename: 'internal-pdf-viewer',
            length: 1,
            name: 'Chrome PDF Viewer',
          },
          {
            0: {
              type: 'application/x-nacl',
              suffixes: '',
              description: 'Native Client Executable',
            },
            1: {
              type: 'application/x-pnacl',
              suffixes: '',
              description: 'Portable Native Client Executable',
            },
            description: '',
            filename: 'internal-nacl-plugin',
            length: 2,
            name: 'Native Client',
          },
        ],
      });

      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: (Notification as any).permission } as PermissionStatus)
          : originalQuery(parameters);

      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });

    logger.info('Switched back to headless mode');
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.currentPage = null;
      logger.info(' ');
    }
  }

  getBrowser(): Browser | null {
    return this.browser;
  }

  getCurrentPage(): Page | null {
    return this.currentPage;
  }

  isHeadlessMode(): boolean {
    return this.isHeadless;
  }
}
