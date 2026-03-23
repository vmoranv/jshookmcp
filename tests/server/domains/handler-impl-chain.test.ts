/**
 * Handler delegation chain tests
 *
 * Verifies that handlers.ts re-exports the same class identity
 * as the underlying implementation file (handlers.impl.core.ts or deeper).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock all heavy dependencies ──

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
  asJsonResponse: vi.fn(),
  asTextResponse: vi.fn(),
  serializeError: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/analysis/handlers.web-tools', () => ({
  runSourceMapExtract: vi.fn(),
  runWebpackEnumerate: vi.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@modules/deobfuscator/webcrack', () => ({ runWebcrack: vi.fn() }));

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@services/LLMService', () => ({ LLMService: vi.fn().mockImplementation(() => ({})) }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/DetailedDataManager', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DetailedDataManager: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/outputPaths', () => ({ resolveOutputDirectory: vi.fn() }));

// Implementation-level mocks
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/encoding/handlers.impl.core.runtime', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  EncodingToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/graphql/handlers.impl.core.runtime.replay', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  GraphQLToolHandlersRuntime: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/network/handlers.impl.core.runtime.intercept', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  AdvancedToolHandlersIntercept: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/network/handlers.impl.core.runtime.replay', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  AdvancedToolHandlersRuntime: vi.fn().mockImplementation(() => ({})),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/process/handlers.impl.core.runtime.inject', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ProcessToolHandlersRuntime: vi.fn().mockImplementation(() => ({})),
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

describe('Handler delegation (handlers.ts -> implementation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── analysis: handlers.ts -> handlers.impl.ts (no .impl.core) ──
  describe('analysis chain', () => {
    it('handlers.ts and handlers.impl.ts export the same CoreAnalysisHandlers', async () => {
      const handlers = await import('@server/domains/analysis/handlers');
      const impl = await import('@server/domains/analysis/handlers.impl');
      expect(handlers.CoreAnalysisHandlers).toBeDefined();
      expect(typeof handlers.CoreAnalysisHandlers).toBe('function');
      expect(handlers.CoreAnalysisHandlers).toBe(impl.CoreAnalysisHandlers);
    });
  });

  // ── encoding: handlers.ts -> handlers.impl.core.runtime.ts ──
  describe('encoding', () => {
    it('handlers.ts exports the same EncodingToolHandlers as the runtime implementation', async () => {
      const handlers = await import('@server/domains/encoding/handlers');
      const runtime = await import('@server/domains/encoding/handlers.impl.core.runtime');
      expect(handlers.EncodingToolHandlers).toBeDefined();
      expect(handlers.EncodingToolHandlers).toBe(runtime.EncodingToolHandlers);
    });
  });

  // ── graphql: handlers.ts -> handlers.impl.core.runtime.replay.ts ──
  describe('graphql', () => {
    it('handlers.ts exports the same GraphQLToolHandlers as the runtime implementation', async () => {
      const handlers = await import('@server/domains/graphql/handlers');
      const runtime = await import('@server/domains/graphql/handlers.impl.core.runtime.replay');
      expect(handlers.GraphQLToolHandlers).toBeDefined();
      expect(handlers.GraphQLToolHandlers).toBe(runtime.GraphQLToolHandlersRuntime);
    });
  });

  // ── network: handlers.ts -> handlers.impl.core.ts ──
  describe('network', () => {
    it('handlers.ts exports the same AdvancedToolHandlers as handlers.impl.core.ts', async () => {
      const handlers = await import('@server/domains/network/handlers');
      const core = await import('@server/domains/network/handlers.impl.core');
      expect(handlers.AdvancedToolHandlers).toBeDefined();
      expect(handlers.AdvancedToolHandlers).toBe(core.AdvancedToolHandlers);
    });
  });

  // ── process: handlers.ts -> handlers.impl.core.runtime.inject.ts ──
  describe('process', () => {
    it('handlers.ts exports the same ProcessToolHandlers as the runtime implementation', async () => {
      const handlers = await import('@server/domains/process/handlers');
      const runtime = await import('@server/domains/process/handlers.impl.core.runtime.inject');
      expect(handlers.ProcessToolHandlers).toBeDefined();
      expect(handlers.ProcessToolHandlers).toBe(runtime.ProcessToolHandlersRuntime);
    });
  });

  // ── sourcemap: handlers.ts -> handlers.impl.core.ts ──
  describe('sourcemap', () => {
    it('handlers.ts exports the same SourcemapToolHandlers as handlers.impl.core.ts', async () => {
      const handlers = await import('@server/domains/sourcemap/handlers');
      const core = await import('@server/domains/sourcemap/handlers.impl.core');
      expect(handlers.SourcemapToolHandlers).toBeDefined();
      expect(handlers.SourcemapToolHandlers).toBe(core.SourcemapToolHandlers);
    });
  });

  // ── streaming: handlers.ts -> handlers.impl.core.ts ──
  describe('streaming', () => {
    it('handlers.ts exports the same StreamingToolHandlers as handlers.impl.core.ts', async () => {
      const handlers = await import('@server/domains/streaming/handlers');
      const core = await import('@server/domains/streaming/handlers.impl.core');
      expect(handlers.StreamingToolHandlers).toBeDefined();
      expect(handlers.StreamingToolHandlers).toBe(core.StreamingToolHandlers);
    });
  });

  // ── transform: handlers.ts -> handlers.impl.core.ts ──
  describe('transform', () => {
    it('handlers.ts exports the same TransformToolHandlers as handlers.impl.core.ts', async () => {
      const handlers = await import('@server/domains/transform/handlers');
      const core = await import('@server/domains/transform/handlers.impl.core');
      expect(handlers.TransformToolHandlers).toBeDefined();
      expect(handlers.TransformToolHandlers).toBe(core.TransformToolHandlers);
    });
  });

  // ── workflow: handlers.ts -> handlers.impl.core.ts ──
  describe('workflow', () => {
    it('handlers.ts exports the same WorkflowHandlers as handlers.impl.core.ts', async () => {
      const handlers = await import('@server/domains/workflow/handlers');
      const core = await import('@server/domains/workflow/handlers.impl.core');
      expect(handlers.WorkflowHandlers).toBeDefined();
      expect(handlers.WorkflowHandlers).toBe(core.WorkflowHandlers);
    });
  });

  // ── browser: handlers.ts -> handlers.impl.ts (facade, not simple re-export) ──
  describe('browser chain', () => {
    it('handlers.ts and handlers.impl.ts export the same BrowserToolHandlers', async () => {
      const handlers = await import('@server/domains/browser/handlers');
      const impl = await import('@server/domains/browser/handlers.impl');
      expect(handlers.BrowserToolHandlers).toBe(impl.BrowserToolHandlers);
    });

    it('both layers export BrowserControlHandlers', async () => {
      const handlers = await import('@server/domains/browser/handlers');
      const impl = await import('@server/domains/browser/handlers.impl');
      expect(handlers.BrowserControlHandlers).toBe(impl.BrowserControlHandlers);
    });
  });
});
