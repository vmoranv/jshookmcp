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
import { getToolDomain } from '@server/ToolCatalog';
import { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import { ToolCallContextGuard } from '@server/ToolCallContextGuard';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { ToolArgs } from '@server/types';
import { resolveToolsForRegistration } from '@server/MCPServer.registration';
import { createDomainProxy, resolveEnabledDomains } from '@server/MCPServer.domain';
import { refreshDomainTtlForTool } from '@server/MCPServer.activation.ttl';
import type { DomainTtlEntry } from '@server/MCPServer.activation.ttl';
import { closeServer, startHttpTransport, startStdioTransport } from '@server/MCPServer.transport';
import { ActivationController } from '@server/activation/ActivationController';
import { registerSingleTool as registerSingleToolImpl } from '@server/MCPServer.tools';
import { registerSearchMetaTools } from '@server/MCPServer.search';
import { registerServerResources } from '@server/MCPServer.resources';
import type { MCPServerContext } from '@server/MCPServer.context';
import { createServerEventBus, type EventBus, type ServerEventMap } from '@server/EventBus';
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
  public readonly eventBus: EventBus<ServerEventMap>;
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

  // Backward-compatible property accessors are generated at class definition
  // time via Object.defineProperty — see DOMAIN_INSTANCE_KEYS below the class.
  // Consumers can still use ctx.collector, ctx.browserHandlers, etc.
  // When adding a new domain, just append the key to DOMAIN_INSTANCE_KEYS below.
  //
  // TypeScript `declare` ensures the compiler knows these properties exist
  // without emitting any runtime code (the actual get/set is from defineProperty).
  declare collector: import('@modules/collector/CodeCollector').CodeCollector | undefined;
  declare pageController: import('@modules/collector/PageController').PageController | undefined;
  declare domInspector: import('@modules/collector/DOMInspector').DOMInspector | undefined;
  declare scriptManager: import('@modules/debugger/ScriptManager').ScriptManager | undefined;
  declare debuggerManager: import('@modules/debugger/DebuggerManager').DebuggerManager | undefined;
  declare runtimeInspector:
    | import('@modules/debugger/RuntimeInspector').RuntimeInspector
    | undefined;
  declare consoleMonitor: import('@modules/monitor/ConsoleMonitor').ConsoleMonitor | undefined;
  declare llm: import('@services/LLMService').LLMService | undefined;
  declare browserHandlers: import('@server/domains/browser/index').BrowserToolHandlers | undefined;
  declare debuggerHandlers:
    | import('@server/domains/debugger/index').DebuggerToolHandlers
    | undefined;
  declare advancedHandlers:
    | import('@server/domains/network/index').AdvancedToolHandlers
    | undefined;
  declare aiHookHandlers: import('@server/domains/hooks/index').AIHookToolHandlers | undefined;
  declare hookPresetHandlers:
    | import('@server/domains/hooks/index').HookPresetToolHandlers
    | undefined;
  declare deobfuscator: import('@modules/deobfuscator/Deobfuscator').Deobfuscator | undefined;
  declare advancedDeobfuscator:
    | import('@modules/deobfuscator/AdvancedDeobfuscator').AdvancedDeobfuscator
    | undefined;
  declare astOptimizer: import('@modules/deobfuscator/ASTOptimizer').ASTOptimizer | undefined;
  declare obfuscationDetector:
    | import('@modules/detector/ObfuscationDetector').ObfuscationDetector
    | undefined;
  declare analyzer: import('@modules/analyzer/CodeAnalyzer').CodeAnalyzer | undefined;
  declare cryptoDetector: import('@modules/crypto/CryptoDetector').CryptoDetector | undefined;
  declare hookManager: import('@modules/hook/HookManager').HookManager | undefined;
  declare coreAnalysisHandlers:
    | import('@server/domains/analysis/index').CoreAnalysisHandlers
    | undefined;
  declare coreMaintenanceHandlers:
    | import('@server/domains/maintenance/index').CoreMaintenanceHandlers
    | undefined;
  declare extensionManagementHandlers:
    | import('@server/domains/maintenance/index').ExtensionManagementHandlers
    | undefined;
  declare processHandlers: import('@server/domains/process/index').ProcessToolHandlers | undefined;
  declare workflowHandlers: import('@server/domains/workflow/index').WorkflowHandlers | undefined;
  declare wasmHandlers: import('@server/domains/wasm/index').WasmToolHandlers | undefined;
  declare streamingHandlers:
    | import('@server/domains/streaming/index').StreamingToolHandlers
    | undefined;
  declare encodingHandlers:
    | import('@server/domains/encoding/index').EncodingToolHandlers
    | undefined;
  declare antidebugHandlers:
    | import('@server/domains/antidebug/index').AntiDebugToolHandlers
    | undefined;
  declare graphqlHandlers: import('@server/domains/graphql/index').GraphQLToolHandlers | undefined;
  declare platformHandlers:
    | import('@server/domains/platform/index').PlatformToolHandlers
    | undefined;
  declare sourcemapHandlers:
    | import('@server/domains/sourcemap/index').SourcemapToolHandlers
    | undefined;
  declare transformHandlers:
    | import('@server/domains/transform/index').TransformToolHandlers
    | undefined;
  declare coordinationHandlers:
    | import('@server/domains/coordination/index').CoordinationHandlers
    | undefined;
  declare evidenceHandlers: import('@server/domains/evidence/index').EvidenceHandlers | undefined;
  declare instrumentationHandlers:
    | import('@server/domains/instrumentation/index').InstrumentationHandlers
    | undefined;

  constructor(config: Config) {
    this.config = config;
    this.cache = new CacheManager(config.cache);
    this.tokenBudget = new TokenBudgetManager();
    this.unifiedCache = new UnifiedCacheManager();
    this.detailedData = new DetailedDataManager();
    this.eventBus = createServerEventBus();
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
          () => m.ensure(this) as object,
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
      createToolHandlerMap(this.handlerDeps, selectedToolNames),
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
      { capabilities: { tools: { listChanged: true }, logging: {} } },
    );
    this.setDomainInstance('activationController', new ActivationController(this.eventBus, this));

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
      // Track consecutive tool calls for repeat loop detection
      this.contextGuard.recordCall(name);
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
      // Emit tool:called event for ActivationController
      void this.eventBus.emit('tool:called', {
        toolName: name,
        domain: getToolDomain(name) ?? null,
        timestamp: new Date().toISOString(),
        success: true,
      });
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
    registerServerResources(this);
    logger.info(`Registered ${this.selectedTools.length} tools + meta tools with McpServer`);
  }
}

