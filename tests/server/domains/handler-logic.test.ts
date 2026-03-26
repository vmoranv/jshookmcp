/**
 * Part 4: Domain-specific handler tests for files with actual logic
 *
 * Tests for:
 * - antidebug/handlers.ts: AntiDebugToolHandlers (full class with parsing, script building, injection)
 * - platform/handlers.ts: PlatformToolHandlers (facade delegating to sub-handlers)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ──

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
vi.mock('@server/domains/antidebug/scripts', () => ({
  ANTI_DEBUG_SCRIPTS: {
    bypassDebuggerStatement: '(function(){/* bypass __ANTI_DEBUG_MODE__ */})()',
    bypassTiming: '(function(){/* timing __ANTI_DEBUG_MAX_DRIFT__ */})()',
    bypassStackTrace: '(function(){/* stack __ANTI_DEBUG_FILTER_PATTERNS__ */})()',
    bypassConsoleDetect: '(function(){/* console */})()',
    detectProtections: '(function(){return {success:true}})()',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/antidebug/scripts.data', () => ({
  ANTI_DEBUG_SCRIPTS: {
    bypassDebuggerStatement: '(function(){/* bypass __ANTI_DEBUG_MODE__ */})()',
    bypassTiming: '(function(){/* timing __ANTI_DEBUG_MAX_DRIFT__ */})()',
    bypassStackTrace: '(function(){/* stack __ANTI_DEBUG_FILTER_PATTERNS__ */})()',
    bypassConsoleDetect: '(function(){/* console */})()',
    detectProtections: '(function(){return {success:true}})()',
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Platform sub-handler mocks — use vi.hoisted so they survive clearAllMocks
const platformMocks = vi.hoisted(() => ({
  miniapp: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleMiniappPkgScan: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'scan' }] }),
    handleMiniappPkgUnpack: vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValue({ content: [{ type: 'text', text: 'unpack' }] }),
    handleMiniappPkgAnalyze: vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValue({ content: [{ type: 'text', text: 'analyze' }] }),
  },
  electron: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleAsarExtract: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'asar' }] }),
    handleElectronInspectApp: vi
      .fn()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      .mockResolvedValue({ content: [{ type: 'text', text: 'inspect' }] }),
  },
  bridge: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleFridaBridge: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'frida' }] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handleJadxBridge: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'jadx' }] }),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/platform/handlers/miniapp-handlers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  MiniappHandlers: vi.fn().mockImplementation(() => platformMocks.miniapp),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/platform/handlers/electron-handlers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ElectronHandlers: vi.fn().mockImplementation(() => platformMocks.electron),
}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/platform/handlers/bridge-handlers', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  BridgeHandlers: vi.fn().mockImplementation(() => platformMocks.bridge),
}));

// ── AntiDebugToolHandlers tests ──

