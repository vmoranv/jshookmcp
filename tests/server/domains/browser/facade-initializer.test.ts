import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all handler classes and modules
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/shared/modules', () => ({
  AICaptchaDetector: vi.fn(),
  CamoufoxBrowserManager: vi.fn(),
  CodeCollector: vi.fn(),
  PageController: vi.fn(),
  DOMInspector: vi.fn(),
  ScriptManager: vi.fn(),
  ConsoleMonitor: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/DetailedDataManager', () => ({
  DetailedDataManager: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/browser/TabRegistry', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  TabRegistry: vi.fn().mockImplementation(() => ({ _mock: 'tabRegistry' })),
}));

// Mock all handler constructors
const handlers = vi.hoisted(() => ({
  BrowserControlHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'browserControl', deps: d })),
  CamoufoxBrowserHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'camoufox', deps: d })),
  PageNavigationHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'pageNav', deps: d })),
  PageInteractionHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'pageInteract', deps: d })),
  PageEvaluationHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'pageEval', deps: d })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  PageDataHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'pageData', deps: d })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DOMQueryHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'domQuery', deps: d })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DOMStyleHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'domStyle', deps: d })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DOMSearchHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'domSearch', deps: d })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ConsoleHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'console', deps: d })),
  ScriptManagementHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'scriptMgmt', deps: d })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CaptchaHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'captcha', deps: d })),
  StealthInjectionHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'stealth', deps: d })),
  FrameworkStateHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'framework', deps: d })),
  IndexedDBDumpHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'indexeddb', deps: d })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  JSHeapSearchHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'jsHeap', deps: d })),
  TabWorkflowHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'tabWorkflow', deps: d })),
  DetailedDataHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation((d: any) => ({ _type: 'detailedData', deps: d })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/browser-control', () => ({
  BrowserControlHandlers: handlers.BrowserControlHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/camoufox-browser', () => ({
  CamoufoxBrowserHandlers: handlers.CamoufoxBrowserHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/page-navigation', () => ({
  PageNavigationHandlers: handlers.PageNavigationHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/page-interaction', () => ({
  PageInteractionHandlers: handlers.PageInteractionHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/page-evaluation', () => ({
  PageEvaluationHandlers: handlers.PageEvaluationHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/page-data', () => ({
  PageDataHandlers: handlers.PageDataHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/dom-query', () => ({
  DOMQueryHandlers: handlers.DOMQueryHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/dom-style', () => ({
  DOMStyleHandlers: handlers.DOMStyleHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/dom-search', () => ({
  DOMSearchHandlers: handlers.DOMSearchHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/console-handlers', () => ({
  ConsoleHandlers: handlers.ConsoleHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/script-management', () => ({
  ScriptManagementHandlers: handlers.ScriptManagementHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/captcha-handlers', () => ({
  CaptchaHandlers: handlers.CaptchaHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/stealth-injection', () => ({
  StealthInjectionHandlers: handlers.StealthInjectionHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/framework-state', () => ({
  FrameworkStateHandlers: handlers.FrameworkStateHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/indexeddb-dump', () => ({
  IndexedDBDumpHandlers: handlers.IndexedDBDumpHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/js-heap', () => ({
  JSHeapSearchHandlers: handlers.JSHeapSearchHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/tab-workflow', () => ({
  TabWorkflowHandlers: handlers.TabWorkflowHandlers,
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/detailed-data', () => ({
  DetailedDataHandlers: handlers.DetailedDataHandlers,
}));

import {
  initializeBrowserHandlerModules,
  type BrowserHandlerModuleInitDeps,
} from '@server/domains/browser/handlers/facade-initializer';

