import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { CacheManager } from '../utils/cache.js';
import { CodeCollector } from '../modules/collector/CodeCollector.js';
import { PageController } from '../modules/collector/PageController.js';
import { DOMInspector } from '../modules/collector/DOMInspector.js';
import { ScriptManager } from '../modules/debugger/ScriptManager.js';
import { DebuggerManager } from '../modules/debugger/DebuggerManager.js';
import { RuntimeInspector } from '../modules/debugger/RuntimeInspector.js';
import { ConsoleMonitor } from '../modules/monitor/ConsoleMonitor.js';
import type { BrowserToolHandlers } from './domains/browser/index.js';
import type { DebuggerToolHandlers } from './domains/debugger/index.js';
import type { AdvancedToolHandlers } from './domains/network/index.js';
import type { AIHookToolHandlers } from './domains/hooks/index.js';
import type { HookPresetToolHandlers } from './domains/hooks/index.js';
import { Deobfuscator } from '../modules/deobfuscator/Deobfuscator.js';
import { AdvancedDeobfuscator } from '../modules/deobfuscator/AdvancedDeobfuscator.js';
import { ASTOptimizer } from '../modules/deobfuscator/ASTOptimizer.js';
import { ObfuscationDetector } from '../modules/detector/ObfuscationDetector.js';
import { LLMService } from '../services/LLMService.js';
import { CodeAnalyzer } from '../modules/analyzer/CodeAnalyzer.js';
import { CryptoDetector } from '../modules/crypto/CryptoDetector.js';
import { HookManager } from '../modules/hook/HookManager.js';
import { TokenBudgetManager } from '../utils/TokenBudgetManager.js';
import { UnifiedCacheManager } from '../utils/UnifiedCacheManager.js';
import type { CoreAnalysisHandlers } from './domains/analysis/index.js';
import type { CoreMaintenanceHandlers } from './domains/maintenance/index.js';
import type { ProcessToolHandlers } from './domains/process/index.js';
import type { WorkflowHandlers } from './domains/workflow/index.js';
import type { WasmToolHandlers } from './domains/wasm/index.js';
import type { StreamingToolHandlers } from './domains/streaming/index.js';
import type { EncodingToolHandlers } from './domains/encoding/index.js';
import type { AntiDebugToolHandlers } from './domains/antidebug/index.js';
import type { GraphQLToolHandlers } from './domains/graphql/index.js';
import type { PlatformToolHandlers } from './domains/platform/index.js';
import type { SourcemapToolHandlers } from './domains/sourcemap/index.js';
import type { TransformToolHandlers } from './domains/transform/index.js';
import { asErrorResponse } from './domains/shared/response.js';
import {
  type ToolDomain,
  type ToolProfile,
} from './ToolCatalog.js';
import { ToolExecutionRouter } from './ToolExecutionRouter.js';
import { createToolHandlerMap, type ToolHandlerMapDependencies } from './ToolHandlerMap.js';
import type { ToolArgs } from './types.js';
import { resolveToolsForRegistration as resolveToolsForRegistrationHelper } from './MCPServer.registration.js';
import {
  createDomainProxy as createDomainProxyHelper,
  ensureAdvancedHandlers as ensureAdvancedHandlersHelper,
  ensureAIHookHandlers as ensureAIHookHandlersHelper,
  ensureAntiDebugHandlers as ensureAntiDebugHandlersHelper,
  ensureBrowserHandlers as ensureBrowserHandlersHelper,
  ensureCollector as ensureCollectorHelper,
  ensureConsoleMonitor as ensureConsoleMonitorHelper,
  ensureCoreAnalysisHandlers as ensureCoreAnalysisHandlersHelper,
  ensureCoreMaintenanceHandlers as ensureCoreMaintenanceHandlersHelper,
  ensureDOMInspector as ensureDOMInspectorHelper,
  ensureDebuggerHandlers as ensureDebuggerHandlersHelper,
  ensureDebuggerManager as ensureDebuggerManagerHelper,
  ensureEncodingHandlers as ensureEncodingHandlersHelper,
  ensureGraphQLHandlers as ensureGraphQLHandlersHelper,
  ensureHookPresetHandlers as ensureHookPresetHandlersHelper,
  ensureLLM as ensureLLMHelper,
  ensurePageController as ensurePageControllerHelper,
  ensurePlatformHandlers as ensurePlatformHandlersHelper,
  ensureProcessHandlers as ensureProcessHandlersHelper,
  ensureRuntimeInspector as ensureRuntimeInspectorHelper,
  ensureScriptManager as ensureScriptManagerHelper,
  ensureSourcemapHandlers as ensureSourcemapHandlersHelper,
  ensureStreamingHandlers as ensureStreamingHandlersHelper,
  ensureTransformHandlers as ensureTransformHandlersHelper,
  ensureWasmHandlers as ensureWasmHandlersHelper,
  ensureWorkflowHandlers as ensureWorkflowHandlersHelper,
  resolveEnabledDomains as resolveEnabledDomainsHelper,
} from './MCPServer.domain.js';
import {
  boostProfile as boostProfileHelper,
  switchToTier as switchToTierHelper,
  unboostProfile as unboostProfileHelper,
} from './MCPServer.boost.js';
import {
  closeServer as closeServerHelper,
  startHttpTransport as startHttpTransportHelper,
  startStdioTransport as startStdioTransportHelper,
} from './MCPServer.transport.js';
import {
  registerMetaTools as registerMetaToolsHelper,
  registerSingleTool as registerSingleToolHelper,
} from './MCPServer.tools.js';
import { registerSearchMetaTools as registerSearchMetaToolsHelper } from './MCPServer.search.js';
import type { MCPServerContext } from './MCPServer.context.js';

