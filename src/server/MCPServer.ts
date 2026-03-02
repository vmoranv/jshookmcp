import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { CacheManager } from '../utils/cache.js';
import type { CodeCollector } from '../modules/collector/CodeCollector.js';
import type { PageController } from '../modules/collector/PageController.js';
import type { DOMInspector } from '../modules/collector/DOMInspector.js';
import type { ScriptManager } from '../modules/debugger/ScriptManager.js';
import type { DebuggerManager } from '../modules/debugger/DebuggerManager.js';
import type { RuntimeInspector } from '../modules/debugger/RuntimeInspector.js';
import type { ConsoleMonitor } from '../modules/monitor/ConsoleMonitor.js';
import type { BrowserToolHandlers } from './domains/browser/index.js';
import type { DebuggerToolHandlers } from './domains/debugger/index.js';
import type { AdvancedToolHandlers } from './domains/network/index.js';
import type { AIHookToolHandlers, HookPresetToolHandlers } from './domains/hooks/index.js';
import type { Deobfuscator } from '../modules/deobfuscator/Deobfuscator.js';
import type { AdvancedDeobfuscator } from '../modules/deobfuscator/AdvancedDeobfuscator.js';
import type { ASTOptimizer } from '../modules/deobfuscator/ASTOptimizer.js';
import type { ObfuscationDetector } from '../modules/detector/ObfuscationDetector.js';
import type { LLMService } from '../services/LLMService.js';
import type { CodeAnalyzer } from '../modules/analyzer/CodeAnalyzer.js';
import type { CryptoDetector } from '../modules/crypto/CryptoDetector.js';
import type { HookManager } from '../modules/hook/HookManager.js';
import { TokenBudgetManager } from '../utils/TokenBudgetManager.js';
import { UnifiedCacheManager } from '../utils/UnifiedCacheManager.js';
import { DetailedDataManager } from '../utils/DetailedDataManager.js';
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
import { type ToolDomain, type ToolProfile } from './ToolCatalog.js';
import { ToolExecutionRouter } from './ToolExecutionRouter.js';
import { createToolHandlerMap, type ToolHandlerMapDependencies } from './ToolHandlerMap.js';
import type { ToolArgs } from './types.js';
import { resolveToolsForRegistration } from './MCPServer.registration.js';
import {
  createDomainProxy,
  ensureAdvancedHandlers,
  ensureAIHookHandlers,
  ensureAntiDebugHandlers,
  ensureBrowserHandlers,
  ensureCoreAnalysisHandlers,
  ensureCoreMaintenanceHandlers,
  ensureDebuggerHandlers,
  ensureEncodingHandlers,
  ensureGraphQLHandlers,
  ensureHookPresetHandlers,
  ensurePlatformHandlers,
  ensureProcessHandlers,
  ensureSourcemapHandlers,
  ensureStreamingHandlers,
  ensureTransformHandlers,
  ensureWasmHandlers,
  ensureWorkflowHandlers,
  resolveEnabledDomains,
} from './MCPServer.domain.js';
import {
  boostProfile as boostProfileImpl,
  switchToTier as switchToTierImpl,
  unboostProfile as unboostProfileImpl,
} from './MCPServer.boost.js';
import {
  closeServer,
  startHttpTransport,
  startStdioTransport,
} from './MCPServer.transport.js';
import {
  registerMetaTools,
  registerSingleTool as registerSingleToolImpl,
} from './MCPServer.tools.js';
import { registerSearchMetaTools } from './MCPServer.search.js';
import type { MCPServerContext } from './MCPServer.context.js';

export class MCPServer implements MCPServerContext {
  public readonly config: Config;
  public readonly server: McpServer;
  private readonly cache: CacheManager;
  public readonly tokenBudget: TokenBudgetManager;
  public readonly unifiedCache: UnifiedCacheManager;
  public readonly detailedData: DetailedDataManager;
  public readonly selectedTools: Tool[];
  public enabledDomains: Set<ToolDomain>;
  public readonly router: ToolExecutionRouter;
  public readonly handlerDeps: ToolHandlerMapDependencies;
  private degradedMode = false;
  private cacheAdaptersRegistered = false;
  private cacheRegistrationPromise?: Promise<void>;
  public readonly baseTier: ToolProfile;
  public currentTier: ToolProfile;
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
    this.tokenBudget = new TokenBudgetManager();
    this.unifiedCache = new UnifiedCacheManager();
    this.detailedData = new DetailedDataManager();
    // Wire the cross-cutting cleanup: TokenBudgetManager clears DetailedDataManager on 90% usage
    this.tokenBudget.setExternalCleanup(() => this.detailedData.clear());
    const { tools, profile } = resolveToolsForRegistration();
    this.selectedTools = tools;
    this.baseTier = profile;
    this.currentTier = profile;
    this.enabledDomains = this.resolveEnabledDomains(this.selectedTools);

