import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '@internal-types/index';
import type { TokenBudgetManager } from '@utils/TokenBudgetManager';
import type { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import type { ToolHandlerDeps } from '@server/registry/contracts';
import type { ExtensionReloadResult, ExtensionListResult } from '@server/extensions/types';
import type { ToolResponse } from '@server/types';
import type { ToolProfile } from '@server/ToolCatalog';

import type {
  ActivationState,
  DomainInstances,
  ExtensionState,
  MCPServerContext,
  MetaToolInfo,
  ServerCore,
  ServerMethods,
  ToolRegistryState,
  TransportState,
} from '@server/MCPServer.context';

function buildTransportState(): TransportState {
  return {
    httpSockets: new Set(),
  };
}

function buildExtensionState(): ExtensionState {
  return {
    extensionToolsByName: new Map(),
    extensionPluginsById: new Map(),
    extensionPluginRuntimeById: new Map(),
    extensionWorkflowsById: new Map(),
    extensionWorkflowRuntimeById: new Map(),
  };
}

function buildDomainInstances(): DomainInstances {
  const instanceMap = new Map<string, unknown>();
  return {
    domainInstanceMap: instanceMap,
    getDomainInstance: <T>(key: string) => instanceMap.get(key) as T,
    setDomainInstance: (key: string, value: unknown) => {
      instanceMap.set(key, value);
    },
  };
}

describe('MCPServer.context types and composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildServerCore(): ServerCore {
    return {
      config: {} as unknown as Config,
      server: {} as unknown as McpServer,
      tokenBudget: {} as unknown as TokenBudgetManager,
      unifiedCache: {} as unknown as UnifiedCacheManager,
      detailedData: {} as unknown as DetailedDataManager,
      eventBus: {} as unknown as EventBus<ServerEventMap>,
      samplingBridge: { isSamplingSupported: () => false, sampleText: async () => null } as any,
      elicitationBridge: {
        isElicitationSupported: () => false,
        requestFormInput: async () => null,
      } as any,
    };
  }

  function buildToolRegistryState(tools: Tool[] = []): ToolRegistryState {
    return {
      selectedTools: tools,
      enabledDomains: new Set<string>(),
      router: { has: vi.fn(() => false) } as unknown as ToolExecutionRouter,
      handlerDeps: {} as unknown as ToolHandlerDeps,
      toolAutocompleteHandlers: new Map(),
    };
  }

  function buildActivationState(profile: ToolProfile = 'search'): ActivationState {
    return {
      baseTier: profile,
      activatedToolNames: new Set<string>(),
      activatedRegisteredTools: new Map<string, RegisteredTool>(),
      domainTtlEntries: new Map(),
      metaToolsByName: new Map<string, MetaToolInfo>(),
      clientSupportsListChanged: true,
    };
  }

  function buildServerMethods(): ServerMethods {
    return {
      registerCaches: async () => undefined,
      resolveEnabledDomains: () => new Set<string>(),
      registerSingleTool: () => ({ remove: () => undefined }) as unknown as RegisteredTool,
      reloadExtensions: async () => ({ success: true }) as unknown as ExtensionReloadResult,
      listExtensions: () => ({ success: true }) as unknown as ExtensionListResult,
      executeToolWithTracking: async () => ({ content: [] }) as unknown as ToolResponse,
    };
  }

  function buildFullContext(overrides: Partial<MCPServerContext> = {}): MCPServerContext {
    return {
      ...buildServerCore(),
      ...buildToolRegistryState(),
      ...buildActivationState(),
      ...buildTransportState(),
      ...buildExtensionState(),
      ...buildDomainInstances(),
      ...buildServerMethods(),
      ...overrides,
    } as MCPServerContext;
  }

  it('exports sub-interfaces that can be composed into a full server context', () => {
    const ctx = buildFullContext();
    expect(ctx.enabledDomains).toEqual(new Set());
    expect(ctx.httpSockets.size).toBe(0);
    expect(typeof ctx.registerCaches).toBe('function');
  });

  it('ServerCore interface includes all required infrastructure references', () => {
    const core = buildServerCore();
    expect(core.config).toBeDefined();
    expect(core.server).toBeDefined();
    expect(core.tokenBudget).toBeDefined();
    expect(core.unifiedCache).toBeDefined();
    expect(core.detailedData).toBeDefined();
    expect(core.eventBus).toBeDefined();
  });

  it('ToolRegistryState tracks selected tools and enabled domains', () => {
    const tool1: Tool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: {} },
    };
    const registry = buildToolRegistryState([tool1]);

    expect(registry.selectedTools).toHaveLength(1);
    expect(registry.selectedTools[0]?.name).toBe('test_tool');
    expect(registry.enabledDomains.size).toBe(0);

    registry.enabledDomains.add('browser');
    expect(registry.enabledDomains.has('browser')).toBe(true);
  });

  it('ActivationState supports different tool profiles', () => {
    // @ts-expect-error
    const profiles: ToolProfile[] = ['search', 'full', 'minimal'];
    for (const profile of profiles) {
      const activation = buildActivationState(profile);
      expect(activation.baseTier).toBe(profile);
    }
  });

  it('ActivationState tracks activated tool names and registered tools', () => {
    const activation = buildActivationState();
    const mockRegisteredTool = { remove: vi.fn() } as unknown as RegisteredTool;

    activation.activatedToolNames.add('page_navigate');
    activation.activatedRegisteredTools.set('page_navigate', mockRegisteredTool);

    expect(activation.activatedToolNames.has('page_navigate')).toBe(true);
    expect(activation.activatedRegisteredTools.get('page_navigate')).toBe(mockRegisteredTool);
  });

  it('MetaToolInfo stores meta-tool schemas for describe_tool lookups', () => {
    const activation = buildActivationState();
    const metaTool: MetaToolInfo = {
      name: 'search_tools',
      description: 'Search for tools',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
    };
    activation.metaToolsByName.set('search_tools', metaTool);

    expect(activation.metaToolsByName.get('search_tools')?.name).toBe('search_tools');
    expect(activation.metaToolsByName.get('search_tools')?.inputSchema).toBeDefined();
  });

  it('ActivationState tracks clientSupportsListChanged', () => {
    const withSupport = buildActivationState();
    withSupport.clientSupportsListChanged = true;
    expect(withSupport.clientSupportsListChanged).toBe(true);

    const withoutSupport = buildActivationState();
    withoutSupport.clientSupportsListChanged = false;
    expect(withoutSupport.clientSupportsListChanged).toBe(false);
  });

  it('TransportState supports optional httpServer', () => {
    const transport = buildTransportState();
    expect(transport.httpServer).toBeUndefined();
    expect(transport.httpSockets.size).toBe(0);
  });

  it('ExtensionState tracks plugins, workflows, and tools', () => {
    const extension = buildExtensionState();

    extension.extensionToolsByName.set('custom_tool', {
      name: 'custom_tool',
      domain: 'custom',
    } as any);
    extension.extensionPluginsById.set('plugin-1', { id: 'plugin-1' } as any);
    extension.extensionWorkflowsById.set('wf-1', { id: 'wf-1' } as any);

    expect(extension.extensionToolsByName.size).toBe(1);
    expect(extension.extensionPluginsById.size).toBe(1);
    expect(extension.extensionWorkflowsById.size).toBe(1);
    expect(extension.lastExtensionReloadAt).toBeUndefined();
  });

  it('ExtensionState tracks lastExtensionReloadAt timestamp', () => {
    const extension = buildExtensionState();
    const now = new Date().toISOString();
    extension.lastExtensionReloadAt = now;
    expect(extension.lastExtensionReloadAt).toBe(now);
  });

  it('DomainInstances provides typed get/set accessors for domain handlers', () => {
    const instances = buildDomainInstances();

    const mockHandler = { handle: vi.fn() };
    instances.setDomainInstance('testDomain', mockHandler);

    expect(instances.getDomainInstance<typeof mockHandler>('testDomain')).toBe(mockHandler);
    expect(instances.getDomainInstance('nonExistent')).toBeUndefined();
  });

  it('DomainInstances map is readonly but allows set via setDomainInstance', () => {
    const instances = buildDomainInstances();

    instances.setDomainInstance('key1', 'value1');
    instances.setDomainInstance('key2', 'value2');

    expect(instances.domainInstanceMap.size).toBe(2);
    expect(instances.domainInstanceMap.get('key1')).toBe('value1');
  });

  it('DomainInstances supports optional backward-compatible named accessors', () => {
    const instances = buildDomainInstances();

    // All named accessors should be optional (undefined by default)
    expect(instances.collector).toBeUndefined();
    expect(instances.pageController).toBeUndefined();
    expect(instances.domInspector).toBeUndefined();
    expect(instances.scriptManager).toBeUndefined();
    expect(instances.debuggerManager).toBeUndefined();
    expect(instances.runtimeInspector).toBeUndefined();
    expect(instances.consoleMonitor).toBeUndefined();
    expect(instances.browserHandlers).toBeUndefined();
    expect(instances.debuggerHandlers).toBeUndefined();
    expect(instances.advancedHandlers).toBeUndefined();
    expect(instances.deobfuscator).toBeUndefined();
    expect(instances.hookManager).toBeUndefined();
    expect(instances.traceRecorder).toBeUndefined();
  });

  it('ServerMethods includes all required method signatures', () => {
    const methods = buildServerMethods();
    expect(typeof methods.registerCaches).toBe('function');
    expect(typeof methods.resolveEnabledDomains).toBe('function');
    expect(typeof methods.registerSingleTool).toBe('function');
    expect(typeof methods.reloadExtensions).toBe('function');
    expect(typeof methods.listExtensions).toBe('function');
    expect(typeof methods.executeToolWithTracking).toBe('function');
  });

  it('ServerMethods.resolveEnabledDomains returns a Set of strings', () => {
    const methods = buildServerMethods();
    const result = methods.resolveEnabledDomains([]);
    expect(result).toBeInstanceOf(Set);
  });

  it('ServerMethods.registerSingleTool returns a RegisteredTool with remove method', () => {
    const methods = buildServerMethods();
    const tool: Tool = {
      name: 'test',
      description: 'Test',
      inputSchema: { type: 'object', properties: {} },
    };
    const registered = methods.registerSingleTool(tool);
    expect(typeof registered.remove).toBe('function');
  });

  it('ServerMethods.executeToolWithTracking returns a ToolResponse', async () => {
    const methods = buildServerMethods();
    const response = await methods.executeToolWithTracking('test', {});
    expect(response.content).toEqual([]);
  });

  it('MCPServerContext is assignable from all composed sub-interfaces', () => {
    const ctx = buildFullContext();
    // Type checks: ctx should satisfy MCPServerContext
    const _: MCPServerContext = ctx;
    expect(_).toBe(ctx);
  });

  it('composed context preserves all properties from sub-interfaces', () => {
    const ctx = buildFullContext({
      enabledDomains: new Set(['browser', 'network']),
      baseTier: 'full',
      clientSupportsListChanged: false,
      skiaCaptureHandlers: undefined,
      activatedRegisteredTools: new Map(),
      toolAutocompleteHandlers: new Map(),
    } as unknown as MCPServerContext);

    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(ctx.enabledDomains.has('network')).toBe(true);
    expect(ctx.baseTier).toBe('full');
    expect(ctx.clientSupportsListChanged).toBe(false);
  });
});
