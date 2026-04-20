// Browser tool facade: composes handler modules and routes calls.

import type { CodeCollector } from '@server/domains/shared/modules';
import type { PageController } from '@server/domains/shared/modules';

import type { ScriptManager } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import { AICaptchaDetector } from '@server/domains/shared/modules';
import { argString } from '@server/domains/shared/parse-args';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { getConfig } from '@utils/config';
import { resolveOutputDirectory } from '@utils/outputPaths';
import { logger } from '@utils/logger';
import { type CamoufoxBrowserManager } from '@server/domains/shared/modules';
import type { EventBus, ServerEventMap } from '@server/EventBus';

import { BrowserControlHandlers } from '@server/domains/browser/handlers/browser-control';
import { CamoufoxBrowserHandlers } from '@server/domains/browser/handlers/camoufox-browser';
import { PageNavigationHandlers } from '@server/domains/browser/handlers/page-navigation';
import { PageInteractionHandlers } from '@server/domains/browser/handlers/page-interaction';
import { PageEvaluationHandlers } from '@server/domains/browser/handlers/page-evaluation';
import { PageDataHandlers } from '@server/domains/browser/handlers/page-data';

import { ConsoleHandlers } from '@server/domains/browser/handlers/console-handlers';
import { ScriptManagementHandlers } from '@server/domains/browser/handlers/script-management';
import { CaptchaHandlers } from '@server/domains/browser/handlers/captcha-handlers';
import { StealthInjectionHandlers } from '@server/domains/browser/handlers/stealth-injection';
import { FrameworkStateHandlers } from '@server/domains/browser/handlers/framework-state';
import { IndexedDBDumpHandlers } from '@server/domains/browser/handlers/indexeddb-dump';
import { DetailedDataHandlers } from '@server/domains/browser/handlers/detailed-data';
import { TargetEvaluationHandlers } from '@server/domains/browser/handlers/target-evaluation';
import { TargetControlHandlers } from '@server/domains/browser/handlers/target-control';
import { type JSHeapSearchHandlers } from '@server/domains/browser/handlers/js-heap';
import { type TabWorkflowHandlers } from '@server/domains/browser/handlers/tab-workflow';
import { type JsdomHandlers } from '@server/domains/browser/handlers/jsdom-tools';
import { initializeBrowserHandlerModules } from '@server/domains/browser/handlers/facade-initializer';
import type { TabRegistry } from '@modules/browser/TabRegistry';
import {
  handleHumanMouse,
  handleHumanScroll,
  handleHumanTyping,
} from '@server/domains/browser/handlers/human-behavior';
import {
  handleCaptchaVisionSolve,
  handleWidgetChallengeSolve,
} from '@server/domains/browser/handlers/captcha-solver';
import {
  type CamoufoxPage,
  handleCamoufoxLaunchFlow,
  handleCamoufoxNavigateFlow,
} from '@server/domains/browser/handlers/camoufox-flow';

export class BrowserToolHandlers {
  protected collector: CodeCollector;
  protected pageController: PageController;

  protected scriptManager: ScriptManager;
  protected consoleMonitor: ConsoleMonitor;
  protected captchaDetector: AICaptchaDetector;
  protected detailedDataManager: DetailedDataManager;
  protected camoufoxManager: CamoufoxBrowserManager | null = null;

  protected activeDriver: 'chrome' | 'camoufox' = 'chrome';
  protected camoufoxPage: CamoufoxPage | null = null;
  private autoDetectCaptcha: boolean = true;
  private autoSwitchHeadless: boolean = true;
  private captchaTimeout: number = 300000;

  private browserControl: BrowserControlHandlers;
  private targetControl: TargetControlHandlers;
  private camoufoxBrowser: CamoufoxBrowserHandlers;
  private pageNavigation: PageNavigationHandlers;
  private pageInteraction: PageInteractionHandlers;
  private pageEvaluation: PageEvaluationHandlers;
  private targetEvaluation: TargetEvaluationHandlers;
  private pageData: PageDataHandlers;

