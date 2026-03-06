import type { CodeCollector } from '@server/domains/shared/modules';
import type { PageController } from '@server/domains/shared/modules';
import type { DOMInspector } from '@server/domains/shared/modules';
import type { ScriptManager } from '@server/domains/shared/modules';
import type { ConsoleMonitor } from '@server/domains/shared/modules';
import { AICaptchaDetector } from '@server/domains/shared/modules';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { CamoufoxBrowserManager } from '@server/domains/shared/modules';
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
import { JSHeapSearchHandlers } from '@server/domains/browser/handlers/js-heap';
import { TabWorkflowHandlers } from '@server/domains/browser/handlers/tab-workflow';
import { DetailedDataHandlers } from '@server/domains/browser/handlers/detailed-data';
import { TabRegistry } from '@modules/browser/TabRegistry';

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
  tabRegistry: TabRegistry;
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

  const tabRegistry = new TabRegistry();

  return {
    tabRegistry,

    browserControl: new BrowserControlHandlers({
      collector: deps.collector,
      pageController: deps.pageController,
      consoleMonitor: deps.consoleMonitor,
      getActiveDriver: deps.getActiveDriver,
      getCamoufoxManager: deps.getCamoufoxManager,
      getCamoufoxPage: deps.getCamoufoxPage,
      getTabRegistry: () => tabRegistry,
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
      getTabRegistry: () => tabRegistry,
    }),

    detailedData: new DetailedDataHandlers({
      detailedDataManager: deps.detailedDataManager,
    }),
  };
}
