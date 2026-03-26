import type { BrowserStatusResponse } from '@tests/server/domains/shared/common-test-types';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/* ------------------------------------------------------------------ *
 *  Hoisted mocks for every sub-handler module the facade delegates to
 * ------------------------------------------------------------------ */

interface MockHandler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  [key: string]: Mock<(...args: any[]) => Promise<any>>;
}

const {
  browserControlMocks,
  pageNavigationMocks,
  pageInteractionMocks,
  pageEvaluationMocks,
  pageDataMocks,
  domQueryMocks,
  domStyleMocks,
  domSearchMocks,
  consoleMocks,
  scriptManagementMocks,
  captchaMocks,
  stealthMocks,
  frameworkMocks,
  indexedMocks,
  detailedDataHandlerMocks,
  jsHeapMocks,
  tabWorkflowMocks,
  camoufoxBrowserMocks,
  humanMouseMock,
  humanScrollMock,
  humanTypingMock,
  captchaVisionSolveMock,
  widgetChallengeSolveMock,
} = vi.hoisted(() => ({
  browserControlMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleBrowserLaunch: vi.fn(async (args: any) => ({ from: 'browser-launch', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleBrowserClose: vi.fn(async (args: any) => ({ from: 'browser-close', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleBrowserStatus: vi.fn(async (args: any) => ({ from: 'browser-status', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleBrowserListTabs: vi.fn(async (args: any) => ({ from: 'list-tabs', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleBrowserSelectTab: vi.fn(async (args: any) => ({ from: 'select-tab', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleBrowserAttach: vi.fn(async (args: any) => ({ from: 'attach', args })),
  } as MockHandler,
  pageNavigationMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageNavigate: vi.fn(async (args: any) => ({ from: 'page-nav', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageReload: vi.fn(async (args: any) => ({ from: 'reload', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageBack: vi.fn(async (args: any) => ({ from: 'back', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageForward: vi.fn(async (args: any) => ({ from: 'forward', args })),
  } as MockHandler,
  pageInteractionMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageClick: vi.fn(async (args: any) => ({ from: 'click', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageType: vi.fn(async (args: any) => ({ from: 'type', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageSelect: vi.fn(async (args: any) => ({ from: 'select', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageHover: vi.fn(async (args: any) => ({ from: 'hover', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageScroll: vi.fn(async (args: any) => ({ from: 'scroll', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePagePressKey: vi.fn(async (args: any) => ({ from: 'press-key', args })),
  } as MockHandler,
  pageEvaluationMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageEvaluate: vi.fn(async (args: any) => ({ from: 'evaluate', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageScreenshot: vi.fn(async (args: any) => ({ from: 'screenshot', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageInjectScript: vi.fn(async (args: any) => ({ from: 'inject-script', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageWaitForSelector: vi.fn(async (args: any) => ({ from: 'wait-selector', args })),
  } as MockHandler,
  pageDataMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageGetPerformance: vi.fn(async (args: any) => ({ from: 'perf', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageSetCookies: vi.fn(async (args: any) => ({ from: 'set-cookies', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageGetCookies: vi.fn(async (args: any) => ({ from: 'get-cookies', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageClearCookies: vi.fn(async (args: any) => ({ from: 'clear-cookies', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageSetViewport: vi.fn(async (args: any) => ({ from: 'set-viewport', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageEmulateDevice: vi.fn(async (args: any) => ({ from: 'emulate', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageGetLocalStorage: vi.fn(async (args: any) => ({ from: 'get-ls', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageSetLocalStorage: vi.fn(async (args: any) => ({ from: 'set-ls', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handlePageGetAllLinks: vi.fn(async (args: any) => ({ from: 'all-links', args })),
  } as MockHandler,
  domQueryMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleDOMQuerySelector: vi.fn(async (args: any) => ({ from: 'qs', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleDOMQueryAll: vi.fn(async (args: any) => ({ from: 'qsa', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleDOMFindClickable: vi.fn(async (args: any) => ({ from: 'clickable', args })),
  } as MockHandler,
  domStyleMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleDOMGetComputedStyle: vi.fn(async (args: any) => ({ from: 'computed-style', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleDOMIsInViewport: vi.fn(async (args: any) => ({ from: 'in-viewport', args })),
  } as MockHandler,
  domSearchMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleDOMFindByText: vi.fn(async (args: any) => ({ from: 'find-text', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleDOMGetXPath: vi.fn(async (args: any) => ({ from: 'xpath', args })),
  } as MockHandler,
  consoleMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleConsoleEnable: vi.fn(async (args: any) => ({ from: 'console-enable', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleConsoleGetLogs: vi.fn(async (args: any) => ({ from: 'console-logs', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleConsoleExecute: vi.fn(async (args: any) => ({ from: 'console-exec', args })),
  } as MockHandler,
  scriptManagementMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleGetAllScripts: vi.fn(async (args: any) => ({ from: 'all-scripts', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleGetScriptSource: vi.fn(async (args: any) => ({ from: 'script-source', args })),
  } as MockHandler,
  captchaMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleCaptchaDetect: vi.fn(async (args: any) => ({ from: 'captcha-detect', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleCaptchaWait: vi.fn(async (args: any) => ({ from: 'captcha-wait', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleCaptchaConfig: vi.fn(async (args: any) => ({ from: 'captcha-config', args })),
  } as MockHandler,
  stealthMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleStealthInject: vi.fn(async (args: any) => ({ from: 'stealth-inject', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleStealthSetUserAgent: vi.fn(async (args: any) => ({ from: 'stealth-ua', args })),
  } as MockHandler,
  frameworkMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleFrameworkStateExtract: vi.fn(async (args: any) => ({ from: 'framework', args })),
  } as MockHandler,
  indexedMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleIndexedDBDump: vi.fn(async (args: any) => ({ from: 'indexed-dump', args })),
  } as MockHandler,
  detailedDataHandlerMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleGetDetailedData: vi.fn(async (args: any) => ({ from: 'detailed-data', args })),
  } as MockHandler,
  jsHeapMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleJSHeapSearch: vi.fn(async (args: any) => ({ from: 'heap-search', args })),
  } as MockHandler,
  tabWorkflowMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleTabWorkflow: vi.fn(async (args: any) => ({ from: 'tab-workflow', args })),
  } as MockHandler,
  camoufoxBrowserMocks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleCamoufoxServerLaunch: vi.fn(async (args: any) => ({ from: 'cfox-launch', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleCamoufoxServerClose: vi.fn(async (args: any) => ({ from: 'cfox-close', args })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleCamoufoxServerStatus: vi.fn(async (args: any) => ({ from: 'cfox-status', args })),
  } as MockHandler,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  humanMouseMock: vi.fn(async (args: any, _collector: any) => ({ from: 'human-mouse', args })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  humanScrollMock: vi.fn(async (args: any, _collector: any) => ({ from: 'human-scroll', args })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  humanTypingMock: vi.fn(async (args: any, _collector: any) => ({ from: 'human-typing', args })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  captchaVisionSolveMock: vi.fn(async (args: any, _collector: any) => ({
    from: 'captcha-vision',
    args,
  })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  widgetChallengeSolveMock: vi.fn(async (args: any, _collector: any) => ({
    from: 'widget-solve',
    args,
  })),
}));

const { resolveOutputDirectoryMock, smartHandleMock } = vi.hoisted(() => ({
  resolveOutputDirectoryMock: vi.fn(() => 'screenshots/captcha'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  smartHandleMock: vi.fn((v: any) => ({ wrapped: v })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
function classFactory(spy: ReturnType<typeof vi.fn>, instance: any) {
  // oxlint-disable-next-line no-extraneous-class
  return class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    constructor(deps: any) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (spy as unknown as (deps: any) => void)(deps);
      return instance;
    }
  };
}

// Mock all sub-handler modules
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/captcha/AICaptchaDetector', () => ({
  AICaptchaDetector: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/utils/outputPaths', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  resolveOutputDirectory: (...args: any[]) => (resolveOutputDirectoryMock as any)(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      smartHandle: (...args: any[]) => (smartHandleMock as any)(...args),
    }),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/modules/browser/CamoufoxBrowserManager', () => ({
  CamoufoxBrowserManager: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    private page: any;
    constructor() {
      this.page = {
        goto: vi.fn(async () => {}),
        title: vi.fn(async () => 'Camoufox Page'),
        url: vi.fn(() => 'https://example.com'),
      };
    }
    async launch() {}
    async connectToServer() {}
    async close() {}
    async newPage() {
      return this.page;
    }
    getBrowser() {
      return {};
    }
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/browser-control', () => ({
  BrowserControlHandlers: classFactory(vi.fn(), browserControlMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/camoufox-browser', () => ({
  CamoufoxBrowserHandlers: classFactory(vi.fn(), camoufoxBrowserMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/page-navigation', () => ({
  PageNavigationHandlers: classFactory(vi.fn(), pageNavigationMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/page-interaction', () => ({
  PageInteractionHandlers: classFactory(vi.fn(), pageInteractionMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/page-evaluation', () => ({
  PageEvaluationHandlers: classFactory(vi.fn(), pageEvaluationMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/page-data', () => ({
  PageDataHandlers: classFactory(vi.fn(), pageDataMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/dom-query', () => ({
  DOMQueryHandlers: classFactory(vi.fn(), domQueryMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/dom-style', () => ({
  DOMStyleHandlers: classFactory(vi.fn(), domStyleMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/dom-search', () => ({
  DOMSearchHandlers: classFactory(vi.fn(), domSearchMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/console-handlers', () => ({
  ConsoleHandlers: classFactory(vi.fn(), consoleMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/script-management', () => ({
  ScriptManagementHandlers: classFactory(vi.fn(), scriptManagementMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/captcha-handlers', () => ({
  CaptchaHandlers: classFactory(vi.fn(), captchaMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/stealth-injection', () => ({
  StealthInjectionHandlers: classFactory(vi.fn(), stealthMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/framework-state', () => ({
  FrameworkStateHandlers: classFactory(vi.fn(), frameworkMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/indexeddb-dump', () => ({
  IndexedDBDumpHandlers: classFactory(vi.fn(), indexedMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/detailed-data', () => ({
  DetailedDataHandlers: classFactory(vi.fn(), detailedDataHandlerMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/js-heap', () => ({
  JSHeapSearchHandlers: classFactory(vi.fn(), jsHeapMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/tab-workflow', () => ({
  TabWorkflowHandlers: classFactory(vi.fn(), tabWorkflowMocks),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/human-behavior', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  handleHumanMouse: (args: any, collector: any) => humanMouseMock(args, collector),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  handleHumanScroll: (args: any, collector: any) => humanScrollMock(args, collector),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  handleHumanTyping: (args: any, collector: any) => humanTypingMock(args, collector),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/server/domains/browser/handlers/captcha-solver', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  handleCaptchaVisionSolve: (args: any, collector: any) => captchaVisionSolveMock(args, collector),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  handleWidgetChallengeSolve: (args: any, collector: any) =>
    widgetChallengeSolveMock(args, collector),
}));

import { BrowserToolHandlers } from '@server/domains/browser/handlers';

class TestBrowserToolHandlers extends BrowserToolHandlers {
  public setActiveDriver(driver: 'chrome' | 'camoufox') {
    this.activeDriver = driver;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public setCamoufoxManager(manager: any) {
    this.camoufoxManager = manager;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  public setCamoufoxPage(page: any) {
    this.camoufoxPage = page;
  }
}

type JsonResponse = {
  content: Array<{ text: string }>;
};

function getResponseText(response: JsonResponse): string {
  const [content] = response.content;
  if (!content) {
    throw new Error('Expected response content');
  }
  return content.text;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
function parseJson<T = Record<string, any>>(response: JsonResponse): T {
  return JSON.parse(getResponseText(response)) as T;
}

import {
  createPageMock,
  createCodeCollectorMock,
  createConsoleMonitorMock,
} from '@tests/server/domains/shared/mock-factories';

describe('BrowserToolHandlers — additional delegation coverage', () => {
  const domInspector = {
    getStructure: vi.fn(async () => ({ node: 'root' })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const collector = createCodeCollectorMock({ getActivePage: vi.fn() } as any);
  const pageController = createPageMock();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const scriptManager = {} as any;
  const consoleMonitor = createConsoleMonitorMock({
    setPlaywrightPage: vi.fn(),
    disable: vi.fn(async () => {}),
    clearPlaywrightPage: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const llmService = {} as any;

  let handlers: TestBrowserToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TestBrowserToolHandlers(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      collector as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      domInspector as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      scriptManager as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      llmService as any,
    );
  });

  // ============ Page Interaction delegation ============
  describe('page interaction delegation', () => {
    it('delegates handlePageClick', async () => {
      const args = { selector: '#btn' };
      const result = await handlers.handlePageClick(args);
      expect(pageInteractionMocks.handlePageClick).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'click', args });
    });

    it('delegates handlePageType', async () => {
      const args = { selector: '#input', text: 'hello' };
      const result = await handlers.handlePageType(args);
      expect(pageInteractionMocks.handlePageType).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'type', args });
    });

    it('delegates handlePageSelect', async () => {
      const args = { selector: 'select', value: 'opt1' };
      const result = await handlers.handlePageSelect(args);
      expect(pageInteractionMocks.handlePageSelect).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'select', args });
    });

    it('delegates handlePageHover', async () => {
      const args = { selector: '.menu' };
      const result = await handlers.handlePageHover(args);
      expect(pageInteractionMocks.handlePageHover).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'hover', args });
    });

    it('delegates handlePageScroll', async () => {
      const args = { x: 0, y: 500 };
      const result = await handlers.handlePageScroll(args);
      expect(pageInteractionMocks.handlePageScroll).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'scroll', args });
    });

    it('delegates handlePagePressKey', async () => {
      const args = { key: 'Enter' };
      const result = await handlers.handlePagePressKey(args);
      expect(pageInteractionMocks.handlePagePressKey).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'press-key', args });
    });
  });

  // ============ Page Evaluation delegation ============
  describe('page evaluation delegation', () => {
    it('delegates handlePageEvaluate', async () => {
      const args = { code: 'document.title' };
      const result = await handlers.handlePageEvaluate(args);
      expect(pageEvaluationMocks.handlePageEvaluate).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'evaluate', args });
    });

    it('delegates handlePageScreenshot', async () => {
      const args = { fullPage: true };
      const result = await handlers.handlePageScreenshot(args);
      expect(pageEvaluationMocks.handlePageScreenshot).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'screenshot', args });
    });

    it('delegates handlePageInjectScript', async () => {
      const args = { script: 'console.log("hi")' };
      const result = await handlers.handlePageInjectScript(args);
      expect(pageEvaluationMocks.handlePageInjectScript).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'inject-script', args });
    });

    it('delegates handlePageWaitForSelector', async () => {
      const args = { selector: '.loaded' };
      const result = await handlers.handlePageWaitForSelector(args);
      expect(pageEvaluationMocks.handlePageWaitForSelector).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'wait-selector', args });
    });
  });

  // ============ Page Data delegation ============
  describe('page data delegation', () => {
    it('delegates handlePageGetPerformance', async () => {
      const result = await handlers.handlePageGetPerformance({});
      expect(pageDataMocks.handlePageGetPerformance).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'perf', args: {} });
    });

    it('delegates handlePageSetCookies', async () => {
      const args = { cookies: [{ name: 'a', value: 'b' }] };
      await handlers.handlePageSetCookies(args);
      expect(pageDataMocks.handlePageSetCookies).toHaveBeenCalledWith(args);
    });

    it('delegates handlePageGetCookies', async () => {
      await handlers.handlePageGetCookies({});
      expect(pageDataMocks.handlePageGetCookies).toHaveBeenCalledWith({});
    });

    it('delegates handlePageClearCookies', async () => {
      await handlers.handlePageClearCookies({});
      expect(pageDataMocks.handlePageClearCookies).toHaveBeenCalledWith({});
    });

    it('delegates handlePageSetViewport', async () => {
      const args = { width: 1920, height: 1080 };
      await handlers.handlePageSetViewport(args);
      expect(pageDataMocks.handlePageSetViewport).toHaveBeenCalledWith(args);
    });

    it('delegates handlePageEmulateDevice', async () => {
      const args = { device: 'iPhone' };
      await handlers.handlePageEmulateDevice(args);
      expect(pageDataMocks.handlePageEmulateDevice).toHaveBeenCalledWith(args);
    });

    it('delegates handlePageGetLocalStorage', async () => {
      await handlers.handlePageGetLocalStorage({});
      expect(pageDataMocks.handlePageGetLocalStorage).toHaveBeenCalledWith({});
    });

    it('delegates handlePageSetLocalStorage', async () => {
      const args = { key: 'k', value: 'v' };
      await handlers.handlePageSetLocalStorage(args);
      expect(pageDataMocks.handlePageSetLocalStorage).toHaveBeenCalledWith(args);
    });

    it('delegates handlePageGetAllLinks', async () => {
      await handlers.handlePageGetAllLinks({});
      expect(pageDataMocks.handlePageGetAllLinks).toHaveBeenCalledWith({});
    });
  });

  // ============ Page Navigation ============
  describe('page navigation delegation', () => {
    it('delegates handlePageReload', async () => {
      const result = await handlers.handlePageReload({});
      expect(pageNavigationMocks.handlePageReload).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'reload', args: {} });
    });

    it('delegates handlePageBack', async () => {
      const result = await handlers.handlePageBack({});
      expect(pageNavigationMocks.handlePageBack).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'back', args: {} });
    });

    it('delegates handlePageForward', async () => {
      const result = await handlers.handlePageForward({});
      expect(pageNavigationMocks.handlePageForward).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'forward', args: {} });
    });

    it('delegates handlePageNavigate to pageNavigation for chrome driver', async () => {
      const args = { url: 'https://example.com' };
      const result = await handlers.handlePageNavigate(args);
      expect(pageNavigationMocks.handlePageNavigate).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'page-nav', args });
    });
  });

  // ============ DOM Query delegation ============
  describe('DOM query delegation', () => {
    it('delegates handleDOMQuerySelector', async () => {
      const args = { selector: 'div' };
      const result = await handlers.handleDOMQuerySelector(args);
      expect(domQueryMocks.handleDOMQuerySelector).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'qs', args });
    });

    it('delegates handleDOMQueryAll', async () => {
      const args = { selector: 'div' };
      const result = await handlers.handleDOMQueryAll(args);
      expect(domQueryMocks.handleDOMQueryAll).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'qsa', args });
    });

    it('delegates handleDOMFindClickable', async () => {
      const result = await handlers.handleDOMFindClickable({});
      expect(domQueryMocks.handleDOMFindClickable).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'clickable', args: {} });
    });
  });

  // ============ DOM Style delegation ============
  describe('DOM style delegation', () => {
    it('delegates handleDOMGetComputedStyle', async () => {
      const args = { selector: '.el' };
      const result = await handlers.handleDOMGetComputedStyle(args);
      expect(domStyleMocks.handleDOMGetComputedStyle).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'computed-style', args });
    });

    it('delegates handleDOMIsInViewport', async () => {
      const args = { selector: '.el' };
      const result = await handlers.handleDOMIsInViewport(args);
      expect(domStyleMocks.handleDOMIsInViewport).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'in-viewport', args });
    });
  });

  // ============ DOM Search delegation ============
  describe('DOM search delegation', () => {
    it('delegates handleDOMFindByText', async () => {
      const args = { text: 'hello' };
      const result = await handlers.handleDOMFindByText(args);
      expect(domSearchMocks.handleDOMFindByText).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'find-text', args });
    });

    it('delegates handleDOMGetXPath', async () => {
      const args = { selector: 'div' };
      const result = await handlers.handleDOMGetXPath(args);
      expect(domSearchMocks.handleDOMGetXPath).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'xpath', args });
    });
  });

  // ============ Console delegation ============
  describe('console delegation', () => {
    it('delegates handleConsoleEnable', async () => {
      const result = await handlers.handleConsoleEnable({});
      expect(consoleMocks.handleConsoleEnable).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'console-enable', args: {} });
    });

    it('delegates handleConsoleGetLogs', async () => {
      await handlers.handleConsoleGetLogs({});
      expect(consoleMocks.handleConsoleGetLogs).toHaveBeenCalledWith({});
    });

    it('delegates handleConsoleExecute', async () => {
      const args = { code: 'console.log("test")' };
      await handlers.handleConsoleExecute(args);
      expect(consoleMocks.handleConsoleExecute).toHaveBeenCalledWith(args);
    });
  });

  // ============ Script Management delegation ============
  describe('script management delegation', () => {
    it('delegates handleGetAllScripts', async () => {
      const result = await handlers.handleGetAllScripts({});
      expect(scriptManagementMocks.handleGetAllScripts).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'all-scripts', args: {} });
    });

    it('delegates handleGetScriptSource', async () => {
      const args = { scriptId: '123' };
      const result = await handlers.handleGetScriptSource(args);
      expect(scriptManagementMocks.handleGetScriptSource).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'script-source', args });
    });
  });

  // ============ CAPTCHA delegation ============
  describe('captcha delegation', () => {
    it('delegates handleCaptchaDetect', async () => {
      const result = await handlers.handleCaptchaDetect({});
      expect(captchaMocks.handleCaptchaDetect).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'captcha-detect', args: {} });
    });

    it('delegates handleCaptchaWait', async () => {
      await handlers.handleCaptchaWait({});
      expect(captchaMocks.handleCaptchaWait).toHaveBeenCalledWith({});
    });

    it('delegates handleCaptchaConfig', async () => {
      const args = { autoDetect: true };
      await handlers.handleCaptchaConfig(args);
      expect(captchaMocks.handleCaptchaConfig).toHaveBeenCalledWith(args);
    });
  });

  // ============ Stealth delegation ============
  describe('stealth delegation', () => {
    it('delegates handleStealthInject', async () => {
      const result = await handlers.handleStealthInject({});
      expect(stealthMocks.handleStealthInject).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'stealth-inject', args: {} });
    });

    it('delegates handleStealthSetUserAgent', async () => {
      const args = { platform: 'mac' };
      const result = await handlers.handleStealthSetUserAgent(args);
      expect(stealthMocks.handleStealthSetUserAgent).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'stealth-ua', args });
    });
  });

  // ============ Framework State delegation ============
  describe('framework state delegation', () => {
    it('delegates handleFrameworkStateExtract', async () => {
      const args = { framework: 'react' };
      const result = await handlers.handleFrameworkStateExtract(args);
      expect(frameworkMocks.handleFrameworkStateExtract).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'framework', args });
    });
  });

  // ============ IndexedDB delegation ============
  describe('IndexedDB delegation', () => {
    it('delegates handleIndexedDBDump', async () => {
      const result = await handlers.handleIndexedDBDump({});
      expect(indexedMocks.handleIndexedDBDump).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'indexed-dump', args: {} });
    });
  });

  // ============ JS Heap Search delegation ============
  describe('JS heap search delegation', () => {
    it('delegates handleJSHeapSearch', async () => {
      const args = { query: 'token' };
      const result = await handlers.handleJSHeapSearch(args);
      expect(jsHeapMocks.handleJSHeapSearch).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'heap-search', args });
    });
  });

  // ============ Tab Workflow delegation ============
  describe('tab workflow delegation', () => {
    it('delegates handleTabWorkflow', async () => {
      const args = { action: 'open' };
      const result = await handlers.handleTabWorkflow(args);
      expect(tabWorkflowMocks.handleTabWorkflow).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'tab-workflow', args });
    });
  });

  // ============ Detailed Data delegation ============
  describe('detailed data delegation', () => {
    it('delegates handleGetDetailedData', async () => {
      const args = { id: 'abc' };
      const result = await handlers.handleGetDetailedData(args);
      expect(detailedDataHandlerMocks.handleGetDetailedData).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'detailed-data', args });
    });
  });

  // ============ Camoufox Server delegation ============
  describe('camoufox server delegation', () => {
    it('delegates handleCamoufoxServerLaunch', async () => {
      const result = await handlers.handleCamoufoxServerLaunch({});
      expect(camoufoxBrowserMocks.handleCamoufoxServerLaunch).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'cfox-launch', args: {} });
    });

    it('delegates handleCamoufoxServerClose', async () => {
      const result = await handlers.handleCamoufoxServerClose({});
      expect(camoufoxBrowserMocks.handleCamoufoxServerClose).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'cfox-close', args: {} });
    });

    it('delegates handleCamoufoxServerStatus', async () => {
      const result = await handlers.handleCamoufoxServerStatus({});
      expect(camoufoxBrowserMocks.handleCamoufoxServerStatus).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'cfox-status', args: {} });
    });
  });

  // ============ Human Behavior delegation ============
  describe('human behavior delegation', () => {
    it('delegates handleHumanMouse with collector', async () => {
      const args = { toX: 100, toY: 200 };
      const result = await handlers.handleHumanMouse(args);
      expect(humanMouseMock).toHaveBeenCalledWith(args, collector);
      expect(result).toEqual({ from: 'human-mouse', args });
    });

    it('delegates handleHumanScroll with collector', async () => {
      const args = { distance: 500 };
      const result = await handlers.handleHumanScroll(args);
      expect(humanScrollMock).toHaveBeenCalledWith(args, collector);
      expect(result).toEqual({ from: 'human-scroll', args });
    });

    it('delegates handleHumanTyping with collector', async () => {
      const args = { selector: '#input', text: 'hello' };
      const result = await handlers.handleHumanTyping(args);
      expect(humanTypingMock).toHaveBeenCalledWith(args, collector);
      expect(result).toEqual({ from: 'human-typing', args });
    });
  });

  // ============ CAPTCHA Solving delegation ============
  describe('captcha solving delegation', () => {
    it('delegates handleCaptchaVisionSolve with collector', async () => {
      const args = { mode: 'manual' };
      const result = await handlers.handleCaptchaVisionSolve(args);
      expect(captchaVisionSolveMock).toHaveBeenCalledWith(args, collector);
      expect(result).toEqual({ from: 'captcha-vision', args });
    });

    it('delegates handleWidgetChallengeSolve with collector', async () => {
      const args = { siteKey: 'abc' };
      const result = await handlers.handleWidgetChallengeSolve(args);
      expect(widgetChallengeSolveMock).toHaveBeenCalledWith(args, collector);
      expect(result).toEqual({ from: 'widget-solve', args });
    });
  });

  // ============ Browser status with camoufox ============
  describe('browser status with camoufox active', () => {
    it('returns camoufox status when camoufoxManager has a browser', async () => {
      handlers.setActiveDriver('camoufox');
      handlers.setCamoufoxManager({ getBrowser: vi.fn(() => ({})) });
      handlers.setCamoufoxPage({ fake: true });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleBrowserStatus({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.driver).toBe('camoufox');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.running).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hasActivePage).toBe(true);
    });

    it('returns camoufox status when camoufoxManager has no browser', async () => {
      handlers.setActiveDriver('camoufox');
      handlers.setCamoufoxManager({ getBrowser: vi.fn(() => null) });

      const body = parseJson<BrowserStatusResponse>(await handlers.handleBrowserStatus({}));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.driver).toBe('camoufox');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.running).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.hasActivePage).toBe(false);
    });

    it('delegates to browserControl for chrome driver', async () => {
      const result = await handlers.handleBrowserStatus({});
      expect(browserControlMocks.handleBrowserStatus).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'browser-status', args: {} });
    });
  });

  // ============ Browser close edge cases ============
  describe('browser close edge cases', () => {
    it('delegates directly to browserControl when activeDriver is chrome', async () => {
      const result = await handlers.handleBrowserClose({});
      expect(browserControlMocks.handleBrowserClose).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'browser-close', args: {} });
    });
  });

  // ============ Browser launch chrome (no existing camoufox) ============
  describe('browser launch chrome — no existing camoufox', () => {
    it('launches chrome without closing camoufox when none is active', async () => {
      const result = await handlers.handleBrowserLaunch({ driver: 'chrome' });
      expect(browserControlMocks.handleBrowserLaunch).toHaveBeenCalledWith({ driver: 'chrome' });
      expect(consoleMonitor.disable).not.toHaveBeenCalled();
      expect(result).toEqual({ from: 'browser-launch', args: { driver: 'chrome' } });
    });

    it('defaults driver to chrome when not specified', async () => {
      const result = await handlers.handleBrowserLaunch({});
      expect(browserControlMocks.handleBrowserLaunch).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'browser-launch', args: {} });
    });
  });

  // ============ Browser tabs ============
  describe('browser tabs delegation', () => {
    it('delegates handleBrowserListTabs', async () => {
      const result = await handlers.handleBrowserListTabs({});
      expect(browserControlMocks.handleBrowserListTabs).toHaveBeenCalledWith({});
      expect(result).toEqual({ from: 'list-tabs', args: {} });
    });

    it('delegates handleBrowserSelectTab', async () => {
      const args = { tabIndex: 1 };
      const result = await handlers.handleBrowserSelectTab(args);
      expect(browserControlMocks.handleBrowserSelectTab).toHaveBeenCalledWith(args);
      expect(result).toEqual({ from: 'select-tab', args });
    });
  });

  // ============ closeCamoufox error handling ============
  describe('closeCamoufox error handling', () => {
    it('continues closing camoufox even if consoleMonitor.disable throws', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor.disable.mockRejectedValueOnce(new Error('disable failed'));
      handlers.setActiveDriver('camoufox');
      const closeSpy = vi.fn(async () => {});
      handlers.setCamoufoxManager({ close: closeSpy });

      await handlers.handleBrowserLaunch({ driver: 'chrome' });

      expect(consoleMonitor.disable).toHaveBeenCalled();
      expect(consoleMonitor.clearPlaywrightPage).toHaveBeenCalled();
      expect(closeSpy).toHaveBeenCalled();
      expect(browserControlMocks.handleBrowserLaunch).toHaveBeenCalled();
    });
  });

  // ============ getTabRegistry ============
  describe('getTabRegistry', () => {
    it('returns the TabRegistry instance', () => {
      const registry = handlers.getTabRegistry();
      expect(registry).toBeDefined();
    });
  });

  // ============ handleDOMGetStructure defaults ============
  describe('handleDOMGetStructure defaults', () => {
    it('uses default maxDepth=3 and includeText=true when not provided', async () => {
      const body = parseJson<BrowserStatusResponse>(await handlers.handleDOMGetStructure({}));
      expect(domInspector.getStructure).toHaveBeenCalledWith(3, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.wrapped).toEqual({ node: 'root' });
    });
  });

  // ============ handleBrowserAttach without camoufox ============
  describe('handleBrowserAttach without camoufox', () => {
    it('attaches chrome without closing camoufox when none active', async () => {
      await handlers.handleBrowserAttach({ browserURL: 'http://localhost:9222' });
      expect(browserControlMocks.handleBrowserAttach).toHaveBeenCalledWith({
        browserURL: 'http://localhost:9222',
      });
      expect(consoleMonitor.disable).not.toHaveBeenCalled();
    });
  });

  // ============ getCamoufoxPage private method coverage ============
  describe('getCamoufoxPage', () => {
    it('throws when camoufoxManager is null', async () => {
      handlers.setActiveDriver('camoufox');
      handlers.setCamoufoxManager(null);

      // Navigate triggers getCamoufoxPage internally
      await expect(handlers.handlePageNavigate({ url: 'https://example.com' })).rejects.toThrow(
        /Camoufox browser not launched/,
      );
    });
  });
});
