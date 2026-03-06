// Browser tool facade that composes focused handler modules and routes calls.

import type { CodeCollector } from '@server/domains/shared/modules';
import type { PageController } from '@server/domains/shared/modules';
import type { DOMInspector } from '@server/domains/shared/modules';
import type { ScriptManager } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import { AICaptchaDetector } from '@server/domains/shared/modules';
import { LLMService } from '@services/LLMService';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { resolveOutputDirectory } from '@utils/outputPaths';
import { CamoufoxBrowserManager } from '@server/domains/shared/modules';

// Import handler modules
import { BrowserControlHandlers } from '@server/domains/browser/handlers/browser-control';
import { CamoufoxBrowserHandlers } from '@server/domains/browser/handlers/camoufox-browser';
import { PageNavigationHandlers } from '@server/domains/browser/handlers/page-navigation';
import { PageInteractionHandlers } from '@server/domains/browser/handlers/page-interaction';
import { PageEvaluationHandlers } from '@server/domains/browser/handlers/page-evaluation';
import { PageDataHandlers } from '@server/domains/browser/handlers/page-data';
import { DOMQueryHandlers } from '@server/domains/browser/handlers/dom-query';
import { DOMStyleHandlers } from '@server/domains/browser/handlers/dom-style';
import { DOMSearchHandlers } from '@server/domains/browser/handlers/dom-search';
import { ConsoleHandlers } from '@server/domains/browser/handlers/console-handlers';
import { ScriptManagementHandlers } from '@server/domains/browser/handlers/script-management';
import { CaptchaHandlers } from '@server/domains/browser/handlers/captcha-handlers';
import { StealthInjectionHandlers } from '@server/domains/browser/handlers/stealth-injection';
import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';
import { IndexedDBDumpHandlers } from '@server/domains/browser/handlers/indexeddb-dump';
import { DetailedDataHandlers } from '@server/domains/browser/handlers/detailed-data';
import { JSHeapSearchHandlers } from '@server/domains/browser/handlers/js-heap';
import { TabWorkflowHandlers } from '@server/domains/browser/handlers/tab-workflow';
import { initializeBrowserHandlerModules } from '@server/domains/browser/handlers/facade-initializer';
import type { TabRegistry } from '@modules/browser/TabRegistry';
import {
  handleHumanMouse,
  handleHumanScroll,
  handleHumanTyping,
} from '@server/domains/browser/handlers/human-behavior';
import {
  handleCaptchaVisionSolve,
  handleTurnstileSolve,
} from '@server/domains/browser/handlers/captcha-solver';
import {
  type CamoufoxPage,
  handleCamoufoxLaunchFlow,
  handleCamoufoxNavigateFlow,
} from '@server/domains/browser/handlers/camoufox-flow';

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
  private camoufoxPage: CamoufoxPage | null = null;
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
  private jsHeapSearch: JSHeapSearchHandlers;
  private tabWorkflow: TabWorkflowHandlers;
  private detailedData: DetailedDataHandlers;
  private _tabRegistry: TabRegistry;

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

    const modules = initializeBrowserHandlerModules({
      collector: this.collector,
      pageController: this.pageController,
      domInspector: this.domInspector,
      scriptManager: this.scriptManager,
      consoleMonitor: this.consoleMonitor,
      captchaDetector: this.captchaDetector,
      detailedDataManager: this.detailedDataManager,
      getActiveDriver: () => this.activeDriver,
      getCamoufoxPage: () => this.getCamoufoxPage(),
      getCamoufoxManager: () => this.camoufoxManager,
      setCamoufoxManager: (manager) => {
        this.camoufoxManager = manager;
      },
      closeCamoufox: () => this.closeCamoufox(),
      getAutoDetectCaptcha: () => this.autoDetectCaptcha,
      getAutoSwitchHeadless: () => this.autoSwitchHeadless,
      getCaptchaTimeout: () => this.captchaTimeout,
      setAutoDetectCaptcha: (value) => {
        this.autoDetectCaptcha = value;
      },
      setAutoSwitchHeadless: (value) => {
        this.autoSwitchHeadless = value;
      },
      setCaptchaTimeout: (value) => {
        this.captchaTimeout = value;
      },
    });

    this.browserControl = modules.browserControl;
    this.camoufoxBrowser = modules.camoufoxBrowser;
    this.pageNavigation = modules.pageNavigation;
    this.pageInteraction = modules.pageInteraction;
    this.pageEvaluation = modules.pageEvaluation;
    this.pageData = modules.pageData;
    this.domQuery = modules.domQuery;
    this.domStyle = modules.domStyle;
    this.domSearch = modules.domSearch;
    this.consoleHandlers = modules.consoleHandlers;
    this.scriptManagement = modules.scriptManagement;
    this.captchaHandlers = modules.captchaHandlers;
    this.stealthInjection = modules.stealthInjection;
    this.frameworkState = modules.frameworkState;
    this.indexedDBDump = modules.indexedDBDump;
    this.jsHeapSearch = modules.jsHeapSearch;
    this.tabWorkflow = modules.tabWorkflow;
    this.detailedData = modules.detailedData;
    this._tabRegistry = modules.tabRegistry;
  }

  /** Get the shared TabRegistry for context enrichment. */
  getTabRegistry(): TabRegistry {
    return this._tabRegistry;
  }

  /** Get or create camoufox page (Playwright Page). */
  private async getCamoufoxPage(): Promise<CamoufoxPage> {
    if (!this.camoufoxManager) {
      throw new Error('Camoufox browser not launched. Call browser_launch(driver="camoufox") first.');
    }
    if (!this.camoufoxPage) {
      this.camoufoxPage = (await this.camoufoxManager.newPage()) as CamoufoxPage;
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

  // ============ JS Heap Search ============
  async handleJSHeapSearch(args: Record<string, unknown>) {
    return this.jsHeapSearch.handleJSHeapSearch(args);
  }

  // ============ Tab Workflow ============
  async handleTabWorkflow(args: Record<string, unknown>) {
    return this.tabWorkflow.handleTabWorkflow(args);
  }

  // ============ Detailed Data ============
  async handleGetDetailedData(args: Record<string, unknown>) {
    return this.detailedData.handleGetDetailedData(args);
  }

  // ============ Helper Methods for Camoufox ============
  private async handleCamoufoxLaunch(args: Record<string, unknown>) {
    return handleCamoufoxLaunchFlow(
      {
        setCamoufoxManager: (manager) => {
          this.camoufoxManager = manager;
        },
        setActiveDriver: (driver) => {
          this.activeDriver = driver;
        },
        clearCamoufoxPage: () => {
          this.camoufoxPage = null;
        },
      },
      args
    );
  }

  private async handleCamoufoxNavigate(args: Record<string, unknown>) {
    return handleCamoufoxNavigateFlow(
      {
        getCamoufoxPage: () => this.getCamoufoxPage(),
        setConsoleMonitorPage: (page) => {
          this.consoleMonitor.setPlaywrightPage(page);
        },
      },
      args
    );
  }

  // ============ Human Behavior Simulation ============
  async handleHumanMouse(args: Record<string, unknown>) {
    return handleHumanMouse(args, this.collector);
  }

  async handleHumanScroll(args: Record<string, unknown>) {
    return handleHumanScroll(args, this.collector);
  }

  async handleHumanTyping(args: Record<string, unknown>) {
    return handleHumanTyping(args, this.collector);
  }

  // ============ CAPTCHA Solving ============
  async handleCaptchaVisionSolve(args: Record<string, unknown>) {
    return handleCaptchaVisionSolve(args, this.collector);
  }

  async handleTurnstileSolve(args: Record<string, unknown>) {
    return handleTurnstileSolve(args, this.collector);
  }
}

// Re-export handler classes for direct access if needed
export { BrowserControlHandlers, CamoufoxBrowserHandlers, PageNavigationHandlers, PageInteractionHandlers, PageEvaluationHandlers, PageDataHandlers, DOMQueryHandlers, DOMStyleHandlers, DOMSearchHandlers, ConsoleHandlers, ScriptManagementHandlers, CaptchaHandlers, StealthInjectionHandlers, FrameworkStateHandlers, IndexedDBDumpHandlers, DetailedDataHandlers };
