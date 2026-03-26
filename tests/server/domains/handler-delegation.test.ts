/**
 * Part 1: Domain handlers.ts delegation tests
 *
 * Verifies that every domain's handlers.ts properly exports
 * the expected handler class (either as a re-export or as a direct class).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock heavy dependencies so that handler module imports succeed ──

// Shared modules: explicit mock for every named export used by handler files
const mockClass = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    getActivePage: vi.fn(),
    getPage: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    probeAll: vi.fn().mockResolvedValue({}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    run: vi.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '', exitCode: 0 }),
  }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/shared/response', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  asJsonResponse: vi.fn((_: any) => ({ content: [{ type: 'text', text: '{}' }] })),
  asTextResponse: vi.fn((_: string) => ({ content: [{ type: 'text', text: '' }] })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  serializeError: vi.fn((e: any) => String(e)),
}));

// Logger
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Antidebug scripts
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/antidebug/scripts', () => ({
  ANTI_DEBUG_SCRIPTS: {
    bypassDebuggerStatement: '/* bypass debugger */',
    bypassTiming: '/* bypass timing */',
    bypassStackTrace: '/* bypass stack trace */',
    bypassConsoleDetect: '/* bypass console detect */',
    detectProtections: '/* detect protections */',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  vi.fn().mockImplementation(
    () =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'constructor') return vi.fn();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
            return vi.fn().mockResolvedValue({ content: [] });
          },
        },
      ),
  );

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/debugger-control', () => ({
  DebuggerControlHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/debugger-stepping', () => ({
  DebuggerSteppingHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/debugger-evaluate', () => ({
  DebuggerEvaluateHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/debugger-state', () => ({
  DebuggerStateHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/session-management', () => ({
  SessionManagementHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/breakpoint-basic', () => ({
  BreakpointBasicHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/breakpoint-exception', () => ({
  BreakpointExceptionHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/xhr-breakpoint', () => ({
  XHRBreakpointHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/event-breakpoint', () => ({
  EventBreakpointHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/watch-expressions', () => ({
  WatchExpressionsHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/scope-inspection', () => ({
  ScopeInspectionHandlers: mockDebuggerSubHandler(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/handlers/blackbox-handlers', () => ({
  BlackboxHandlers: mockDebuggerSubHandler(),
}));

// Platform handler sub-modules
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/platform/handlers/miniapp-handlers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  MiniappHandlers: vi.fn().mockImplementation(() => ({
    handleMiniappPkgScan: vi.fn(),
    handleMiniappPkgUnpack: vi.fn(),
    handleMiniappPkgAnalyze: vi.fn(),
  })),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/platform/handlers/electron-handlers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ElectronHandlers: vi.fn().mockImplementation(() => ({
    handleAsarExtract: vi.fn(),
    handleElectronInspectApp: vi.fn(),
  })),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/platform/handlers/bridge-handlers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  BridgeHandlers: vi.fn().mockImplementation(() => ({
    handleFridaBridge: vi.fn(),
    handleJadxBridge: vi.fn(),
  })),
}));

// Hooks dependencies
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/hooks/preset-definitions', () => ({
  PRESETS: {},
  PRESET_LIST: [],
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/hooks/preset-builder', () => ({
  buildHookCode: vi.fn(),
}));

// Maintenance dependencies
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/TokenBudgetManager', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  TokenBudgetManager: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/UnifiedCacheManager', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  UnifiedCacheManager: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/artifactRetention', () => ({
  cleanupArtifacts: vi.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/environmentDoctor', () => ({
  runEnvironmentDoctor: vi.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@services/LLMService', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  LLMService: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/DetailedDataManager', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DetailedDataManager: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/outputPaths', () => ({
  resolveOutputDirectory: vi.fn(),
}));

// Wasm dependencies
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockResolvedValue({ absolutePath: '/tmp/test.wasm', displayPath: 'test.wasm' }),
}));

