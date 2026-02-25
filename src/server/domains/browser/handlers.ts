/**
 * Browser Tool Handlers - Facade Module
 *
 * This file serves as the main entry point for browser tool handlers.
 * Handlers are organized into atomic modules by functional domain:
 * - browser-control: Browser lifecycle management
 * - camoufox-browser: Camoufox server management
 * - page-navigation: Navigation and history
 * - page-interaction: User interactions (click, type, etc.)
 * - page-evaluation: JS evaluation and screenshots
 * - page-data: Cookies, storage, viewport
 * - dom-query: DOM querying
 * - dom-style: DOM styles and viewport
 * - dom-search: Text-based DOM search
 * - console-handlers: Console monitoring
 * - script-management: Script inspection
 * - captcha-handlers: CAPTCHA detection
 * - stealth-injection: Anti-detection scripts
 * - framework-state: React/Vue state extraction
 * - indexeddb-dump: IndexedDB inspection
 * - detailed-data: Detailed data retrieval
 */

import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import type { PageController } from '../../../modules/collector/PageController.js';
import type { DOMInspector } from '../../../modules/collector/DOMInspector.js';
import type { ScriptManager } from '../../../modules/debugger/ScriptManager.js';
import type { ConsoleMonitor } from '../../../modules/monitor/ConsoleMonitor.js';
import { AICaptchaDetector } from '../../../modules/captcha/AICaptchaDetector.js';
import { LLMService } from '../../../services/LLMService.js';
import { DetailedDataManager } from '../../../utils/DetailedDataManager.js';
import { resolveOutputDirectory } from '../../../utils/outputPaths.js';
import { CamoufoxBrowserManager } from '../../../modules/browser/CamoufoxBrowserManager.js';

// Import handler modules
import { BrowserControlHandlers } from './handlers/browser-control.js';
import { CamoufoxBrowserHandlers } from './handlers/camoufox-browser.js';
import { PageNavigationHandlers } from './handlers/page-navigation.js';
import { PageInteractionHandlers } from './handlers/page-interaction.js';
import { PageEvaluationHandlers } from './handlers/page-evaluation.js';
import { PageDataHandlers } from './handlers/page-data.js';
import { DOMQueryHandlers } from './handlers/dom-query.js';
import { DOMStyleHandlers } from './handlers/dom-style.js';
import { DOMSearchHandlers } from './handlers/dom-search.js';
import { ConsoleHandlers } from './handlers/console-handlers.js';
import { ScriptManagementHandlers } from './handlers/script-management.js';
import { CaptchaHandlers } from './handlers/captcha-handlers.js';
import { StealthInjectionHandlers } from './handlers/stealth-injection.js';
import { FrameworkStateHandlers } from './handlers/framework-state.js';
import { IndexedDBDumpHandlers } from './handlers/indexeddb-dump.js';
import { DetailedDataHandlers } from './handlers/detailed-data.js';

export class BrowserToolHandlers {
  // Core dependencies
  private collector: CodeCollector;
  private pageController: PageController;
  private domInspector: DOMInspector;
  private scriptManager: ScriptManager;
  private consoleMonitor: ConsoleMonitor;
  private captchaDetector: AICaptchaDetector;
  private detailedDataManager: DetailedDataManager;
  private camoufoxManager: CamoufoxBrowserManager | null = null;

  // State
  private activeDriver: 'chrome' | 'camoufox' = 'chrome';
  private camoufoxPage: any = null;
  private autoDetectCaptcha: boolean = true;
  private autoSwitchHeadless: boolean = true;
  private captchaTimeout: number = 300000;

  // Handler modules
  private browserControl: BrowserControlHandlers;
  private camoufoxBrowser: CamoufoxBrowserHandlers;
  private pageNavigation: PageNavigationHandlers;
  private pageInteraction: PageInteractionHandlers;
  private pageEvaluation: PageEvaluationHandlers;
  private pageData: PageDataHandlers;
  private domQuery: DOMQueryHandlers;
  private domStyle: DOMStyleHandlers;
  private domSearch: DOMSearchHandlers;
  private consoleHandlers: ConsoleHandlers;
  private scriptManagement: ScriptManagementHandlers;
  private captchaHandlers: CaptchaHandlers;
  private stealthInjection: StealthInjectionHandlers;
  private frameworkState: FrameworkStateHandlers;
  private indexedDBDump: IndexedDBDumpHandlers;
  private detailedData: DetailedDataHandlers;

