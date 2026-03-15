import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '@internal-types/index';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import type { PageController } from '@modules/collector/PageController';
import type { DOMInspector } from '@modules/collector/DOMInspector';
import type { ScriptManager } from '@modules/debugger/ScriptManager';
import type { DebuggerManager } from '@modules/debugger/DebuggerManager';
import type { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import type { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor';
import type { BrowserToolHandlers } from '@server/domains/browser/index';
import type { DebuggerToolHandlers } from '@server/domains/debugger/index';
import type { AdvancedToolHandlers } from '@server/domains/network/index';
import type { AIHookToolHandlers, HookPresetToolHandlers } from '@server/domains/hooks/index';
import type { Deobfuscator } from '@modules/deobfuscator/Deobfuscator';
import type { AdvancedDeobfuscator } from '@modules/deobfuscator/AdvancedDeobfuscator';
import type { ASTOptimizer } from '@modules/deobfuscator/ASTOptimizer';
import type { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';
import type { LLMService } from '@services/LLMService';
import type { CodeAnalyzer } from '@modules/analyzer/CodeAnalyzer';
import type { CryptoDetector } from '@modules/crypto/CryptoDetector';
import type { HookManager } from '@modules/hook/HookManager';
import type { TokenBudgetManager } from '@utils/TokenBudgetManager';
import type { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import type { CoreAnalysisHandlers } from '@server/domains/analysis/index';
import type { CoreMaintenanceHandlers, ExtensionManagementHandlers } from '@server/domains/maintenance/index';
import type { ProcessToolHandlers } from '@server/domains/process/index';
import type { WorkflowHandlers } from '@server/domains/workflow/index';
import type { ExtensionWorkflowRuntimeRecord } from '@server/extensions/types';
import type { WasmToolHandlers } from '@server/domains/wasm/index';
import type { StreamingToolHandlers } from '@server/domains/streaming/index';
import type { EncodingToolHandlers } from '@server/domains/encoding/index';
import type { AntiDebugToolHandlers } from '@server/domains/antidebug/index';
import type { GraphQLToolHandlers } from '@server/domains/graphql/index';
import type { PlatformToolHandlers } from '@server/domains/platform/index';
import type { SourcemapToolHandlers } from '@server/domains/sourcemap/index';
import type { TransformToolHandlers } from '@server/domains/transform/index';
import type { ToolArgs, ToolResponse } from '@server/types';
import type { ToolProfile } from '@server/ToolCatalog';
import type { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import type { ToolHandlerDeps } from '@server/registry/contracts';
import type {
  ExtensionListResult,
  ExtensionPluginRecord,
  ExtensionPluginRuntimeRecord,
  ExtensionReloadResult,
  ExtensionToolRecord,
  ExtensionWorkflowRecord,
} from '@server/extensions/types';

/* ---------- Sub-interfaces ---------- */

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

/** Domain-level activation state with TTL support. */
export interface ActivationState {
  baseTier: ToolProfile;
  activatedToolNames: Set<string>;
  activatedRegisteredTools: Map<string, RegisteredTool>;
  /** Per-domain TTL entries for auto-expiry of activated domains. */
  domainTtlEntries: Map<string, import('@server/MCPServer.activation.ttl').DomainTtlEntry>;
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

/** Lazy-initialized domain handler and core module instances. */
export interface DomainInstances {
  collector?: CodeCollector;
  pageController?: PageController;
  domInspector?: DOMInspector;
  scriptManager?: ScriptManager;
  debuggerManager?: DebuggerManager;
  runtimeInspector?: RuntimeInspector;
  consoleMonitor?: ConsoleMonitor;
  llm?: LLMService;
  browserHandlers?: BrowserToolHandlers;
  debuggerHandlers?: DebuggerToolHandlers;
  advancedHandlers?: AdvancedToolHandlers;
  aiHookHandlers?: AIHookToolHandlers;
  hookPresetHandlers?: HookPresetToolHandlers;
  deobfuscator?: Deobfuscator;
  advancedDeobfuscator?: AdvancedDeobfuscator;
  astOptimizer?: ASTOptimizer;
  obfuscationDetector?: ObfuscationDetector;
  analyzer?: CodeAnalyzer;
  cryptoDetector?: CryptoDetector;
  hookManager?: HookManager;
  coreAnalysisHandlers?: CoreAnalysisHandlers;
  coreMaintenanceHandlers?: CoreMaintenanceHandlers;
  extensionManagementHandlers?: ExtensionManagementHandlers;
  processHandlers?: ProcessToolHandlers;
  workflowHandlers?: WorkflowHandlers;
  wasmHandlers?: WasmToolHandlers;
  streamingHandlers?: StreamingToolHandlers;
  encodingHandlers?: EncodingToolHandlers;
  antidebugHandlers?: AntiDebugToolHandlers;
  graphqlHandlers?: GraphQLToolHandlers;
  platformHandlers?: PlatformToolHandlers;
  sourcemapHandlers?: SourcemapToolHandlers;
  transformHandlers?: TransformToolHandlers;
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

/* ---------- Composed context ---------- */

export interface MCPServerContext extends
  ServerCore,
  ToolRegistryState,
  ActivationState,
  TransportState,
  ExtensionState,
  DomainInstances,
  ServerMethods {}
