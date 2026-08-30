import { McpServer } from '@modelcontextprotocol/server';
import type { RegisteredTool, Tool } from '@modelcontextprotocol/server';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';
import type { Config } from '@internal-types/index';
import { logger } from '@utils/logger';
import { CacheManager } from '@utils/cache';
import { TokenBudgetManager } from '@utils/TokenBudgetManager';
import { UnifiedCacheManager } from '@utils/UnifiedCacheManager';
import { DetailedDataManager } from '@utils/DetailedDataManager';
import { LLMSamplingBridge } from '@server/LLMSamplingBridge';
import { ElicitationBridge } from '@server/ElicitationBridge';
import type { ToolProfile } from '@server/ToolCatalog';
import { ToolExecutionRouter } from '@server/ToolExecutionRouter';
import { ToolCallContextGuard } from '@server/ToolCallContextGuard';
import { ToolCircuitBreaker } from '@server/security/ToolCircuitBreaker';
import { TaskManager } from '@server/tasks/TaskManager';
import { TaskStoreAdapter } from '@server/tasks/TaskStoreAdapter';
import { LargeDataOffloader } from '@server/ToolResponseOffloader';
import { createToolHandlerMap } from '@server/ToolHandlerMap';
import type { ToolArgs } from '@server/types';
import { resolveToolsForRegistration } from '@server/MCPServer.registration';
import { createDomainProxy, resolveEnabledDomains } from '@server/MCPServer.domain';
import { getLoaderMetadata } from '@server/registry/discovery';
import type { DomainTtlEntry } from '@server/MCPServer.activation.ttl';
import { closeServer, startHttpTransport, startStdioTransport } from '@server/MCPServer.transport';
import { startArtifactRetentionScheduler } from '@utils/artifactRetention';
import { createLoopLagSampler } from '@utils/loopLag';
import { createToolLatencyTracker } from '@utils/toolLatency';
import { McpLogTransport } from '@server/transport/McpLogTransport';
import type { McpLogLevel } from '@server/transport/McpLogTransport';
import {
  MCP_BROWSER_FLEET_LEASE_TTL_MS,
  MCP_BROWSER_FLEET_MAX_LOCAL_LEASES,
  MCP_BROWSER_FLEET_VIRTUAL_NODES,
  MCP_LOG_ENABLED,
  MCP_LOG_FILE_DIR,
  MCP_LOG_LEVEL,
  MCP_TRANSPORT,
} from '@src/constants';
import { ActivationController } from '@server/activation/ActivationController';
import { SearchQualityTracker } from '@server/search/SearchQualityTracker';
import { registerSingleTool as registerSingleToolImpl } from '@server/MCPServer.tools';
import { registerSearchMetaTools } from '@server/MCPServer.search';
import { registerServerResources } from '@server/MCPServer.resources';
import { registerServerPrompts } from '@server/MCPServer.prompts';
import type { MCPServerContext } from '@server/MCPServer.context';
import { createServerEventBus, type EventBus, type ServerEventMap } from '@server/EventBus';
import { getAllManifests, ensureDomainLoaded } from '@server/registry/index';
import {
  RuntimeSnapshotScheduler,
  getStateDir,
} from '@server/persistence/RuntimeSnapshotScheduler';
import {
  ServerRuntimeState,
  restorePendingDomainActivations,
} from '@server/runtime/ServerRuntimeState';
import { BrowserSessionCoordinator } from '@server/runtime/BrowserSessionCoordinator';
import {
  BrowserFleetRouter,
  getConfiguredBrowserFleetLeaseStore,
  InMemoryBrowserFleetLeaseStore,
  type BrowserFleetLeaseStore,
} from '@server/runtime/BrowserFleetRouter';
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
import { executeToolWithTracking as executeToolWithTrackingImpl } from '@server/MCPServer.execution';

/**
 * Info-level logs are forwarded to the MCP client at a reduced rate: lines
 * whose count is 1 modulo INFO_LOG_FORWARD_EVERY (the 1st, 11th, 21st, ...)
 * are sent, so a noisy info stream can't amplify into O(log lines × active
 * sessions) notifications. warn/error always forward; debug is dropped
 * entirely.
 */
const INFO_LOG_FORWARD_EVERY = 10;

export interface MCPServerRuntimeOptions {
  browserFleetLeaseStore?: BrowserFleetLeaseStore;
}

