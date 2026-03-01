import type { CodeCollector } from '../../../../modules/collector/CodeCollector.js';
import type { PageController } from '../../../../modules/collector/PageController.js';
import type { DOMInspector } from '../../../../modules/collector/DOMInspector.js';
import type { ScriptManager } from '../../../../modules/debugger/ScriptManager.js';
import type { ConsoleMonitor } from '../../../../modules/monitor/ConsoleMonitor.js';
import { AICaptchaDetector } from '../../../../modules/captcha/AICaptchaDetector.js';
import { DetailedDataManager } from '../../../../utils/DetailedDataManager.js';
import { CamoufoxBrowserManager } from '../../../../modules/browser/CamoufoxBrowserManager.js';
import { BrowserControlHandlers } from './browser-control.js';
import { CamoufoxBrowserHandlers } from './camoufox-browser.js';
import { PageNavigationHandlers } from './page-navigation.js';
import { PageInteractionHandlers } from './page-interaction.js';
import { PageEvaluationHandlers } from './page-evaluation.js';
import { PageDataHandlers } from './page-data.js';
import { DOMQueryHandlers } from './dom-query.js';
import { DOMStyleHandlers } from './dom-style.js';
import { DOMSearchHandlers } from './dom-search.js';
import { ConsoleHandlers } from './console-handlers.js';
import { ScriptManagementHandlers } from './script-management.js';
import { CaptchaHandlers } from './captcha-handlers.js';
import { StealthInjectionHandlers } from './stealth-injection.js';
import { FrameworkStateHandlers } from './framework-state.js';
import { IndexedDBDumpHandlers } from './indexeddb-dump.js';
import { JSHeapSearchHandlers } from './js-heap.js';
import { TabWorkflowHandlers } from './tab-workflow.js';
import { DetailedDataHandlers } from './detailed-data.js';

export interface BrowserHandlerModuleInitDeps {
  collector: CodeCollector;
  pageController: PageController;
  domInspector: DOMInspector;
  scriptManager: ScriptManager;
  consoleMonitor: ConsoleMonitor;
  captchaDetector: AICaptchaDetector;
  detailedDataManager: DetailedDataManager;
  getActiveDriver: () => 'chrome' | 'camoufox';
  getCamoufoxPage: () => Promise<unknown>;
  getCamoufoxManager: () => CamoufoxBrowserManager | null;
  setCamoufoxManager: (manager: CamoufoxBrowserManager | null) => void;
  closeCamoufox: () => Promise<void>;
  getAutoDetectCaptcha: () => boolean;
  getAutoSwitchHeadless: () => boolean;
  getCaptchaTimeout: () => number;
  setAutoDetectCaptcha: (value: boolean) => void;
  setAutoSwitchHeadless: (value: boolean) => void;
  setCaptchaTimeout: (value: number) => void;
}

export interface BrowserHandlerModules {
  browserControl: BrowserControlHandlers;
  camoufoxBrowser: CamoufoxBrowserHandlers;
  pageNavigation: PageNavigationHandlers;
  pageInteraction: PageInteractionHandlers;
  pageEvaluation: PageEvaluationHandlers;
  pageData: PageDataHandlers;
  domQuery: DOMQueryHandlers;
  domStyle: DOMStyleHandlers;
  domSearch: DOMSearchHandlers;
  consoleHandlers: ConsoleHandlers;
  scriptManagement: ScriptManagementHandlers;
  captchaHandlers: CaptchaHandlers;
  stealthInjection: StealthInjectionHandlers;
  frameworkState: FrameworkStateHandlers;
  indexedDBDump: IndexedDBDumpHandlers;
  jsHeapSearch: JSHeapSearchHandlers;
  tabWorkflow: TabWorkflowHandlers;
  detailedData: DetailedDataHandlers;
}

export function initializeBrowserHandlerModules(
  deps: BrowserHandlerModuleInitDeps
): BrowserHandlerModules {
  const commonDeps = {
    getActiveDriver: deps.getActiveDriver,
    getCamoufoxPage: deps.getCamoufoxPage,
  };

  return {
    browserControl: new BrowserControlHandlers({
      collector: deps.collector,
      pageController: deps.pageController,
      consoleMonitor: deps.consoleMonitor,
      getActiveDriver: deps.getActiveDriver,
      getCamoufoxManager: deps.getCamoufoxManager,
      getCamoufoxPage: deps.getCamoufoxPage,
    }),

    camoufoxBrowser: new CamoufoxBrowserHandlers({
      getCamoufoxManager: deps.getCamoufoxManager,
      setCamoufoxManager: deps.setCamoufoxManager,
      closeCamoufox: deps.closeCamoufox,
    }),

    pageNavigation: new PageNavigationHandlers({
      pageController: deps.pageController,
      consoleMonitor: deps.consoleMonitor,
      ...commonDeps,
    }),

    pageInteraction: new PageInteractionHandlers({
      pageController: deps.pageController,
      ...commonDeps,
    }),

    pageEvaluation: new PageEvaluationHandlers({
      pageController: deps.pageController,
      detailedDataManager: deps.detailedDataManager,
      ...commonDeps,
    }),

    pageData: new PageDataHandlers({
      pageController: deps.pageController,
      ...commonDeps,
    }),

    domQuery: new DOMQueryHandlers({
      domInspector: deps.domInspector,
    }),

    domStyle: new DOMStyleHandlers({
      domInspector: deps.domInspector,
    }),

    domSearch: new DOMSearchHandlers({
      domInspector: deps.domInspector,
    }),

    consoleHandlers: new ConsoleHandlers({
      consoleMonitor: deps.consoleMonitor,
      detailedDataManager: deps.detailedDataManager,
    }),

    scriptManagement: new ScriptManagementHandlers({
      scriptManager: deps.scriptManager,
      detailedDataManager: deps.detailedDataManager,
    }),

    captchaHandlers: new CaptchaHandlers({
      pageController: deps.pageController,
      captchaDetector: deps.captchaDetector,
      autoDetectCaptcha: deps.getAutoDetectCaptcha(),
      autoSwitchHeadless: deps.getAutoSwitchHeadless(),
      captchaTimeout: deps.getCaptchaTimeout(),
      setAutoDetectCaptcha: deps.setAutoDetectCaptcha,
      setAutoSwitchHeadless: deps.setAutoSwitchHeadless,
      setCaptchaTimeout: deps.setCaptchaTimeout,
    }),

    stealthInjection: new StealthInjectionHandlers({
      pageController: deps.pageController,
      ...commonDeps,
    }),

    frameworkState: new FrameworkStateHandlers({
      getActivePage: () => deps.collector.getActivePage(),
    }),

    indexedDBDump: new IndexedDBDumpHandlers({
      getActivePage: () => deps.collector.getActivePage(),
    }),

    jsHeapSearch: new JSHeapSearchHandlers({
      getActivePage: () => deps.collector.getActivePage(),
      getActiveDriver: deps.getActiveDriver,
    }),

    tabWorkflow: new TabWorkflowHandlers({
      getActiveDriver: deps.getActiveDriver,
      getCamoufoxPage: deps.getCamoufoxPage,
      getPageController: () => deps.pageController,
    }),

    detailedData: new DetailedDataHandlers({
      detailedDataManager: deps.detailedDataManager,
    }),
  };
}
