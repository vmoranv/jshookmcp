import { describe, expect, it, vi } from 'vitest';
import manifest from '@server/domains/instrumentation/manifest';

vi.mock('@server/registry/ensure-browser-core', () => ({
  ensureBrowserCore: vi.fn((ctx: Record<string, unknown>) => {
    if (!ctx.collector) ctx.collector = { on: vi.fn(), _mock: 'collector' };
    if (!ctx.pageController) ctx.pageController = { _mock: 'pageController' };
    if (!ctx.domInspector) ctx.domInspector = { _mock: 'domInspector' };
    if (!ctx.scriptManager) ctx.scriptManager = { _mock: 'scriptManager' };
    if (!ctx.consoleMonitor) ctx.consoleMonitor = { _mock: 'consoleMonitor' };
  }),
}));

describe('instrumentation manifest', () => {
  it('has kind "domain-manifest" and version 1', async () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.version).toBe(1);
  });

  it('has domain "instrumentation"', async () => {
    expect(manifest.domain).toBe('instrumentation');
  });

  it('profiles include only "full"', async () => {
    expect(manifest.profiles).toContain('full');
    expect(manifest.profiles).not.toContain('workflow');
    expect(manifest.profiles).not.toContain('search');
  });

  it('has secondaryDepKeys for hooks and evidence', async () => {
    expect(manifest.secondaryDepKeys).toContain('aiHookHandlers');
    expect(manifest.secondaryDepKeys).toContain('hookPresetHandlers');
    expect(manifest.secondaryDepKeys).toContain('evidenceHandlers');
  });

  it('registers the expected instrumentation tools without hard-coded count coupling', async () => {
    const names = manifest.registrations.map((r) => r.tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('instrumentation_session');
    expect(names).toContain('instrumentation_session_export');
    expect(names).toContain('instrumentation_operation');
    expect(names).toContain('instrumentation_artifact');
    expect(names).toContain('instrumentation_hook_preset');
    expect(names).toContain('instrumentation_network_replay');
    expect(names).toContain('ai_hook');
    expect(names).toContain('hook_preset');
    expect(names).toContain('evidence_query');
    expect(names).toContain('evidence_export');
    expect(names).toContain('evidence_chain');
  });

  it('workflowRule patterns match instrumentation keywords', async () => {
    expect(manifest.workflowRule).toBeDefined();
    const patterns = manifest.workflowRule!.patterns;
    // Should match English keywords
    expect(patterns.some((p) => p.test('hook a session'))).toBe(true);
    expect(patterns.some((p) => p.test('intercept unified'))).toBe(true);
    expect(patterns.some((p) => p.test('trace session'))).toBe(true);
    expect(patterns.some((p) => p.test('instrument all apis'))).toBe(true);
    // Evidence patterns
    expect(patterns.some((p) => p.test('evidence graph query'))).toBe(true);
    expect(patterns.some((p) => p.test('provenance chain report'))).toBe(true);
  });

  it('depKey is "instrumentationHandlers"', async () => {
    expect(manifest.depKey).toBe('instrumentationHandlers');
  });

  it('ensure() returns a handler object', async () => {
    // Create a minimal context mock
    const domainInstanceMap = new Map<string, unknown>();
    const ctx = {
      config: { puppeteer: {} },
      instrumentationHandlers: undefined,
      aiHookHandlers: undefined,
      hookPresetHandlers: undefined,
      evidenceHandlers: undefined,
      handlerDeps: {
        hookPresetHandlers: {
          handleHookPreset: async () => ({ content: [{ type: 'text', text: '{}' }] }),
        },
        advancedHandlers: {
          handleNetworkReplayRequest: async () => ({ content: [{ type: 'text', text: '{}' }] }),
        },
      },
      setDomainInstance: (key: string, value: unknown) => {
        domainInstanceMap.set(key, value);
      },
      getDomainInstance: (key: string) => domainInstanceMap.get(key),
      domainInstanceMap,
    } as unknown as Parameters<typeof manifest.ensure>[0];

    const handler = await manifest.ensure(ctx);
    expect(handler).toBeDefined();
    expect(typeof handler.handleSessionCreate).toBe('function');
    expect(typeof handler.handleSessionList).toBe('function');
    expect(typeof handler.handleSessionDestroy).toBe('function');
    expect(typeof handler.handleSessionStatus).toBe('function');
    expect(typeof handler.handleSessionExport).toBe('function');
    expect(typeof handler.handleOperationRegister).toBe('function');
    expect(typeof handler.handleOperationList).toBe('function');
    expect(typeof handler.handleArtifactRecord).toBe('function');
    expect(typeof handler.handleArtifactQuery).toBe('function');
    expect(typeof handler.handleHookPreset).toBe('function');
    expect(typeof handler.handleNetworkReplay).toBe('function');
    expect(ctx.getDomainInstance('evidenceGraph')).toBeDefined();
    expect(ctx.getDomainInstance('instrumentationSessionManager')).toBeDefined();
    expect(ctx.getDomainInstance('evidenceGraphBridge')).toBeDefined();
  });
});