export class MCPServer implements MCPServerContext {
  public readonly config: Config;
  public readonly server: McpServer;
  private readonly cache: CacheManager;
  public readonly tokenBudget: TokenBudgetManager;
  public readonly unifiedCache: UnifiedCacheManager;
  public readonly selectedTools: Tool[];
  public enabledDomains: Set<ToolDomain>;
  public readonly router: ToolExecutionRouter;
  public readonly handlerDeps: ToolHandlerMapDependencies;
  private degradedMode = false;
  private cacheAdaptersRegistered = false;
  private cacheRegistrationPromise?: Promise<void>;
  /** Startup profile (from env / default). */
  public readonly baseTier: ToolProfile;
  /** Currently active profile tier. */
  public currentTier: ToolProfile;
  /** Tier history stack for progressive downgrade: [baseTier, ...boosted tiers]. */
  public readonly boostHistory: ToolProfile[] = [];
  public readonly boostedToolNames = new Set<string>();
  public readonly boostedRegisteredTools = new Map<string, RegisteredTool>();
  public boostTtlTimer: ReturnType<typeof setTimeout> | null = null;
  public boostLock: Promise<void> = Promise.resolve();
  public readonly activatedToolNames = new Set<string>();
  public readonly activatedRegisteredTools = new Map<string, RegisteredTool>();
  public httpServer?: Server;
  public readonly httpSockets = new Set<Socket>();

  public collector?: CodeCollector;
  public pageController?: PageController;
  public domInspector?: DOMInspector;
  public scriptManager?: ScriptManager;
  public debuggerManager?: DebuggerManager;
  public runtimeInspector?: RuntimeInspector;
  public consoleMonitor?: ConsoleMonitor;
  public llm?: LLMService;

  public browserHandlers?: BrowserToolHandlers;
  public debuggerHandlers?: DebuggerToolHandlers;
  public advancedHandlers?: AdvancedToolHandlers;
  public aiHookHandlers?: AIHookToolHandlers;
  public hookPresetHandlers?: HookPresetToolHandlers;
  public deobfuscator?: Deobfuscator;
  public advancedDeobfuscator?: AdvancedDeobfuscator;
  public astOptimizer?: ASTOptimizer;
  public obfuscationDetector?: ObfuscationDetector;
  public analyzer?: CodeAnalyzer;
  public cryptoDetector?: CryptoDetector;
  public hookManager?: HookManager;
  public coreAnalysisHandlers?: CoreAnalysisHandlers;
  public coreMaintenanceHandlers?: CoreMaintenanceHandlers;
  public processHandlers?: ProcessToolHandlers;
  public workflowHandlers?: WorkflowHandlers;
  public wasmHandlers?: WasmToolHandlers;
  public streamingHandlers?: StreamingToolHandlers;
  public encodingHandlers?: EncodingToolHandlers;
  public antidebugHandlers?: AntiDebugToolHandlers;
  public graphqlHandlers?: GraphQLToolHandlers;
  public platformHandlers?: PlatformToolHandlers;
  public sourcemapHandlers?: SourcemapToolHandlers;
  public transformHandlers?: TransformToolHandlers;

