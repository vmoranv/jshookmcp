import { parseJson, BrowserStatusResponse } from '@tests/server/domains/shared/mock-factories';
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
    handleBrowserLaunch: vi.fn(async (args: unknown) => ({ from: 'browser-launch', args })),
    handleBrowserClose: vi.fn(async (args: unknown) => ({ from: 'browser-close', args })),
    handleBrowserStatus: vi.fn(async (args: unknown) => ({ from: 'browser-status', args })),
    handleBrowserListTabs: vi.fn(async (args: unknown) => ({ from: 'list-tabs', args })),
    handleBrowserSelectTab: vi.fn(async (args: unknown) => ({ from: 'select-tab', args })),
    handleBrowserAttach: vi.fn(async (args: unknown) => ({ from: 'attach', args })),
  },
  pageNavigationMocks: {
    handlePageNavigate: vi.fn(async (args: unknown) => ({ from: 'page-nav', args })),
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

function classFactory(spy: ReturnType<typeof vi.fn>, instance: unknown) {
  return class {
    constructor(deps: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (spy as any)(deps);
      return instance;
    }
  };
}

vi.mock('@src/modules/captcha/AICaptchaDetector', () => ({
  AICaptchaDetector: class {
    constructor() {}
  },
}));

vi.mock('@src/utils/outputPaths', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  resolveOutputDirectory: (...args: any[]) => (resolveOutputDirectoryMock as unknown)(...args),
}));

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      smartHandle: (...args: any[]) => (smartHandleMock as unknown)(...args),
    }),
  },
}));

