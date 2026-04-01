/**
 * Tests for MCPServer.context.ts
 *
 * This is a type-only module with interfaces. Tests verify:
 * - All exported interfaces are importable and composable
 * - MCPServerContext properly extends all sub-interfaces
 * - DomainInstances can be populated with domain handlers
 * - All named domain accessors are optional
 */
import { describe, it, expect, vi } from 'vitest';

import type {
  MCPServerContext,
  ServerCore,
  ToolRegistryState,
  ActivationState,
  TransportState,
  ExtensionState,
  DomainInstances,
  ServerMethods,
  MetaToolInfo,
} from '@server/MCPServer.context';

describe('MCPServer.context — interface coverage', () => {
  function makeMinimalContext(): MCPServerContext {
    const domainMap = new Map<string, unknown>();
    return {
      // ServerCore
      config: {} as any,
      server: {} as any,
      tokenBudget: {} as any,
      unifiedCache: {} as any,
      detailedData: {} as any,
      eventBus: {} as any,
      // ToolRegistryState
      selectedTools: [],
      enabledDomains: new Set(),
      router: { has: vi.fn() } as any,
      handlerDeps: {} as any,
      // ActivationState
      baseTier: 'search',
      activatedToolNames: new Set(),
      activatedRegisteredTools: new Map(),
      domainTtlEntries: new Map(),
      metaToolsByName: new Map(),
      clientSupportsListChanged: true,
      // TransportState
      httpSockets: new Set(),
      // ExtensionState
      extensionToolsByName: new Map(),
      extensionPluginsById: new Map(),
      extensionPluginRuntimeById: new Map(),
      extensionWorkflowsById: new Map(),
      extensionWorkflowRuntimeById: new Map(),
      // DomainInstances
      domainInstanceMap: domainMap,
      getDomainInstance: <T>(key: string) => domainMap.get(key) as T,
      setDomainInstance: (key: string, value: unknown) => domainMap.set(key, value),
      // ServerMethods
      registerCaches: vi.fn(),
      resolveEnabledDomains: vi.fn(),
      registerSingleTool: vi.fn(),
      reloadExtensions: vi.fn(),
      listExtensions: vi.fn(),
      executeToolWithTracking: vi.fn(),
    } as unknown as MCPServerContext;
  }

  it('MCPServerContext can be constructed from sub-interfaces', () => {
    const ctx = makeMinimalContext();
    expect(ctx).toBeDefined();
    expect(ctx.selectedTools).toEqual([]);
    expect(ctx.baseTier).toBe('search');
  });

  it('ServerCore fields are all present', () => {
    const ctx = makeMinimalContext();
    const core: ServerCore = {
      config: ctx.config,
      server: ctx.server,
      tokenBudget: ctx.tokenBudget,
      unifiedCache: ctx.unifiedCache,
      detailedData: ctx.detailedData,
      eventBus: ctx.eventBus,
    };
    expect(core).toBeDefined();
    expect(Object.keys(core)).toHaveLength(6);
  });

  it('ToolRegistryState holds tools and routing', () => {
    const ctx = makeMinimalContext();
    const registryState: ToolRegistryState = {
      selectedTools: ctx.selectedTools,
      enabledDomains: ctx.enabledDomains,
      router: ctx.router,
      handlerDeps: ctx.handlerDeps,
    };
    expect(registryState.selectedTools).toEqual([]);
    expect(registryState.enabledDomains).toBeInstanceOf(Set);
  });

  it('ActivationState tracks meta-tools and domain TTLs', () => {
    const ctx = makeMinimalContext();
    const metaTool: MetaToolInfo = {
      name: 'search_tools',
      description: 'Search',
      inputSchema: { type: 'object', properties: {} },
    };
    ctx.metaToolsByName.set('search_tools', metaTool);
    expect(ctx.metaToolsByName.get('search_tools')).toBe(metaTool);

    const activation: ActivationState = {
      baseTier: ctx.baseTier,
      activatedToolNames: ctx.activatedToolNames,
      activatedRegisteredTools: ctx.activatedRegisteredTools,
      domainTtlEntries: ctx.domainTtlEntries,
      metaToolsByName: ctx.metaToolsByName,
      clientSupportsListChanged: ctx.clientSupportsListChanged,
    };
    expect(activation.baseTier).toBe('search');
    expect(activation.clientSupportsListChanged).toBe(true);
  });

  it('TransportState allows optional httpServer', () => {
    const transport: TransportState = {
      httpSockets: new Set(),
    };
    expect(transport.httpServer).toBeUndefined();
    expect(transport.httpSockets.size).toBe(0);
  });

  it('ExtensionState tracks lastExtensionReloadAt', () => {
    const ext: ExtensionState = {
      extensionToolsByName: new Map(),
      extensionPluginsById: new Map(),
      extensionPluginRuntimeById: new Map(),
      extensionWorkflowsById: new Map(),
      extensionWorkflowRuntimeById: new Map(),
      lastExtensionReloadAt: '2026-01-01T00:00:00Z',
    };
    expect(ext.lastExtensionReloadAt).toBe('2026-01-01T00:00:00Z');
  });

  it('DomainInstances get/set work correctly', () => {
    const ctx = makeMinimalContext();
    ctx.setDomainInstance('testHandler', { handle: vi.fn() });
    expect(ctx.getDomainInstance('testHandler')).toBeDefined();
    expect(ctx.getDomainInstance('nonExistent')).toBeUndefined();
  });

  it('DomainInstances backward-compatible named accessors default to undefined', () => {
    const ctx = makeMinimalContext();
    const instances: DomainInstances = {
      domainInstanceMap: ctx.domainInstanceMap,
      getDomainInstance: ctx.getDomainInstance,
      setDomainInstance: ctx.setDomainInstance,
    };
    // All optional named accessors
    expect(instances.collector).toBeUndefined();
    expect(instances.pageController).toBeUndefined();
    expect(instances.browserHandlers).toBeUndefined();
    expect(instances.traceRecorder).toBeUndefined();
    expect(instances.evidenceHandlers).toBeUndefined();
    expect(instances.instrumentationHandlers).toBeUndefined();
    expect(instances.coordinationHandlers).toBeUndefined();
    expect(instances.graphqlHandlers).toBeUndefined();
  });

  it('ServerMethods exposes all required methods', () => {
    const methods: ServerMethods = {
      registerCaches: vi.fn(),
      resolveEnabledDomains: vi.fn(() => new Set<string>()),
      registerSingleTool: vi.fn(() => ({ remove: vi.fn() }) as any),
      reloadExtensions: vi.fn(async () => ({}) as any),
      listExtensions: vi.fn(() => ({}) as any),
      executeToolWithTracking: vi.fn(async () => ({ content: [] }) as any),
    };
    expect(typeof methods.registerCaches).toBe('function');
    expect(typeof methods.resolveEnabledDomains).toBe('function');
    expect(typeof methods.registerSingleTool).toBe('function');
    expect(typeof methods.reloadExtensions).toBe('function');
    expect(typeof methods.listExtensions).toBe('function');
    expect(typeof methods.executeToolWithTracking).toBe('function');
  });

  it('MCPServerContext is fully composable and assignable', () => {
    const ctx = makeMinimalContext();
    const assigned: MCPServerContext = ctx;
    expect(assigned).toBe(ctx);
    expect(assigned.enabledDomains).toBeInstanceOf(Set);
    expect(assigned.domainInstanceMap).toBeInstanceOf(Map);
  });
});
