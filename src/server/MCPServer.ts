import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '@internal-types/index';
import { logger } from '@utils/logger';
import { CacheManager } from '@utils/cache';
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
import { TokenBudgetManager } from '@utils/TokenBudgetManager';
import { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import type { CoreAnalysisHandlers } from '@server/domains/analysis/index';
import type { CoreMaintenanceHandlers } from '@server/domains/maintenance/index';
import type { ProcessToolHandlers } from '@server/domains/process/index';
import type { WorkflowHandlers } from '@server/domains/workflow/index';
import type { WasmToolHandlers } from '@server/domains/wasm/index';
import type { StreamingToolHandlers } from '@server/domains/streaming/index';
import type { EncodingToolHandlers } from '@server/domains/encoding/index';
import type { AntiDebugToolHandlers } from '@server/domains/antidebug/index';
import type { GraphQLToolHandlers } from '@server/domains/graphql/index';
import type { PlatformToolHandlers } from '@server/domains/platform/index';
import type { SourcemapToolHandlers } from '@server/domains/sourcemap/index';
import type { TransformToolHandlers } from '@server/domains/transform/index';
import { asErrorResponse } from '@server/domains/shared/response';
import type { ToolProfile } from '@server/ToolCatalog';
import { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import { ToolCallContextGuard } from '@server/ToolCallContextGuard';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { ToolArgs } from '@server/types';
import { resolveToolsForRegistration } from '@server/MCPServer.registration';
import { createDomainProxy, resolveEnabledDomains } from '@server/MCPServer.domain';
import {
  boostProfile as boostProfileImpl,
  refreshBoostTtl,
  switchToTier as switchToTierImpl,
  unboostProfile as unboostProfileImpl,
} from '@server/MCPServer.boost';
import {
  closeServer,
  startHttpTransport,
  startStdioTransport,
} from '@server/MCPServer.transport';
import {
  registerMetaTools,
  registerSingleTool as registerSingleToolImpl,
} from '@server/MCPServer.tools';
import { registerSearchMetaTools } from '@server/MCPServer.search';
import type { MCPServerContext } from '@server/MCPServer.context';
import { ALL_MANIFESTS } from '@server/registry/index';
import type { ToolHandlerDeps } from '@server/registry/contracts';
import type {
  ExtensionListResult,
  ExtensionPluginRecord,
  ExtensionPluginRuntimeRecord,
  ExtensionReloadResult,
  ExtensionToolRecord,
  ExtensionWorkflowRecord,
} from '@server/extensions/types';
import { listExtensions as listExtensionsImpl, reloadExtensions as reloadExtensionsImpl } from '@server/extensions/ExtensionManager';

export class MCPServer implements MCPServerContext {
  public readonly config: Config;
  public readonly server: McpServer;
  private readonly cache: CacheManager;
  public readonly tokenBudget: TokenBudgetManager;
  public readonly unifiedCache: UnifiedCacheManager;
  public readonly detailedData: DetailedDataManager;
  public readonly selectedTools: Tool[];
  public enabledDomains: Set<string>;
  public readonly router: ToolExecutionRouter;
  public readonly contextGuard: ToolCallContextGuard;
  public readonly handlerDeps: ToolHandlerDeps;
  private degradedMode = false;
  private cacheAdaptersRegistered = false;
  private cacheRegistrationPromise?: Promise<void>;
  public readonly baseTier: ToolProfile;
  public currentTier: ToolProfile;
  public readonly boostHistory: ToolProfile[] = [];
  public readonly boostedToolNames = new Set<string>();
  public readonly boostedRegisteredTools = new Map<string, RegisteredTool>();
  public boostTtlTimer: ReturnType<typeof setTimeout> | null = null;
  public boostTtlMinutes = 0;
  public boostLock: Promise<void> = Promise.resolve();
  public readonly activatedToolNames = new Set<string>();
  public readonly activatedRegisteredTools = new Map<string, RegisteredTool>();
  public readonly absorbedFromActivated = new Set<string>();
  public readonly boostedExtensionToolNames = new Set<string>();
  public readonly extensionToolsByName = new Map<string, ExtensionToolRecord>();
  public readonly extensionPluginsById = new Map<string, ExtensionPluginRecord>();
  public readonly extensionPluginRuntimeById = new Map<string, ExtensionPluginRuntimeRecord>();
  public readonly extensionWorkflowsById = new Map<string, ExtensionWorkflowRecord>();
  public lastExtensionReloadAt?: string;
  public httpServer?: Server;
  public readonly httpSockets = new Set<Socket>();

  // Lazy-initialized domain instances (used by ensure functions in manifests)
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
    this.tokenBudget.setExternalCleanup(() => this.detailedData.clear());
    const { tools, profile } = resolveToolsForRegistration();
    this.selectedTools = tools;
    this.baseTier = profile;
    this.currentTier = profile;
    this.enabledDomains = this.resolveEnabledDomains(this.selectedTools);

    // Build handlerDeps dynamically from discovered manifests
    // Each manifest's depKey gets a lazy proxy that calls ensure(ctx) on first access
    const depsEntries: Array<[string, unknown]> = [];
    for (const m of ALL_MANIFESTS) {
      depsEntries.push([
        m.depKey,
        createDomainProxy(this, m.domain, `${m.domain}:${m.depKey}`, () => m.ensure(this) as object),
      ]);
    }
    // Special case: hooks domain has a secondary depKey for hookPresetHandlers
    // The hooks ensure() also initializes hookPresetHandlers on ctx
    const hooksManifest = ALL_MANIFESTS.find(m => m.domain === 'hooks');
    if (hooksManifest && !depsEntries.some(([k]) => k === 'hookPresetHandlers')) {
      depsEntries.push([
        'hookPresetHandlers',
        createDomainProxy(this, 'hooks', 'hooks:hookPresetHandlers', () => {
          // Trigger hooks ensure which inits both handlers
          hooksManifest.ensure(this);
          return this.hookPresetHandlers!;
        }),
      ]);
    }
    this.handlerDeps = Object.fromEntries(depsEntries) as ToolHandlerDeps;

    const selectedToolNames = new Set(this.selectedTools.map(t => t.name));
    this.router = new ToolExecutionRouter(
      createToolHandlerMap(this.handlerDeps, selectedToolNames)
    );

    // Context guard: lazily resolves TabRegistry from browser handlers (loaded on demand)
    this.contextGuard = new ToolCallContextGuard(() => {
      const bh = this.handlerDeps.browserHandlers as
        | { getTabRegistry?: () => unknown }
        | undefined;
      if (bh && typeof bh.getTabRegistry === 'function') {
        return bh.getTabRegistry() as {
          getContextMeta(): {
            url: string | null;
            title: string | null;
            tabIndex: number | null;
            pageId: string | null;
          };
        };
      }
      return null;
    });
    this.server = new McpServer(
      { name: config.mcp.name, version: config.mcp.version },
      { capabilities: { tools: { listChanged: true }, logging: {} } }
    );

    this.registerTools();
  }

  /* ---------- MCPServerContext method implementations ---------- */

  public resolveEnabledDomains(tools: Tool[]): Set<string> {
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

  public async reloadExtensions(): Promise<ExtensionReloadResult> {
    return reloadExtensionsImpl(this);
  }

  public listExtensions(): ExtensionListResult {
    return listExtensionsImpl(this);
  }

  public async registerCaches(): Promise<void> {
    if (this.cacheAdaptersRegistered) return;
    if (!this.collector) return;
    if (this.cacheRegistrationPromise) {
      await this.cacheRegistrationPromise;
      return;
    }

    this.cacheRegistrationPromise = (async () => {
      try {
        const { createCacheAdapters } = await import('@utils/CacheAdapters');
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
      // Enrich context-sensitive tool responses with current tab metadata
      const enriched = this.contextGuard.enrichResponse(name, response);
      try {
        this.tokenBudget.recordToolCall(name, args, enriched);
      } catch (trackingError) {
        logger.warn('Token tracking failed, continuing without tracking this call:', trackingError);
      }
      if (this.boostedToolNames.has(name)) {
        refreshBoostTtl(this);
      }
      return enriched;
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
    if (this.degradedMode) return;
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