vi.mock('@src/modules/browser/CamoufoxBrowserManager', () => ({
  CamoufoxBrowserManager: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    private page: any;
    constructor(opts: unknown) {
      camoufoxManagerCtor(opts);
      this.page = {
        goto: vi.fn(async () => {}),
        title: vi.fn(async () => 'Camoufox Page'),
        url: vi.fn(() => 'https://vmoranv.github.io/jshookmcp'),
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

vi.mock('@src/server/domains/browser/handlers/browser-control', () => ({
  BrowserControlHandlers: classFactory(browserControlCtor, browserControlMocks),
}));
vi.mock('@src/server/domains/browser/handlers/camoufox-browser', () => ({
  CamoufoxBrowserHandlers: classFactory(vi.fn(), camoufoxBrowserMocks),
}));
vi.mock('@src/server/domains/browser/handlers/page-navigation', () => ({
  PageNavigationHandlers: classFactory(vi.fn(), pageNavigationMocks),
}));
vi.mock('@src/server/domains/browser/handlers/page-interaction', () => ({
  PageInteractionHandlers: classFactory(vi.fn(), pageInteractionMocks),
}));
vi.mock('@src/server/domains/browser/handlers/page-evaluation', () => ({
  PageEvaluationHandlers: classFactory(vi.fn(), pageEvaluationMocks),
}));
vi.mock('@src/server/domains/browser/handlers/page-data', () => ({
  PageDataHandlers: classFactory(vi.fn(), pageDataMocks),
}));
vi.mock('@src/server/domains/browser/handlers/dom-query', () => ({
  DOMQueryHandlers: classFactory(vi.fn(), domQueryMocks),
}));
vi.mock('@src/server/domains/browser/handlers/dom-style', () => ({
  DOMStyleHandlers: classFactory(vi.fn(), domStyleMocks),
}));
vi.mock('@src/server/domains/browser/handlers/dom-search', () => ({
  DOMSearchHandlers: classFactory(vi.fn(), domSearchMocks),
}));
vi.mock('@src/server/domains/browser/handlers/console-handlers', () => ({
  ConsoleHandlers: classFactory(vi.fn(), consoleMocks),
}));
vi.mock('@src/server/domains/browser/handlers/script-management', () => ({
  ScriptManagementHandlers: classFactory(vi.fn(), scriptManagementMocks),
}));
vi.mock('@src/server/domains/browser/handlers/captcha-handlers', () => ({
  CaptchaHandlers: classFactory(vi.fn(), captchaMocks),
}));
vi.mock('@src/server/domains/browser/handlers/stealth-injection', () => ({
  StealthInjectionHandlers: classFactory(vi.fn(), stealthMocks),
}));
vi.mock('@src/server/domains/browser/handlers/framework-state', () => ({
  FrameworkStateHandlers: classFactory(vi.fn(), frameworkMocks),
}));
vi.mock('@src/server/domains/browser/handlers/indexeddb-dump', () => ({
  IndexedDBDumpHandlers: classFactory(vi.fn(), indexedMocks),
}));
vi.mock('@src/server/domains/browser/handlers/detailed-data', () => ({
  DetailedDataHandlers: classFactory(vi.fn(), detailedDataHandlerMocks),
}));
vi.mock('@src/server/domains/browser/handlers/js-heap', () => ({
  JSHeapSearchHandlers: classFactory(vi.fn(), jsHeapMocks),
}));
vi.mock('@src/server/domains/browser/handlers/tab-workflow', () => ({
  TabWorkflowHandlers: classFactory(vi.fn(), tabWorkflowMocks),
}));

import { BrowserToolHandlers } from '@server/domains/browser/handlers';



describe('BrowserToolHandlers', () => {
  const domInspector = {
    getStructure: vi.fn(async () => ({ node: 'root' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
  const collector = {
    getActivePage: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
  const pageController = {} as unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const scriptManager = {} as any;
  const consoleMonitor = {
    setPlaywrightPage: vi.fn(),
    disable: vi.fn(async () => {}),
    clearPlaywrightPage: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  } as any;
  const llmService = {} as unknown;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handlers as any).activeDriver = 'camoufox';
    (handlers as unknown).camoufoxManager = { close: vi.fn(async () => {}) };

    const result = await handlers.handleBrowserLaunch({ driver: 'chrome' });
    expect(result).toEqual({ from: 'browser-launch', args: { driver: 'chrome' } });
    expect(browserControlMocks.handleBrowserLaunch).toHaveBeenCalledWith({ driver: 'chrome' });
    expect(consoleMonitor.disable).toHaveBeenCalledTimes(1);
    expect(consoleMonitor.clearPlaywrightPage).toHaveBeenCalledTimes(1);
  });

  it('attaches chrome path and closes existing camoufox session', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handlers as any).activeDriver = 'camoufox';
    (handlers as unknown).camoufoxManager = { close: vi.fn(async () => {}) };

    const result = await handlers.handleBrowserAttach({ browserURL: 'http://127.0.0.1:9222' });
    expect(result).toEqual({ from: 'attach', args: { browserURL: 'http://127.0.0.1:9222' } });
    expect(browserControlMocks.handleBrowserAttach).toHaveBeenCalledWith({
      browserURL: 'http://127.0.0.1:9222',
    });
    expect(consoleMonitor.disable).toHaveBeenCalledTimes(1);
    expect(consoleMonitor.clearPlaywrightPage).toHaveBeenCalledTimes(1);
  });

  it('returns validation error for camoufox connect mode without wsEndpoint', async () => {
    const response = await handlers.handleBrowserLaunch({
      driver: 'camoufox',
      mode: 'connect',
    });
    const body = parseJson<BrowserStatusResponse>(response);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.error).toContain('wsEndpoint is required');
  });

  it('returns camoufox close payload when active driver is camoufox', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handlers as any).activeDriver = 'camoufox';
    (handlers as unknown).camoufoxManager = {
      close: vi.fn(async () => {}),
      getBrowser: vi.fn(() => ({})),
    };
    const body = parseJson<BrowserStatusResponse>(await handlers.handleBrowserClose({}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.message).toContain('Camoufox browser closed');
    expect(browserControlMocks.handleBrowserClose).toHaveBeenCalledWith({});
    expect(consoleMonitor.disable).toHaveBeenCalledTimes(1);
    expect(consoleMonitor.clearPlaywrightPage).toHaveBeenCalledTimes(1);
  });

  it('wraps DOM structure via DetailedDataManager smartHandle', async () => {
    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleDOMGetStructure({ maxDepth: 2, includeText: false })
    );
    expect(domInspector.getStructure).toHaveBeenCalledWith(2, false);
    expect(smartHandleMock).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.wrapped).toEqual({ node: 'root' });
  });

  it('navigates with camoufox page and updates console monitor', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (handlers as any).activeDriver = 'camoufox';
    (handlers as unknown).camoufoxManager = {
      newPage: vi.fn(async () => ({
        goto: vi.fn(async () => {}),
        title: vi.fn(async () => 'Camoufox Page'),
        url: vi.fn(() => 'https://vmoranv.github.io/jshookmcp/target'),
      })),
      close: vi.fn(async () => {}),
      getBrowser: vi.fn(() => ({})),
    };

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handlePageNavigate({
        url: 'https://vmoranv.github.io/jshookmcp/target',
        waitUntil: 'networkidle2',
      })
    );
    expect(consoleMonitor.setPlaywrightPage).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.driver).toBe('camoufox');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(body.url).toBe('https://vmoranv.github.io/jshookmcp/target');
  });
});