  constructor(config: Config) {
    this.config = config;
    this.cache = new CacheManager(config.cache);
    this.tokenBudget = TokenBudgetManager.getInstance();
    this.unifiedCache = UnifiedCacheManager.getInstance();
    const { tools, profile } = this.resolveToolsForRegistration();
    this.selectedTools = tools;
    this.baseTier = profile;
    this.currentTier = profile;
    this.enabledDomains = this.resolveEnabledDomains(this.selectedTools);

    const selectedToolNames = new Set(this.selectedTools.map(t => t.name));
    this.handlerDeps = {
      browserHandlers: this.createDomainProxy(
        'browser',
        'BrowserToolHandlers',
        () => this.ensureBrowserHandlers()
      ),
      debuggerHandlers: this.createDomainProxy(
        'debugger',
        'DebuggerToolHandlers',
        () => this.ensureDebuggerHandlers()
      ),
      advancedHandlers: this.createDomainProxy(
        'network',
        'AdvancedToolHandlers',
        () => this.ensureAdvancedHandlers()
      ),
      aiHookHandlers: this.createDomainProxy(
        'hooks',
        'AIHookToolHandlers',
        () => this.ensureAIHookHandlers()
      ),
      hookPresetHandlers: this.createDomainProxy(
        'hooks',
        'HookPresetToolHandlers',
        () => this.ensureHookPresetHandlers()
      ),
      coreAnalysisHandlers: this.createDomainProxy(
        'core',
        'CoreAnalysisHandlers',
        () => this.ensureCoreAnalysisHandlers()
      ),
      coreMaintenanceHandlers: this.createDomainProxy(
        'maintenance',
        'CoreMaintenanceHandlers',
        () => this.ensureCoreMaintenanceHandlers()
      ),
      processHandlers: this.createDomainProxy(
        'process',
        'ProcessToolHandlers',
        () => this.ensureProcessHandlers()
      ),
      workflowHandlers: this.createDomainProxy(
        'workflow',
        'WorkflowHandlers',
        () => this.ensureWorkflowHandlers()
      ),
      wasmHandlers: this.createDomainProxy(
        'wasm',
        'WasmToolHandlers',
        () => this.ensureWasmHandlers()
      ),
      streamingHandlers: this.createDomainProxy(
        'streaming',
        'StreamingToolHandlers',
        () => this.ensureStreamingHandlers()
      ),
      encodingHandlers: this.createDomainProxy(
        'encoding',
        'EncodingToolHandlers',
        () => this.ensureEncodingHandlers()
      ),
      antidebugHandlers: this.createDomainProxy(
        'antidebug',
        'AntiDebugToolHandlers',
        () => this.ensureAntiDebugHandlers()
      ),
      graphqlHandlers: this.createDomainProxy(
        'graphql',
        'GraphQLToolHandlers',
        () => this.ensureGraphQLHandlers()
      ),
      platformHandlers: this.createDomainProxy(
        'platform',
        'PlatformToolHandlers',
        () => this.ensurePlatformHandlers()
      ),
      sourcemapHandlers: this.createDomainProxy(
        'sourcemap',
        'SourcemapToolHandlers',
        () => this.ensureSourcemapHandlers()
      ),
      transformHandlers: this.createDomainProxy(
        'transform',
        'TransformToolHandlers',
        () => this.ensureTransformHandlers()
      ),
    };
    this.router = new ToolExecutionRouter(
      createToolHandlerMap(this.handlerDeps, selectedToolNames)
    );
    // Use McpServer high-level API with logging capability declared
    this.server = new McpServer(
      { name: config.mcp.name, version: config.mcp.version },
      { capabilities: { tools: { listChanged: true }, logging: {} } }
    );

    this.registerTools();
  }