// Extension handlers deps
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@src/constants', () => ({
  EXTENSION_GIT_CLONE_TIMEOUT_MS: 30000,
  EXTENSION_GIT_CHECKOUT_TIMEOUT_MS: 10000,
}));

// Analysis web-tools
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/analysis/handlers.web-tools', () => ({
  runSourceMapExtract: vi.fn(),
  runWebpackEnumerate: vi.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/deobfuscator/webcrack', () => ({
  runWebcrack: vi.fn(),
}));

// Browser sub-handler mocks
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/browser-control', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  BrowserControlHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/camoufox-browser', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CamoufoxBrowserHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/page-navigation', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  PageNavigationHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/page-interaction', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  PageInteractionHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/page-evaluation', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  PageEvaluationHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/page-data', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  PageDataHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/dom-query', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DOMQueryHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/dom-style', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DOMStyleHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/dom-search', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DOMSearchHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/console-handlers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ConsoleHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/script-management', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ScriptManagementHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/captcha-handlers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CaptchaHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/stealth-injection', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  StealthInjectionHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/framework-state', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  FrameworkStateHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/indexeddb-dump', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  IndexedDBDumpHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/detailed-data', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DetailedDataHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/js-heap', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  JSHeapSearchHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/tab-workflow', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  TabWorkflowHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/facade-initializer', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  initializeBrowserHandlerModules: vi.fn().mockReturnValue({}),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/human-behavior', () => ({
  handleHumanMouse: vi.fn(),
  handleHumanScroll: vi.fn(),
  handleHumanTyping: vi.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/captcha-solver', () => ({
  handleCaptchaVisionSolve: vi.fn(),
  handleWidgetChallengeSolve: vi.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/handlers/camoufox-flow', () => ({
  handleCamoufoxLaunchFlow: vi.fn(),
  handleCamoufoxNavigateFlow: vi.fn(),
}));

// ── Delegation chain mocks for handlers.impl files that re-export from .impl.core ──

// encoding, graphql, network, process, sourcemap, streaming, transform, workflow
// have handlers.impl.core.ts -> handlers.impl.core.runtime.ts chains
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/encoding/handlers.impl.core.runtime', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  EncodingToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/graphql/handlers.impl.core.runtime', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  GraphQLToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/network/handlers.impl.core.runtime', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  AdvancedToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/process/handlers.impl.core.runtime', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ProcessToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/sourcemap/handlers.impl.sourcemap-main', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  SourcemapToolHandlersMain: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/streaming/handlers.impl.streaming-sse', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  StreamingToolHandlersSse: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/transform/handlers.impl.transform-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  TransformToolHandlersCrypto: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/workflow/handlers.impl.workflow-batch', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  WorkflowHandlersBatch: vi.fn().mockImplementation(() => ({})),
}));

// ── Tests ──

describe('Domain handler delegation (handlers.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  // oxlint-disable-next-line consistent-function-scoping
  function asExportMap(value: any): Record<string, unknown> {
    return value as Record<string, unknown>;
  }

  // oxlint-disable-next-line consistent-function-scoping
  function asMethodMap(value: object): Record<string, unknown> {
    return value as unknown as Record<string, unknown>;
  }

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

  describe.each(pureReExportDomains)(
    '$domain/handlers.ts re-exports $exportName',
    ({ domain, exportName }) => {
      it(`exports ${exportName} as a constructor function`, async () => {
        const mod = asExportMap(await import(`@server/domains/${domain}/handlers`));
        expect(mod[exportName]).toBeDefined();
        expect(typeof mod[exportName]).toBe('function');
      });

      it(`has no unexpected exports besides ${exportName}`, async () => {
        const mod = await import(`@server/domains/${domain}/handlers`);
        const exportedNames = Object.keys(mod).filter((k) => k !== '__esModule');
        expect(exportedNames).toContain(exportName);
      });
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      'DOMQueryHandlers',
      'DOMStyleHandlers',
      'DOMSearchHandlers',
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
        'handleDebuggerEnable',
        'handleDebuggerDisable',
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
        'handleFridaBridge',
        'handleJadxBridge',
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
