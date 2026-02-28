import { beforeEach, describe, expect, it, vi } from 'vitest';

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
} = vi.hoisted(() => ({
  browserControlMocks: {
    handleBrowserLaunch: vi.fn(async (args: any) => ({ from: 'browser-launch', args })),
    handleBrowserClose: vi.fn(async (args: any) => ({ from: 'browser-close', args })),
    handleBrowserStatus: vi.fn(async (args: any) => ({ from: 'browser-status', args })),
    handleBrowserListTabs: vi.fn(async (args: any) => ({ from: 'list-tabs', args })),
    handleBrowserSelectTab: vi.fn(async (args: any) => ({ from: 'select-tab', args })),
    handleBrowserAttach: vi.fn(async (args: any) => ({ from: 'attach', args })),
  },
  pageNavigationMocks: {
    handlePageNavigate: vi.fn(async (args: any) => ({ from: 'page-nav', args })),
    handlePageReload: vi.fn(async () => ({ from: 'reload' })),
    handlePageBack: vi.fn(async () => ({ from: 'back' })),
    handlePageForward: vi.fn(async () => ({ from: 'forward' })),
  },
  pageInteractionMocks: {
    handlePageClick: vi.fn(),
    handlePageType: vi.fn(),
    handlePageSelect: vi.fn(),
    handlePageHover: vi.fn(),
    handlePageScroll: vi.fn(),
    handlePagePressKey: vi.fn(),
  },
  pageEvaluationMocks: {
    handlePageEvaluate: vi.fn(),
    handlePageScreenshot: vi.fn(),
    handlePageInjectScript: vi.fn(),
    handlePageWaitForSelector: vi.fn(),
  },
  pageDataMocks: {
    handlePageGetPerformance: vi.fn(),
    handlePageSetCookies: vi.fn(),
    handlePageGetCookies: vi.fn(),
    handlePageClearCookies: vi.fn(),
    handlePageSetViewport: vi.fn(),
    handlePageEmulateDevice: vi.fn(),
    handlePageGetLocalStorage: vi.fn(),
    handlePageSetLocalStorage: vi.fn(),
    handlePageGetAllLinks: vi.fn(),
  },
  domQueryMocks: {
    handleDOMQuerySelector: vi.fn(),
    handleDOMQueryAll: vi.fn(),
    handleDOMFindClickable: vi.fn(),
  },
  domStyleMocks: {
    handleDOMGetComputedStyle: vi.fn(),
    handleDOMIsInViewport: vi.fn(),
  },
  domSearchMocks: {
    handleDOMFindByText: vi.fn(),
    handleDOMGetXPath: vi.fn(),
  },
  consoleMocks: {
    handleConsoleEnable: vi.fn(),
    handleConsoleGetLogs: vi.fn(),
    handleConsoleExecute: vi.fn(),
  },
  scriptManagementMocks: {
    handleGetAllScripts: vi.fn(),
    handleGetScriptSource: vi.fn(),
  },
  captchaMocks: {
    handleCaptchaDetect: vi.fn(),
    handleCaptchaWait: vi.fn(),
    handleCaptchaConfig: vi.fn(),
  },
  stealthMocks: {
    handleStealthInject: vi.fn(),
    handleStealthSetUserAgent: vi.fn(),
  },
  frameworkMocks: {
    handleFrameworkStateExtract: vi.fn(),
  },
  indexedMocks: {
    handleIndexedDBDump: vi.fn(),
  },
  detailedDataHandlerMocks: {
    handleGetDetailedData: vi.fn(),
  },
  jsHeapMocks: {
    handleJSHeapSearch: vi.fn(),
  },
  tabWorkflowMocks: {
    handleTabWorkflow: vi.fn(),
  },
  camoufoxBrowserMocks: {
    handleCamoufoxServerLaunch: vi.fn(),
    handleCamoufoxServerClose: vi.fn(),
    handleCamoufoxServerStatus: vi.fn(),
  },
}));

const { browserControlCtor, camoufoxManagerCtor, resolveOutputDirectoryMock, smartHandleMock } =
  vi.hoisted(() => ({
    browserControlCtor: vi.fn(),
    camoufoxManagerCtor: vi.fn(),
    resolveOutputDirectoryMock: vi.fn(() => 'screenshots/captcha'),
    smartHandleMock: vi.fn((v) => ({ wrapped: v })),
  }));

function classFactory(spy: ReturnType<typeof vi.fn>, instance: any) {
  return class {
    constructor(deps: unknown) {
      spy(deps);
      return instance;
    }
  };
}

vi.mock('../../../../src/modules/captcha/AICaptchaDetector.js', () => ({
  AICaptchaDetector: class {
    constructor() {}
  },
}));

vi.mock('../../../../src/utils/outputPaths.js', () => ({
  resolveOutputDirectory: (...args: any[]) => resolveOutputDirectoryMock(...args),
}));

vi.mock('../../../../src/utils/DetailedDataManager.js', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (...args: any[]) => smartHandleMock(...args),
    }),
  },
}));