  constructor(
    collector: CodeCollector,
    pageController: PageController,
    domInspector: DOMInspector,
    scriptManager: ScriptManager,
    consoleMonitor: ConsoleMonitor,
    llmService: LLMService
  ) {
    this.collector = collector;
    this.pageController = pageController;
    this.domInspector = domInspector;
    this.scriptManager = scriptManager;
    this.consoleMonitor = consoleMonitor;

    const screenshotDir = resolveOutputDirectory(
      process.env.CAPTCHA_SCREENSHOT_DIR,
      'screenshots/captcha'
    );
    this.captchaDetector = new AICaptchaDetector(llmService, screenshotDir);
    this.detailedDataManager = DetailedDataManager.getInstance();

    // Initialize handler modules with dependencies
    const commonDeps = {
      getActiveDriver: () => this.activeDriver,
      getCamoufoxPage: () => this.getCamoufoxPage(),
    };

    this.browserControl = new BrowserControlHandlers({
      collector: this.collector,
      pageController: this.pageController,
      consoleMonitor: this.consoleMonitor,
      getActiveDriver: () => this.activeDriver,
      getCamoufoxManager: () => this.camoufoxManager,
      getCamoufoxPage: () => this.getCamoufoxPage(),
    });

    this.camoufoxBrowser = new CamoufoxBrowserHandlers({
      getCamoufoxManager: () => this.camoufoxManager,
      setCamoufoxManager: (m) => { this.camoufoxManager = m; },
      closeCamoufox: () => this.closeCamoufox(),
    });

    this.pageNavigation = new PageNavigationHandlers({
      pageController: this.pageController,
      consoleMonitor: this.consoleMonitor,
      ...commonDeps,
    });

    this.pageInteraction = new PageInteractionHandlers({
      pageController: this.pageController,
      ...commonDeps,
    });

    this.pageEvaluation = new PageEvaluationHandlers({
      pageController: this.pageController,
      detailedDataManager: this.detailedDataManager,
      ...commonDeps,
    });

    this.pageData = new PageDataHandlers({
      pageController: this.pageController,
      ...commonDeps,
    });

    this.domQuery = new DOMQueryHandlers({
      domInspector: this.domInspector,
    });

    this.domStyle = new DOMStyleHandlers({
      domInspector: this.domInspector,
    });

    this.domSearch = new DOMSearchHandlers({
      domInspector: this.domInspector,
    });

    this.consoleHandlers = new ConsoleHandlers({
      consoleMonitor: this.consoleMonitor,
      detailedDataManager: this.detailedDataManager,
    });

    this.scriptManagement = new ScriptManagementHandlers({
      scriptManager: this.scriptManager,
      detailedDataManager: this.detailedDataManager,
    });

    this.captchaHandlers = new CaptchaHandlers({
      pageController: this.pageController,
      captchaDetector: this.captchaDetector,
      autoDetectCaptcha: this.autoDetectCaptcha,
      autoSwitchHeadless: this.autoSwitchHeadless,
      captchaTimeout: this.captchaTimeout,
      setAutoDetectCaptcha: (v) => { this.autoDetectCaptcha = v; },
      setAutoSwitchHeadless: (v) => { this.autoSwitchHeadless = v; },
      setCaptchaTimeout: (v) => { this.captchaTimeout = v; },
    });

    this.stealthInjection = new StealthInjectionHandlers({
      pageController: this.pageController,
      ...commonDeps,
    });

    this.frameworkState = new FrameworkStateHandlers({
      getActivePage: () => this.collector.getActivePage(),
    });

    this.indexedDBDump = new IndexedDBDumpHandlers({
      getActivePage: () => this.collector.getActivePage(),
    });

    this.detailedData = new DetailedDataHandlers({
      detailedDataManager: this.detailedDataManager,
    });
  }

