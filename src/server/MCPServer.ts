import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { checkAuth, checkOrigin, readBodyWithLimit } from './http/HttpMiddleware.js';
import { z } from 'zod';
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
import { BrowserToolHandlers } from './domains/browser/index.js';
import { DebuggerToolHandlers } from './domains/debugger/index.js';
import { AdvancedToolHandlers } from './domains/network/index.js';
import { AIHookToolHandlers } from './domains/hooks/index.js';
import { HookPresetToolHandlers } from './domains/hooks/index.js';
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
import { CoreAnalysisHandlers } from './domains/analysis/index.js';
import { CoreMaintenanceHandlers } from './domains/maintenance/index.js';
import { ProcessToolHandlers } from './domains/process/index.js';
import { WorkflowHandlers } from './domains/workflow/index.js';
import { asErrorResponse } from './domains/shared/response.js';
import {
  getToolsByDomains,
  getToolsForProfile,
  getToolDomain,
  getProfileDomains,
  parseToolDomains,
  type ToolDomain,
  type ToolProfile,
} from './ToolCatalog.js';
import { ToolExecutionRouter } from './ToolExecutionRouter.js';
import { createToolHandlerMap, type ToolHandlerMapDependencies } from './ToolHandlerMap.js';
import type { ToolArgs } from './types.js';

/** Build a ZodRawShape from a JSON Schema inputSchema for McpServer.tool() registration. */
function buildZodShape(inputSchema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const props = (inputSchema.properties as Record<string, unknown>) ?? {};
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of Object.keys(props)) {
    shape[key] = z.any();
  }
  return shape;
}

export class MCPServer {
  private readonly config: Config;
  private readonly server: McpServer;
  private readonly cache: CacheManager;
  private readonly tokenBudget: TokenBudgetManager;
  private readonly unifiedCache: UnifiedCacheManager;
  private readonly selectedTools: Tool[];
  private enabledDomains: Set<ToolDomain>;
  private readonly router: ToolExecutionRouter;
  private readonly handlerDeps: ToolHandlerMapDependencies;
  private degradedMode = false;
  private cacheAdaptersRegistered = false;
  private cacheRegistrationPromise?: Promise<void>;
  private boosted = false;
  private readonly boostedToolNames = new Set<string>();
  private boostTtlTimer: ReturnType<typeof setTimeout> | null = null;
  private httpServer?: Server;
  private readonly httpSockets = new Set<Socket>();

  private collector?: CodeCollector;
  private pageController?: PageController;
  private domInspector?: DOMInspector;
  private scriptManager?: ScriptManager;
  private debuggerManager?: DebuggerManager;
  private runtimeInspector?: RuntimeInspector;
  private consoleMonitor?: ConsoleMonitor;
  private llm?: LLMService;

  private browserHandlers?: BrowserToolHandlers;
  private debuggerHandlers?: DebuggerToolHandlers;
  private advancedHandlers?: AdvancedToolHandlers;
  private aiHookHandlers?: AIHookToolHandlers;
  private hookPresetHandlers?: HookPresetToolHandlers;
  private deobfuscator?: Deobfuscator;
  private advancedDeobfuscator?: AdvancedDeobfuscator;
  private astOptimizer?: ASTOptimizer;
  private obfuscationDetector?: ObfuscationDetector;
  private analyzer?: CodeAnalyzer;
  private cryptoDetector?: CryptoDetector;
  private hookManager?: HookManager;
  private coreAnalysisHandlers?: CoreAnalysisHandlers;
  private coreMaintenanceHandlers?: CoreMaintenanceHandlers;
  private processHandlers?: ProcessToolHandlers;
  private workflowHandlers?: WorkflowHandlers;

