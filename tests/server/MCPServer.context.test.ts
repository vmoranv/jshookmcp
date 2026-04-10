import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '@internal-types/index';
import type { TokenBudgetManager } from '@utils/TokenBudgetManager';
import type { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import type { ToolHandlerDeps } from '@server/registry/contracts';
import type { ExtensionReloadResult, ExtensionListResult } from '@server/extensions/types';
import type { ToolResponse } from '@server/types';

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
    } satisfies ServerCore;

    const registryState = {
      selectedTools: [],
      enabledDomains: new Set<string>(['browser']),
      router: {} as unknown as ToolExecutionRouter,
      handlerDeps: {} as unknown as ToolHandlerDeps,
      toolAutocompleteHandlers: new Map(),
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
      getDomainInstance: <T>(key: string) => new Map().get(key) as T,
      setDomainInstance: () => undefined,
    } satisfies DomainInstances;

    const methods = {
      registerCaches: async () => undefined,
      resolveEnabledDomains: () => new Set<string>(),
      registerSingleTool: () => ({ remove: () => undefined }) as unknown as RegisteredTool,
      reloadExtensions: async () => ({ success: true }) as unknown as ExtensionReloadResult,
      listExtensions: () => ({ success: true }) as unknown as ExtensionListResult,
      executeToolWithTracking: async () => ({ content: [] }) as unknown as ToolResponse,
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
