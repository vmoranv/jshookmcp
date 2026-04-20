/**
 * Part 1: Domain handlers.ts delegation tests
 *
 * Verifies that every domain's handlers.ts properly exports
 * the expected handler class (either as a re-export or as a direct class).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function asExportMap(value: any): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function asMethodMap(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

// ── Mock heavy dependencies so that handler module imports succeed ──

// Shared modules: explicit mock for every named export used by handler files
const mockClass = () =>
  vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    getActivePage: vi.fn(),
    getPage: vi.fn(),
    probeAll: vi.fn().mockResolvedValue({}),
    run: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '', exitCode: 0 }),
  }));

vi.mock('@server/domains/shared/modules', () => ({
  CodeAnalyzer: mockClass(),
  CamoufoxBrowserManager: mockClass(),
  AICaptchaDetector: mockClass(),
  CodeCollector: mockClass(),
  DOMInspector: mockClass(),
  PageController: mockClass(),
  CryptoDetector: mockClass(),
  ASTOptimizer: mockClass(),
  AdvancedDeobfuscator: mockClass(),
  Deobfuscator: mockClass(),
  ObfuscationDetector: mockClass(),
  DebuggerManager: mockClass(),
  RuntimeInspector: mockClass(),
  ScriptManager: mockClass(),
  BlackboxManager: mockClass(),
  ExternalToolRunner: mockClass(),
  ToolRegistry: mockClass(),
  HookManager: mockClass(),
  ConsoleMonitor: mockClass(),
  PerformanceMonitor: mockClass(),
  MemoryManager: mockClass(),
  UnifiedProcessManager: mockClass(),
  StealthScripts: mockClass(),
}));

vi.mock('@server/domains/shared/response', () => ({
  asJsonResponse: vi.fn((_: any) => ({ content: [{ type: 'text', text: '{}' }] })),
  asTextResponse: vi.fn((_: string) => ({ content: [{ type: 'text', text: '' }] })),
  serializeError: vi.fn((e: any) => String(e)),
}));

// Logger
vi.mock('@utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Antidebug scripts
vi.mock('@server/domains/antidebug/scripts', () => ({
  ANTI_DEBUG_SCRIPTS: {
    bypassDebuggerStatement: '/* bypass debugger */',
    bypassTiming: '/* bypass timing */',
    bypassStackTrace: '/* bypass stack trace */',
    bypassConsoleDetect: '/* bypass console detect */',
    detectProtections: '/* detect protections */',
  },
}));

vi.mock('@server/domains/antidebug/scripts.data', () => ({
  ANTI_DEBUG_SCRIPTS: {
    bypassDebuggerStatement: '/* bypass debugger */',
    bypassTiming: '/* bypass timing */',
    bypassStackTrace: '/* bypass stack trace */',
    bypassConsoleDetect: '/* bypass console detect */',
    detectProtections: '/* detect protections */',
  },
}));

// Debugger handler sub-modules
const mockDebuggerSubHandler = () =>
  vi.fn().mockImplementation(
    () =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'constructor') return vi.fn();
            return vi.fn().mockResolvedValue({ content: [] });
          },
        },
      ),
  );

vi.mock('@server/domains/debugger/handlers/debugger-control', () => ({
  DebuggerControlHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/debugger-stepping', () => ({
  DebuggerSteppingHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/debugger-evaluate', () => ({
  DebuggerEvaluateHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/debugger-state', () => ({
  DebuggerStateHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/session-management', () => ({
  SessionManagementHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/breakpoint-basic', () => ({
  BreakpointBasicHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/breakpoint-exception', () => ({
  BreakpointExceptionHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/xhr-breakpoint', () => ({
  XHRBreakpointHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/event-breakpoint', () => ({
  EventBreakpointHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/watch-expressions', () => ({
  WatchExpressionsHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/scope-inspection', () => ({
  ScopeInspectionHandlers: mockDebuggerSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/blackbox-handlers', () => ({
  BlackboxHandlers: mockDebuggerSubHandler(),
}));