describe('AntiDebugToolHandlers', () => {
  let AntiDebugToolHandlers: typeof import('@server/domains/antidebug/handlers').AntiDebugToolHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@server/domains/antidebug/handlers');
    AntiDebugToolHandlers = mod.AntiDebugToolHandlers;
  });

  function createHandler(pageOverrides: Record<string, unknown> = {}) {
    const mockPage = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      evaluate: vi.fn().mockResolvedValue(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      ...pageOverrides,
    };
    const collector = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      getActivePage: vi.fn().mockResolvedValue(mockPage),
    } as never;
    return { handler: new AntiDebugToolHandlers(collector), mockPage, collector };
  }

  // oxlint-disable-next-line consistent-function-scoping
  function parseJsonResponse(result: { content: Array<{ text?: string }> }) {
    return JSON.parse(result.content[0]?.text ?? '{}');
  }

  // ── parseBooleanArg ──
  describe('handleAntiDebugBypassAll', () => {
    it('injects all bypass scripts with persistent=true by default', async () => {
      const { handler, mockPage } = createHandler();

      const result = await handler.handleAntiDebugBypassAll({});

      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.persistent).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.injectedCount).toBe(4);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.injected).toEqual([
        'bypassDebuggerStatement',
        'bypassTiming',
        'bypassStackTrace',
        'bypassConsoleDetect',
      ]);

      // With persistent=true, evaluateOnNewDocument should be called
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('with persistent=false, skips evaluateOnNewDocument', async () => {
      const { handler, mockPage } = createHandler();

      const result = await handler.handleAntiDebugBypassAll({ persistent: false });

      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.persistent).toBe(false);

      expect(mockPage.evaluateOnNewDocument).not.toHaveBeenCalled();
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('returns error on page access failure', async () => {
      const collector = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        getActivePage: vi.fn().mockRejectedValue(new Error('No page')),
      } as never;
      const handler = new AntiDebugToolHandlers(collector);

      const result = await handler.handleAntiDebugBypassAll({});

      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.error).toBe('No page');
    });

    it('accepts string "false" for persistent arg', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassAll({ persistent: 'false' });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.persistent).toBe(false);
    });

    it('accepts number 0 for persistent arg', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassAll({ persistent: 0 });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.persistent).toBe(false);
    });

    it('accepts string "yes" for persistent arg', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassAll({ persistent: 'yes' });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.persistent).toBe(true);
    });
  });

  describe('handleAntiDebugBypassDebuggerStatement', () => {
    it('injects debugger bypass script with default mode', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassDebuggerStatement({});
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.mode).toBe('remove');
    });

    it('accepts mode="noop"', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassDebuggerStatement({ mode: 'noop' });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.mode).toBe('noop');
    });

    it('normalizes uppercase mode string', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassDebuggerStatement({ mode: 'NOOP' });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.mode).toBe('noop');
    });

    it('falls back to default for invalid mode', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassDebuggerStatement({ mode: 'invalid' });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.mode).toBe('remove');
    });
  });

  describe('handleAntiDebugBypassTiming', () => {
    it('uses default maxDrift when not specified', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassTiming({});
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.maxDrift).toBe(50);
    });

    it('accepts numeric maxDrift', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassTiming({ maxDrift: 100 });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.maxDrift).toBe(100);
    });

    it('accepts string maxDrift', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassTiming({ maxDrift: '200' });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.maxDrift).toBe(200);
    });

    it('clamps maxDrift to min=0', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassTiming({ maxDrift: -10 });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.maxDrift).toBe(0);
    });

    it('clamps maxDrift to max=1000', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassTiming({ maxDrift: 5000 });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.maxDrift).toBe(1000);
    });

    it('uses default for non-finite number', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassTiming({ maxDrift: NaN });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.maxDrift).toBe(50);
    });

    it('uses default for non-numeric string', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassTiming({ maxDrift: 'abc' });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.maxDrift).toBe(50);
    });
  });

  describe('handleAntiDebugBypassStackTrace', () => {
    it('uses default filter patterns when none specified', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassStackTrace({});
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.filterPatterns).toContain('puppeteer');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.filterPatterns).toContain('devtools');
    });

    it('merges user patterns with defaults', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassStackTrace({
        filterPatterns: ['custom_pattern'],
      });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.filterPatterns).toContain('puppeteer');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.filterPatterns).toContain('custom_pattern');
    });

    it('parses comma-separated string patterns', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassStackTrace({
        filterPatterns: 'foo,bar',
      });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.filterPatterns).toContain('foo');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.filterPatterns).toContain('bar');
    });

    it('deduplicates patterns', async () => {
      const { handler } = createHandler();
      const result = await handler.handleAntiDebugBypassStackTrace({
        filterPatterns: ['puppeteer', 'puppeteer'],
      });
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const puppeteerCount = parsed.filterPatterns.filter((p: string) => p === 'puppeteer').length;
      expect(puppeteerCount).toBe(1);
    });

    it('returns empty array for non-array non-string input', async () => {
      const { handler } = createHandler();
      // parseStringArrayArg returns [] for non-string non-array
      const result = await handler.handleAntiDebugBypassStackTrace({
        filterPatterns: 42,
      });
      const parsed = parseJsonResponse(result);
      // Still has defaults since mergeStackFilterPatterns adds defaults
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.filterPatterns).toContain('puppeteer');
    });
  });

  describe('handleAntiDebugBypassConsoleDetect', () => {
    it('injects console detect bypass', async () => {
      const { handler, mockPage } = createHandler();
      const result = await handler.handleAntiDebugBypassConsoleDetect({});
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.tool).toBe('antidebug_bypass_console_detect');
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('handleAntiDebugDetectProtections', () => {
    it('returns detection results from page.evaluate', async () => {
      const detectResult = {
        success: true,
        detected: true,
        count: 2,
        protections: [
          {
            type: 'debugger',
            severity: 'high',
            evidence: 'found debugger',
            recommendedBypass: 'bypass',
          },
        ],
        recommendations: ['Use bypass'],
        evidence: { test: true },
      };
      const { handler } = createHandler({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        evaluate: vi.fn().mockResolvedValue(detectResult),
      });

      const result = await handler.handleAntiDebugDetectProtections({});
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.detected).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.count).toBe(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.protections).toHaveLength(1);
    });

    it('handles null result from page.evaluate', async () => {
      const { handler } = createHandler({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        evaluate: vi.fn().mockResolvedValue(null),
      });

      const result = await handler.handleAntiDebugDetectProtections({});
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.detected).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.count).toBe(0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.protections).toEqual([]);
    });

    it('handles evaluate error', async () => {
      const { handler } = createHandler({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        evaluate: vi.fn().mockRejectedValue(new Error('eval failed')),
      });

      const result = await handler.handleAntiDebugDetectProtections({});
      const parsed = parseJsonResponse(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(parsed.error).toBe('eval failed');
    });
  });
});

// PlatformToolHandlers delegation is tested in dedicated sub-handler test files:
// - tests/server/domains/platform/handlers.test.ts
// - tests/server/domains/platform/miniapp-handlers.test.ts
// - tests/server/domains/platform/electron-handlers.test.ts
// - tests/server/domains/platform/bridge-handlers.test.ts