  public resolveEnabledDomains(tools: Tool[]): Set<ToolDomain> {
    return resolveEnabledDomainsHelper(tools);
  }

  private createDomainProxy<T extends object>(domain: ToolDomain, label: string, factory: () => T): T {
    return createDomainProxyHelper(this, domain, label, factory);
  }

  public ensureCollector(): CodeCollector {
    return ensureCollectorHelper(this);
  }

  public ensurePageController(): PageController {
    return ensurePageControllerHelper(this);
  }

  public ensureDOMInspector(): DOMInspector {
    return ensureDOMInspectorHelper(this);
  }

  public ensureScriptManager(): ScriptManager {
    return ensureScriptManagerHelper(this);
  }

  public ensureDebuggerManager(): DebuggerManager {
    return ensureDebuggerManagerHelper(this);
  }

  public ensureRuntimeInspector(): RuntimeInspector {
    return ensureRuntimeInspectorHelper(this);
  }

  public ensureConsoleMonitor(): ConsoleMonitor {
    return ensureConsoleMonitorHelper(this);
  }

  public ensureLLM(): LLMService {
    return ensureLLMHelper(this);
  }

  private ensureBrowserHandlers(): BrowserToolHandlers {
    return ensureBrowserHandlersHelper(this);
  }

  private ensureDebuggerHandlers(): DebuggerToolHandlers {
    return ensureDebuggerHandlersHelper(this);
  }

  private ensureAdvancedHandlers(): AdvancedToolHandlers {
    return ensureAdvancedHandlersHelper(this);
  }

  private ensureAIHookHandlers(): AIHookToolHandlers {
    return ensureAIHookHandlersHelper(this);
  }

  private ensureHookPresetHandlers(): HookPresetToolHandlers {
    return ensureHookPresetHandlersHelper(this);
  }

  private ensureCoreAnalysisHandlers(): CoreAnalysisHandlers {
    return ensureCoreAnalysisHandlersHelper(this);
  }

  private ensureCoreMaintenanceHandlers(): CoreMaintenanceHandlers {
    return ensureCoreMaintenanceHandlersHelper(this);
  }

  private ensureProcessHandlers(): ProcessToolHandlers {
    return ensureProcessHandlersHelper(this);
  }

  private ensureWorkflowHandlers(): WorkflowHandlers {
    return ensureWorkflowHandlersHelper(this);
  }

  private ensureWasmHandlers(): WasmToolHandlers {
    return ensureWasmHandlersHelper(this);
  }

  private ensureStreamingHandlers(): StreamingToolHandlers {
    return ensureStreamingHandlersHelper(this);
  }

  private ensureEncodingHandlers(): EncodingToolHandlers {
    return ensureEncodingHandlersHelper(this);
  }

  private ensureAntiDebugHandlers(): AntiDebugToolHandlers {
    return ensureAntiDebugHandlersHelper(this);
  }

  private ensureGraphQLHandlers(): GraphQLToolHandlers {
    return ensureGraphQLHandlersHelper(this);
  }

  private ensurePlatformHandlers(): PlatformToolHandlers {
    return ensurePlatformHandlersHelper(this);
  }

  private ensureSourcemapHandlers(): SourcemapToolHandlers {
    return ensureSourcemapHandlersHelper(this);
  }

  private ensureTransformHandlers(): TransformToolHandlers {
    return ensureTransformHandlersHelper(this);
  }

  /**
   * Register all tools with the McpServer using the high-level tool() API.
   */
  private registerTools(): void {
    for (const toolDef of this.selectedTools) {
      this.registerSingleTool(toolDef);
    }
    this.registerMetaTools();
    this.registerSearchMetaTools();
    logger.info(`Registered ${this.selectedTools.length} tools + meta tools with McpServer`);
  }

  /** Register a single tool definition with the MCP SDK. Returns the RegisteredTool handle. */
  public registerSingleTool(toolDef: Tool): RegisteredTool {
    return registerSingleToolHelper(this, toolDef);
  }

  /**
   * Register profile boost/unboost meta-tools that are always available regardless of profile.
   *
   * Three-tier progressive boost:
   *   min (base) ─boost→ workflow ─boost→ full
   *   full ─unboost→ workflow ─unboost→ min
   */
  private registerMetaTools(): void {
    return registerMetaToolsHelper(this);
  }

