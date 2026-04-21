import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all handler classes and modules
vi.mock('@server/domains/shared/modules', () => ({
  AICaptchaDetector: vi.fn(),
  CamoufoxBrowserManager: vi.fn(),
  CodeCollector: vi.fn(),
  PageController: vi.fn(),
  ScriptManager: vi.fn(),
  ConsoleMonitor: vi.fn(),
}));

vi.mock('@utils/DetailedDataManager', () => ({
  DetailedDataManager: vi.fn(),
}));

vi.mock('@modules/browser/TabRegistry', () => ({
  TabRegistry: vi.fn().mockImplementation(() => ({
    _mock: 'tabRegistry',
    register: vi.fn(),
    getByAlias: vi.fn(),
  })),
}));

// Mock all handler constructors with tracking
const handlers = vi.hoisted(() => ({
  BrowserControlHandlers: vi
    .fn()
    .mockImplementation((d: any) => ({ _type: 'browserControl', deps: d })),
  CamoufoxBrowserHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'camoufox', deps: d })),
  PageNavigationHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'pageNav', deps: d })),
  PageInteractionHandlers: vi
    .fn()
    .mockImplementation((d: any) => ({ _type: 'pageInteract', deps: d })),
  PageEvaluationHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'pageEval', deps: d })),
  PageDataHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'pageData', deps: d })),
  ConsoleHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'console', deps: d })),
  ScriptManagementHandlers: vi
    .fn()
    .mockImplementation((d: any) => ({ _type: 'scriptMgmt', deps: d })),
  CaptchaHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'captcha', deps: d })),
  StealthInjectionHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'stealth', deps: d })),
  FrameworkStateHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'framework', deps: d })),
  IndexedDBDumpHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'indexeddb', deps: d })),
  JSHeapSearchHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'jsHeap', deps: d })),
  TabWorkflowHandlers: vi.fn().mockImplementation((d: any) => ({ _type: 'tabWorkflow', deps: d })),
  DetailedDataHandlers: vi
    .fn()
    .mockImplementation((d: any) => ({ _type: 'detailedData', deps: d })),
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
  type BrowserHandlerModules,
} from '@server/domains/browser/handlers/facade-initializer';