    const selectedToolNames = new Set(this.selectedTools.map(t => t.name));
    this.handlerDeps = {
      browserHandlers: createDomainProxy(this, 'browser', 'BrowserToolHandlers', () => ensureBrowserHandlers(this)),
      debuggerHandlers: createDomainProxy(this, 'debugger', 'DebuggerToolHandlers', () => ensureDebuggerHandlers(this)),
      advancedHandlers: createDomainProxy(this, 'network', 'AdvancedToolHandlers', () => ensureAdvancedHandlers(this)),
      aiHookHandlers: createDomainProxy(this, 'hooks', 'AIHookToolHandlers', () => ensureAIHookHandlers(this)),
      hookPresetHandlers: createDomainProxy(this, 'hooks', 'HookPresetToolHandlers', () => ensureHookPresetHandlers(this)),
      coreAnalysisHandlers: createDomainProxy(this, 'core', 'CoreAnalysisHandlers', () => ensureCoreAnalysisHandlers(this)),
      coreMaintenanceHandlers: createDomainProxy(this, 'maintenance', 'CoreMaintenanceHandlers', () => ensureCoreMaintenanceHandlers(this)),
      processHandlers: createDomainProxy(this, 'process', 'ProcessToolHandlers', () => ensureProcessHandlers(this)),
      workflowHandlers: createDomainProxy(this, 'workflow', 'WorkflowHandlers', () => ensureWorkflowHandlers(this)),
      wasmHandlers: createDomainProxy(this, 'wasm', 'WasmToolHandlers', () => ensureWasmHandlers(this)),
      streamingHandlers: createDomainProxy(this, 'streaming', 'StreamingToolHandlers', () => ensureStreamingHandlers(this)),
      encodingHandlers: createDomainProxy(this, 'encoding', 'EncodingToolHandlers', () => ensureEncodingHandlers(this)),
      antidebugHandlers: createDomainProxy(this, 'antidebug', 'AntiDebugToolHandlers', () => ensureAntiDebugHandlers(this)),
      graphqlHandlers: createDomainProxy(this, 'graphql', 'GraphQLToolHandlers', () => ensureGraphQLHandlers(this)),
      platformHandlers: createDomainProxy(this, 'platform', 'PlatformToolHandlers', () => ensurePlatformHandlers(this)),
      sourcemapHandlers: createDomainProxy(this, 'sourcemap', 'SourcemapToolHandlers', () => ensureSourcemapHandlers(this)),
      transformHandlers: createDomainProxy(this, 'transform', 'TransformToolHandlers', () => ensureTransformHandlers(this)),
    };
    this.router = new ToolExecutionRouter(
      createToolHandlerMap(this.handlerDeps, selectedToolNames)
    );
    this.server = new McpServer(
      { name: config.mcp.name, version: config.mcp.version },
      { capabilities: { tools: { listChanged: true }, logging: {} } }
    );

    this.registerTools();
  }

  /* ---------- MCPServerContext method implementations ---------- */

  public resolveEnabledDomains(tools: Tool[]): Set<ToolDomain> {
    return resolveEnabledDomains(tools);
  }

  public registerSingleTool(toolDef: Tool): RegisteredTool {
    return registerSingleToolImpl(this, toolDef);
  }

  public async boostProfile(target?: string, ttlMinutes?: number): Promise<Record<string, unknown>> {
    return boostProfileImpl(this, target, ttlMinutes);
  }

  public async unboostProfile(target?: string): Promise<Record<string, unknown>> {
    return unboostProfileImpl(this, target);
  }

  public async switchToTier(targetTier: ToolProfile): Promise<void> {
    return switchToTierImpl(this, targetTier);
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
        const { createCacheAdapters } = await import('../utils/CacheAdapters.js');
        const codeCache = this.collector!.getCache();
        const codeCompressor = this.collector!.getCompressor();

        const adapters = createCacheAdapters(this.detailedData, codeCache, codeCompressor);
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

  /* ---------- Lifecycle ---------- */

  enterDegradedMode(reason: string): void {
    if (this.degradedMode) {
      return;
    }

    this.degradedMode = true;
    logger.warn(`Entering degraded mode: ${reason}`);
    this.tokenBudget.setTrackingEnabled(false);
    logger.setLevel('warn');
  }

  async start(): Promise<void> {
    await this.registerCaches();
    await this.cache.init();

    const transportMode = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();

    if (transportMode === 'http') {
      await startHttpTransport(this);
    } else {
      await startStdioTransport(this);
    }
  }

  async close(): Promise<void> {
    return closeServer(this);
  }

  /* ---------- Internal ---------- */

  private registerTools(): void {
    for (const toolDef of this.selectedTools) {
      this.registerSingleTool(toolDef);
    }
    registerMetaTools(this);
    registerSearchMetaTools(this);
    logger.info(`Registered ${this.selectedTools.length} tools + meta tools with McpServer`);
  }
}