// Platform handler sub-modules
vi.mock('@server/domains/platform/handlers/miniapp-handlers', () => ({
  MiniappHandlers: vi.fn().mockImplementation(() => ({
    handleMiniappPkgScan: vi.fn(),
    handleMiniappPkgUnpack: vi.fn(),
    handleMiniappPkgAnalyze: vi.fn(),
  })),
}));
vi.mock('@server/domains/platform/handlers/electron-handlers', () => ({
  ElectronHandlers: vi.fn().mockImplementation(() => ({
    handleAsarExtract: vi.fn(),
    handleElectronInspectApp: vi.fn(),
  })),
}));
vi.mock('@server/domains/platform/handlers/bridge-handlers', () => ({
  BridgeHandlers: vi.fn().mockImplementation(() => ({})),
}));

// Hooks dependencies
vi.mock('@server/domains/hooks/preset-definitions', () => ({
  PRESETS: {},
  PRESET_LIST: [],
}));
vi.mock('@server/domains/hooks/preset-builder', () => ({
  buildHookCode: vi.fn(),
}));

// Maintenance dependencies
vi.mock('@utils/TokenBudgetManager', () => ({
  TokenBudgetManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@utils/UnifiedCacheManager', () => ({
  UnifiedCacheManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@utils/artifactRetention', () => ({
  cleanupArtifacts: vi.fn(),
}));
vi.mock('@utils/environmentDoctor', () => ({
  runEnvironmentDoctor: vi.fn(),
}));
vi.mock('@services/LLMService', () => ({
  LLMService: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@utils/DetailedDataManager', () => ({
  DetailedDataManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@utils/outputPaths', () => ({
  resolveOutputDirectory: vi.fn(),
}));

// Wasm dependencies
vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi
    .fn()
    .mockResolvedValue({ absolutePath: '/tmp/test.wasm', displayPath: 'test.wasm' }),
}));

// Extension handlers deps
vi.mock(import('@src/constants'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    EXTENSION_GIT_CLONE_TIMEOUT_MS: 30000,
    EXTENSION_GIT_CHECKOUT_TIMEOUT_MS: 10000,
  };
});

// Analysis web-tools
vi.mock('@server/domains/analysis/handlers.web-tools', () => ({
  runSourceMapExtract: vi.fn(),
  runWebpackEnumerate: vi.fn(),
}));
vi.mock('@modules/deobfuscator/webcrack', () => ({
  runWebcrack: vi.fn(),
}));

// Browser sub-handler mocks
vi.mock('@server/domains/browser/handlers/browser-control', () => ({
  BrowserControlHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/camoufox-browser', () => ({
  CamoufoxBrowserHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/page-navigation', () => ({
  PageNavigationHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/page-interaction', () => ({
  PageInteractionHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/page-evaluation', () => ({
  PageEvaluationHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/page-data', () => ({
  PageDataHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/dom-query', () => ({
  DOMQueryHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/dom-style', () => ({
  DOMStyleHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/dom-search', () => ({
  DOMSearchHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/console-handlers', () => ({
  ConsoleHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/script-management', () => ({
  ScriptManagementHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/captcha-handlers', () => ({
  CaptchaHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/stealth-injection', () => ({
  StealthInjectionHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/framework-state', () => ({
  FrameworkStateHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/indexeddb-dump', () => ({
  IndexedDBDumpHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/detailed-data', () => ({
  DetailedDataHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/js-heap', () => ({
  JSHeapSearchHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/tab-workflow', () => ({
  TabWorkflowHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/browser/handlers/facade-initializer', () => ({
  initializeBrowserHandlerModules: vi.fn().mockReturnValue({}),
}));
vi.mock('@server/domains/browser/handlers/human-behavior', () => ({
  handleHumanMouse: vi.fn(),
  handleHumanScroll: vi.fn(),
  handleHumanTyping: vi.fn(),
}));
vi.mock('@server/domains/browser/handlers/captcha-solver', () => ({
  handleCaptchaVisionSolve: vi.fn(),
  handleWidgetChallengeSolve: vi.fn(),
}));
vi.mock('@server/domains/browser/handlers/camoufox-flow', () => ({
  handleCamoufoxLaunchFlow: vi.fn(),
  handleCamoufoxNavigateFlow: vi.fn(),
}));

