import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all handler classes and modules
vi.mock('@server/domains/shared/modules', () => ({
  AICaptchaDetector: vi.fn(),
  CamoufoxBrowserManager: vi.fn(),
  CodeCollector: vi.fn(),
  PageController: vi.fn(),
  DOMInspector: vi.fn(),
  ScriptManager: vi.fn(),
  ConsoleMonitor: vi.fn(),
}));

vi.mock('@utils/DetailedDataManager', () => ({
  DetailedDataManager: vi.fn(),
}));

vi.mock('@modules/browser/TabRegistry', () => ({
  TabRegistry: vi.fn().mockImplementation(() => ({ _mock: 'tabRegistry' })),
}));

// Mock all handler constructors
const handlers = vi.hoisted(() => ({
  BrowserControlHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'browserControl', deps: d })),
  CamoufoxBrowserHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'camoufox', deps: d })),
  PageNavigationHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'pageNav', deps: d })),
  PageInteractionHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'pageInteract', deps: d })),
  PageEvaluationHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'pageEval', deps: d })),
  PageDataHandlers: vi.fn().mockImplementation((d: unknown) => ({ _type: 'pageData', deps: d })),
  DOMQueryHandlers: vi.fn().mockImplementation((d: unknown) => ({ _type: 'domQuery', deps: d })),
  DOMStyleHandlers: vi.fn().mockImplementation((d: unknown) => ({ _type: 'domStyle', deps: d })),
  DOMSearchHandlers: vi.fn().mockImplementation((d: unknown) => ({ _type: 'domSearch', deps: d })),
  ConsoleHandlers: vi.fn().mockImplementation((d: unknown) => ({ _type: 'console', deps: d })),
  ScriptManagementHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'scriptMgmt', deps: d })),
  CaptchaHandlers: vi.fn().mockImplementation((d: unknown) => ({ _type: 'captcha', deps: d })),
  StealthInjectionHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'stealth', deps: d })),
  FrameworkStateHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'framework', deps: d })),
  IndexedDBDumpHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'indexeddb', deps: d })),
  JSHeapSearchHandlers: vi.fn().mockImplementation((d: unknown) => ({ _type: 'jsHeap', deps: d })),
  TabWorkflowHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'tabWorkflow', deps: d })),
  DetailedDataHandlers: vi
    .fn()
    .mockImplementation((d: unknown) => ({ _type: 'detailedData', deps: d })),
}));