// ── Generated backward-compatible property accessors ──
// To add a new domain, just append its key to this array.
// Types come from the DomainInstances interface in MCPServer.context.ts.

const DOMAIN_INSTANCE_KEYS: ReadonlyArray<
  keyof import('@server/MCPServer.context').DomainInstances
> = [
  'collector',
  'pageController',
  'domInspector',
  'scriptManager',
  'debuggerManager',
  'runtimeInspector',
  'consoleMonitor',
  'llm',
  'browserHandlers',
  'debuggerHandlers',
  'advancedHandlers',
  'aiHookHandlers',
  'hookPresetHandlers',
  'deobfuscator',
  'advancedDeobfuscator',
  'astOptimizer',
  'obfuscationDetector',
  'analyzer',
  'cryptoDetector',
  'hookManager',
  'coreAnalysisHandlers',
  'coreMaintenanceHandlers',
  'extensionManagementHandlers',
  'processHandlers',
  'workflowHandlers',
  'wasmHandlers',
  'streamingHandlers',
  'encodingHandlers',
  'antidebugHandlers',
  'graphqlHandlers',
  'platformHandlers',
  'sourcemapHandlers',
  'transformHandlers',
  'coordinationHandlers',
  'evidenceHandlers',
  'instrumentationHandlers',
];

for (const key of DOMAIN_INSTANCE_KEYS) {
  // Skip keys that are part of the DomainInstances map API itself
  if (key === 'domainInstanceMap' || key === 'getDomainInstance' || key === 'setDomainInstance')
    continue;

  Object.defineProperty(MCPServer.prototype, key, {
    get(this: MCPServer) {
      return this.domainInstanceMap.get(key);
    },
    set(this: MCPServer, v: unknown) {
      if (v === undefined) this.domainInstanceMap.delete(key);
      else this.domainInstanceMap.set(key, v);
    },
    enumerable: true,
    configurable: true,
  });
}
