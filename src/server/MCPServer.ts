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
import { getAllManifests } from '@server/registry/index';
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
  public clientSupportsListChanged = true;
  public readonly extensionToolsByName = new Map<string, ExtensionToolRecord>();
  public readonly extensionPluginsById = new Map<string, ExtensionPluginRecord>();
  public readonly extensionPluginRuntimeById = new Map<string, ExtensionPluginRuntimeRecord>();
  public readonly extensionWorkflowsById = new Map<string, ExtensionWorkflowRecord>();
  public readonly extensionWorkflowRuntimeById = new Map<string, ExtensionWorkflowRuntimeRecord>();
  public lastExtensionReloadAt?: string;
  public httpServer?: Server;
  public readonly httpSockets = new Set<Socket>();

  // ── Centralized domain instance store (replaces 33 typed properties) ──

  public readonly domainInstanceMap = new Map<string, unknown>();

  public getDomainInstance<T>(key: string): T | undefined {
    return this.domainInstanceMap.get(key) as T | undefined;
  }

  public setDomainInstance(key: string, value: unknown): void {
    this.domainInstanceMap.set(key, value);
  }

  // Backward-compatible property accessors — domain manifests and consumers
  // can still use ctx.collector, ctx.browserHandlers, etc.
  // These delegate to the centralised domainInstanceMap.
  //
  // NOTE: When adding a new domain, you do NOT need to add a getter here.
  // Just use ctx.setDomainInstance('myHandlers', handler) in your manifest
  // and ctx.getDomainInstance<MyType>('myHandlers') in consumers.
  // These getters exist only for backward compatibility with existing code.

  get collector() { return this.domainInstanceMap.get('collector') as import('@modules/collector/CodeCollector').CodeCollector | undefined; }
  set collector(v) { if (v === undefined) this.domainInstanceMap.delete('collector'); else this.domainInstanceMap.set('collector', v); }

  get pageController() { return this.domainInstanceMap.get('pageController') as import('@modules/collector/PageController').PageController | undefined; }
  set pageController(v) { if (v === undefined) this.domainInstanceMap.delete('pageController'); else this.domainInstanceMap.set('pageController', v); }

  get domInspector() { return this.domainInstanceMap.get('domInspector') as import('@modules/collector/DOMInspector').DOMInspector | undefined; }
  set domInspector(v) { if (v === undefined) this.domainInstanceMap.delete('domInspector'); else this.domainInstanceMap.set('domInspector', v); }

  get scriptManager() { return this.domainInstanceMap.get('scriptManager') as import('@modules/debugger/ScriptManager').ScriptManager | undefined; }
  set scriptManager(v) { if (v === undefined) this.domainInstanceMap.delete('scriptManager'); else this.domainInstanceMap.set('scriptManager', v); }

  get debuggerManager() { return this.domainInstanceMap.get('debuggerManager') as import('@modules/debugger/DebuggerManager').DebuggerManager | undefined; }
  set debuggerManager(v) { if (v === undefined) this.domainInstanceMap.delete('debuggerManager'); else this.domainInstanceMap.set('debuggerManager', v); }

  get runtimeInspector() { return this.domainInstanceMap.get('runtimeInspector') as import('@modules/debugger/RuntimeInspector').RuntimeInspector | undefined; }
  set runtimeInspector(v) { if (v === undefined) this.domainInstanceMap.delete('runtimeInspector'); else this.domainInstanceMap.set('runtimeInspector', v); }

  get consoleMonitor() { return this.domainInstanceMap.get('consoleMonitor') as import('@modules/monitor/ConsoleMonitor').ConsoleMonitor | undefined; }
  set consoleMonitor(v) { if (v === undefined) this.domainInstanceMap.delete('consoleMonitor'); else this.domainInstanceMap.set('consoleMonitor', v); }

  get llm() { return this.domainInstanceMap.get('llm') as import('@services/LLMService').LLMService | undefined; }
  set llm(v) { if (v === undefined) this.domainInstanceMap.delete('llm'); else this.domainInstanceMap.set('llm', v); }

  get browserHandlers() { return this.domainInstanceMap.get('browserHandlers') as import('@server/domains/browser/index').BrowserToolHandlers | undefined; }
  set browserHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('browserHandlers'); else this.domainInstanceMap.set('browserHandlers', v); }

  get debuggerHandlers() { return this.domainInstanceMap.get('debuggerHandlers') as import('@server/domains/debugger/index').DebuggerToolHandlers | undefined; }
  set debuggerHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('debuggerHandlers'); else this.domainInstanceMap.set('debuggerHandlers', v); }

  get advancedHandlers() { return this.domainInstanceMap.get('advancedHandlers') as import('@server/domains/network/index').AdvancedToolHandlers | undefined; }
  set advancedHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('advancedHandlers'); else this.domainInstanceMap.set('advancedHandlers', v); }

  get aiHookHandlers() { return this.domainInstanceMap.get('aiHookHandlers') as import('@server/domains/hooks/index').AIHookToolHandlers | undefined; }
  set aiHookHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('aiHookHandlers'); else this.domainInstanceMap.set('aiHookHandlers', v); }

  get hookPresetHandlers() { return this.domainInstanceMap.get('hookPresetHandlers') as import('@server/domains/hooks/index').HookPresetToolHandlers | undefined; }
  set hookPresetHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('hookPresetHandlers'); else this.domainInstanceMap.set('hookPresetHandlers', v); }

  get deobfuscator() { return this.domainInstanceMap.get('deobfuscator') as import('@modules/deobfuscator/Deobfuscator').Deobfuscator | undefined; }
  set deobfuscator(v) { if (v === undefined) this.domainInstanceMap.delete('deobfuscator'); else this.domainInstanceMap.set('deobfuscator', v); }

  get advancedDeobfuscator() { return this.domainInstanceMap.get('advancedDeobfuscator') as import('@modules/deobfuscator/AdvancedDeobfuscator').AdvancedDeobfuscator | undefined; }
  set advancedDeobfuscator(v) { if (v === undefined) this.domainInstanceMap.delete('advancedDeobfuscator'); else this.domainInstanceMap.set('advancedDeobfuscator', v); }

  get astOptimizer() { return this.domainInstanceMap.get('astOptimizer') as import('@modules/deobfuscator/ASTOptimizer').ASTOptimizer | undefined; }
  set astOptimizer(v) { if (v === undefined) this.domainInstanceMap.delete('astOptimizer'); else this.domainInstanceMap.set('astOptimizer', v); }

  get obfuscationDetector() { return this.domainInstanceMap.get('obfuscationDetector') as import('@modules/detector/ObfuscationDetector').ObfuscationDetector | undefined; }
  set obfuscationDetector(v) { if (v === undefined) this.domainInstanceMap.delete('obfuscationDetector'); else this.domainInstanceMap.set('obfuscationDetector', v); }

  get analyzer() { return this.domainInstanceMap.get('analyzer') as import('@modules/analyzer/CodeAnalyzer').CodeAnalyzer | undefined; }
  set analyzer(v) { if (v === undefined) this.domainInstanceMap.delete('analyzer'); else this.domainInstanceMap.set('analyzer', v); }

  get cryptoDetector() { return this.domainInstanceMap.get('cryptoDetector') as import('@modules/crypto/CryptoDetector').CryptoDetector | undefined; }
  set cryptoDetector(v) { if (v === undefined) this.domainInstanceMap.delete('cryptoDetector'); else this.domainInstanceMap.set('cryptoDetector', v); }

  get hookManager() { return this.domainInstanceMap.get('hookManager') as import('@modules/hook/HookManager').HookManager | undefined; }
  set hookManager(v) { if (v === undefined) this.domainInstanceMap.delete('hookManager'); else this.domainInstanceMap.set('hookManager', v); }

  get coreAnalysisHandlers() { return this.domainInstanceMap.get('coreAnalysisHandlers') as import('@server/domains/analysis/index').CoreAnalysisHandlers | undefined; }
  set coreAnalysisHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('coreAnalysisHandlers'); else this.domainInstanceMap.set('coreAnalysisHandlers', v); }

  get coreMaintenanceHandlers() { return this.domainInstanceMap.get('coreMaintenanceHandlers') as import('@server/domains/maintenance/index').CoreMaintenanceHandlers | undefined; }
  set coreMaintenanceHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('coreMaintenanceHandlers'); else this.domainInstanceMap.set('coreMaintenanceHandlers', v); }

  get extensionManagementHandlers() { return this.domainInstanceMap.get('extensionManagementHandlers') as import('@server/domains/maintenance/index').ExtensionManagementHandlers | undefined; }
  set extensionManagementHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('extensionManagementHandlers'); else this.domainInstanceMap.set('extensionManagementHandlers', v); }

  get processHandlers() { return this.domainInstanceMap.get('processHandlers') as import('@server/domains/process/index').ProcessToolHandlers | undefined; }
  set processHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('processHandlers'); else this.domainInstanceMap.set('processHandlers', v); }

  get workflowHandlers() { return this.domainInstanceMap.get('workflowHandlers') as import('@server/domains/workflow/index').WorkflowHandlers | undefined; }
  set workflowHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('workflowHandlers'); else this.domainInstanceMap.set('workflowHandlers', v); }

  get wasmHandlers() { return this.domainInstanceMap.get('wasmHandlers') as import('@server/domains/wasm/index').WasmToolHandlers | undefined; }
  set wasmHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('wasmHandlers'); else this.domainInstanceMap.set('wasmHandlers', v); }

  get streamingHandlers() { return this.domainInstanceMap.get('streamingHandlers') as import('@server/domains/streaming/index').StreamingToolHandlers | undefined; }
  set streamingHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('streamingHandlers'); else this.domainInstanceMap.set('streamingHandlers', v); }

  get encodingHandlers() { return this.domainInstanceMap.get('encodingHandlers') as import('@server/domains/encoding/index').EncodingToolHandlers | undefined; }
  set encodingHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('encodingHandlers'); else this.domainInstanceMap.set('encodingHandlers', v); }

  get antidebugHandlers() { return this.domainInstanceMap.get('antidebugHandlers') as import('@server/domains/antidebug/index').AntiDebugToolHandlers | undefined; }
  set antidebugHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('antidebugHandlers'); else this.domainInstanceMap.set('antidebugHandlers', v); }

  get graphqlHandlers() { return this.domainInstanceMap.get('graphqlHandlers') as import('@server/domains/graphql/index').GraphQLToolHandlers | undefined; }
  set graphqlHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('graphqlHandlers'); else this.domainInstanceMap.set('graphqlHandlers', v); }

  get platformHandlers() { return this.domainInstanceMap.get('platformHandlers') as import('@server/domains/platform/index').PlatformToolHandlers | undefined; }
  set platformHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('platformHandlers'); else this.domainInstanceMap.set('platformHandlers', v); }

  get sourcemapHandlers() { return this.domainInstanceMap.get('sourcemapHandlers') as import('@server/domains/sourcemap/index').SourcemapToolHandlers | undefined; }
  set sourcemapHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('sourcemapHandlers'); else this.domainInstanceMap.set('sourcemapHandlers', v); }

  get transformHandlers() { return this.domainInstanceMap.get('transformHandlers') as import('@server/domains/transform/index').TransformToolHandlers | undefined; }
  set transformHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('transformHandlers'); else this.domainInstanceMap.set('transformHandlers', v); }

  get coordinationHandlers() { return this.domainInstanceMap.get('coordinationHandlers') as import('@server/domains/coordination/index').CoordinationHandlers | undefined; }
  set coordinationHandlers(v) { if (v === undefined) this.domainInstanceMap.delete('coordinationHandlers'); else this.domainInstanceMap.set('coordinationHandlers', v); }

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
    this.enabledDomains = this.resolveEnabledDomains(this.selectedTools);

    // Build handlerDeps dynamically from discovered manifests
    // Each manifest's depKey gets a lazy proxy that calls ensure(ctx) on first access
    const depsEntries: Array<[string, unknown]> = [];
    const manifests = getAllManifests();
    for (const m of manifests) {
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
    // Register secondary dep keys declared by manifests
    for (const m of manifests) {
      if (m.secondaryDepKeys) {
        for (const key of m.secondaryDepKeys) {
          if (!depsEntries.some(([k]) => k === key)) {
            depsEntries.push([
              key,
              createDomainProxy(this, m.domain, `${m.domain}:${key}`, () => {
                m.ensure(this);
                return (this as Record<string, unknown>)[key]!;
              }),
            ]);
          }
        }
      }
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

  // ── MCPServerContext method implementations ──

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

  // ── Lifecycle ──

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

  // ── Internal ──

  private registerTools(): void {
    for (const toolDef of this.selectedTools) {
      this.registerSingleTool(toolDef);
    }
    registerSearchMetaTools(this);
    logger.info(`Registered ${this.selectedTools.length} tools + meta tools with McpServer`);
  }
}