  /** Register search, activate, deactivate, and activate_domain meta-tools. */
  private registerSearchMetaTools(): void {
    return registerSearchMetaToolsHelper(this);
  }

  /** Serialize and execute a boost to the target tier. */
  public async boostProfile(
    target?: string,
    ttlMinutes?: number,
  ): Promise<Record<string, unknown>> {
    return boostProfileHelper(this, target, ttlMinutes);
  }

  /** Serialize and execute an unboost / downgrade. */
  public async unboostProfile(
    target?: string,
  ): Promise<Record<string, unknown>> {
    return unboostProfileHelper(this, target);
  }

  /**
   * Core tier-switching logic: tear down all boosted tools then optionally
   * rebuild for the new target tier (if it's above the base tier).
   */
  public async switchToTier(targetTier: ToolProfile): Promise<void> {
    return switchToTierHelper(this, targetTier);
  }

  private resolveToolsForRegistration(): { tools: Tool[]; profile: ToolProfile } {
    return resolveToolsForRegistrationHelper();
  }

  public async registerCaches(): Promise<void> {
    if (this.cacheAdaptersRegistered) {
      return;
    }
    if (!this.collector) {
      return;
    }
    if (this.cacheRegistrationPromise) {
      await this.cacheRegistrationPromise;
      return;
    }

    this.cacheRegistrationPromise = (async () => {
      try {
        const { DetailedDataManager } = await import('../utils/DetailedDataManager.js');
        const { createCacheAdapters } = await import('../utils/CacheAdapters.js');
        const detailedDataManager = DetailedDataManager.getInstance();
        const codeCache = this.collector!.getCache();
        const codeCompressor = this.collector!.getCompressor();

        const adapters = createCacheAdapters(detailedDataManager, codeCache, codeCompressor);
        for (const adapter of adapters) {
          this.unifiedCache.registerCache(adapter);
        }
        this.cacheAdaptersRegistered = true;
        logger.info(`Registered ${adapters.length} cache adapters.`);
      } catch (error) {
        logger.error('Cache registration failed:', error);
      } finally {
        this.cacheRegistrationPromise = undefined;
      }
    })();

    try {
      await this.cacheRegistrationPromise;
    } catch (error) {
      logger.error('Cache registration failed:', error);
    }
  }

  public async executeToolWithTracking(name: string, args: ToolArgs) {
    try {
      const response = await this.router.execute(name, args);
      try {
        this.tokenBudget.recordToolCall(name, args, response);
      } catch (trackingError) {
        logger.warn('Token tracking failed, continuing without tracking this call:', trackingError);
      }
      return response;
    } catch (error) {
      const errorResponse = asErrorResponse(error);
      try {
        this.tokenBudget.recordToolCall(name, args, errorResponse);
      } catch (trackingError) {
        logger.warn('Token tracking failed on error path:', trackingError);
      }
      throw error;
    }
  }

  enterDegradedMode(reason: string): void {
    if (this.degradedMode) {
      return;
    }

    this.degradedMode = true;
    logger.warn(`Entering degraded mode: ${reason}`);
    this.tokenBudget.setTrackingEnabled(false);
    logger.setLevel('warn');
  }

  /**
   * Start the MCP server.
   *
   * Transport is selected via environment variables:
   *   MCP_TRANSPORT=stdio  (default) – connect via stdin/stdout
   *   MCP_TRANSPORT=http   – listen for Streamable HTTP on MCP_PORT (default 3000)
   *
   * The Streamable HTTP transport implements the current MCP specification and
   * supports both SSE streaming responses and direct JSON responses in one endpoint.
   */
  async start(): Promise<void> {
    await this.registerCaches();
    await this.cache.init();

    const transportMode = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();

    if (transportMode === 'http') {
      await this.startHttpTransport();
    } else {
      await this.startStdioTransport();
    }
  }

  private async startStdioTransport(): Promise<void> {
    return startStdioTransportHelper(this);
  }

  private async startHttpTransport(): Promise<void> {
    return startHttpTransportHelper(this);
  }

  async close(): Promise<void> {
    return closeServerHelper(this);
  }
}