describe('initializeBrowserHandlerModules', () => {
  function makeDeps(): BrowserHandlerModuleInitDeps {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      collector: { getActivePage: vi.fn() } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      pageController: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      domInspector: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      scriptManager: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      consoleMonitor: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      captchaDetector: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      detailedDataManager: {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getActiveDriver: vi.fn().mockReturnValue('chrome'),
      getCamoufoxPage: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getCamoufoxManager: vi.fn().mockReturnValue(null),
      setCamoufoxManager: vi.fn(),
      closeCamoufox: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getAutoDetectCaptcha: vi.fn().mockReturnValue(false),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getAutoSwitchHeadless: vi.fn().mockReturnValue(false),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getCaptchaTimeout: vi.fn().mockReturnValue(30000),
      setAutoDetectCaptcha: vi.fn(),
      setAutoSwitchHeadless: vi.fn(),
      setCaptchaTimeout: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all required handler modules', () => {
    const deps = makeDeps();
    const modules = initializeBrowserHandlerModules(deps);

    expect(modules.tabRegistry).toBeDefined();
    expect(modules.browserControl).toBeDefined();
    expect(modules.camoufoxBrowser).toBeDefined();
    expect(modules.pageNavigation).toBeDefined();
    expect(modules.pageInteraction).toBeDefined();
    expect(modules.pageEvaluation).toBeDefined();
    expect(modules.pageData).toBeDefined();
    expect(modules.domQuery).toBeDefined();
    expect(modules.domStyle).toBeDefined();
    expect(modules.domSearch).toBeDefined();
    expect(modules.consoleHandlers).toBeDefined();
    expect(modules.scriptManagement).toBeDefined();
    expect(modules.captchaHandlers).toBeDefined();
    expect(modules.stealthInjection).toBeDefined();
    expect(modules.frameworkState).toBeDefined();
    expect(modules.indexedDBDump).toBeDefined();
    expect(modules.jsHeapSearch).toBeDefined();
    expect(modules.tabWorkflow).toBeDefined();
    expect(modules.detailedData).toBeDefined();
  });

  it('creates all 18 handler instances', () => {
    const deps = makeDeps();
    initializeBrowserHandlerModules(deps);

    expect(handlers.BrowserControlHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.CamoufoxBrowserHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.PageNavigationHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.PageInteractionHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.PageEvaluationHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.PageDataHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.DOMQueryHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.DOMStyleHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.DOMSearchHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.ConsoleHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.ScriptManagementHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.CaptchaHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.StealthInjectionHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.FrameworkStateHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.IndexedDBDumpHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.JSHeapSearchHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.TabWorkflowHandlers).toHaveBeenCalledTimes(1);
    expect(handlers.DetailedDataHandlers).toHaveBeenCalledTimes(1);
  });

  it('passes correct deps to BrowserControlHandlers', () => {
    const deps = makeDeps();
    initializeBrowserHandlerModules(deps);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.collector).toBe(deps.collector);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.pageController).toBe(deps.pageController);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.consoleMonitor).toBe(deps.consoleMonitor);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.getActiveDriver).toBe(deps.getActiveDriver);
  });

  it('passes getCamoufoxManager deps to CamoufoxBrowserHandlers', () => {
    const deps = makeDeps();
    initializeBrowserHandlerModules(deps);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const call = handlers.CamoufoxBrowserHandlers.mock.calls[0]![0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.getCamoufoxManager).toBe(deps.getCamoufoxManager);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.setCamoufoxManager).toBe(deps.setCamoufoxManager);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.closeCamoufox).toBe(deps.closeCamoufox);
  });

  it('passes captcha settings to CaptchaHandlers', () => {
    const deps = makeDeps();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.getAutoDetectCaptcha as any).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (deps.getCaptchaTimeout as any).mockReturnValue(60000);
    initializeBrowserHandlerModules(deps);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const call = handlers.CaptchaHandlers.mock.calls[0]![0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.autoDetectCaptcha).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.captchaTimeout).toBe(60000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.setAutoDetectCaptcha).toBe(deps.setAutoDetectCaptcha);
  });

  it('passes domInspector to DOM handlers', () => {
    const deps = makeDeps();
    initializeBrowserHandlerModules(deps);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(handlers.DOMQueryHandlers.mock.calls[0]![0].domInspector).toBe(deps.domInspector);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(handlers.DOMStyleHandlers.mock.calls[0]![0].domInspector).toBe(deps.domInspector);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(handlers.DOMSearchHandlers.mock.calls[0]![0].domInspector).toBe(deps.domInspector);
  });

  it('provides getActivePage to framework state handlers', () => {
    const deps = makeDeps();
    initializeBrowserHandlerModules(deps);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const call = handlers.FrameworkStateHandlers.mock.calls[0]![0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(call.getActivePage).toBeTypeOf('function');
  });

  it('shares tabRegistry between browserControl and tabWorkflow', () => {
    const deps = makeDeps();
    const modules = initializeBrowserHandlerModules(deps);

    // The tabRegistry should be the same instance used by both handlers
    expect(modules.tabRegistry).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const controlCall = handlers.BrowserControlHandlers.mock.calls[0]![0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(controlCall.getTabRegistry()).toBe(modules.tabRegistry);
  });
});