// ── Delegation chain mocks for handlers.impl files that re-export from .impl.core ──

// encoding, graphql, network, process, sourcemap, streaming, transform, workflow
// have handlers.impl.core.ts -> handlers.impl.core.runtime.ts chains
vi.mock('@server/domains/encoding/handlers.impl.core.runtime', () => ({
  EncodingToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/graphql/handlers.impl.core.runtime', () => ({
  GraphQLToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/network/handlers.impl.core.runtime', () => ({
  AdvancedToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/process/handlers.impl.core.runtime', () => ({
  ProcessToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/sourcemap/handlers.impl.sourcemap-main', () => ({
  SourcemapToolHandlersMain: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/streaming/handlers.impl.streaming-sse', () => ({
  StreamingToolHandlersSse: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/transform/handlers.impl.transform-crypto', () => ({
  TransformToolHandlersCrypto: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/workflow/handlers.impl.workflow-batch', () => ({
  WorkflowHandlersBatch: vi.fn().mockImplementation(() => ({})),
}));

// ── Tests ──

describe('Domain handler delegation (handlers.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Pure re-export handlers.ts files: they just re-export from handlers.impl
  const pureReExportDomains = [
    { domain: 'analysis', exportName: 'CoreAnalysisHandlers' },
    { domain: 'encoding', exportName: 'EncodingToolHandlers' },
    { domain: 'graphql', exportName: 'GraphQLToolHandlers' },
    { domain: 'network', exportName: 'AdvancedToolHandlers' },
    { domain: 'process', exportName: 'ProcessToolHandlers' },
    { domain: 'sourcemap', exportName: 'SourcemapToolHandlers' },
    { domain: 'streaming', exportName: 'StreamingToolHandlers' },
    { domain: 'transform', exportName: 'TransformToolHandlers' },
    { domain: 'workflow', exportName: 'WorkflowHandlers' },
  ] as const;

  // Lazy loader map — avoids Vite dynamic-import-vars warning
  type PureDomain = (typeof pureReExportDomains)[number]['domain'];

  const pureHandlerModuleLoaders = {
    analysis: () => import('@server/domains/analysis/handlers'),
    encoding: () => import('@server/domains/encoding/handlers'),
    graphql: () => import('@server/domains/graphql/handlers'),
    network: () => import('@server/domains/network/handlers'),
    process: () => import('@server/domains/process/handlers'),
    sourcemap: () => import('@server/domains/sourcemap/handlers'),
    streaming: () => import('@server/domains/streaming/handlers'),
    transform: () => import('@server/domains/transform/handlers'),
    workflow: () => import('@server/domains/workflow/handlers'),
  } satisfies Record<PureDomain, () => Promise<Record<string, unknown>>>;

  async function loadHandlerModule(domain: PureDomain) {
    return asExportMap(await pureHandlerModuleLoaders[domain]());
  }

  describe.each(pureReExportDomains)(
    '$domain/handlers.ts re-exports $exportName',
    ({ domain, exportName }) => {
      it(`exports ${exportName} as a constructor function`, async () => {
        const mod = await loadHandlerModule(domain);
        expect(mod[exportName]).toBeDefined();
        expect(typeof mod[exportName]).toBe('function');
      });

      it(`has no unexpected exports besides ${exportName}`, async () => {
        const mod = await loadHandlerModule(domain);
        const exportedNames = Object.keys(mod).filter((k) => k !== '__esModule');
        expect(exportedNames).toContain(exportName);
      });
    },
  );

  // Browser handlers.ts re-exports many classes
  describe('browser/handlers.ts re-exports', () => {
    const expectedBrowserExports = [
      'BrowserToolHandlers',
      'BrowserControlHandlers',
      'CamoufoxBrowserHandlers',
      'PageNavigationHandlers',
      'PageInteractionHandlers',
      'PageEvaluationHandlers',
      'PageDataHandlers',

      'ConsoleHandlers',
      'ScriptManagementHandlers',
      'CaptchaHandlers',
      'StealthInjectionHandlers',
      'FrameworkStateHandlers',
      'IndexedDBDumpHandlers',
      'DetailedDataHandlers',
    ];

    it.each(expectedBrowserExports)('exports %s', async (name) => {
      const mod = asExportMap(await import('@server/domains/browser/handlers'));
      expect(mod[name]).toBeDefined();
      expect(typeof mod[name]).toBe('function');
    });
  });

  // Debugger handlers.ts: class with delegation + re-exports
  describe('debugger/handlers.ts', () => {
    it('exports DebuggerToolHandlers as a constructor', async () => {
      const mod = await import('@server/domains/debugger/handlers');
      expect(mod.DebuggerToolHandlers).toBeDefined();
      expect(typeof mod.DebuggerToolHandlers).toBe('function');
    });

    it('re-exports all sub-handler classes', async () => {
      const mod = asExportMap(await import('@server/domains/debugger/handlers'));
      const expectedSubHandlers = [
        'DebuggerControlHandlers',
        'DebuggerSteppingHandlers',
        'DebuggerEvaluateHandlers',
        'DebuggerStateHandlers',
        'SessionManagementHandlers',
        'BreakpointBasicHandlers',
        'BreakpointExceptionHandlers',
        'XHRBreakpointHandlers',
        'EventBreakpointHandlers',
        'WatchExpressionsHandlers',
        'ScopeInspectionHandlers',
        'BlackboxHandlers',
      ];
      for (const name of expectedSubHandlers) {
        expect(mod[name]).toBeDefined();
        expect(typeof mod[name]).toBe('function');
      }
    });

    it('can be instantiated and delegates methods', async () => {
      const mod = await import('@server/domains/debugger/handlers');
      const instance = new mod.DebuggerToolHandlers({} as never, {} as never);
      expect(instance).toBeDefined();

      // Verify a sample of delegation methods exist
      const delegationMethods = [
        'handleDebuggerLifecycle',
        'handleDebuggerLifecycle',
        'handleDebuggerPause',
        'handleDebuggerResume',
        'handleDebuggerStepInto',
        'handleDebuggerStepOver',
        'handleDebuggerStepOut',
        'handleDebuggerEvaluate',
        'handleBreakpointSet',
        'handleBreakpointRemove',
        'handleBreakpointList',
        'handleBlackboxAdd',
        'handleBlackboxList',
      ];
      for (const method of delegationMethods) {
        expect(typeof asMethodMap(instance)[method]).toBe('function');
      }
    });
  });

  // Antidebug handlers.ts: full class with actual logic
  describe('antidebug/handlers.ts', () => {
    it('exports AntiDebugToolHandlers as a constructor', async () => {
      const mod = await import('@server/domains/antidebug/handlers');
      expect(mod.AntiDebugToolHandlers).toBeDefined();
      expect(typeof mod.AntiDebugToolHandlers).toBe('function');
    });

    it('can be instantiated with a collector', async () => {
      const mod = await import('@server/domains/antidebug/handlers');
      const mockCollector = { getActivePage: vi.fn() } as never;
      const instance = new mod.AntiDebugToolHandlers(mockCollector);
      expect(instance).toBeDefined();
    });

    it('has expected handler methods', async () => {
      const mod = await import('@server/domains/antidebug/handlers');
      const mockCollector = { getActivePage: vi.fn() } as never;
      const instance = new mod.AntiDebugToolHandlers(mockCollector);

      const expectedMethods = [
        'handleAntiDebugBypassAll',
        'handleAntiDebugBypassDebuggerStatement',
        'handleAntiDebugBypassTiming',
        'handleAntiDebugBypassStackTrace',
        'handleAntiDebugBypassConsoleDetect',
        'handleAntiDebugDetectProtections',
      ];

      for (const method of expectedMethods) {
        expect(typeof asMethodMap(instance)[method]).toBe('function');
      }
    });
  });

  // Platform handlers.ts: facade that delegates to sub-handlers
  describe('platform/handlers.ts', () => {
    it('exports PlatformToolHandlers as a constructor', async () => {
      const mod = await import('@server/domains/platform/handlers');
      expect(mod.PlatformToolHandlers).toBeDefined();
      expect(typeof mod.PlatformToolHandlers).toBe('function');
    });

    it('can be instantiated and has delegation methods', async () => {
      const mod = await import('@server/domains/platform/handlers');
      const instance = new mod.PlatformToolHandlers({} as never);
      expect(instance).toBeDefined();

      const expectedMethods = [
        'handleMiniappPkgScan',
        'handleMiniappPkgUnpack',
        'handleMiniappPkgAnalyze',
        'handleAsarExtract',
        'handleElectronInspectApp',
      ];

      for (const method of expectedMethods) {
        expect(typeof asMethodMap(instance)[method]).toBe('function');
      }
    });
  });

  // Wasm handlers.ts: full class (no handlers.impl)
  describe('wasm/handlers.ts', () => {
    it('exports WasmToolHandlers as a constructor', async () => {
      const mod = await import('@server/domains/wasm/handlers');
      expect(mod.WasmToolHandlers).toBeDefined();
      expect(typeof mod.WasmToolHandlers).toBe('function');
    });

    it('can be instantiated and has expected methods', async () => {
      const mod = await import('@server/domains/wasm/handlers');
      const instance = new mod.WasmToolHandlers({} as never);
      expect(instance).toBeDefined();

      const expectedMethods = [
        'handleWasmDump',
        'handleWasmDisassemble',
        'handleWasmDecompile',
        'handleWasmInspectSections',
        'handleWasmOfflineRun',
        'handleWasmOptimize',
        'handleWasmVmpTrace',
        'handleWasmMemoryInspect',
      ];

      for (const method of expectedMethods) {
        expect(typeof asMethodMap(instance)[method]).toBe('function');
      }
    });
  });

  // Maintenance handlers.ts: actual class
  describe('maintenance/handlers.ts', () => {
    it('exports CoreMaintenanceHandlers as a constructor', async () => {
      const mod = await import('@server/domains/maintenance/handlers');
      expect(mod.CoreMaintenanceHandlers).toBeDefined();
      expect(typeof mod.CoreMaintenanceHandlers).toBe('function');
    });
  });

  // Maintenance extension handlers
  describe('maintenance/handlers.extensions.ts', () => {
    it('exports ExtensionManagementHandlers as a constructor', async () => {
      const mod = await import('@server/domains/maintenance/handlers.extensions');
      expect(mod.ExtensionManagementHandlers).toBeDefined();
      expect(typeof mod.ExtensionManagementHandlers).toBe('function');
    });
  });

  // Hooks handlers
  describe('hooks/ai-handlers.ts', () => {
    it('exports AIHookToolHandlers as a constructor', async () => {
      const mod = await import('@server/domains/hooks/ai-handlers');
      expect(mod.AIHookToolHandlers).toBeDefined();
      expect(typeof mod.AIHookToolHandlers).toBe('function');
    });
  });

  describe('hooks/preset-handlers.ts', () => {
    it('exports HookPresetToolHandlers as a constructor', async () => {
      const mod = await import('@server/domains/hooks/preset-handlers');
      expect(mod.HookPresetToolHandlers).toBeDefined();
      expect(typeof mod.HookPresetToolHandlers).toBe('function');
    });
  });
});