  constructor(config: Config) {
    this.config = config;
    this.cache = new CacheManager(config.cache);
    this.tokenBudget = TokenBudgetManager.getInstance();
    this.unifiedCache = UnifiedCacheManager.getInstance();
    this.selectedTools = this.resolveToolsForRegistration();
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

  private resolveEnabledDomains(tools: Tool[]): Set<ToolDomain> {
    const domains = new Set<ToolDomain>();
    for (const tool of tools) {
      const domain = getToolDomain(tool.name);
      if (domain) {
        domains.add(domain);
      }
    }
    return domains;
  }

  private createDomainProxy<T extends object>(
    domain: ToolDomain,
    label: string,
    factory: () => T
  ): T {
    let instance: T | undefined;
    return new Proxy({} as T, {
      get: (_target, prop) => {
        if (!this.enabledDomains.has(domain)) {
          return () => {
            throw new Error(
              `${label} is unavailable: domain "${domain}" not enabled by current tool profile`
            );
          };
        }

        if (!instance) {
          logger.info(`Lazy-initializing ${label} for domain "${domain}"`);
          instance = factory();
        }

        const value = (instance as any)[prop];
        return typeof value === 'function' ? value.bind(instance) : value;
      },
    });
  }

  private ensureCollector(): CodeCollector {
    if (!this.collector) {
      this.collector = new CodeCollector(this.config.puppeteer);
      void this.registerCaches();
    }
    return this.collector;
  }

  private ensurePageController(): PageController {
    if (!this.pageController) {
      this.pageController = new PageController(this.ensureCollector());
    }
    return this.pageController;
  }

  private ensureDOMInspector(): DOMInspector {
    if (!this.domInspector) {
      this.domInspector = new DOMInspector(this.ensureCollector());
    }
    return this.domInspector;
  }

  private ensureScriptManager(): ScriptManager {
    if (!this.scriptManager) {
      this.scriptManager = new ScriptManager(this.ensureCollector());
    }
    return this.scriptManager;
  }

  private ensureDebuggerManager(): DebuggerManager {
    if (!this.debuggerManager) {
      this.debuggerManager = new DebuggerManager(this.ensureCollector());
    }
    return this.debuggerManager;
  }

  private ensureRuntimeInspector(): RuntimeInspector {
    if (!this.runtimeInspector) {
      this.runtimeInspector = new RuntimeInspector(this.ensureCollector(), this.ensureDebuggerManager());
    }
    return this.runtimeInspector;
  }

  private ensureConsoleMonitor(): ConsoleMonitor {
    if (!this.consoleMonitor) {
      this.consoleMonitor = new ConsoleMonitor(this.ensureCollector());
    }
    return this.consoleMonitor;
  }

  private ensureLLM(): LLMService {
    if (!this.llm) {
      this.llm = new LLMService(this.config.llm);
    }
    return this.llm;
  }

  private ensureBrowserHandlers(): BrowserToolHandlers {
    if (!this.browserHandlers) {
      this.browserHandlers = new BrowserToolHandlers(
        this.ensureCollector(),
        this.ensurePageController(),
        this.ensureDOMInspector(),
        this.ensureScriptManager(),
        this.ensureConsoleMonitor(),
        this.ensureLLM()
      );
    }
    return this.browserHandlers;
  }

  private ensureDebuggerHandlers(): DebuggerToolHandlers {
    if (!this.debuggerHandlers) {
      this.debuggerHandlers = new DebuggerToolHandlers(
        this.ensureDebuggerManager(),
        this.ensureRuntimeInspector()
      );
    }
    return this.debuggerHandlers;
  }

  private ensureAdvancedHandlers(): AdvancedToolHandlers {
    if (!this.advancedHandlers) {
      this.advancedHandlers = new AdvancedToolHandlers(
        this.ensureCollector(),
        this.ensureConsoleMonitor()
      );
    }
    return this.advancedHandlers;
  }

  private ensureAIHookHandlers(): AIHookToolHandlers {
    if (!this.aiHookHandlers) {
      this.aiHookHandlers = new AIHookToolHandlers(this.ensurePageController());
    }
    return this.aiHookHandlers;
  }

  private ensureHookPresetHandlers(): HookPresetToolHandlers {
    if (!this.hookPresetHandlers) {
      this.hookPresetHandlers = new HookPresetToolHandlers(this.ensurePageController());
    }
    return this.hookPresetHandlers;
  }

  private ensureCoreAnalysisHandlers(): CoreAnalysisHandlers {
    if (!this.deobfuscator) {
      this.deobfuscator = new Deobfuscator(this.ensureLLM());
    }
    if (!this.advancedDeobfuscator) {
      this.advancedDeobfuscator = new AdvancedDeobfuscator(this.ensureLLM());
    }
    if (!this.astOptimizer) {
      this.astOptimizer = new ASTOptimizer();
    }
    if (!this.obfuscationDetector) {
      this.obfuscationDetector = new ObfuscationDetector();
    }
    if (!this.analyzer) {
      this.analyzer = new CodeAnalyzer(this.ensureLLM());
    }
    if (!this.cryptoDetector) {
      this.cryptoDetector = new CryptoDetector(this.ensureLLM());
    }
    if (!this.hookManager) {
      this.hookManager = new HookManager();
    }
    if (!this.coreAnalysisHandlers) {
      this.coreAnalysisHandlers = new CoreAnalysisHandlers({
        collector: this.ensureCollector(),
        scriptManager: this.ensureScriptManager(),
        deobfuscator: this.deobfuscator,
        advancedDeobfuscator: this.advancedDeobfuscator,
        astOptimizer: this.astOptimizer,
        obfuscationDetector: this.obfuscationDetector,
        analyzer: this.analyzer,
        cryptoDetector: this.cryptoDetector,
        hookManager: this.hookManager,
      });
    }
    return this.coreAnalysisHandlers;
  }

  private ensureCoreMaintenanceHandlers(): CoreMaintenanceHandlers {
    if (!this.coreMaintenanceHandlers) {
      this.coreMaintenanceHandlers = new CoreMaintenanceHandlers({
        tokenBudget: this.tokenBudget,
        unifiedCache: this.unifiedCache,
      });
    }
    return this.coreMaintenanceHandlers;
  }

  private ensureProcessHandlers(): ProcessToolHandlers {
    if (!this.processHandlers) {
      this.processHandlers = new ProcessToolHandlers();
    }
    return this.processHandlers;
  }

  private ensureWorkflowHandlers(): WorkflowHandlers {
    if (!this.workflowHandlers) {
      this.workflowHandlers = new WorkflowHandlers({
        browserHandlers: this.ensureBrowserHandlers(),
        advancedHandlers: this.ensureAdvancedHandlers(),
      });
    }
    return this.workflowHandlers;
  }

  /**
   * Register all tools with the McpServer using the high-level tool() API.
   */
  private registerTools(): void {
    for (const toolDef of this.selectedTools) {
      this.registerSingleTool(toolDef);
    }
    this.registerMetaTools();
    logger.info(`Registered ${this.selectedTools.length} tools + meta tools with McpServer`);
  }

  /** Register a single tool definition with the MCP SDK. */
  private registerSingleTool(toolDef: Tool): void {
    const shape = buildZodShape(toolDef.inputSchema as Record<string, unknown>);
    const description = toolDef.description ?? toolDef.name;

    if (Object.keys(shape).length > 0) {
      this.server.tool(
        toolDef.name,
        description,
        shape as Record<string, z.ZodAny>,
        async (args) => {
          try {
            return await this.executeToolWithTracking(toolDef.name, args as ToolArgs);
          } catch (error) {
            logger.error(`Tool execution failed: ${toolDef.name}`, error);
            return asErrorResponse(error);
          }
        }
      );
    } else {
      this.server.tool(
        toolDef.name,
        description,
        async () => {
          try {
            return await this.executeToolWithTracking(toolDef.name, {});
          } catch (error) {
            logger.error(`Tool execution failed: ${toolDef.name}`, error);
            return asErrorResponse(error);
          }
        }
      );
    }
  }

  /**
   * Register profile boost/unboost meta-tools that are always available regardless of profile.
   * boost_profile: dynamically loads extra domains (e.g. full) into the running session.
   * unboost_profile: removes boost-added tools and reverts to the base profile.
   */
  private registerMetaTools(): void {
    this.server.tool(
      'boost_profile',
      'Dynamically load additional tools from a higher-capability profile (e.g. "full") into the current session. Gives access to debugger, hooks, deobfuscation and other advanced tools without restarting. Auto-expires after ttlMinutes (default 30). Call unboost_profile to remove immediately.',
      {
        target: z.string().optional().describe('Target profile to boost to (default: full)'),
        ttlMinutes: z.number().optional().describe('Auto-unboost after this many minutes (default: 30, set 0 to disable)'),
      } as unknown as Record<string, z.ZodAny>,
      async (args) => {
        try {
          const target = (args.target as ToolProfile | undefined) ?? 'full';
          const ttlMinutes = (args.ttlMinutes as number | undefined) ?? 30;
          await this.boostProfile(target, ttlMinutes);
          const addedNames = [...this.boostedToolNames];
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                boosted: true,
                target,
                addedTools: addedNames.length,
                ttlMinutes: ttlMinutes > 0 ? ttlMinutes : 'disabled',
                addedToolNames: addedNames,
                hint: 'These tools are now directly callable. Call unboost_profile when done (or they auto-expire after TTL).',
              }),
            }],
          };
        } catch (error) {
          logger.error('boost_profile failed', error);
          return asErrorResponse(error);
        }
      }
    );

    this.server.tool(
      'unboost_profile',
      'Remove tools added by boost_profile and revert to the base profile. Call this after completing tasks that required the boosted tools to prevent context pollution from unused high-capability tools.',
      async () => {
        try {
          const removed = this.boostedToolNames.size;
          if (!this.boosted) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: true, boosted: false, removedTools: 0, message: 'Not currently boosted; nothing to revert.' }),
              }],
            };
          }
          await this.unboostProfile();
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                success: true,
                boosted: false,
                removedTools: removed,
                message: `Unboosted: ${removed} tools removed. Reverted to base profile.`,
              }),
            }],
          };
        } catch (error) {
          logger.error('unboost_profile failed', error);
          return asErrorResponse(error);
        }
      }
    );
  }

  /** Dynamically load all tools from a higher-capability profile into the running session. */
  private async boostProfile(target: ToolProfile = 'full', ttlMinutes = 30): Promise<void> {
    if (this.boosted) {
      logger.warn('Already boosted — call unboost_profile first');
      return;
    }

    const targetTools = getToolsForProfile(target);
    const currentNames = new Set(this.selectedTools.map((t) => t.name));
    const newTools = targetTools.filter((t) => !currentNames.has(t.name));

    // Expand enabled domains so domain proxies will allow the new handlers
    for (const domain of getProfileDomains(target)) {
      this.enabledDomains.add(domain);
    }

    // Register each new tool with the MCP SDK
    for (const toolDef of newTools) {
      this.registerSingleTool(toolDef);
      this.boostedToolNames.add(toolDef.name);
    }

    // Register handlers for the new tools in the router
    const newToolNames = new Set(newTools.map((t) => t.name));
    const newHandlers = createToolHandlerMap(this.handlerDeps, newToolNames);
    this.router.addHandlers(newHandlers);

    this.boosted = true;

    // Auto-unboost after TTL if configured
    if (ttlMinutes > 0) {
      if (this.boostTtlTimer) clearTimeout(this.boostTtlTimer);
      this.boostTtlTimer = setTimeout(async () => {
        logger.info(`boost_profile TTL expired (${ttlMinutes}min) — auto-unboosting`);
        await this.unboostProfile();
      }, ttlMinutes * 60 * 1000);
    }

    // Notify connected clients that the tool list has changed
    try {
      await this.server.sendToolListChanged();
    } catch (e) {
      logger.warn('sendToolListChanged failed (client may not support notifications):', e);
    }

    logger.info(`Boosted to "${target}": added ${newTools.length} tools (${[...this.boostedToolNames].join(', ')})`);
  }

  /** Remove boost-added tools and revert enabled domains to the base profile. */
  private async unboostProfile(): Promise<void> {
    if (!this.boosted) return;

    // Cancel any pending TTL timer
    if (this.boostTtlTimer) {
      clearTimeout(this.boostTtlTimer);
      this.boostTtlTimer = null;
    }

    // Remove boosted tools from the MCP SDK registry
    const registry = (this.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    for (const name of this.boostedToolNames) {
      delete registry[name];
      this.router.removeHandler(name);
    }

    // Revert enabled domains to the original base profile
    this.enabledDomains = this.resolveEnabledDomains(this.selectedTools);

    this.boostedToolNames.clear();
    this.boosted = false;

    try {
      await this.server.sendToolListChanged();
    } catch (e) {
      logger.warn('sendToolListChanged failed (client may not support notifications):', e);
    }

    logger.info('Unboosted: reverted to base profile domains');
  }

  private resolveToolsForRegistration() {
    const transportMode = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();
    const explicitProfile = (process.env.MCP_TOOL_PROFILE ?? '').trim().toLowerCase();
    const explicitDomains = parseToolDomains(process.env.MCP_TOOL_DOMAINS);

    if (explicitDomains && explicitDomains.length > 0) {
      const tools = getToolsByDomains(explicitDomains);
      logger.info(`Tool registration mode=domains [${explicitDomains.join(',')}], count=${tools.length}`);
      return tools;
    }

    let profile: ToolProfile;
    if (explicitProfile === 'minimal' || explicitProfile === 'full' || explicitProfile === 'workflow') {
      profile = explicitProfile as ToolProfile;
    } else {
      profile = transportMode === 'stdio' ? 'minimal' : 'workflow';
    }

    const tools = getToolsForProfile(profile);
    logger.info(`Tool registration mode=${profile}, transport=${transportMode}, count=${tools.length}`);
    return tools;
  }

  private async registerCaches(): Promise<void> {
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

  private async executeToolWithTracking(name: string, args: ToolArgs) {
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
   * The Streamable HTTP transport implements the MCP 2025-03-26 specification and
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.success('MCP stdio server started');
  }

  private async startHttpTransport(): Promise<void> {
    const port = parseInt(process.env.MCP_PORT ?? '3000', 10);
    const host = process.env.MCP_HOST ?? '127.0.0.1';

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Connect MCP server to the transport once; the transport manages sessions internally
    await this.server.connect(transport);

    this.httpServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found – use POST /mcp');
        return;
      }

      // CSRF protection – reject cross-origin browser requests without auth
      if (!checkOrigin(req, res)) return;

      // Auth gate – rejects early if MCP_AUTH_TOKEN is set and token is missing/invalid
      if (!checkAuth(req, res)) return;

      if (req.method === 'GET' || req.method === 'DELETE') {
        // SSE stream open / session close
        transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'POST') {
        readBodyWithLimit(req, res)
          .then((body) => transport.handleRequest(req, res, body))
          .catch(() => { /* already responded by middleware */ });
        return;
      }

      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
    });

    // Track open sockets so close() can destroy lingering SSE connections
    this.httpServer.on('connection', (socket: Socket) => {
      this.httpSockets.add(socket);
      socket.on('close', () => this.httpSockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, host, () => {
        logger.success(`MCP Streamable HTTP server listening on http://${host}:${port}/mcp`);
        resolve();
      });
      this.httpServer!.on('error', reject);
    });
  }

  async close(): Promise<void> {
    // Clean up boost timer
    if (this.boostTtlTimer) {
      clearTimeout(this.boostTtlTimer);
      this.boostTtlTimer = null;
    }

    // Shut down DetailedDataManager cleanup interval
    const { DetailedDataManager } = await import('../utils/DetailedDataManager.js');
    DetailedDataManager.getInstance().shutdown();

    if (this.httpServer) {
      // Grace period: allow in-flight requests to complete, then force-destroy
      const closePromise = new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      const forceTimeout = setTimeout(() => {
        for (const socket of this.httpSockets) {
          socket.destroy();
        }
      }, 5_000);
      await closePromise;
      clearTimeout(forceTimeout);
      this.httpSockets.clear();
      this.httpServer = undefined;
    }
    if (this.collector) {
      await this.collector.close();
    }
    await this.server.close();
    logger.success('MCP server closed');
  }
}
