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
import type { ADBBridgeHandlers } from '@server/domains/adb-bridge/handlers';
import type { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import type { BoringsslInspectorHandlers } from '@server/domains/boringssl-inspector/handlers';
import type { CrossDomainHandlers } from '@server/domains/cross-domain/handlers';
import type { ExtensionRegistryHandlers } from '@server/domains/extension-registry/handlers';
import type { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers';
import type { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';
import type { SkiaCaptureHandlers } from '@server/domains/skia-capture/handlers';
import type { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers';
import type { V8InspectorHandlers } from '@server/domains/v8-inspector/handlers';
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
  eventBus: import('@server/EventBus').EventBus<import('@server/EventBus').ServerEventMap>;
  /** Sampling delegation bridge — allows tools to request LLM inference from the client */
  samplingBridge: import('@server/LLMSamplingBridge').LLMSamplingBridge;
  /** Elicitation bridge — allows tools to request interactive user input from the client */
  elicitationBridge: import('@server/ElicitationBridge').ElicitationBridge;
}

/** Tool selection and routing state. */
export interface ToolRegistryState {
  selectedTools: Tool[];
  enabledDomains: Set<string>;
  router: ToolExecutionRouter;
  handlerDeps: ToolHandlerDeps;
  toolAutocompleteHandlers: Map<
    string,
    Record<string, (value: string) => string[] | Promise<string[]>>
  >;
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
  shutdownStarted?: boolean;
  shutdownPromise?: Promise<void>;
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

  // ── Backward-compatible named accessors (STS2 P4) ──

  collector?: import('@modules/collector/CodeCollector').CodeCollector;
  pageController?: import('@modules/collector/PageController').PageController;
  domInspector?: import('@modules/collector/DOMInspector').DOMInspector;
  scriptManager?: import('@modules/debugger/ScriptManager').ScriptManager;
  debuggerManager?: import('@modules/debugger/DebuggerManager').DebuggerManager;
  runtimeInspector?: import('@modules/debugger/RuntimeInspector').RuntimeInspector;
  consoleMonitor?: import('@modules/monitor/ConsoleMonitor').ConsoleMonitor;
  browserHandlers?: import('@server/domains/browser/index').BrowserToolHandlers;
  v8InspectorHandlers?: V8InspectorHandlers;
  boringsslInspectorHandlers?: BoringsslInspectorHandlers;
  skiaCaptureHandlers?: SkiaCaptureHandlers;
  binaryInstrumentHandlers?: BinaryInstrumentHandlers;
  adbBridgeHandlers?: ADBBridgeHandlers;
  mojoIpcHandlers?: MojoIPCHandlers;
  syscallHookHandlers?: SyscallHookHandlers;
  protocolAnalysisHandlers?: ProtocolAnalysisHandlers;
  extensionRegistryHandlers?: ExtensionRegistryHandlers;
  crossDomainHandlers?: CrossDomainHandlers;
  debuggerHandlers?: import('@server/domains/debugger/index').DebuggerToolHandlers;
  advancedHandlers?: import('@server/domains/network/index').AdvancedToolHandlers;
  aiHookHandlers?: import('@server/domains/hooks/index').AIHookToolHandlers;
  hookPresetHandlers?: import('@server/domains/hooks/index').HookPresetToolHandlers;
  deobfuscator?: import('@modules/deobfuscator/Deobfuscator').Deobfuscator;
  advancedDeobfuscator?: import('@modules/deobfuscator/AdvancedDeobfuscator').AdvancedDeobfuscator;
  astOptimizer?: import('@modules/deobfuscator/ASTOptimizer').ASTOptimizer;
  obfuscationDetector?: import('@modules/detector/ObfuscationDetector').ObfuscationDetector;
  analyzer?: import('@modules/analyzer/CodeAnalyzer').CodeAnalyzer;
  cryptoDetector?: import('@modules/crypto/CryptoDetector').CryptoDetector;
  hookManager?: import('@modules/hook/HookManager').HookManager;
  coreAnalysisHandlers?: import('@server/domains/analysis/index').CoreAnalysisHandlers;
  coreMaintenanceHandlers?: import('@server/domains/maintenance/index').CoreMaintenanceHandlers;
  extensionManagementHandlers?: import('@server/domains/maintenance/index').ExtensionManagementHandlers;
  processHandlers?: import('@server/domains/process/index').ProcessToolHandlers;
  workflowHandlers?: import('@server/domains/workflow/index').WorkflowHandlers;
  wasmHandlers?: import('@server/domains/wasm/index').WasmToolHandlers;
  streamingHandlers?: import('@server/domains/streaming/index').StreamingToolHandlers;
  encodingHandlers?: import('@server/domains/encoding/index').EncodingToolHandlers;
  antidebugHandlers?: import('@server/domains/antidebug/index').AntiDebugToolHandlers;
  graphqlHandlers?: import('@server/domains/graphql/index').GraphQLToolHandlers;
  platformHandlers?: import('@server/domains/platform/index').PlatformToolHandlers;
  sourcemapHandlers?: import('@server/domains/sourcemap/index').SourcemapToolHandlers;
  transformHandlers?: import('@server/domains/transform/index').TransformToolHandlers;
  coordinationHandlers?: import('@server/domains/coordination/index').CoordinationHandlers;
  traceRecorder?: import('@modules/trace/TraceRecorder').TraceRecorder;
  traceHandlers?: import('@server/domains/trace/index').TraceToolHandlers;
  evidenceHandlers?: import('@server/domains/evidence/index').EvidenceHandlers;
  instrumentationHandlers?:
    | import('@server/domains/instrumentation/index').InstrumentationHandlers
    | undefined;
  sharedStateBoardHandlers?: import('@server/domains/shared-state-board/index').SharedStateBoardHandlers;
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