vi.mock('@server/domains/browser/handlers/browser-control', () => ({
  BrowserControlHandlers: handlers.BrowserControlHandlers,
}));
vi.mock('@server/domains/browser/handlers/camoufox-browser', () => ({
  CamoufoxBrowserHandlers: handlers.CamoufoxBrowserHandlers,
}));
vi.mock('@server/domains/browser/handlers/page-navigation', () => ({
  PageNavigationHandlers: handlers.PageNavigationHandlers,
}));
vi.mock('@server/domains/browser/handlers/page-interaction', () => ({
  PageInteractionHandlers: handlers.PageInteractionHandlers,
}));
vi.mock('@server/domains/browser/handlers/page-evaluation', () => ({
  PageEvaluationHandlers: handlers.PageEvaluationHandlers,
}));
vi.mock('@server/domains/browser/handlers/page-data', () => ({
  PageDataHandlers: handlers.PageDataHandlers,
}));
vi.mock('@server/domains/browser/handlers/dom-query', () => ({
  DOMQueryHandlers: handlers.DOMQueryHandlers,
}));
vi.mock('@server/domains/browser/handlers/dom-style', () => ({
  DOMStyleHandlers: handlers.DOMStyleHandlers,
}));
vi.mock('@server/domains/browser/handlers/dom-search', () => ({
  DOMSearchHandlers: handlers.DOMSearchHandlers,
}));
vi.mock('@server/domains/browser/handlers/console-handlers', () => ({
  ConsoleHandlers: handlers.ConsoleHandlers,
}));
vi.mock('@server/domains/browser/handlers/script-management', () => ({
  ScriptManagementHandlers: handlers.ScriptManagementHandlers,
}));
vi.mock('@server/domains/browser/handlers/captcha-handlers', () => ({
  CaptchaHandlers: handlers.CaptchaHandlers,
}));
vi.mock('@server/domains/browser/handlers/stealth-injection', () => ({
  StealthInjectionHandlers: handlers.StealthInjectionHandlers,
}));
vi.mock('@server/domains/browser/handlers/framework-state', () => ({
  FrameworkStateHandlers: handlers.FrameworkStateHandlers,
}));
vi.mock('@server/domains/browser/handlers/indexeddb-dump', () => ({
  IndexedDBDumpHandlers: handlers.IndexedDBDumpHandlers,
}));
vi.mock('@server/domains/browser/handlers/js-heap', () => ({
  JSHeapSearchHandlers: handlers.JSHeapSearchHandlers,
}));
vi.mock('@server/domains/browser/handlers/tab-workflow', () => ({
  TabWorkflowHandlers: handlers.TabWorkflowHandlers,
}));
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
      collector: { getActivePage: vi.fn() } as any,
      pageController: {} as any,
      domInspector: {} as any,
      scriptManager: {} as any,
      consoleMonitor: {} as any,
      captchaDetector: {} as any,
      detailedDataManager: {} as any,
      getActiveDriver: vi.fn().mockReturnValue('chrome'),
      getCamoufoxPage: vi.fn(),
      getCamoufoxManager: vi.fn().mockReturnValue(null),
      setCamoufoxManager: vi.fn(),
      closeCamoufox: vi.fn(),
      getAutoDetectCaptcha: vi.fn().mockReturnValue(false),
      getAutoSwitchHeadless: vi.fn().mockReturnValue(false),
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

    const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
    expect(call.collector).toBe(deps.collector);
    expect(call.pageController).toBe(deps.pageController);
    expect(call.consoleMonitor).toBe(deps.consoleMonitor);
    expect(call.getActiveDriver).toBe(deps.getActiveDriver);
  });

  it('passes getCamoufoxManager deps to CamoufoxBrowserHandlers', () => {
    const deps = makeDeps();
    initializeBrowserHandlerModules(deps);

    const call = handlers.CamoufoxBrowserHandlers.mock.calls[0]![0];
    expect(call.getCamoufoxManager).toBe(deps.getCamoufoxManager);
    expect(call.setCamoufoxManager).toBe(deps.setCamoufoxManager);
    expect(call.closeCamoufox).toBe(deps.closeCamoufox);
  });

  it('passes captcha settings to CaptchaHandlers', () => {
    const deps = makeDeps();
    (deps.getAutoDetectCaptcha as any).mockReturnValue(true);
    (deps.getCaptchaTimeout as any).mockReturnValue(60000);
    initializeBrowserHandlerModules(deps);

    const call = handlers.CaptchaHandlers.mock.calls[0]![0];
    expect(call.autoDetectCaptcha).toBe(true);
    expect(call.captchaTimeout).toBe(60000);
    expect(call.setAutoDetectCaptcha).toBe(deps.setAutoDetectCaptcha);
  });

  it('passes domInspector to DOM handlers', () => {
    const deps = makeDeps();
    initializeBrowserHandlerModules(deps);

    expect(handlers.DOMQueryHandlers.mock.calls[0]![0].domInspector).toBe(deps.domInspector);
    expect(handlers.DOMStyleHandlers.mock.calls[0]![0].domInspector).toBe(deps.domInspector);
    expect(handlers.DOMSearchHandlers.mock.calls[0]![0].domInspector).toBe(deps.domInspector);
  });

  it('provides getActivePage to framework state handlers', () => {
    const deps = makeDeps();
    initializeBrowserHandlerModules(deps);

    const call = handlers.FrameworkStateHandlers.mock.calls[0]![0];
    expect(call.getActivePage).toBeTypeOf('function');
  });

  it('shares tabRegistry between browserControl and tabWorkflow', () => {
    const deps = makeDeps();
    const modules = initializeBrowserHandlerModules(deps);

    // The tabRegistry should be the same instance used by both handlers
    expect(modules.tabRegistry).toBeDefined();
    const controlCall = handlers.BrowserControlHandlers.mock.calls[0]![0];
    expect(controlCall.getTabRegistry()).toBe(modules.tabRegistry);
  });
});
