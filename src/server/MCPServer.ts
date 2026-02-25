import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
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
import { asErrorResponse } from './domains/shared/response.js';
import {
  getToolsByDomains,
  getToolsForProfile,
  getToolDomain,
  parseToolDomains,
  type ToolDomain,
  type ToolProfile,
} from './ToolCatalog.js';
import { ToolExecutionRouter } from './ToolExecutionRouter.js';
import { createToolHandlerMap } from './ToolHandlerMap.js';
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
  private readonly enabledDomains: ReadonlySet<ToolDomain>;
  private readonly router: ToolExecutionRouter;
  private degradedMode = false;
  private cacheAdaptersRegistered = false;
  private cacheRegistrationPromise?: Promise<void>;

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

  constructor(config: Config) {
    this.config = config;
    this.cache = new CacheManager(config.cache);
    this.tokenBudget = TokenBudgetManager.getInstance();
    this.unifiedCache = UnifiedCacheManager.getInstance();
    this.selectedTools = this.resolveToolsForRegistration();
    this.enabledDomains = this.resolveEnabledDomains(this.selectedTools);

    this.router = new ToolExecutionRouter(
      createToolHandlerMap({
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
      })
    );

    // Use McpServer high-level API with logging capability declared
    this.server = new McpServer(
      { name: config.mcp.name, version: config.mcp.version },
      { capabilities: { tools: {}, logging: {} } }
    );

    this.registerTools();
  }

  private resolveEnabledDomains(tools: Tool[]): ReadonlySet<ToolDomain> {
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

  /**
   * Register all 157 tools with the McpServer using the high-level tool() API.
   * Each tool gets a ZodRawShape built from its JSON Schema properties (all typed as z.any())
   * so the SDK validates input structure while our domain handlers perform business validation.
   */
  private registerTools(): void {
    for (const toolDef of this.selectedTools) {
      const shape = buildZodShape(toolDef.inputSchema as Record<string, unknown>);
      const description = toolDef.description ?? toolDef.name;

      if (Object.keys(shape).length > 0) {
        // Tool has declared parameters → pass schema so SDK validates input structure
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
        // Tool has no parameters → use no-schema overload
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
    logger.info(`Registered ${this.selectedTools.length} tools with McpServer`);
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
    if (explicitProfile === 'minimal' || explicitProfile === 'full') {
      profile = explicitProfile;
    } else {
      profile = transportMode === 'stdio' ? 'minimal' : 'full';
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

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    // Connect MCP server to the transport once; the transport manages sessions internally
    await this.server.connect(transport);

    const httpServer = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found – use POST /mcp');
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        // SSE stream open / session close
        transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            await transport.handleRequest(req, res, body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad Request – invalid JSON body');
          }
        });
        return;
      }

      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.listen(port, () => {
        logger.success(`MCP Streamable HTTP server listening on http://localhost:${port}/mcp`);
        resolve();
      });
      httpServer.on('error', reject);
    });
  }

  async close(): Promise<void> {
    if (this.collector) {
      await this.collector.close();
    }
    await this.server.close();
    logger.success('MCP server closed');
  }
}
