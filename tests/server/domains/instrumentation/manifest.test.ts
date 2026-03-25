import { describe, expect, it } from 'vitest';
import manifest from '@server/domains/instrumentation/manifest';

describe('instrumentation manifest', () => {
  it('has kind "domain-manifest" and version 1', () => {
    expect(manifest.kind).toBe('domain-manifest');
    expect(manifest.version).toBe(1);
  });

  it('has domain "instrumentation"', () => {
    expect(manifest.domain).toBe('instrumentation');
  });

  it('profiles include "workflow" and "full" (NOT full-only)', () => {
    expect(manifest.profiles).toContain('workflow');
    expect(manifest.profiles).toContain('full');
    expect(manifest.profiles).not.toContain('search');
  });

  it('registers the expected instrumentation tools without hard-coded count coupling', () => {
    const names = manifest.registrations.map((r) => r.tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('instrumentation_session_create');
    expect(names).toContain('instrumentation_session_list');
    expect(names).toContain('instrumentation_session_destroy');
    expect(names).toContain('instrumentation_session_status');
    expect(names).toContain('instrumentation_operation_register');
    expect(names).toContain('instrumentation_operation_list');
    expect(names).toContain('instrumentation_artifact_record');
    expect(names).toContain('instrumentation_artifact_query');
    expect(names).toContain('instrumentation_hook_preset');
    expect(names).toContain('instrumentation_network_replay');
  });

  it('workflowRule patterns match instrumentation keywords', () => {
    expect(manifest.workflowRule).toBeDefined();
    const patterns = manifest.workflowRule!.patterns;
    // Should match English keywords
    expect(patterns.some((p) => p.test('hook a session'))).toBe(true);
    expect(patterns.some((p) => p.test('intercept unified'))).toBe(true);
    expect(patterns.some((p) => p.test('trace session'))).toBe(true);
    expect(patterns.some((p) => p.test('instrument all apis'))).toBe(true);
  });

  it('depKey is "instrumentationHandlers"', () => {
    expect(manifest.depKey).toBe('instrumentationHandlers');
  });

  it('ensure() returns a handler object', () => {
    // Create a minimal context mock
    const domainInstanceMap = new Map<string, unknown>();
    const ctx = {
      instrumentationHandlers: undefined,
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

    const handler = manifest.ensure(ctx);
    expect(handler).toBeDefined();
    expect(typeof handler.handleSessionCreate).toBe('function');
    expect(typeof handler.handleSessionList).toBe('function');
    expect(typeof handler.handleSessionDestroy).toBe('function');
    expect(typeof handler.handleSessionStatus).toBe('function');
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