export class MCPServer implements MCPServerContext {
  public readonly config: Config;
  public readonly server: McpServer;
  private readonly cache: CacheManager;
  public readonly tokenBudget: TokenBudgetManager;
  public readonly unifiedCache: UnifiedCacheManager;
  public readonly detailedData: DetailedDataManager;
  public readonly eventBus: EventBus<ServerEventMap>;
  public readonly samplingBridge: LLMSamplingBridge;
  public readonly elicitationBridge: ElicitationBridge;
  public readonly selectedTools: Tool[];
  public enabledDomains: Set<string>;
  public readonly router: ToolExecutionRouter;
  public readonly contextGuard: ToolCallContextGuard;
  public readonly circuitBreaker = new ToolCircuitBreaker();
  /** MCP 2.0 Tasks protocol — background scheduler for long-running tool operations. */
  public readonly taskManager = new TaskManager();
  private readonly circuitBrokenTools = new Set<string>();
  private readonly searchQualityTracker = new SearchQualityTracker();
  /** Offloads large response data (>512KB) to disk / DetailedDataManager to keep context lean. */
  public readonly largeDataOffloader: LargeDataOffloader;
  public readonly handlerDeps: ToolHandlerDeps;
  public readonly toolAutocompleteHandlers = new Map<
    string,
    Record<string, (value: string) => string[] | Promise<string[]>>
  >();
  private degradedMode = false;
  private clientInitialized = false;
  private cacheAdaptersRegistered = false;
  private cacheRegistrationPromise?: Promise<void>;
  /**
   * Stop handle for the artifact retention sweep, wired in start() and
   * released by closeServer(). The scheduler is idempotent at module level,
   * so the CLI entry's own call shares this timer instead of stacking one.
   */
  artifactRetentionStop: (() => void) | null = null;
  /**
   * Event-loop lag sampler + its stop handle, wired in start() and released by
   * closeServer() — mirrors the artifactRetentionStop lifecycle pattern. The
   * sampler exposes p50/p90/p99 through the /health verbose branch (r1-1).
   */
  loopLagSampler: import('@utils/loopLag').LoopLagSampler | null = null;
  loopLagStop: (() => void) | null = null;
  /**
   * Per-tool latency tracker + its eventBus unsubscribe handle, wired in start()
   * and released by closeServer() — mirrors the loopLagSampler lifecycle pattern.
   * The tracker exposes top-N slow tools through the /health verbose branch (r1-2).
   */
  toolLatencyTracker: import('@utils/toolLatency').ToolLatencyTracker | null = null;
  toolLatencyStop: (() => void) | null = null;
  /** Structured log transport for MCP `notifications/message`. */
  public readonly mcpLog = new McpLogTransport();
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
  declare browserHandlers: import('@server/domains/browser/index').BrowserToolHandlers | undefined;
  declare v8InspectorHandlers:
    | import('@server/domains/v8-inspector/handlers').V8InspectorHandlers
    | undefined;
  declare boringsslInspectorHandlers:
    | import('@server/domains/boringssl-inspector/handlers').BoringsslInspectorHandlers
    | undefined;
  declare skiaCaptureHandlers:
    | import('@server/domains/canvas/skia').SkiaCaptureHandlers
    | undefined;
  declare binaryInstrumentHandlers:
    | import('@server/domains/binary-instrument/handlers').BinaryInstrumentHandlers
    | undefined;
  declare binarySecretsHandlers:
    | import('@server/domains/binary-instrument/secrets/handlers').BinarySecretsHandlers
    | undefined;
  declare apkPackerHandlers:
    | import('@server/domains/binary-instrument/apk-packer/handlers').ApkPackerHandlers
    | undefined;
  declare adbBridgeHandlers:
    | import('@server/domains/adb-bridge/handlers').ADBBridgeHandlers
    | undefined;
  declare mojoIpcHandlers: import('@server/domains/mojo-ipc/handlers').MojoIPCHandlers | undefined;
  declare syscallHookHandlers:
    | import('@server/domains/syscall-hook/handlers').SyscallHookHandlers
    | undefined;
  declare protocolAnalysisHandlers:
    | import('@server/domains/protocol-analysis/handlers').ProtocolAnalysisHandlers
    | undefined;
  declare extensionRegistryHandlers:
    | import('@server/domains/extension-registry/handlers').ExtensionRegistryHandlers
    | undefined;
  declare crossDomainHandlers:
    | import('@server/domains/cross-domain/handlers').CrossDomainHandlers
    | undefined;
  declare debuggerHandlers:
    | import('@server/domains/debugger/index').DebuggerToolHandlers
    | undefined;
  declare advancedHandlers:
    | import('@server/domains/network/index').AdvancedToolHandlers
    | undefined;
  declare aiHookHandlers:
    | import('@server/domains/instrumentation/hooks/ai-handlers').AIHookToolHandlers
    | undefined;
  declare hookPresetHandlers:
    | import('@server/domains/instrumentation/hooks/preset-handlers').HookPresetToolHandlers
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
    | import('@server/domains/debugger/antidebug/index').AntiDebugToolHandlers
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
  declare evidenceHandlers:
    | import('@server/domains/instrumentation/evidence/handlers').EvidenceHandlers
    | undefined;
  declare instrumentationHandlers:
    | import('@server/domains/instrumentation/index').InstrumentationHandlers
    | undefined;

