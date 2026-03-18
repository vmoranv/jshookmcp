import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '@internal-types/index';
import { logger } from '@utils/logger';
import { CacheManager } from '@utils/cache';
import { TokenBudgetManager } from '@utils/TokenBudgetManager';
import { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { asErrorResponse } from '@server/domains/shared/response';
import type { ToolProfile } from '@server/ToolCatalog';
import { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import { ToolCallContextGuard } from '@server/ToolCallContextGuard';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { ToolArgs } from '@server/types';
import { resolveToolsForRegistration } from '@server/MCPServer.registration';
import { createDomainProxy, resolveEnabledDomains } from '@server/MCPServer.domain';
import { refreshDomainTtlForTool } from '@server/MCPServer.activation.ttl';
import type { DomainTtlEntry } from '@server/MCPServer.activation.ttl';
import { closeServer, startHttpTransport, startStdioTransport } from '@server/MCPServer.transport';
import { registerSingleTool as registerSingleToolImpl } from '@server/MCPServer.tools';
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
  ExtensionWorkflowRuntimeRecord,
} from '@server/extensions/types';
import {
  listExtensions as listExtensionsImpl,
  reloadExtensions as reloadExtensionsImpl,
} from '@server/extensions/ExtensionManager';
import { DomainInstanceRegistry } from '@server/DomainInstanceRegistry';

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
  public readonly activatedToolNames = new Set<string>();
  public readonly activatedRegisteredTools = new Map<string, RegisteredTool>();
  public readonly domainTtlEntries = new Map<string, DomainTtlEntry>();
  public readonly metaToolsByName = new Map<
    string,
    import('@server/MCPServer.context').MetaToolInfo
  >();
  public readonly extensionToolsByName = new Map<string, ExtensionToolRecord>();
  public readonly extensionPluginsById = new Map<string, ExtensionPluginRecord>();
  public readonly extensionPluginRuntimeById = new Map<string, ExtensionPluginRuntimeRecord>();
  public readonly extensionWorkflowsById = new Map<string, ExtensionWorkflowRecord>();
  public readonly extensionWorkflowRuntimeById = new Map<string, ExtensionWorkflowRuntimeRecord>();
  public lastExtensionReloadAt?: string;
  public httpServer?: Server;
  public readonly httpSockets = new Set<Socket>();

  // Domain instance registry (replaces 33 individual lazy properties)
  public readonly domainInstances: DomainInstanceRegistry;

  // Lazy-initialized domain instances - delegated to domainInstances registry
  // These getters/setters maintain backward compatibility with existing ensure() functions
  public get collector() {
    return this.domainInstances.collector;
  }
  public set collector(v) {
    this.domainInstances.collector = v;
  }
  public get pageController() {
    return this.domainInstances.pageController;
  }
  public set pageController(v) {
    this.domainInstances.pageController = v;
  }
  public get domInspector() {
    return this.domainInstances.domInspector;
  }
  public set domInspector(v) {
    this.domainInstances.domInspector = v;
  }
  public get scriptManager() {
    return this.domainInstances.scriptManager;
  }
  public set scriptManager(v) {
    this.domainInstances.scriptManager = v;
  }
  public get debuggerManager() {
    return this.domainInstances.debuggerManager;
  }
  public set debuggerManager(v) {
    this.domainInstances.debuggerManager = v;
  }
  public get runtimeInspector() {
    return this.domainInstances.runtimeInspector;
  }
  public set runtimeInspector(v) {
    this.domainInstances.runtimeInspector = v;
  }
  public get consoleMonitor() {
    return this.domainInstances.consoleMonitor;
  }
  public set consoleMonitor(v) {
    this.domainInstances.consoleMonitor = v;
  }
  public get llm() {
    return this.domainInstances.llm;
  }
  public set llm(v) {
    this.domainInstances.llm = v;
  }
  public get browserHandlers() {
    return this.domainInstances.browserHandlers;
  }
  public set browserHandlers(v) {
    this.domainInstances.browserHandlers = v;
  }
  public get debuggerHandlers() {
    return this.domainInstances.debuggerHandlers;
  }
  public set debuggerHandlers(v) {
    this.domainInstances.debuggerHandlers = v;
  }
  public get advancedHandlers() {
    return this.domainInstances.advancedHandlers;
  }
  public set advancedHandlers(v) {
    this.domainInstances.advancedHandlers = v;
  }
  public get aiHookHandlers() {
    return this.domainInstances.aiHookHandlers;
  }
  public set aiHookHandlers(v) {
    this.domainInstances.aiHookHandlers = v;
  }
  public get hookPresetHandlers() {
    return this.domainInstances.hookPresetHandlers;
  }
  public set hookPresetHandlers(v) {
    this.domainInstances.hookPresetHandlers = v;
  }
  public get deobfuscator() {
    return this.domainInstances.deobfuscator;
  }
  public set deobfuscator(v) {
    this.domainInstances.deobfuscator = v;
  }
  public get advancedDeobfuscator() {
    return this.domainInstances.advancedDeobfuscator;
  }
  public set advancedDeobfuscator(v) {
    this.domainInstances.advancedDeobfuscator = v;
  }
  public get astOptimizer() {
    return this.domainInstances.astOptimizer;
  }
  public set astOptimizer(v) {
    this.domainInstances.astOptimizer = v;
  }
  public get obfuscationDetector() {
    return this.domainInstances.obfuscationDetector;
  }
  public set obfuscationDetector(v) {
    this.domainInstances.obfuscationDetector = v;
  }
  public get analyzer() {
    return this.domainInstances.analyzer;
  }
  public set analyzer(v) {
    this.domainInstances.analyzer = v;
  }
  public get cryptoDetector() {
    return this.domainInstances.cryptoDetector;
  }
  public set cryptoDetector(v) {
    this.domainInstances.cryptoDetector = v;
  }
  public get hookManager() {
    return this.domainInstances.hookManager;
  }
  public set hookManager(v) {
    this.domainInstances.hookManager = v;
  }
  public get coreAnalysisHandlers() {
    return this.domainInstances.coreAnalysisHandlers;
  }
  public set coreAnalysisHandlers(v) {
    this.domainInstances.coreAnalysisHandlers = v;
  }
  public get coreMaintenanceHandlers() {
    return this.domainInstances.coreMaintenanceHandlers;
  }
  public set coreMaintenanceHandlers(v) {
    this.domainInstances.coreMaintenanceHandlers = v;
  }
  public get extensionManagementHandlers() {
    return this.domainInstances.extensionManagementHandlers;
  }
  public set extensionManagementHandlers(v) {
    this.domainInstances.extensionManagementHandlers = v;
  }
  public get processHandlers() {
    return this.domainInstances.processHandlers;
  }
  public set processHandlers(v) {
    this.domainInstances.processHandlers = v;
  }
  public get workflowHandlers() {
    return this.domainInstances.workflowHandlers;
  }
  public set workflowHandlers(v) {
    this.domainInstances.workflowHandlers = v;
  }
  public get wasmHandlers() {
    return this.domainInstances.wasmHandlers;
  }
  public set wasmHandlers(v) {
    this.domainInstances.wasmHandlers = v;
  }
  public get streamingHandlers() {
    return this.domainInstances.streamingHandlers;
  }
  public set streamingHandlers(v) {
    this.domainInstances.streamingHandlers = v;
  }
  public get encodingHandlers() {
    return this.domainInstances.encodingHandlers;
  }
  public set encodingHandlers(v) {
    this.domainInstances.encodingHandlers = v;
  }
  public get antidebugHandlers() {
    return this.domainInstances.antidebugHandlers;
  }
  public set antidebugHandlers(v) {
    this.domainInstances.antidebugHandlers = v;
  }
  public get graphqlHandlers() {
    return this.domainInstances.graphqlHandlers;
  }
  public set graphqlHandlers(v) {
    this.domainInstances.graphqlHandlers = v;
  }
  public get platformHandlers() {
    return this.domainInstances.platformHandlers;
  }
  public set platformHandlers(v) {
    this.domainInstances.platformHandlers = v;
  }
  public get sourcemapHandlers() {
    return this.domainInstances.sourcemapHandlers;
  }
  public set sourcemapHandlers(v) {
    this.domainInstances.sourcemapHandlers = v;
  }
  public get transformHandlers() {
    return this.domainInstances.transformHandlers;
  }
  public set transformHandlers(v) {
    this.domainInstances.transformHandlers = v;
  }

  constructor(config: Config) {
    this.config = config;
    this.cache = new CacheManager(config.cache);
    this.tokenBudget = new TokenBudgetManager();
    this.unifiedCache = new UnifiedCacheManager();
    this.detailedData = new DetailedDataManager();
    this.domainInstances = new DomainInstanceRegistry();
    this.tokenBudget.setExternalCleanup(() => this.detailedData.clear());
    const { tools, profile } = resolveToolsForRegistration();
    this.selectedTools = tools;
    this.baseTier = profile;
    this.enabledDomains = this.resolveEnabledDomains(this.selectedTools);

    // Build handlerDeps dynamically from discovered manifests
    // Each manifest's depKey gets a lazy proxy that calls ensure(ctx) on first access
    const depsEntries: Array<[string, unknown]> = [];
    for (const m of ALL_MANIFESTS) {
      depsEntries.push([
        m.depKey,
        createDomainProxy(
          this,
          m.domain,
          `${m.domain}:${m.depKey}`,
          () => m.ensure(this) as object
        ),
      ]);
    }
    // Special case: hooks domain has a secondary depKey for hookPresetHandlers
    // The hooks ensure() also initializes hookPresetHandlers on ctx
    const hooksManifest = ALL_MANIFESTS.find((m) => m.domain === 'hooks');
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
    // Special case: maintenance domain has a secondary depKey for extensionManagementHandlers
    // The maintenance ensure() also initializes extensionManagementHandlers on ctx
    const maintenanceManifest = ALL_MANIFESTS.find((m) => m.domain === 'maintenance');
    if (maintenanceManifest && !depsEntries.some(([k]) => k === 'extensionManagementHandlers')) {
      depsEntries.push([
        'extensionManagementHandlers',
        createDomainProxy(this, 'maintenance', 'maintenance:extensionManagementHandlers', () => {
          maintenanceManifest.ensure(this);
          return this.extensionManagementHandlers!;
        }),
      ]);
    }
    this.handlerDeps = Object.fromEntries(depsEntries) as ToolHandlerDeps;

    const selectedToolNames = new Set(this.selectedTools.map((t) => t.name));
    this.router = new ToolExecutionRouter(
      createToolHandlerMap(this.handlerDeps, selectedToolNames)
    );

    // Context guard: lazily resolves TabRegistry from browser handlers (loaded on demand)
    this.contextGuard = new ToolCallContextGuard(() => {
      const bh = this.handlerDeps.browserHandlers as { getTabRegistry?: () => unknown } | undefined;
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
      // Refresh domain TTL when an activated tool is used
      if (this.activatedToolNames.has(name)) {
        refreshDomainTtlForTool(this, name);
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
    registerSearchMetaTools(this);
    logger.info(`Registered ${this.selectedTools.length} tools + meta tools with McpServer`);
  }
}
