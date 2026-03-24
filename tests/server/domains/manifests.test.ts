/**
 * Unified manifest tests for all 16 domain manifests.
 *
 * Validates the structural contract (shape, types) and behavioural contract
 * (ensure idempotency, depKey population) for every domain manifest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
// ── vi.mock declarations (hoisted) ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/shared/modules', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  AdvancedDeobfuscator: vi.fn().mockImplementation(() => ({ _mock: 'AdvancedDeobfuscator' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CodeAnalyzer: vi.fn().mockImplementation(() => ({ _mock: 'CodeAnalyzer' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CodeCollector: vi.fn().mockImplementation(() => ({ _mock: 'CodeCollector', on: vi.fn() })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CryptoDetector: vi.fn().mockImplementation(() => ({ _mock: 'CryptoDetector' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  Deobfuscator: vi.fn().mockImplementation(() => ({ _mock: 'Deobfuscator' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  HookManager: vi.fn().mockImplementation(() => ({ _mock: 'HookManager' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ObfuscationDetector: vi.fn().mockImplementation(() => ({ _mock: 'ObfuscationDetector' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DebuggerManager: vi.fn().mockImplementation(() => ({ _mock: 'DebuggerManager' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  RuntimeInspector: vi.fn().mockImplementation(() => ({ _mock: 'RuntimeInspector' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ScriptManager: vi.fn().mockImplementation(() => ({ _mock: 'ScriptManager' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ConsoleMonitor: vi.fn().mockImplementation(() => ({ _mock: 'ConsoleMonitor' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  PageController: vi.fn().mockImplementation(() => ({ _mock: 'PageController' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DOMInspector: vi.fn().mockImplementation(() => ({ _mock: 'DOMInspector' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/registry/ensure-browser-core', () => ({
  ensureBrowserCore: vi.fn((ctx: Record<string, unknown>) => {
    if (!ctx.collector) ctx.collector = { on: vi.fn(), _mock: 'collector' };
    if (!ctx.pageController) ctx.pageController = { _mock: 'pageController' };
    if (!ctx.domInspector) ctx.domInspector = { _mock: 'domInspector' };
    if (!ctx.scriptManager) ctx.scriptManager = { _mock: 'scriptManager' };
    if (!ctx.consoleMonitor) ctx.consoleMonitor = { _mock: 'consoleMonitor' };
    if (!ctx.llm) ctx.llm = { _mock: 'llm' };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@services/LLMService', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  LLMService: vi.fn().mockImplementation(() => ({ _mock: 'LLMService' })),
}));

// Handler class mocks — each returns a unique instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/analysis/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CoreAnalysisHandlers: vi.fn().mockImplementation(() => ({ _mock: 'CoreAnalysisHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/antidebug/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  AntiDebugToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'AntiDebugToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/browser/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  BrowserToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'BrowserToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/debugger/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  DebuggerToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'DebuggerToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/encoding/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  EncodingToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'EncodingToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/graphql/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  GraphQLToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'GraphQLToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/hooks/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  AIHookToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'AIHookToolHandlers' })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  HookPresetToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'HookPresetToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/maintenance/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  CoreMaintenanceHandlers: vi.fn().mockImplementation(() => ({ _mock: 'CoreMaintenanceHandlers' })),
  ExtensionManagementHandlers: vi
    .fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    .mockImplementation(() => ({ _mock: 'ExtensionManagementHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/network/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  AdvancedToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'AdvancedToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/platform/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  PlatformToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'PlatformToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/process/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  ProcessToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'ProcessToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/sourcemap/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  SourcemapToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'SourcemapToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/streaming/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  StreamingToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'StreamingToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/transform/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  TransformToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'TransformToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/wasm/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  WasmToolHandlers: vi.fn().mockImplementation(() => ({ _mock: 'WasmToolHandlers' })),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@server/domains/workflow/index', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  WorkflowHandlers: vi.fn().mockImplementation(() => ({ _mock: 'WorkflowHandlers' })),
}));

// ── Manifest imports ────────────────────────────────────────────────────────

import analysisManifest from '@server/domains/analysis/manifest';
import antidebugManifest from '@server/domains/antidebug/manifest';
import browserManifest from '@server/domains/browser/manifest';
import debuggerManifest from '@server/domains/debugger/manifest';
import encodingManifest from '@server/domains/encoding/manifest';
import graphqlManifest from '@server/domains/graphql/manifest';
import hooksManifest from '@server/domains/hooks/manifest';
import maintenanceManifest from '@server/domains/maintenance/manifest';
import networkManifest from '@server/domains/network/manifest';
import platformManifest from '@server/domains/platform/manifest';
import processManifest from '@server/domains/process/manifest';
import sourcemapManifest from '@server/domains/sourcemap/manifest';
import streamingManifest from '@server/domains/streaming/manifest';
import transformManifest from '@server/domains/transform/manifest';
import wasmManifest from '@server/domains/wasm/manifest';
import workflowManifest from '@server/domains/workflow/manifest';

// ── Helpers ─────────────────────────────────────────────────────────────────

interface ManifestLike {
  kind: string;
  version: number;
  domain: string;
  depKey: string;
  profiles: readonly string[];
  ensure: (ctx: Record<string, unknown>) => unknown;
  registrations: ReadonlyArray<{
    tool: Record<string, unknown>;
    domain: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    bind: any;
  }>;
}

function mockContext(): Record<string, unknown> {
  return {
    config: { puppeteer: {}, llm: {} },
    llm: { _mock: 'llm' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    registerCaches: vi.fn().mockResolvedValue(undefined),
    tokenBudget: { _mock: 'tokenBudget' },
    unifiedCache: { _mock: 'unifiedCache' },
    // Pre-set browser core deps so ensureBrowserCore mock and direct consumers work
    collector: { on: vi.fn(), _mock: 'collector' },
    scriptManager: { _mock: 'scriptManager' },
    browserManager: { _mock: 'browserManager' },
    pageController: { _mock: 'pageController' },
    domInspector: { _mock: 'domInspector' },
    consoleMonitor: { _mock: 'consoleMonitor' },
    // Workflow manifest accesses handlerDeps proxy
    handlerDeps: new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'browserHandlers') return { _mock: 'browserHandlers' };
          if (prop === 'advancedHandlers') return { _mock: 'advancedHandlers' };
          return undefined;
        },
      }
    ),
  };
}

// ── All manifests table ─────────────────────────────────────────────────────

const ALL_MANIFESTS: Array<{
  label: string;
  manifest: ManifestLike;
  expectedDomain: string;
  expectedDepKey: string;
}> = [
  {
    label: 'analysis',
    manifest: analysisManifest as unknown as ManifestLike,
    expectedDomain: 'core',
    expectedDepKey: 'coreAnalysisHandlers',
  },
  {
    label: 'antidebug',
    manifest: antidebugManifest as unknown as ManifestLike,
    expectedDomain: 'antidebug',
    expectedDepKey: 'antidebugHandlers',
  },
  {
    label: 'browser',
    manifest: browserManifest as unknown as ManifestLike,
    expectedDomain: 'browser',
    expectedDepKey: 'browserHandlers',
  },
  {
    label: 'debugger',
    manifest: debuggerManifest as unknown as ManifestLike,
    expectedDomain: 'debugger',
    expectedDepKey: 'debuggerHandlers',
  },
  {
    label: 'encoding',
    manifest: encodingManifest as unknown as ManifestLike,
    expectedDomain: 'encoding',
    expectedDepKey: 'encodingHandlers',
  },
  {
    label: 'graphql',
    manifest: graphqlManifest as unknown as ManifestLike,
    expectedDomain: 'graphql',
    expectedDepKey: 'graphqlHandlers',
  },
  {
    label: 'hooks',
    manifest: hooksManifest as unknown as ManifestLike,
    expectedDomain: 'hooks',
    expectedDepKey: 'aiHookHandlers',
  },
  {
    label: 'maintenance',
    manifest: maintenanceManifest as unknown as ManifestLike,
    expectedDomain: 'maintenance',
    expectedDepKey: 'coreMaintenanceHandlers',
  },
  {
    label: 'network',
    manifest: networkManifest as unknown as ManifestLike,
    expectedDomain: 'network',
    expectedDepKey: 'advancedHandlers',
  },
  {
    label: 'platform',
    manifest: platformManifest as unknown as ManifestLike,
    expectedDomain: 'platform',
    expectedDepKey: 'platformHandlers',
  },
  {
    label: 'process',
    manifest: processManifest as unknown as ManifestLike,
    expectedDomain: 'process',
    expectedDepKey: 'processHandlers',
  },
  {
    label: 'sourcemap',
    manifest: sourcemapManifest as unknown as ManifestLike,
    expectedDomain: 'sourcemap',
    expectedDepKey: 'sourcemapHandlers',
  },
  {
    label: 'streaming',
    manifest: streamingManifest as unknown as ManifestLike,
    expectedDomain: 'streaming',
    expectedDepKey: 'streamingHandlers',
  },
  {
    label: 'transform',
    manifest: transformManifest as unknown as ManifestLike,
    expectedDomain: 'transform',
    expectedDepKey: 'transformHandlers',
  },
  {
    label: 'wasm',
    manifest: wasmManifest as unknown as ManifestLike,
    expectedDomain: 'wasm',
    expectedDepKey: 'wasmHandlers',
  },
  {
    label: 'workflow',
    manifest: workflowManifest as unknown as ManifestLike,
    expectedDomain: 'workflow',
    expectedDepKey: 'workflowHandlers',
  },
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe('domain manifests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Structural contract tests for each manifest
  describe.each(ALL_MANIFESTS)(
    '$label manifest structure',
    ({ manifest, expectedDomain, expectedDepKey }) => {
      it('has kind === "domain-manifest"', () => {
        expect(manifest.kind).toBe('domain-manifest');
      });

      it('has version === 1', () => {
        expect(manifest.version).toBe(1);
      });

      it('has the expected domain string', () => {
        expect(manifest.domain).toBe(expectedDomain);
        expect(typeof manifest.domain).toBe('string');
      });

      it('has the expected depKey string', () => {
        expect(manifest.depKey).toBe(expectedDepKey);
        expect(typeof manifest.depKey).toBe('string');
      });

      it('has profiles as a non-empty array', () => {
        expect(Array.isArray(manifest.profiles)).toBe(true);
        expect(manifest.profiles.length).toBeGreaterThan(0);
      });

      it('has ensure as a function', () => {
        expect(typeof manifest.ensure).toBe('function');
      });

      it('has registrations as a non-empty array', () => {
        expect(Array.isArray(manifest.registrations)).toBe(true);
        expect(manifest.registrations.length).toBeGreaterThan(0);
      });

      it('every registration has tool, domain, and bind', () => {
        for (const reg of manifest.registrations) {
          expect(reg).toEqual(
            expect.objectContaining({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
              tool: expect.objectContaining({ name: expect.any(String) }),
              domain: expectedDomain,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
              bind: expect.any(Function),
            })
          );
        }
      });

      it('every tool has annotations with valid semantic hints', () => {
        for (const reg of manifest.registrations) {
          const tool = reg.tool as Record<string, unknown>;
          const annotations = tool.annotations as Record<string, unknown> | undefined;

          // Every tool must have annotations
          expect(annotations).toBeDefined();

          if (annotations) {
            // readOnlyHint and destructiveHint must not both be true
            if (annotations.readOnlyHint === true) {
              expect(annotations.destructiveHint).not.toBe(true);
            }
          }
        }
      });
    }
  );

  // Ensure function tests for each manifest
  describe.each(ALL_MANIFESTS)('$label manifest ensure()', ({ manifest, expectedDepKey }) => {
    it('returns a truthy handler and populates ctx[depKey]', () => {
      const ctx = mockContext();
      const handler = manifest.ensure(ctx);

      expect(handler).toBeTruthy();
      expect(ctx[expectedDepKey]).toBeTruthy();
      expect(ctx[expectedDepKey]).toBe(handler);
    });

    it('is idempotent — returns the same instance on second call', () => {
      const ctx = mockContext();
      const first = manifest.ensure(ctx);
      const second = manifest.ensure(ctx);

      expect(second).toBe(first);
    });
  });

  // Verify all 16 domains are covered
  it('covers all 16 domains', () => {
    expect(ALL_MANIFESTS).toHaveLength(16);
    const domains = new Set(ALL_MANIFESTS.map((m) => m.label));
    expect(domains).toEqual(
      new Set([
        'analysis',
        'antidebug',
        'browser',
        'debugger',
        'encoding',
        'graphql',
        'hooks',
        'maintenance',
        'network',
        'platform',
        'process',
        'sourcemap',
        'streaming',
        'transform',
        'wasm',
        'workflow',
      ])
    );
  });
});