  constructor(config: Config, runtimeOptions: MCPServerRuntimeOptions = {}) {
    this.config = config;
    this.cache = new CacheManager(config.cache);
    this.tokenBudget = new TokenBudgetManager();
    this.unifiedCache = new UnifiedCacheManager();
    this.detailedData = new DetailedDataManager();
    this.eventBus = createServerEventBus();
    this.tokenBudget.setExternalCleanup(() => this.detailedData.clear());
    const { tools, profile } = resolveToolsForRegistration(config);
    this.selectedTools = tools;
    this.baseTier = profile;
    this.enabledDomains = this.resolveEnabledDomains(this.selectedTools);

    // Build handlerDeps for ALL domains (loaded + unloaded) using build-time metadata.
    // Loaded domains use manifest.ensure() directly; unloaded domains lazy-load on first access.
    const depsEntries: Array<[string, unknown]> = [];
    const manifests = getAllManifests();
    const loadedByDomain = new Map(manifests.map((m) => [m.domain, m]));
    const allMeta = getLoaderMetadata();
    if (!Array.isArray(allMeta)) {
      // Mock may return non-array in test environments
      logger.warn('[MCPServer] getLoaderMetadata returned non-array, skipping domain proxy setup');
    } else {
      for (const meta of allMeta) {
        const loaded = loadedByDomain.get(meta.domain);
        if (loaded) {
          depsEntries.push([
            meta.depKey,
            createDomainProxy(
              this,
              meta.domain,
              `${meta.domain}:${meta.depKey}`,
              () => loaded.ensure(this) as object,
            ),
          ]);
          // Secondary dep keys from loaded manifest
          if (loaded.secondaryDepKeys) {
            for (const key of loaded.secondaryDepKeys) {
              if (!depsEntries.some(([k]) => k === key)) {
                depsEntries.push([
                  key,
                  createDomainProxy(this, meta.domain, `${meta.domain}:${key}`, async () => {
                    await loaded.ensure(this);
                    return (this as Record<string, unknown>)[key] as object;
                  }),
                ]);
              }
            }
          }
        } else {
          // Unloaded domain — proxy that loads manifest on first access
          depsEntries.push([
            meta.depKey,
            createDomainProxy(this, meta.domain, `${meta.domain}:${meta.depKey}`, async () => {
              const manifest = await ensureDomainLoaded(meta.domain);
              if (!manifest) throw new Error(`Failed to load domain ${meta.domain}`);
              return manifest.ensure(this) as object;
            }),
          ]);
          // Secondary dep keys for unloaded domains
          for (const key of meta.secondaryDepKeys) {
            if (!depsEntries.some(([k]) => k === key)) {
              depsEntries.push([
                key,
                createDomainProxy(this, meta.domain, `${meta.domain}:${key}`, async () => {
                  const manifest = await ensureDomainLoaded(meta.domain);
                  if (!manifest) throw new Error(`Failed to load domain ${meta.domain}`);
                  await manifest.ensure(this);
                  return (this as Record<string, unknown>)[key] as object;
                }),
              ]);
            }
          }
        }
      }
    }
    this.handlerDeps = Object.fromEntries(depsEntries) as ToolHandlerDeps;
    // Expose the task scheduler to domain bind closures (deps.taskManager).
    (this.handlerDeps as Record<string, unknown>)['taskManager'] = this.taskManager;

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

    // Large-data offloader: writes payloads >threshold to disk / DetailedDataManager.
    // Thresholds come from config (OFFLOADER_* envs); previously the offloader
    // was constructed with zero config, leaving every knob at its default.
    this.largeDataOffloader = new LargeDataOffloader(this.detailedData, {
      detailThreshold: config.offloader?.detailThreshold,
      fileThreshold: config.offloader?.fileThreshold,
      outputDir: config.offloader?.outputDir,
      excludeTools: config.offloader?.excludeTools
        ? new Set(config.offloader.excludeTools)
        : undefined,
    });

    this.server = new McpServer(
      { name: config.mcp.name, version: config.mcp.version },
      {
        capabilities: {
          tools: { listChanged: true },
          logging: {},
          completions: {},
          prompts: { listChanged: true },
          // Legacy (2025-11-25) tasks capability. The handlers themselves are
          // installed explicitly below — v2 has no taskStore option
          // (SEP-2663 moved tasks to the Extensions Track).
          // requests.tools.call intentionally omitted: no handler creates
          // tasks via extra.taskStore yet — declaring it would promise
          // CreateTaskResult-shaped replies that tools/call never produces.
          tasks: {
            list: {},
            cancel: {},
          },
        },
      },
    );
    new TaskStoreAdapter(this.taskManager).install(this.server.server);

    // Attach structured MCP log transport
    const loggingConfig = config.server?.logging;
    this.mcpLog.attach(this.server, loggingConfig?.enabled ?? MCP_LOG_ENABLED);
    const validLevels = new Set<string>(['debug', 'info', 'warning', 'error']);
    const configuredLogLevel = loggingConfig?.level ?? MCP_LOG_LEVEL;
    if (validLevels.has(configuredLogLevel)) {
      this.mcpLog.setLevel(configuredLogLevel as McpLogLevel);
    }
    const configuredLogDir = loggingConfig?.fileDir ?? MCP_LOG_FILE_DIR;
    if (configuredLogDir) {
      this.mcpLog.enableFileLogging(configuredLogDir);
    }

    // Circuit breaker: deactivate blocked tools so the model won't attempt them
    this.circuitBreaker.onChange((event, toolName) => {
      if (event === 'opened') {
        this.circuitBreakerDeactivate(toolName);
      } else {
        this.circuitBreakerReactivate(toolName);
      }
    });

    // Forward structured logs to the MCP client (only after initialize handshake)
    this.server.server.oninitialized = () => {
      this.clientInitialized = true;
    };
    // Rate-limit the info forward path (see INFO_LOG_FORWARD_EVERY) while
    // always forwarding warn/error; debug is dropped entirely.
    let infoLogCount = 0;
    logger.onLog((level, message, args) => {
      if (!this.clientInitialized) return;
      // Drop debug — forwarding every debug/info line as an MCP notification
      // broadcast to all HTTP sessions is a quadratic amplification risk
      // (O(log lines × sessions)) under load.
      if (level === 'debug') return;
      if (level === 'info') {
        infoLogCount += 1;
        if (infoLogCount % INFO_LOG_FORWARD_EVERY !== 1) return;
      }
      try {
        const mcpLevel = level === 'warn' ? 'Warning' : level === 'error' ? 'Error' : 'Info';

        const data = args.length > 0 ? ' ' + JSON.stringify(args) : '';
        void this.server.server
          .sendLoggingMessage({
            level: mcpLevel as never,
            data: `${message}${data}`,
            logger: 'jshookmcp',
          })
          .catch(() => undefined);
      } catch {
        // Safe swallow
      }
    });
    this.samplingBridge = new LLMSamplingBridge(this.server);
    this.elicitationBridge = new ElicitationBridge(this.server);
    this.setDomainInstance('activationController', new ActivationController(this.eventBus, this));
    this.setDomainInstance('searchQualityTracker', this.searchQualityTracker);

    // Snapshot scheduler for StateBoard + EvidenceGraph persistence
    const stateDir = getStateDir();
    const snapshotScheduler = new RuntimeSnapshotScheduler();
    const runtimeState = new ServerRuntimeState();
    const browserFleetWorkerId = config.mcp.browserFleetWorkerId?.trim() || 'local';
    const configuredLeaseStore =
      runtimeOptions.browserFleetLeaseStore ?? getConfiguredBrowserFleetLeaseStore();
    if ((config.mcp.browserFleetWorkers?.length ?? 0) > 1 && !configuredLeaseStore) {
      throw new TypeError(
        'Multi-worker browser fleet topology requires a shared BrowserFleetLeaseStore via fleet-api',
      );
    }
    const browserFleetRouter = new BrowserFleetRouter(
      {
        localWorkerId: browserFleetWorkerId,
        workers:
          config.mcp.browserFleetWorkers?.length > 0
            ? config.mcp.browserFleetWorkers
            : [{ id: browserFleetWorkerId }],
        virtualNodes: config.mcp.browserFleetVirtualNodes ?? MCP_BROWSER_FLEET_VIRTUAL_NODES,
        leaseTtlMs: config.mcp.browserFleetLeaseTtlMs ?? MCP_BROWSER_FLEET_LEASE_TTL_MS,
      },
      configuredLeaseStore ??
        new InMemoryBrowserFleetLeaseStore(
          config.mcp.browserFleetMaxLocalLeases ?? MCP_BROWSER_FLEET_MAX_LOCAL_LEASES,
        ),
    );
    const browserSessionCoordinator = new BrowserSessionCoordinator(() => this.collector, {
      maxPending: config.mcp.browserSessionQueueMaxPending,
      maxPendingPerSession: config.mcp.browserSessionQueueMaxPendingPerSession,
      waitTimeoutMs: config.mcp.browserSessionQueueWaitTimeoutMs,
      quantumMs: config.mcp.browserSessionSchedulerQuantumMs,
      agingMs: config.mcp.browserSessionSchedulerAgingMs,
      expectedConcurrency: config.mcp.browserSessionExpectedConcurrency,
      reservedPendingPerSession: config.mcp.browserSessionReservedPendingPerSession,
      costEwmaAlpha: config.mcp.browserSessionCostEwmaAlpha,
    });
    this.setDomainInstance('snapshotScheduler', snapshotScheduler);
    this.setDomainInstance('snapshotStateDir', stateDir);
    this.setDomainInstance('serverRuntimeState', runtimeState);
    this.setDomainInstance('browserFleetRouter', browserFleetRouter);
    this.setDomainInstance('browserSessionCoordinator', browserSessionCoordinator);
    snapshotScheduler.register(`${stateDir}/runtime-state.json`, runtimeState);
    snapshotScheduler
      .start()
      .then(async () => {
        await restorePendingDomainActivations(this);
      })
      .catch((err) => logger.warn('snapshot scheduler start failed:', err));

    this.eventBus.on('tool:progress', async (payload) => {
      try {
        await this.server.server.notification({
          method: 'notifications/progress',
          params: {
            progressToken: payload.progressToken,
            progress: payload.progress,
            total: payload.total,
          },
        });
      } catch {
        // Swallow progress notification errors (e.g. broken transports)
      }
    });

    this.eventBus.on('evidence:updated', () => {
      try {
        void this.server.server.sendResourceUpdated({ uri: 'jshook://evidence/graph' });
      } catch {
        // Swallow resource updated notification errors
      }
    });

    this.eventBus.on('activation:domain_pruned', (payload) => {
      this.mcpLog.info('jshookmcp', {
        event: 'domain_pruned',
        domain: payload.domain,
        reason: payload.reason,
      });
    });

    this.server.server.setRequestHandler('completion/complete', async (request) => {
      try {
        const refName = (request.params.ref as { name?: string }).name;
        if (!refName) {
          return { completion: { values: [], total: 0, hasMore: false } };
        }
        const argName = request.params.argument.name;
        const argValue = request.params.argument.value;
        const toolHandlers = this.toolAutocompleteHandlers.get(refName);
        if (!toolHandlers) return { completion: { values: [], total: 0, hasMore: false } };
        const handler = toolHandlers[argName];
        if (!handler) return { completion: { values: [], total: 0, hasMore: false } };

        const results = await handler(argValue);
        const MAX_SUGGESTIONS = 100;
        return {
          completion: {
            values: results.slice(0, MAX_SUGGESTIONS),
            total: results.length,
            hasMore: results.length > MAX_SUGGESTIONS,
          },
        };
      } catch (err) {
        logger.error('Autocomplete failed:', err);
        return { completion: { values: [], total: 0, hasMore: false } };
      }
    });

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
    return executeToolWithTrackingImpl(this, name, args);
  }

