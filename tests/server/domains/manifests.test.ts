/**
 * Unified manifest tests for all 16 domain manifests.
 *
 * Validates the structural contract (shape, types) and behavioural contract
 * (ensure idempotency, depKey population) for every domain manifest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── vi.mock declarations (hoisted) ──────────────────────────────────────────

vi.mock('@server/domains/shared/modules', () => ({
  AdvancedDeobfuscator: function () {
    return { _mock: 'AdvancedDeobfuscator' };
  },
  CodeAnalyzer: function () {
    return { _mock: 'CodeAnalyzer' };
  },
  CodeCollector: function () {
    return { _mock: 'CodeCollector', on: vi.fn() };
  },
  CryptoDetector: function () {
    return { _mock: 'CryptoDetector' };
  },
  Deobfuscator: function () {
    return { _mock: 'Deobfuscator' };
  },
  HookManager: function () {
    return { _mock: 'HookManager' };
  },
  ObfuscationDetector: function () {
    return { _mock: 'ObfuscationDetector' };
  },
  DebuggerManager: function () {
    return { _mock: 'DebuggerManager' };
  },
  RuntimeInspector: function () {
    return { _mock: 'RuntimeInspector' };
  },
  ScriptManager: function () {
    return { _mock: 'ScriptManager' };
  },
  ConsoleMonitor: function () {
    return { _mock: 'ConsoleMonitor' };
  },
  PageController: function () {
    return { _mock: 'PageController' };
  },
  DOMInspector: function () {
    return { _mock: 'DOMInspector' };
  },
}));

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

vi.mock('@services/LLMService', () => ({
  LLMService: function () {
    return { _mock: 'LLMService' };
  },
}));

// Handler class mocks — each returns a unique instance
vi.mock('@server/domains/analysis/index', () => ({
  CoreAnalysisHandlers: function () {
    return { _mock: 'CoreAnalysisHandlers' };
  },
}));

vi.mock('@server/domains/antidebug/index', () => ({
  AntiDebugToolHandlers: function () {
    return { _mock: 'AntiDebugToolHandlers' };
  },
}));

vi.mock('@server/domains/browser/index', () => ({
  BrowserToolHandlers: function () {
    return { _mock: 'BrowserToolHandlers' };
  },
}));

vi.mock('@server/domains/debugger/index', () => ({
  DebuggerToolHandlers: function () {
    return { _mock: 'DebuggerToolHandlers' };
  },
}));

vi.mock('@server/domains/encoding/index', () => ({
  EncodingToolHandlers: function () {
    return { _mock: 'EncodingToolHandlers' };
  },
}));

vi.mock('@server/domains/graphql/index', () => ({
  GraphQLToolHandlers: function () {
    return { _mock: 'GraphQLToolHandlers' };
  },
}));

vi.mock('@server/domains/hooks/index', () => ({
  AIHookToolHandlers: function () {
    return { _mock: 'AIHookToolHandlers' };
  },
  HookPresetToolHandlers: function () {
    return { _mock: 'HookPresetToolHandlers' };
  },
}));

vi.mock('@server/domains/maintenance/index', () => ({
  CoreMaintenanceHandlers: function () {
    return { _mock: 'CoreMaintenanceHandlers' };
  },
  ExtensionManagementHandlers: function () {
    return { _mock: 'ExtensionManagementHandlers' };
  },
}));

vi.mock('@server/domains/network/index', () => ({
  AdvancedToolHandlers: function () {
    return { _mock: 'AdvancedToolHandlers' };
  },
}));

vi.mock('@server/domains/platform/index', () => ({
  PlatformToolHandlers: function () {
    return { _mock: 'PlatformToolHandlers' };
  },
}));

vi.mock('@server/domains/process/index', () => ({
  ProcessToolHandlers: function () {
    return { _mock: 'ProcessToolHandlers' };
  },
}));

vi.mock('@server/domains/sourcemap/index', () => ({
  SourcemapToolHandlers: function () {
    return { _mock: 'SourcemapToolHandlers' };
  },
}));

vi.mock('@server/domains/streaming/index', () => ({
  StreamingToolHandlers: function () {
    return { _mock: 'StreamingToolHandlers' };
  },
}));

vi.mock('@server/domains/transform/index', () => ({
  TransformToolHandlers: function () {
    return { _mock: 'TransformToolHandlers' };
  },
}));

vi.mock('@server/domains/wasm/index', () => ({
  WasmToolHandlers: function () {
    return { _mock: 'WasmToolHandlers' };
  },
}));

vi.mock('@server/domains/workflow/index', () => ({
  WorkflowHandlers: function () {
    return { _mock: 'WorkflowHandlers' };
  },
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
    bind: any;
  }>;
}

function mockContext(): Record<string, unknown> {
  return {
    config: { puppeteer: {}, llm: {} },
    llm: { _mock: 'llm' },
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
      },
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
      it('has kind === "domain-manifest"', async () => {
        expect(manifest.kind).toBe('domain-manifest');
      });

      it('has version === 1', async () => {
        expect(manifest.version).toBe(1);
      });

      it('has the expected domain string', async () => {
        expect(manifest.domain).toBe(expectedDomain);
        expect(typeof manifest.domain).toBe('string');
      });

      it('has the expected depKey string', async () => {
        expect(manifest.depKey).toBe(expectedDepKey);
        expect(typeof manifest.depKey).toBe('string');
      });

      it('has profiles as a non-empty array', async () => {
        expect(Array.isArray(manifest.profiles)).toBe(true);
        expect(manifest.profiles.length).toBeGreaterThan(0);
      });

      it('has ensure as a function', async () => {
        expect(typeof manifest.ensure).toBe('function');
      });

      it('has registrations as a non-empty array', async () => {
        expect(Array.isArray(manifest.registrations)).toBe(true);
        expect(manifest.registrations.length).toBeGreaterThan(0);
      });

      it('every registration has tool, domain, and bind', async () => {
        for (const reg of manifest.registrations) {
          expect(reg).toEqual(
            expect.objectContaining({
              tool: expect.objectContaining({ name: expect.any(String) }),
              domain: expectedDomain,
              bind: expect.any(Function),
            }),
          );
        }
      });

      it('every tool has annotations with valid semantic hints', async () => {
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
    },
  );

  // Ensure function tests for each manifest
  describe.each(ALL_MANIFESTS)('$label manifest ensure()', ({ manifest, expectedDepKey }) => {
    it('returns a truthy handler and populates ctx[depKey]', async () => {
      const ctx = mockContext();
      const handler = await manifest.ensure(ctx);

      expect(handler).toBeTruthy();
      expect(ctx[expectedDepKey]).toBeTruthy();
      expect(ctx[expectedDepKey]).toBe(handler);
    });

    it('is idempotent — returns the same instance on second call', async () => {
      const ctx = mockContext();
      const first = await manifest.ensure(ctx);
      const second = await manifest.ensure(ctx);

      expect(second).toBe(first);
    });
  });

  // Verify all 16 domains are covered
  it('covers all 16 domains', async () => {
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
      ]),
    );
  });
});