  /** Get or create camoufox page (Playwright Page). */
  private async getCamoufoxPage(): Promise<any> {
    if (!this.camoufoxManager) {
      throw new Error('Camoufox browser not launched. Call browser_launch(driver="camoufox") first.');
    }
    if (!this.camoufoxPage) {
      this.camoufoxPage = await this.camoufoxManager.newPage();
    }
    return this.camoufoxPage;
  }

  private async closeCamoufox(): Promise<void> {
    if (this.camoufoxManager) {
      await this.camoufoxManager.close();
      this.camoufoxManager = null;
      this.camoufoxPage = null;
    }
  }

  // ============ Browser Control ============
  async handleBrowserLaunch(args: Record<string, unknown>) {
    const driver = (args.driver as string) || 'chrome';

    if (driver === 'camoufox') {
      return this.handleCamoufoxLaunch(args);
    }

    if (this.activeDriver === 'camoufox' && this.camoufoxManager) {
      await this.closeCamoufox();
    }
    this.activeDriver = 'chrome';

    return this.browserControl.handleBrowserLaunch(args);
  }

  async handleBrowserClose(args: Record<string, unknown>) {
    if (this.activeDriver === 'camoufox' && this.camoufoxManager) {
      await this.closeCamoufox();
      this.activeDriver = 'chrome';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, message: 'Camoufox browser closed' }, null, 2),
        }],
      };
    }
    return this.browserControl.handleBrowserClose(args);
  }

  async handleBrowserStatus(args: Record<string, unknown>) {
    if (this.activeDriver === 'camoufox') {
      const running = !!(this.camoufoxManager?.getBrowser());
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            driver: 'camoufox',
            running,
            hasActivePage: !!this.camoufoxPage,
          }, null, 2),
        }],
      };
    }
    return this.browserControl.handleBrowserStatus(args);
  }

  async handleBrowserListTabs(args: Record<string, unknown>) {
    return this.browserControl.handleBrowserListTabs(args);
  }

  async handleBrowserSelectTab(args: Record<string, unknown>) {
    return this.browserControl.handleBrowserSelectTab(args);
  }

  async handleBrowserAttach(args: Record<string, unknown>) {
    if (this.activeDriver === 'camoufox' && this.camoufoxManager) {
      await this.closeCamoufox();
    }
    this.activeDriver = 'chrome';
    return this.browserControl.handleBrowserAttach(args);
  }

  // ============ Camoufox Server ============
  async handleCamoufoxServerLaunch(args: Record<string, unknown>) {
    return this.camoufoxBrowser.handleCamoufoxServerLaunch(args);
  }

  async handleCamoufoxServerClose(args: Record<string, unknown>) {
    return this.camoufoxBrowser.handleCamoufoxServerClose(args);
  }

  async handleCamoufoxServerStatus(args: Record<string, unknown>) {
    return this.camoufoxBrowser.handleCamoufoxServerStatus(args);
  }

  // ============ Page Navigation ============
  async handlePageNavigate(args: Record<string, unknown>) {
    if (this.activeDriver === 'camoufox') {
      return this.handleCamoufoxNavigate(args);
    }
    return this.pageNavigation.handlePageNavigate(args);
  }

  async handlePageReload(args: Record<string, unknown>) {
    return this.pageNavigation.handlePageReload(args);
  }

  async handlePageBack(args: Record<string, unknown>) {
    return this.pageNavigation.handlePageBack(args);
  }

  async handlePageForward(args: Record<string, unknown>) {
    return this.pageNavigation.handlePageForward(args);
  }

  // ============ Page Interaction ============
  async handlePageClick(args: Record<string, unknown>) {
    return this.pageInteraction.handlePageClick(args);
  }

  async handlePageType(args: Record<string, unknown>) {
    return this.pageInteraction.handlePageType(args);
  }

  async handlePageSelect(args: Record<string, unknown>) {
    return this.pageInteraction.handlePageSelect(args);
  }

  async handlePageHover(args: Record<string, unknown>) {
    return this.pageInteraction.handlePageHover(args);
  }

  async handlePageScroll(args: Record<string, unknown>) {
    return this.pageInteraction.handlePageScroll(args);
  }

  async handlePagePressKey(args: Record<string, unknown>) {
    return this.pageInteraction.handlePagePressKey(args);
  }

  // ============ Page Evaluation ============
  async handlePageEvaluate(args: Record<string, unknown>) {
    return this.pageEvaluation.handlePageEvaluate(args);
  }

  async handlePageScreenshot(args: Record<string, unknown>) {
    return this.pageEvaluation.handlePageScreenshot(args);
  }

  async handlePageInjectScript(args: Record<string, unknown>) {
    return this.pageEvaluation.handlePageInjectScript(args);
  }

  async handlePageWaitForSelector(args: Record<string, unknown>) {
    return this.pageEvaluation.handlePageWaitForSelector(args);
  }

  // ============ Page Data ============
  async handlePageGetPerformance(args: Record<string, unknown>) {
    return this.pageData.handlePageGetPerformance(args);
  }

  async handlePageSetCookies(args: Record<string, unknown>) {
    return this.pageData.handlePageSetCookies(args);
  }

  async handlePageGetCookies(args: Record<string, unknown>) {
    return this.pageData.handlePageGetCookies(args);
  }

  async handlePageClearCookies(args: Record<string, unknown>) {
    return this.pageData.handlePageClearCookies(args);
  }

  async handlePageSetViewport(args: Record<string, unknown>) {
    return this.pageData.handlePageSetViewport(args);
  }

  async handlePageEmulateDevice(args: Record<string, unknown>) {
    return this.pageData.handlePageEmulateDevice(args);
  }

  async handlePageGetLocalStorage(args: Record<string, unknown>) {
    return this.pageData.handlePageGetLocalStorage(args);
  }

  async handlePageSetLocalStorage(args: Record<string, unknown>) {
    return this.pageData.handlePageSetLocalStorage(args);
  }

  async handlePageGetAllLinks(args: Record<string, unknown>) {
    return this.pageData.handlePageGetAllLinks(args);
  }

  // ============ DOM Query ============
  async handleDOMQuerySelector(args: Record<string, unknown>) {
    return this.domQuery.handleDOMQuerySelector(args);
  }

  async handleDOMQueryAll(args: Record<string, unknown>) {
    return this.domQuery.handleDOMQueryAll(args);
  }

  async handleDOMGetStructure(args: Record<string, unknown>) {
    const structure = await this.domInspector.getStructure(
      (args.maxDepth as number) ?? 3,
      (args.includeText as boolean) ?? true
    );
    const processedStructure = this.detailedDataManager.smartHandle(structure, 51200);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(processedStructure, null, 2),
      }],
    };
  }

  async handleDOMFindClickable(args: Record<string, unknown>) {
    return this.domQuery.handleDOMFindClickable(args);
  }

  // ============ DOM Style ============
  async handleDOMGetComputedStyle(args: Record<string, unknown>) {
    return this.domStyle.handleDOMGetComputedStyle(args);
  }

  async handleDOMIsInViewport(args: Record<string, unknown>) {
    return this.domStyle.handleDOMIsInViewport(args);
  }

  // ============ DOM Search ============
  async handleDOMFindByText(args: Record<string, unknown>) {
    return this.domSearch.handleDOMFindByText(args);
  }

  async handleDOMGetXPath(args: Record<string, unknown>) {
    return this.domSearch.handleDOMGetXPath(args);
  }

  // ============ Console ============
  async handleConsoleEnable(args: Record<string, unknown>) {
    return this.consoleHandlers.handleConsoleEnable(args);
  }

  async handleConsoleGetLogs(args: Record<string, unknown>) {
    return this.consoleHandlers.handleConsoleGetLogs(args);
  }

  async handleConsoleExecute(args: Record<string, unknown>) {
    return this.consoleHandlers.handleConsoleExecute(args);
  }

  // ============ Script Management ============
  async handleGetAllScripts(args: Record<string, unknown>) {
    return this.scriptManagement.handleGetAllScripts(args);
  }

  async handleGetScriptSource(args: Record<string, unknown>) {
    return this.scriptManagement.handleGetScriptSource(args);
  }

  // ============ CAPTCHA ============
  async handleCaptchaDetect(args: Record<string, unknown>) {
    return this.captchaHandlers.handleCaptchaDetect(args);
  }

  async handleCaptchaWait(args: Record<string, unknown>) {
    return this.captchaHandlers.handleCaptchaWait(args);
  }

  async handleCaptchaConfig(args: Record<string, unknown>) {
    return this.captchaHandlers.handleCaptchaConfig(args);
  }

  // ============ Stealth ============
  async handleStealthInject(args: Record<string, unknown>) {
    return this.stealthInjection.handleStealthInject(args);
  }

  async handleStealthSetUserAgent(args: Record<string, unknown>) {
    return this.stealthInjection.handleStealthSetUserAgent(args);
  }

  // ============ Framework State ============
  async handleFrameworkStateExtract(args: Record<string, unknown>) {
    return this.frameworkState.handleFrameworkStateExtract(args);
  }

  // ============ IndexedDB ============
  async handleIndexedDBDump(args: Record<string, unknown>) {
    return this.indexedDBDump.handleIndexedDBDump(args);
  }

  // ============ Detailed Data ============
  async handleGetDetailedData(args: Record<string, unknown>) {
    return this.detailedData.handleGetDetailedData(args);
  }

  // ============ Helper Methods for Camoufox ============
  private async handleCamoufoxLaunch(args: Record<string, unknown>) {
    const headless = (args.headless as boolean) ?? true;
    const os = (args.os as 'windows' | 'macos' | 'linux') ?? 'windows';
    const mode = (args.mode as string) ?? 'launch';

    if (mode === 'connect') {
      const wsEndpoint = args.wsEndpoint as string | undefined;
      if (!wsEndpoint) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'wsEndpoint is required for connect mode.',
            }, null, 2),
          }],
        };
      }
      this.camoufoxManager = new CamoufoxBrowserManager({ headless, os });
      await this.camoufoxManager.connectToServer(wsEndpoint);
      this.activeDriver = 'camoufox';
      this.camoufoxPage = null;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            driver: 'camoufox',
            mode: 'connect',
            wsEndpoint,
            message: 'Connected to Camoufox server.',
          }, null, 2),
        }],
      };
    }

    this.camoufoxManager = new CamoufoxBrowserManager({ headless, os });
    await this.camoufoxManager.launch();
    this.activeDriver = 'camoufox';
    this.camoufoxPage = null;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          driver: 'camoufox',
          mode: 'launch',
          message: 'Camoufox (Firefox) browser launched',
        }, null, 2),
      }],
    };
  }

  private async handleCamoufoxNavigate(args: Record<string, unknown>) {
    const url = args.url as string;
    const rawWaitUntil = (args.waitUntil as string) || 'networkidle';
    const timeout = args.timeout as number | undefined;

    const playwrightWaitUntil = (rawWaitUntil === 'networkidle2' ? 'networkidle' : rawWaitUntil) as any;
    const page = await this.getCamoufoxPage();
    await page.goto(url, { waitUntil: playwrightWaitUntil, timeout });

    this.consoleMonitor.setPlaywrightPage(page);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          driver: 'camoufox',
          captcha_detected: false,
          url: page.url(),
          title: await page.title(),
        }, null, 2),
      }],
    };
  }
}

// Re-export handler classes for direct access if needed
export {
  BrowserControlHandlers,
  CamoufoxBrowserHandlers,
  PageNavigationHandlers,
  PageInteractionHandlers,
  PageEvaluationHandlers,
  PageDataHandlers,
  DOMQueryHandlers,
  DOMStyleHandlers,
  DOMSearchHandlers,
  ConsoleHandlers,
  ScriptManagementHandlers,
  CaptchaHandlers,
  StealthInjectionHandlers,
  FrameworkStateHandlers,
  IndexedDBDumpHandlers,
  DetailedDataHandlers,
};