  // ── Lifecycle ──

  enterDegradedMode(reason: string): void {
    if (this.degradedMode) return;
    this.degradedMode = true;
    logger.warn(`Entering degraded mode: ${reason}`);
    this.tokenBudget.setTrackingEnabled(false);
    logger.setLevel('warn');
  }

  private circuitBreakerDeactivate(toolName: string): void {
    if (this.circuitBrokenTools.has(toolName)) return;

    const registeredTool = this.activatedRegisteredTools.get(toolName);
    if (registeredTool) {
      try {
        registeredTool.remove();
      } catch (e) {
        logger.warn(`CircuitBreaker: failed to remove tool "${toolName}":`, e);
        return; // Preserve retry path — don't add to circuitBrokenTools on transient error.
      }
    } else if (!this.activatedToolNames.has(toolName)) {
      return;
    }

    this.router.removeHandler(toolName);
    this.activatedToolNames.delete(toolName);
    this.activatedRegisteredTools.delete(toolName);
    this.circuitBrokenTools.add(toolName);

    const extRecord = this.extensionToolsByName.get(toolName);
    if (extRecord) {
      extRecord.registeredTool = undefined;
    }

    if (this.clientSupportsListChanged) {
      void this.server.sendToolListChanged();
    }

    logger.info(`CircuitBreaker: deactivated "${toolName}" from tool list`);
  }

