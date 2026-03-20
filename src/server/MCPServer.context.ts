import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '@internal-types/index';
import type { ToolArgs, ToolResponse } from '@server/types';
import type { ToolProfile } from '@server/ToolCatalog';
import type { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import type { ToolHandlerDeps } from '@server/registry/contracts';
import type { TokenBudgetManager } from '@utils/TokenBudgetManager';
import type { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import type {
  ExtensionListResult,
  ExtensionPluginRecord,
  ExtensionPluginRuntimeRecord,
  ExtensionReloadResult,
  ExtensionToolRecord,
  ExtensionWorkflowRecord,
  ExtensionWorkflowRuntimeRecord,
} from '@server/extensions/types';

// ── Sub-interfaces ──

/** Core server infrastructure: MCP SDK instance, config, global managers. */
export interface ServerCore {
  config: Config;
  server: McpServer;
  tokenBudget: TokenBudgetManager;
  unifiedCache: UnifiedCacheManager;
  detailedData: DetailedDataManager;
}

/** Tool selection and routing state. */
export interface ToolRegistryState {
  selectedTools: Tool[];
  enabledDomains: Set<string>;
  router: ToolExecutionRouter;
  handlerDeps: ToolHandlerDeps;
}

/** Minimal info stored for meta-tools so describe_tool can look them up. */
export interface MetaToolInfo {
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
}

/** Domain-level activation state with TTL support. */
export interface ActivationState {
  baseTier: ToolProfile;
  activatedToolNames: Set<string>;
  activatedRegisteredTools: Map<string, RegisteredTool>;
  /** Per-domain TTL entries for auto-expiry of activated domains. */
  domainTtlEntries: Map<string, import('@server/MCPServer.activation.ttl').DomainTtlEntry>;
  /** Meta-tool schemas for describe_tool lookups (search_tools, activate_domain, etc.). */
  metaToolsByName: Map<string, MetaToolInfo>;
  /** Whether the connected client supports tools/list_changed notifications. */
  clientSupportsListChanged: boolean;
}

/** Transport-level (HTTP / stdio) state. */
export interface TransportState {
  httpServer?: Server;
  httpSockets: Set<Socket>;
}

/** Runtime-loaded plugins/workflows/tools from external directories. */
export interface ExtensionState {
  extensionToolsByName: Map<string, ExtensionToolRecord>;
  extensionPluginsById: Map<string, ExtensionPluginRecord>;
  extensionPluginRuntimeById: Map<string, ExtensionPluginRuntimeRecord>;
  extensionWorkflowsById: Map<string, ExtensionWorkflowRecord>;
  extensionWorkflowRuntimeById: Map<string, ExtensionWorkflowRuntimeRecord>;
  lastExtensionReloadAt?: string;
}

/**
 * Centralized domain instance store.
 *
 * Replaces the old 35-property typed interface. New domains no longer
 * need to modify this file — just call `setDomainInstance(key, handler)`
 * in their manifest ensure() function.
 *
 * For backward compatibility, the MCPServer class exposes typed getters
 * (e.g. `get collector()`) that delegate to the map.
 */
export interface DomainInstances {
  /** Centralized store for lazy-initialised domain handler instances. */
  readonly domainInstanceMap: Map<string, unknown>;
  /** Typed read accessor. */
  getDomainInstance<T>(key: string): T | undefined;
  /** Typed write accessor. */
  setDomainInstance(key: string, value: unknown): void;
}

/** Methods exposed by the server context for cross-module use. */
export interface ServerMethods {
  registerCaches(): Promise<void>;
  resolveEnabledDomains(tools: Tool[]): Set<string>;
  registerSingleTool(toolDef: Tool): RegisteredTool;
  reloadExtensions(): Promise<ExtensionReloadResult>;
  listExtensions(): ExtensionListResult;
  executeToolWithTracking(name: string, args: ToolArgs): Promise<ToolResponse>;
}

// ── Composed context ──

export interface MCPServerContext
  extends
    ServerCore,
    ToolRegistryState,
    ActivationState,
    TransportState,
    ExtensionState,
    DomainInstances,
    ServerMethods {}