vi.mock('../../../../src/modules/browser/CamoufoxBrowserManager.js', () => ({
  CamoufoxBrowserManager: class {
    private page: any;
    constructor(opts: unknown) {
      camoufoxManagerCtor(opts);
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

vi.mock('../../../../src/server/domains/browser/handlers/browser-control.js', () => ({
  BrowserControlHandlers: classFactory(browserControlCtor, browserControlMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/camoufox-browser.js', () => ({
  CamoufoxBrowserHandlers: classFactory(vi.fn(), camoufoxBrowserMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/page-navigation.js', () => ({
  PageNavigationHandlers: classFactory(vi.fn(), pageNavigationMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/page-interaction.js', () => ({
  PageInteractionHandlers: classFactory(vi.fn(), pageInteractionMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/page-evaluation.js', () => ({
  PageEvaluationHandlers: classFactory(vi.fn(), pageEvaluationMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/page-data.js', () => ({
  PageDataHandlers: classFactory(vi.fn(), pageDataMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/dom-query.js', () => ({
  DOMQueryHandlers: classFactory(vi.fn(), domQueryMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/dom-style.js', () => ({
  DOMStyleHandlers: classFactory(vi.fn(), domStyleMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/dom-search.js', () => ({
  DOMSearchHandlers: classFactory(vi.fn(), domSearchMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/console-handlers.js', () => ({
  ConsoleHandlers: classFactory(vi.fn(), consoleMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/script-management.js', () => ({
  ScriptManagementHandlers: classFactory(vi.fn(), scriptManagementMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/captcha-handlers.js', () => ({
  CaptchaHandlers: classFactory(vi.fn(), captchaMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/stealth-injection.js', () => ({
  StealthInjectionHandlers: classFactory(vi.fn(), stealthMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/framework-state.js', () => ({
  FrameworkStateHandlers: classFactory(vi.fn(), frameworkMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/indexeddb-dump.js', () => ({
  IndexedDBDumpHandlers: classFactory(vi.fn(), indexedMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/detailed-data.js', () => ({
  DetailedDataHandlers: classFactory(vi.fn(), detailedDataHandlerMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/js-heap.js', () => ({
  JSHeapSearchHandlers: classFactory(vi.fn(), jsHeapMocks),
}));
vi.mock('../../../../src/server/domains/browser/handlers/tab-workflow.js', () => ({
  TabWorkflowHandlers: classFactory(vi.fn(), tabWorkflowMocks),
}));

import { BrowserToolHandlers } from '../../../../src/server/domains/browser/handlers.js';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('BrowserToolHandlers', () => {
  const domInspector = {
    getStructure: vi.fn(async () => ({ node: 'root' })),
  } as any;
  const collector = {
    getActivePage: vi.fn(),
  } as any;
  const pageController = {} as any;
  const scriptManager = {} as any;
  const consoleMonitor = {
    setPlaywrightPage: vi.fn(),
  } as any;
  const llmService = {} as any;

  let handlers: BrowserToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new BrowserToolHandlers(
      collector,
      pageController,
      domInspector,
      scriptManager,
      consoleMonitor,
      llmService
    );
  });

  it('constructs BrowserControlHandlers and resolves screenshot dir', () => {
    expect(browserControlCtor).toHaveBeenCalledOnce();
    expect(resolveOutputDirectoryMock).toHaveBeenCalled();
  });

  it('launches chrome path and closes existing camoufox session', async () => {
    (handlers as any).activeDriver = 'camoufox';
    (handlers as any).camoufoxManager = { close: vi.fn(async () => {}) };

    const result = await handlers.handleBrowserLaunch({ driver: 'chrome' });
    expect(result).toEqual({ from: 'browser-launch', args: { driver: 'chrome' } });
    expect(browserControlMocks.handleBrowserLaunch).toHaveBeenCalledWith({ driver: 'chrome' });
  });

  it('returns validation error for camoufox connect mode without wsEndpoint', async () => {
    const response = await handlers.handleBrowserLaunch({
      driver: 'camoufox',
      mode: 'connect',
    });
    const body = parseJson(response);
    expect(body.success).toBe(false);
    expect(body.error).toContain('wsEndpoint is required');
  });

  it('returns camoufox close payload when active driver is camoufox', async () => {
    (handlers as any).activeDriver = 'camoufox';
    (handlers as any).camoufoxManager = { close: vi.fn(async () => {}), getBrowser: vi.fn(() => ({})) };
    const body = parseJson(await handlers.handleBrowserClose({}));
    expect(body.success).toBe(true);
    expect(body.message).toContain('Camoufox browser closed');
  });

  it('wraps DOM structure via DetailedDataManager smartHandle', async () => {
    const body = parseJson(await handlers.handleDOMGetStructure({ maxDepth: 2, includeText: false }));
    expect(domInspector.getStructure).toHaveBeenCalledWith(2, false);
    expect(smartHandleMock).toHaveBeenCalled();
    expect(body.wrapped).toEqual({ node: 'root' });
  });

  it('navigates with camoufox page and updates console monitor', async () => {
    (handlers as any).activeDriver = 'camoufox';
    (handlers as any).camoufoxManager = {
      newPage: vi.fn(async () => ({
        goto: vi.fn(async () => {}),
        title: vi.fn(async () => 'Camoufox Page'),
        url: vi.fn(() => 'https://target.example'),
      })),
      close: vi.fn(async () => {}),
      getBrowser: vi.fn(() => ({})),
    };

    const body = parseJson(
      await handlers.handlePageNavigate({ url: 'https://target.example', waitUntil: 'networkidle2' })
    );
    expect(consoleMonitor.setPlaywrightPage).toHaveBeenCalledOnce();
    expect(body.success).toBe(true);
    expect(body.driver).toBe('camoufox');
    expect(body.url).toBe('https://target.example');
  });
});