  private circuitBreakerReactivate(toolName: string): void {
    if (!this.circuitBrokenTools.has(toolName)) return;
    this.circuitBrokenTools.delete(toolName);

    // Look up tool definition from selected tools (base tier) or registry
    const toolDef = this.selectedTools.find((t) => t.name === toolName);
    if (!toolDef) {
      logger.warn(`CircuitBreaker: cannot reactivate "${toolName}" — no tool definition found`);
      return;
    }

    const registration = this.registerSingleTool(toolDef);
    this.activatedRegisteredTools.set(toolName, registration);
    this.activatedToolNames.add(toolName);

    if (this.clientSupportsListChanged) {
      void this.server.sendToolListChanged();
    }

    logger.info(`CircuitBreaker: reactivated "${toolName}" in tool list`);
  }

  async start(): Promise<void> {
    await this.registerCaches();
    await this.cache.init();
    // Explicit lifecycle wiring: the artifact retention sweep is started by
    // the server (async, unref'd, non-blocking) so every embedder path gets
    // the default cleanup — not a module-level side effect. The scheduler is
    // idempotent at module level, sharing one timer with the CLI entry call.
    this.artifactRetentionStop = startArtifactRetentionScheduler();
    // r1-1: production event-loop lag metric — always on (cheap on-demand
    // sampling via monitorEventLoopDelay, no timer), so /health verbose can
    // report p50/p90/p99 regardless of E2E env gating. Stopped in closeServer().
    const loopLagSampler = createLoopLagSampler();
    this.loopLagSampler = loopLagSampler;
    this.loopLagStop = loopLagSampler.enable();
    // r1-2: per-tool latency histograms — always on (synchronous ring-buffer push
    // on the 'tool:called' eventBus path, no timers), so /health verbose can report
    // top-N slow tools regardless of E2E env gating. Unsubscribed in closeServer().
    const toolLatencyTracker = createToolLatencyTracker();
    this.toolLatencyTracker = toolLatencyTracker;
    this.toolLatencyStop = this.eventBus.on('tool:called', (payload) => {
      if (typeof payload.durationMs === 'number') {
        toolLatencyTracker.record(payload.toolName, payload.durationMs);
      }
    });
    const transportMode = (this.config.server?.transport ?? MCP_TRANSPORT).toLowerCase();
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
    registerServerPrompts(this);
    const metaToolCount = this.metaToolsByName.size;
    logger.info(
      `Registered ${this.selectedTools.length} base tools + ${metaToolCount} meta tools with McpServer`,
    );
    this.mcpLog.info('jshookmcp', {
      event: 'registry_discovered',
      domainCount: this.enabledDomains.size,
      toolCount: this.selectedTools.length,
    });
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
  'browserHandlers',
  'v8InspectorHandlers',
  'boringsslInspectorHandlers',
  'skiaCaptureHandlers',
  'binaryInstrumentHandlers',
  'binarySecretsHandlers',
  'apkPackerHandlers',
  'adbBridgeHandlers',
  'mojoIpcHandlers',
  'syscallHookHandlers',
  'protocolAnalysisHandlers',
  'extensionRegistryHandlers',
  'crossDomainHandlers',
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
  'sandboxHandlers',
  'processHandlers',
  'workflowHandlers',
  'macroHandlers',
  'wasmHandlers',
  'streamingHandlers',
  'encodingHandlers',
  'antidebugHandlers',
  'graphqlHandlers',
  'platformHandlers',
  'sourcemapHandlers',
  'transformHandlers',
  'coordinationHandlers',
  'sharedStateBoardHandlers',
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