describe('initializeBrowserHandlerModules — comprehensive coverage', () => {
  function makeDeps(): BrowserHandlerModuleInitDeps {
    return {
      collector: {
        getActivePage: vi.fn().mockResolvedValue({ id: 'page-1' }),
      } as any,
      pageController: { _mock: 'pageController' } as any,
      scriptManager: { _mock: 'scriptManager' } as any,
      consoleMonitor: { _mock: 'consoleMonitor' } as any,
      captchaDetector: { _mock: 'captchaDetector' } as any,
      detailedDataManager: { _mock: 'detailedDataManager' } as any,
      getActiveDriver: vi.fn().mockReturnValue('chrome'),
      getCamoufoxPage: vi.fn().mockResolvedValue(null),
      getCamoufoxManager: vi.fn().mockReturnValue(null),
      setCamoufoxManager: vi.fn(),
      closeCamoufox: vi.fn().mockResolvedValue(undefined),
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

  describe('module initialization', () => {
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

    it('creates exactly 18 handler instances', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      expect(handlers.BrowserControlHandlers).toHaveBeenCalledTimes(1);
      expect(handlers.CamoufoxBrowserHandlers).toHaveBeenCalledTimes(1);
      expect(handlers.PageNavigationHandlers).toHaveBeenCalledTimes(1);
      expect(handlers.PageInteractionHandlers).toHaveBeenCalledTimes(1);
      expect(handlers.PageEvaluationHandlers).toHaveBeenCalledTimes(1);
      expect(handlers.PageDataHandlers).toHaveBeenCalledTimes(1);
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
  });

  describe('BrowserControlHandlers deps', () => {
    it('passes collector to BrowserControlHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
      expect(call.collector).toBe(deps.collector);
    });

    it('passes pageController to BrowserControlHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
      expect(call.pageController).toBe(deps.pageController);
    });

    it('passes consoleMonitor to BrowserControlHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
      expect(call.consoleMonitor).toBe(deps.consoleMonitor);
    });

    it('passes getActiveDriver to BrowserControlHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
      expect(call.getActiveDriver).toBe(deps.getActiveDriver);
    });

    it('passes getCamoufoxManager to BrowserControlHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
      expect(call.getCamoufoxManager).toBe(deps.getCamoufoxManager);
    });

    it('passes getCamoufoxPage to BrowserControlHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
      expect(call.getCamoufoxPage).toBe(deps.getCamoufoxPage);
    });

    it('provides getTabRegistry function that returns tabRegistry', () => {
      const deps = makeDeps();
      const modules = initializeBrowserHandlerModules(deps);

      const call = handlers.BrowserControlHandlers.mock.calls[0]![0];
      expect(typeof call.getTabRegistry).toBe('function');
      expect(call.getTabRegistry()).toBe(modules.tabRegistry);
    });
  });

  describe('CamoufoxBrowserHandlers deps', () => {
    it('passes getCamoufoxManager to CamoufoxBrowserHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.CamoufoxBrowserHandlers.mock.calls[0]![0];
      expect(call.getCamoufoxManager).toBe(deps.getCamoufoxManager);
    });

    it('passes setCamoufoxManager to CamoufoxBrowserHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.CamoufoxBrowserHandlers.mock.calls[0]![0];
      expect(call.setCamoufoxManager).toBe(deps.setCamoufoxManager);
    });

    it('passes closeCamoufox to CamoufoxBrowserHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.CamoufoxBrowserHandlers.mock.calls[0]![0];
      expect(call.closeCamoufox).toBe(deps.closeCamoufox);
    });
  });

  describe('PageNavigationHandlers deps', () => {
    it('passes pageController to PageNavigationHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.PageNavigationHandlers.mock.calls[0]![0];
      expect(call.pageController).toBe(deps.pageController);
    });

    it('passes consoleMonitor to PageNavigationHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.PageNavigationHandlers.mock.calls[0]![0];
      expect(call.consoleMonitor).toBe(deps.consoleMonitor);
    });

    it('passes getActiveDriver (commonDeps) to PageNavigationHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.PageNavigationHandlers.mock.calls[0]![0];
      expect(call.getActiveDriver).toBe(deps.getActiveDriver);
    });

    it('passes getCamoufoxPage (commonDeps) to PageNavigationHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.PageNavigationHandlers.mock.calls[0]![0];
      expect(call.getCamoufoxPage).toBe(deps.getCamoufoxPage);
    });
  });

  describe('PageInteractionHandlers deps', () => {
    it('passes pageController and commonDeps to PageInteractionHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.PageInteractionHandlers.mock.calls[0]![0];
      expect(call.pageController).toBe(deps.pageController);
      expect(call.getActiveDriver).toBe(deps.getActiveDriver);
      expect(call.getCamoufoxPage).toBe(deps.getCamoufoxPage);
    });
  });

  describe('PageEvaluationHandlers deps', () => {
    it('passes pageController and detailedDataManager to PageEvaluationHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.PageEvaluationHandlers.mock.calls[0]![0];
      expect(call.pageController).toBe(deps.pageController);
      expect(call.detailedDataManager).toBe(deps.detailedDataManager);
    });

    it('passes commonDeps to PageEvaluationHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.PageEvaluationHandlers.mock.calls[0]![0];
      expect(call.getActiveDriver).toBe(deps.getActiveDriver);
      expect(call.getCamoufoxPage).toBe(deps.getCamoufoxPage);
    });
  });

  describe('PageDataHandlers deps', () => {
    it('passes pageController and commonDeps to PageDataHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.PageDataHandlers.mock.calls[0]![0];
      expect(call.pageController).toBe(deps.pageController);
      expect(call.getActiveDriver).toBe(deps.getActiveDriver);
      expect(call.getCamoufoxPage).toBe(deps.getCamoufoxPage);
    });
  });

  describe('ConsoleHandlers deps', () => {
    it('passes consoleMonitor and detailedDataManager to ConsoleHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.ConsoleHandlers.mock.calls[0]![0];
      expect(call.consoleMonitor).toBe(deps.consoleMonitor);
      expect(call.detailedDataManager).toBe(deps.detailedDataManager);
    });
  });

  describe('ScriptManagementHandlers deps', () => {
    it('passes scriptManager and detailedDataManager to ScriptManagementHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.ScriptManagementHandlers.mock.calls[0]![0];
      expect(call.scriptManager).toBe(deps.scriptManager);
      expect(call.detailedDataManager).toBe(deps.detailedDataManager);
    });
  });

  describe('CaptchaHandlers deps', () => {
    it('passes pageController to CaptchaHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.CaptchaHandlers.mock.calls[0]![0];
      expect(call.pageController).toBe(deps.pageController);
    });

    it('passes captchaDetector to CaptchaHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.CaptchaHandlers.mock.calls[0]![0];
      expect(call.captchaDetector).toBe(deps.captchaDetector);
    });

    it('evaluates and passes current captcha settings', () => {
      const deps = makeDeps();
      (deps.getAutoDetectCaptcha as any).mockReturnValue(true);
      (deps.getAutoSwitchHeadless as any).mockReturnValue(true);
      (deps.getCaptchaTimeout as any).mockReturnValue(60000);

      initializeBrowserHandlerModules(deps);

      const call = handlers.CaptchaHandlers.mock.calls[0]![0];
      expect(call.autoDetectCaptcha).toBe(true);
      expect(call.autoSwitchHeadless).toBe(true);
      expect(call.captchaTimeout).toBe(60000);
    });

    it('passes setter functions for captcha settings', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.CaptchaHandlers.mock.calls[0]![0];
      expect(call.setAutoDetectCaptcha).toBe(deps.setAutoDetectCaptcha);
      expect(call.setAutoSwitchHeadless).toBe(deps.setAutoSwitchHeadless);
      expect(call.setCaptchaTimeout).toBe(deps.setCaptchaTimeout);
    });
  });

  describe('StealthInjectionHandlers deps', () => {
    it('passes pageController and commonDeps to StealthInjectionHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.StealthInjectionHandlers.mock.calls[0]![0];
      expect(call.pageController).toBe(deps.pageController);
      expect(call.getActiveDriver).toBe(deps.getActiveDriver);
    });
  });

  describe('FrameworkStateHandlers deps', () => {
    it('provides getActivePage function wrapping collector.getActivePage', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.FrameworkStateHandlers.mock.calls[0]![0];
      expect(typeof call.getActivePage).toBe('function');

      // Call the provided function and verify it delegates to collector
      call.getActivePage();
      expect(deps.collector.getActivePage).toHaveBeenCalled();
    });
  });

  describe('IndexedDBDumpHandlers deps', () => {
    it('provides getActivePage function wrapping collector.getActivePage', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.IndexedDBDumpHandlers.mock.calls[0]![0];
      expect(typeof call.getActivePage).toBe('function');

      call.getActivePage();
      expect(deps.collector.getActivePage).toHaveBeenCalled();
    });
  });

  describe('JSHeapSearchHandlers deps', () => {
    it('provides getActivePage function wrapping collector.getActivePage', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.JSHeapSearchHandlers.mock.calls[0]![0];
      expect(typeof call.getActivePage).toBe('function');

      call.getActivePage();
      expect(deps.collector.getActivePage).toHaveBeenCalled();
    });

    it('passes getActiveDriver to JSHeapSearchHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.JSHeapSearchHandlers.mock.calls[0]![0];
      expect(call.getActiveDriver).toBe(deps.getActiveDriver);
    });
  });

  describe('TabWorkflowHandlers deps', () => {
    it('passes getActiveDriver to TabWorkflowHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.TabWorkflowHandlers.mock.calls[0]![0];
      expect(call.getActiveDriver).toBe(deps.getActiveDriver);
    });

    it('passes getCamoufoxPage to TabWorkflowHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.TabWorkflowHandlers.mock.calls[0]![0];
      expect(call.getCamoufoxPage).toBe(deps.getCamoufoxPage);
    });

    it('provides getPageController function returning pageController', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.TabWorkflowHandlers.mock.calls[0]![0];
      expect(typeof call.getPageController).toBe('function');
      expect(call.getPageController()).toBe(deps.pageController);
    });

    it('provides getTabRegistry function returning tabRegistry', () => {
      const deps = makeDeps();
      const modules = initializeBrowserHandlerModules(deps);

      const call = handlers.TabWorkflowHandlers.mock.calls[0]![0];
      expect(typeof call.getTabRegistry).toBe('function');
      expect(call.getTabRegistry()).toBe(modules.tabRegistry);
    });
  });

  describe('DetailedDataHandlers deps', () => {
    it('passes detailedDataManager to DetailedDataHandlers', () => {
      const deps = makeDeps();
      initializeBrowserHandlerModules(deps);

      const call = handlers.DetailedDataHandlers.mock.calls[0]![0];
      expect(call.detailedDataManager).toBe(deps.detailedDataManager);
    });
  });

  describe('TabRegistry sharing', () => {
    it('shares same tabRegistry between browserControl and tabWorkflow', () => {
      const deps = makeDeps();
      const modules = initializeBrowserHandlerModules(deps);

      const browserControlCall = handlers.BrowserControlHandlers.mock.calls[0]![0];
      const tabWorkflowCall = handlers.TabWorkflowHandlers.mock.calls[0]![0];

      // Both should return the same tabRegistry instance
      expect(browserControlCall.getTabRegistry()).toBe(modules.tabRegistry);
      expect(tabWorkflowCall.getTabRegistry()).toBe(modules.tabRegistry);
      expect(browserControlCall.getTabRegistry()).toBe(tabWorkflowCall.getTabRegistry());
    });
  });

  describe('return value structure', () => {
    it('returns object conforming to BrowserHandlerModules interface', () => {
      const deps = makeDeps();
      const modules: BrowserHandlerModules = initializeBrowserHandlerModules(deps);

      // Type check - these properties must exist
      const requiredKeys: (keyof BrowserHandlerModules)[] = [
        'tabRegistry',
        'browserControl',
        'camoufoxBrowser',
        'pageNavigation',
        'pageInteraction',
        'pageEvaluation',
        'pageData',
        'consoleHandlers',
        'scriptManagement',
        'captchaHandlers',
        'stealthInjection',
        'frameworkState',
        'indexedDBDump',
        'jsHeapSearch',
        'tabWorkflow',
        'detailedData',
      ];

      for (const key of requiredKeys) {
        expect(modules[key]).toBeDefined();
      }
    });
  });
});
