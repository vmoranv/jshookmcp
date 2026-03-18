/**
 * Part 2: Domain index.ts barrel file export tests
 *
 * Verifies that each domain's index.ts correctly re-exports
 * tool definitions and handler classes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all heavy dependencies ──

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
  AIHookGenerator: mockClass(),
  HookManager: mockClass(),
  ConsoleMonitor: mockClass(),
  PerformanceMonitor: mockClass(),
  MemoryManager: mockClass(),
  UnifiedProcessManager: mockClass(),
  StealthScripts: mockClass(),
}));

vi.mock('@server/domains/shared/response', () => ({
  asJsonResponse: vi.fn(),
  asTextResponse: vi.fn(),
  serializeError: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@server/domains/antidebug/scripts', () => ({
  ANTI_DEBUG_SCRIPTS: {
    bypassDebuggerStatement: '',
    bypassTiming: '',
    bypassStackTrace: '',
    bypassConsoleDetect: '',
    detectProtections: '',
  },
}));
vi.mock('@server/domains/antidebug/scripts.data', () => ({
  ANTI_DEBUG_SCRIPTS: {
    bypassDebuggerStatement: '',
    bypassTiming: '',
    bypassStackTrace: '',
    bypassConsoleDetect: '',
    detectProtections: '',
  },
}));

// Debugger sub-handler mocks
const mockSubHandler = () =>
  vi
    .fn()
    .mockImplementation(
      () => new Proxy({}, { get: () => vi.fn().mockResolvedValue({ content: [] }) })
    );

vi.mock('@server/domains/debugger/handlers/debugger-control', () => ({
  DebuggerControlHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/debugger-stepping', () => ({
  DebuggerSteppingHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/debugger-evaluate', () => ({
  DebuggerEvaluateHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/debugger-state', () => ({
  DebuggerStateHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/session-management', () => ({
  SessionManagementHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/breakpoint-basic', () => ({
  BreakpointBasicHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/breakpoint-exception', () => ({
  BreakpointExceptionHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/xhr-breakpoint', () => ({
  XHRBreakpointHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/event-breakpoint', () => ({
  EventBreakpointHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/watch-expressions', () => ({
  WatchExpressionsHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/scope-inspection', () => ({
  ScopeInspectionHandlers: mockSubHandler(),
}));
vi.mock('@server/domains/debugger/handlers/blackbox-handlers', () => ({
  BlackboxHandlers: mockSubHandler(),
}));

// Platform sub-handler mocks
vi.mock('@server/domains/platform/handlers/miniapp-handlers', () => ({
  MiniappHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/platform/handlers/electron-handlers', () => ({
  ElectronHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/platform/handlers/bridge-handlers', () => ({
  BridgeHandlers: vi.fn().mockImplementation(() => ({})),
}));

// Hooks dependencies
vi.mock('@server/domains/hooks/preset-definitions', () => ({ PRESETS: {}, PRESET_LIST: [] }));
vi.mock('@server/domains/hooks/preset-builder', () => ({ buildHookCode: vi.fn() }));

// Maintenance dependencies
vi.mock('@utils/TokenBudgetManager', () => ({
  TokenBudgetManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@utils/UnifiedCacheManager', () => ({
  UnifiedCacheManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@utils/artifactRetention', () => ({ cleanupArtifacts: vi.fn() }));
vi.mock('@utils/environmentDoctor', () => ({ runEnvironmentDoctor: vi.fn() }));
vi.mock('@services/LLMService', () => ({ LLMService: vi.fn().mockImplementation(() => ({})) }));
vi.mock('@utils/DetailedDataManager', () => ({
  DetailedDataManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@utils/outputPaths', () => ({ resolveOutputDirectory: vi.fn() }));
vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi
    .fn()
    .mockResolvedValue({ absolutePath: '/tmp/test', displayPath: 'test' }),
}));
vi.mock('@src/constants', () => ({
  EXTENSION_GIT_CLONE_TIMEOUT_MS: 30000,
  EXTENSION_GIT_CHECKOUT_TIMEOUT_MS: 10000,
}));

// Analysis web-tools
vi.mock('@server/domains/analysis/handlers.web-tools', () => ({
  runSourceMapExtract: vi.fn(),
  runWebpackEnumerate: vi.fn(),
}));
vi.mock('@modules/deobfuscator/webcrack', () => ({ runWebcrack: vi.fn() }));

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

// handlers.impl.core chain mocks
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

describe('Domain barrel file exports (index.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analysis/index.ts', () => {
    it('exports coreTools and CoreAnalysisHandlers', async () => {
      const mod = await import('@server/domains/analysis/index');
      expect(mod.coreTools).toBeDefined();
      expect(Array.isArray(mod.coreTools)).toBe(true);
      expect(mod.CoreAnalysisHandlers).toBeDefined();
      expect(typeof mod.CoreAnalysisHandlers).toBe('function');
    });
  });

  describe('antidebug/index.ts', () => {
    it('exports antidebugTools, ANTI_DEBUG_SCRIPTS, and AntiDebugToolHandlers', async () => {
      const mod = await import('@server/domains/antidebug/index');
      expect(mod.antidebugTools).toBeDefined();
      expect(Array.isArray(mod.antidebugTools)).toBe(true);
      expect(mod.ANTI_DEBUG_SCRIPTS).toBeDefined();
      expect(mod.AntiDebugToolHandlers).toBeDefined();
      expect(typeof mod.AntiDebugToolHandlers).toBe('function');
    });
  });

  describe('browser/index.ts', () => {
    it('exports browserTools, advancedBrowserToolDefinitions, and BrowserToolHandlers', async () => {
      const mod = await import('@server/domains/browser/index');
      expect(mod.browserTools).toBeDefined();
      expect(mod.advancedBrowserToolDefinitions).toBeDefined();
      expect(mod.BrowserToolHandlers).toBeDefined();
      expect(typeof mod.BrowserToolHandlers).toBe('function');
    });
  });

  describe('debugger/index.ts', () => {
    it('exports debuggerTools and DebuggerToolHandlers', async () => {
      const mod = await import('@server/domains/debugger/index');
      expect(mod.debuggerTools).toBeDefined();
      expect(Array.isArray(mod.debuggerTools)).toBe(true);
      expect(mod.DebuggerToolHandlers).toBeDefined();
      expect(typeof mod.DebuggerToolHandlers).toBe('function');
    });
  });

  describe('encoding/index.ts', () => {
    it('exports encodingTools and EncodingToolHandlers', async () => {
      const mod = await import('@server/domains/encoding/index');
      expect(mod.encodingTools).toBeDefined();
      expect(Array.isArray(mod.encodingTools)).toBe(true);
      expect(mod.EncodingToolHandlers).toBeDefined();
      expect(typeof mod.EncodingToolHandlers).toBe('function');
    });
  });

  describe('graphql/index.ts', () => {
    it('exports graphqlTools and GraphQLToolHandlers', async () => {
      const mod = await import('@server/domains/graphql/index');
      expect(mod.graphqlTools).toBeDefined();
      expect(Array.isArray(mod.graphqlTools)).toBe(true);
      expect(mod.GraphQLToolHandlers).toBeDefined();
      expect(typeof mod.GraphQLToolHandlers).toBe('function');
    });
  });

  describe('hooks/index.ts', () => {
    it('exports hook tool definitions and both handler classes', async () => {
      const mod = await import('@server/domains/hooks/index');
      expect(mod.aiHookTools).toBeDefined();
      expect(mod.hookPresetTools).toBeDefined();
      expect(mod.AIHookToolHandlers).toBeDefined();
      expect(typeof mod.AIHookToolHandlers).toBe('function');
      expect(mod.HookPresetToolHandlers).toBeDefined();
      expect(typeof mod.HookPresetToolHandlers).toBe('function');
    });
  });

  describe('maintenance/index.ts', () => {
    it('exports tool definitions and both handler classes', async () => {
      const mod = await import('@server/domains/maintenance/index');
      expect(mod.tokenBudgetTools).toBeDefined();
      expect(mod.cacheTools).toBeDefined();
      expect(mod.extensionTools).toBeDefined();
      expect(mod.artifactTools).toBeDefined();
      expect(mod.CoreMaintenanceHandlers).toBeDefined();
      expect(typeof mod.CoreMaintenanceHandlers).toBe('function');
      expect(mod.ExtensionManagementHandlers).toBeDefined();
      expect(typeof mod.ExtensionManagementHandlers).toBe('function');
    });
  });

  describe('network/index.ts', () => {
    it('exports advancedTools and AdvancedToolHandlers', async () => {
      const mod = await import('@server/domains/network/index');
      expect(mod.advancedTools).toBeDefined();
      expect(Array.isArray(mod.advancedTools)).toBe(true);
      expect(mod.AdvancedToolHandlers).toBeDefined();
      expect(typeof mod.AdvancedToolHandlers).toBe('function');
    });
  });

  describe('platform/index.ts', () => {
    it('exports platformTools and PlatformToolHandlers', async () => {
      const mod = await import('@server/domains/platform/index');
      expect(mod.platformTools).toBeDefined();
      expect(Array.isArray(mod.platformTools)).toBe(true);
      expect(mod.PlatformToolHandlers).toBeDefined();
      expect(typeof mod.PlatformToolHandlers).toBe('function');
    });
  });

  describe('process/index.ts', () => {
    it('exports processToolDefinitions and ProcessToolHandlers', async () => {
      const mod = await import('@server/domains/process/index');
      expect(mod.processToolDefinitions).toBeDefined();
      expect(Array.isArray(mod.processToolDefinitions)).toBe(true);
      expect(mod.ProcessToolHandlers).toBeDefined();
      expect(typeof mod.ProcessToolHandlers).toBe('function');
    });
  });

  describe('sourcemap/index.ts', () => {
    it('exports sourcemapTools and SourcemapToolHandlers', async () => {
      const mod = await import('@server/domains/sourcemap/index');
      expect(mod.sourcemapTools).toBeDefined();
      expect(Array.isArray(mod.sourcemapTools)).toBe(true);
      expect(mod.SourcemapToolHandlers).toBeDefined();
      expect(typeof mod.SourcemapToolHandlers).toBe('function');
    });
  });

  describe('streaming/index.ts', () => {
    it('exports streamingTools and StreamingToolHandlers', async () => {
      const mod = await import('@server/domains/streaming/index');
      expect(mod.streamingTools).toBeDefined();
      expect(Array.isArray(mod.streamingTools)).toBe(true);
      expect(mod.StreamingToolHandlers).toBeDefined();
      expect(typeof mod.StreamingToolHandlers).toBe('function');
    });
  });

  describe('transform/index.ts', () => {
    it('exports transformTools and TransformToolHandlers', async () => {
      const mod = await import('@server/domains/transform/index');
      expect(mod.transformTools).toBeDefined();
      expect(Array.isArray(mod.transformTools)).toBe(true);
      expect(mod.TransformToolHandlers).toBeDefined();
      expect(typeof mod.TransformToolHandlers).toBe('function');
    });
  });

  describe('wasm/index.ts', () => {
    it('exports wasmTools and WasmToolHandlers', async () => {
      const mod = await import('@server/domains/wasm/index');
      expect(mod.wasmTools).toBeDefined();
      expect(Array.isArray(mod.wasmTools)).toBe(true);
      expect(mod.WasmToolHandlers).toBeDefined();
      expect(typeof mod.WasmToolHandlers).toBe('function');
    });
  });

  describe('workflow/index.ts', () => {
    it('exports workflowToolDefinitions and WorkflowHandlers', async () => {
      const mod = await import('@server/domains/workflow/index');
      expect(mod.workflowToolDefinitions).toBeDefined();
      expect(Array.isArray(mod.workflowToolDefinitions)).toBe(true);
      expect(mod.WorkflowHandlers).toBeDefined();
      expect(typeof mod.WorkflowHandlers).toBe('function');
    });
  });
});
