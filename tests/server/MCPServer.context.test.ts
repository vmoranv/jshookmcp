import { describe, it, expect, vi, beforeEach } from 'vitest';

import type {
  ActivationState,
  DomainInstances,
  ExtensionState,
  MCPServerContext,
  ServerCore,
  ServerMethods,
  ToolRegistryState,
  TransportState,
} from '@server/MCPServer.context';

describe('MCPServer.context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports sub-interfaces that can be composed into a full server context', () => {
    const serverCore = {
      config: {} as any,
      server: {} as any,
      tokenBudget: {} as any,
      unifiedCache: {} as any,
      detailedData: {} as any,
    } satisfies ServerCore;

    const registryState = {
      selectedTools: [],
      enabledDomains: new Set<string>(['browser']),
      router: {} as any,
      handlerDeps: {} as any,
    } satisfies ToolRegistryState;

    const activationState = {
      baseTier: 'search',
      activatedToolNames: new Set<string>(),
      activatedRegisteredTools: new Map(),
      domainTtlEntries: new Map(),
      metaToolsByName: new Map(),
      clientSupportsListChanged: true,
    } satisfies ActivationState;

    const transportState = {
      httpSockets: new Set(),
    } satisfies TransportState;

    const extensionState = {
      extensionToolsByName: new Map(),
      extensionPluginsById: new Map(),
      extensionPluginRuntimeById: new Map(),
      extensionWorkflowsById: new Map(),
      extensionWorkflowRuntimeById: new Map(),
    } satisfies ExtensionState;

    const domainInstances = {
      domainInstanceMap: new Map(),
      getDomainInstance: <T>(key: string) => (new Map().get(key) as T),
      setDomainInstance: () => undefined,
    } satisfies DomainInstances;

    const methods = {
      registerCaches: async () => undefined,
      resolveEnabledDomains: () => new Set<string>(),
      registerSingleTool: () => ({ remove: () => undefined }) as any,
      reloadExtensions: async () => ({ success: true }) as any,
      listExtensions: () => ({ success: true }) as any,
      executeToolWithTracking: async () => ({ content: [] }) as any,
    } satisfies ServerMethods;

    const ctx = {
      ...serverCore,
      ...registryState,
      ...activationState,
      ...transportState,
      ...extensionState,
      ...domainInstances,
      ...methods,
    } satisfies MCPServerContext;

    expect(ctx.enabledDomains).toEqual(new Set(['browser']));
    expect(ctx.httpSockets.size).toBe(0);
    expect(typeof ctx.registerCaches).toBe('function');
  });
});
