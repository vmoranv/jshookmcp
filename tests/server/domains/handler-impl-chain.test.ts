/**
 * Handler delegation chain tests
 *
 * Verifies that handlers.ts re-exports the same class identity
 * as the underlying implementation file (handlers.impl.core.ts or deeper).
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

vi.mock('@modules/analyzer/CodeAnalyzer', () => ({ CodeAnalyzer: mockClass() }));
vi.mock('@modules/browser/CamoufoxBrowserManager', () => ({ CamoufoxBrowserManager: mockClass() }));
vi.mock('@modules/captcha/AICaptchaDetector', () => ({ AICaptchaDetector: mockClass() }));
vi.mock('@modules/crypto/CryptoDetector', () => ({ CryptoDetector: mockClass() }));
vi.mock('@modules/deobfuscator/AdvancedDeobfuscator', () => ({
  AdvancedDeobfuscator: mockClass(),
}));
vi.mock('@modules/deobfuscator/Deobfuscator', () => ({ Deobfuscator: mockClass() }));
vi.mock('@modules/detector/ObfuscationDetector', () => ({ ObfuscationDetector: mockClass() }));
vi.mock('@modules/debugger/DebuggerManager', () => ({ DebuggerManager: mockClass() }));
vi.mock('@modules/debugger/RuntimeInspector', () => ({ RuntimeInspector: mockClass() }));
vi.mock('@modules/debugger/ScriptManager', () => ({ ScriptManager: mockClass() }));
vi.mock('@modules/debugger/BlackboxManager', () => ({ BlackboxManager: mockClass() }));
vi.mock('@modules/external/ExternalToolRunner', () => ({ ExternalToolRunner: mockClass() }));
vi.mock('@modules/external/ToolRegistry', () => ({ ToolRegistry: mockClass() }));
vi.mock('@modules/hook/HookManager', () => ({ HookManager: mockClass() }));
vi.mock('@modules/monitor/PerformanceMonitor', () => ({ PerformanceMonitor: mockClass() }));
vi.mock('@modules/stealth/StealthScripts', () => ({ StealthScripts: mockClass() }));

vi.mock('@server/domains/shared/response', () => ({
  asJsonResponse: vi.fn(),
  asTextResponse: vi.fn(),
  serializeError: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
vi.mock('@utils/DetailedDataManager', () => ({
  DetailedDataManager: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@utils/outputPaths', () => ({ resolveOutputDirectory: vi.fn() }));

// Implementation-level mocks
vi.mock('@server/domains/encoding/handlers.impl.core.runtime', () => ({
  EncodingToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/graphql/handlers.impl', () => ({
  GraphQLToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/process/handlers.impl', () => ({
  ProcessToolHandlers: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/sourcemap/handlers.impl.sourcemap-main', () => ({
  SourcemapToolHandlersMain: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@server/domains/workflow/handlers.impl.workflow-batch', () => ({
  WorkflowHandlersBatch: vi.fn().mockImplementation(() => ({})),
}));

// ── Tests ──

describe('Handler delegation (handlers.ts -> implementation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── analysis: handlers.ts (direct aggregation, no .impl chain) ──
  describe('analysis chain', () => {
    it('handlers.ts exports CoreAnalysisHandlers', async () => {
      const handlers = await import('@server/domains/analysis/handlers');
      expect(handlers.CoreAnalysisHandlers).toBeDefined();
      expect(typeof handlers.CoreAnalysisHandlers).toBe('function');
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

  // ── graphql: handlers.ts -> handlers.impl.ts ──
  describe('graphql', () => {
    it('handlers.ts exports the same GraphQLToolHandlers as handlers.impl.ts', async () => {
      const handlers = await import('@server/domains/graphql/handlers');
      const impl = await import('@server/domains/graphql/handlers.impl');
      expect(handlers.GraphQLToolHandlers).toBeDefined();
      expect(handlers.GraphQLToolHandlers).toBe(impl.GraphQLToolHandlers);
    });
  });

  // ── network: handlers.ts -> handlers.impl.ts (composition facade) ──
  describe('network', () => {
    it('handlers.ts exports the same AdvancedToolHandlers as handlers.impl.ts', async () => {
      const handlers = await import('@server/domains/network/handlers');
      const impl = await import('@server/domains/network/handlers.impl');
      expect(handlers.AdvancedToolHandlers).toBeDefined();
      expect(handlers.AdvancedToolHandlers).toBe(impl.AdvancedToolHandlers);
    });
  });

  // ── process: handlers.ts -> handlers.impl.ts (composition facade) ──
  describe('process', () => {
    it('handlers.ts exports ProcessToolHandlers from the composition facade', async () => {
      const handlers = await import('@server/domains/process/handlers');
      const impl = await import('@server/domains/process/handlers.impl');
      expect(handlers.ProcessToolHandlers).toBeDefined();
      expect(handlers.ProcessToolHandlers).toBe(impl.ProcessToolHandlers);
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