  private consoleHandlers: ConsoleHandlers;
  private scriptManagement: ScriptManagementHandlers;
  private captchaHandlers: CaptchaHandlers;
  private stealthInjection: StealthInjectionHandlers;
  private frameworkState: FrameworkStateHandlers;
  private indexedDBDump: IndexedDBDumpHandlers;
  private jsHeapSearch: JSHeapSearchHandlers;
  private tabWorkflow: TabWorkflowHandlers;
  private detailedData: DetailedDataHandlers;
  private jsdomHandlers: JsdomHandlers;
  private _tabRegistry: TabRegistry;

  constructor(
    collector: CodeCollector,
    pageController: PageController,

    scriptManager: ScriptManager,
    consoleMonitor: ConsoleMonitor,
    eventBus?: EventBus<ServerEventMap>,
  ) {
    this.collector = collector;
    this.pageController = pageController;

    this.scriptManager = scriptManager;
    this.consoleMonitor = consoleMonitor;

    const screenshotDir = resolveOutputDirectory(
      getConfig().paths.captchaScreenshotDir,
      'screenshots/captcha',
    );
    this.captchaDetector = new AICaptchaDetector(screenshotDir);
    this.detailedDataManager = DetailedDataManager.getInstance();

    const modules = initializeBrowserHandlerModules({
      collector: this.collector,
      pageController: this.pageController,

      scriptManager: this.scriptManager,
      consoleMonitor: this.consoleMonitor,
      eventBus,
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
    this.targetControl = modules.targetControl;
    this.camoufoxBrowser = modules.camoufoxBrowser;
    this.pageNavigation = modules.pageNavigation;
    this.pageInteraction = modules.pageInteraction;
    this.pageEvaluation = modules.pageEvaluation;
    this.targetEvaluation = modules.targetEvaluation;
    this.pageData = modules.pageData;

    this.consoleHandlers = modules.consoleHandlers;
    this.scriptManagement = modules.scriptManagement;
    this.captchaHandlers = modules.captchaHandlers;
    this.stealthInjection = modules.stealthInjection;
    this.frameworkState = modules.frameworkState;
    this.indexedDBDump = modules.indexedDBDump;
    this.jsHeapSearch = modules.jsHeapSearch;
    this.tabWorkflow = modules.tabWorkflow;
    this.detailedData = modules.detailedData;
    this.jsdomHandlers = modules.jsdomHandlers;
    this._tabRegistry = modules.tabRegistry;
  }

  /** Get the shared TabRegistry for context enrichment. */
  getTabRegistry(): TabRegistry {
    return this._tabRegistry;
  }

  /** Get or create camoufox page (Playwright Page). */
  private async getCamoufoxPage(): Promise<CamoufoxPage> {
    if (!this.camoufoxManager) {
      throw new Error(
        'Camoufox browser not launched. Call browser_launch(driver="camoufox") first.',
      );
    }
    if (!this.camoufoxPage) {
      this.camoufoxPage = (await this.camoufoxManager.newPage()) as CamoufoxPage;
    }
    return this.camoufoxPage;
  }

  private async closeCamoufox(): Promise<void> {
    try {
      await this.consoleMonitor.disable();
    } catch (error) {
      logger.warn(`Failed to reset console monitor before closing Camoufox: ${String(error)}`);
    }
    this.consoleMonitor.clearPlaywrightPage();

    if (this.camoufoxManager) {
      await this.camoufoxManager.close();
      this.camoufoxManager = null;
      this.camoufoxPage = null;
    }
  }

  // ── Browser Control ──
  async handleBrowserLaunch(args: Record<string, unknown>) {
    const driver = argString(args, 'driver', 'chrome');

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
      await this.browserControl.handleBrowserClose(args);
      this.activeDriver = 'chrome';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Camoufox browser closed' }, null, 2),
          },
        ],
      };
    }
    return this.browserControl.handleBrowserClose(args);
  }

  async handleBrowserStatus(args: Record<string, unknown>) {
    if (this.activeDriver === 'camoufox') {
      const running = !!this.camoufoxManager?.getBrowser();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                driver: 'camoufox',
                running,
                hasActivePage: !!this.camoufoxPage,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    return this.browserControl.handleBrowserStatus(args);
  }

  async handleBrowserListTabs(args: Record<string, unknown>) {
    return this.browserControl.handleBrowserListTabs(args);
  }

  async handleBrowserListCdpTargets(args: Record<string, unknown>) {
    return this.targetControl.handleBrowserListCdpTargets(args);
  }

  async handleBrowserSelectTab(args: Record<string, unknown>) {
    return this.browserControl.handleBrowserSelectTab(args);
  }

  async handleBrowserAttachCdpTarget(args: Record<string, unknown>) {
    return this.targetControl.handleBrowserAttachCdpTarget(args);
  }

  async handleBrowserDetachCdpTarget(args: Record<string, unknown>) {
    return this.targetControl.handleBrowserDetachCdpTarget(args);
  }

  async handleBrowserEvaluateCdpTarget(args: Record<string, unknown>) {
    return this.targetEvaluation.handleBrowserEvaluateCdpTarget(args);
  }

  async handleBrowserAttach(args: Record<string, unknown>) {
    if (this.activeDriver === 'camoufox' && this.camoufoxManager) {
      await this.closeCamoufox();
    }
    this.activeDriver = 'chrome';
    return this.browserControl.handleBrowserAttach(args);
  }

  // ── Camoufox Server ──
  async handleCamoufoxServerDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'close':
        return this.camoufoxBrowser.handleCamoufoxServerClose(args);
      case 'status':
        return this.camoufoxBrowser.handleCamoufoxServerStatus(args);
      default:
        return this.camoufoxBrowser.handleCamoufoxServerLaunch(args);
    }
  }
  async handleCamoufoxServerLaunch(args: Record<string, unknown>) {
    return this.camoufoxBrowser.handleCamoufoxServerLaunch(args);
  }

  async handleCamoufoxServerClose(args: Record<string, unknown>) {
    return this.camoufoxBrowser.handleCamoufoxServerClose(args);
  }

  async handleCamoufoxServerStatus(args: Record<string, unknown>) {
    return this.camoufoxBrowser.handleCamoufoxServerStatus(args);
  }

  // ── Page Navigation ──
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

  // ── Page Interaction ──
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

  // ── Page Evaluation ──
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

  // ── Page Data ──

  async handlePageCookiesDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'get':
        return this.pageData.handlePageGetCookies(args);
      case 'set':
        return this.pageData.handlePageSetCookies(args);
      case 'clear':
        return this.pageData.handlePageClearCookies(args);
      default:
        return {
          content: [
            { type: 'text', text: `Invalid action: "${action}". Expected one of: get, set, clear` },
          ],
          isError: true,
        };
    }
  }

  async handlePageSetViewport(args: Record<string, unknown>) {
    return this.pageData.handlePageSetViewport(args);
  }

  async handlePageEmulateDevice(args: Record<string, unknown>) {
    return this.pageData.handlePageEmulateDevice(args);
  }

  async handlePageLocalStorageDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'get':
        return this.pageData.handlePageGetLocalStorage(args);
      case 'set':
        return this.pageData.handlePageSetLocalStorage(args);
      default:
        return {
          content: [
            { type: 'text', text: `Invalid action: "${action}". Expected one of: get, set` },
          ],
          isError: true,
        };
    }
  }

  // ── Console ──
  async handleConsoleMonitor(args: Record<string, unknown>) {
    return this.consoleHandlers.handleConsoleMonitor(args);
  }

  async handleConsoleGetLogs(args: Record<string, unknown>) {
    return this.consoleHandlers.handleConsoleGetLogs(args);
  }

  async handleConsoleExecute(args: Record<string, unknown>) {
    return this.consoleHandlers.handleConsoleExecute(args);
  }

  // ── Script Management ──
  async handleGetAllScripts(args: Record<string, unknown>) {
    return this.scriptManagement.handleGetAllScripts(args);
  }

  async handleGetScriptSource(args: Record<string, unknown>) {
    return this.scriptManagement.handleGetScriptSource(args);
  }

  // ── CAPTCHA ──
  async handleCaptchaDetect(args: Record<string, unknown>) {
    return this.captchaHandlers.handleCaptchaDetect(args);
  }

  async handleCaptchaWait(args: Record<string, unknown>) {
    return this.captchaHandlers.handleCaptchaWait(args);
  }

  async handleCaptchaConfig(args: Record<string, unknown>) {
    return this.captchaHandlers.handleCaptchaConfig(args);
  }

  // ── Stealth ──
  async handleStealthInject(args: Record<string, unknown>) {
    return this.stealthInjection.handleStealthInject(args);
  }

  async handleStealthSetUserAgent(args: Record<string, unknown>) {
    return this.stealthInjection.handleStealthSetUserAgent(args);
  }

  async handleStealthConfigureJitter(args: Record<string, unknown>) {
    return this.stealthInjection.handleStealthConfigureJitter(args);
  }

  async handleStealthGenerateFingerprint(args: Record<string, unknown>) {
    return this.stealthInjection.handleStealthGenerateFingerprint(args);
  }

  async handleStealthVerify(args: Record<string, unknown>) {
    return this.stealthInjection.handleStealthVerify(args);
  }

  // ── Framework State ──
  async handleFrameworkStateExtract(args: Record<string, unknown>) {
    return this.frameworkState.handleFrameworkStateExtract(args);
  }

  // ── IndexedDB ──
  async handleIndexedDBDump(args: Record<string, unknown>) {
    return this.indexedDBDump.handleIndexedDBDump(args);
  }

  // ── JS Heap Search ──
  async handleJSHeapSearch(args: Record<string, unknown>) {
    return this.jsHeapSearch.handleJSHeapSearch(args);
  }

  // ── Tab Workflow ──
  async handleTabWorkflow(args: Record<string, unknown>) {
    return this.tabWorkflow.handleTabWorkflow(args);
  }

  // ── Detailed Data ──
  async handleGetDetailedData(args: Record<string, unknown>) {
    return this.detailedData.handleGetDetailedData(args);
  }

  // ── Camoufox Helpers ──
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
      args,
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
      args,
    );
  }

  // ── Human Behavior ──
  async handleHumanMouse(args: Record<string, unknown>) {
    return handleHumanMouse(args, this.collector);
  }

  async handleHumanScroll(args: Record<string, unknown>) {
    return handleHumanScroll(args, this.collector);
  }

  async handleHumanTyping(args: Record<string, unknown>) {
    return handleHumanTyping(args, this.collector);
  }

  // ── CAPTCHA Solving ──
  async handleCaptchaVisionSolve(args: Record<string, unknown>) {
    return handleCaptchaVisionSolve(args, this.collector);
  }

  async handleWidgetChallengeSolve(args: Record<string, unknown>) {
    return handleWidgetChallengeSolve(args, this.collector);
  }

  // ── JSDOM (headless DOM, no browser) ──
  async handleJsdomParse(args: Record<string, unknown>) {
    return this.jsdomHandlers.handleJsdomParse(args);
  }

  async handleJsdomQuery(args: Record<string, unknown>) {
    return this.jsdomHandlers.handleJsdomQuery(args);
  }

  async handleJsdomExecute(args: Record<string, unknown>) {
    return this.jsdomHandlers.handleJsdomExecute(args);
  }

  async handleJsdomSerialize(args: Record<string, unknown>) {
    return this.jsdomHandlers.handleJsdomSerialize(args);
  }

  async handleJsdomCookies(args: Record<string, unknown>) {
    return this.jsdomHandlers.handleJsdomCookies(args);
  }
}

// Re-export for direct access
export {
  BrowserControlHandlers,
  CamoufoxBrowserHandlers,
  PageNavigationHandlers,
  PageInteractionHandlers,
  PageEvaluationHandlers,
  PageDataHandlers,
  ConsoleHandlers,
  ScriptManagementHandlers,
  CaptchaHandlers,
  StealthInjectionHandlers,
  FrameworkStateHandlers,
  IndexedDBDumpHandlers,
  DetailedDataHandlers,
};
