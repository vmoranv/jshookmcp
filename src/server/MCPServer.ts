import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
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
import { allTools } from './ToolCatalog.js';
import { ToolExecutionRouter } from './ToolExecutionRouter.js';
import { createToolHandlerMap } from './ToolHandlerMap.js';
import type { ToolArgs } from './types.js';

export class MCPServer {
  private readonly server: Server;
  private readonly cache: CacheManager;
  private readonly collector: CodeCollector;
  private readonly pageController: PageController;
  private readonly domInspector: DOMInspector;
  private readonly scriptManager: ScriptManager;
  private readonly debuggerManager: DebuggerManager;
  private readonly runtimeInspector: RuntimeInspector;
  private readonly consoleMonitor: ConsoleMonitor;
  private readonly browserHandlers: BrowserToolHandlers;
  private readonly debuggerHandlers: DebuggerToolHandlers;
  private readonly advancedHandlers: AdvancedToolHandlers;
  private readonly aiHookHandlers: AIHookToolHandlers;
  private readonly hookPresetHandlers: HookPresetToolHandlers;
  private readonly deobfuscator: Deobfuscator;
  private readonly advancedDeobfuscator: AdvancedDeobfuscator;
  private readonly astOptimizer: ASTOptimizer;
  private readonly obfuscationDetector: ObfuscationDetector;
  private readonly llm: LLMService;
  private readonly analyzer: CodeAnalyzer;
  private readonly cryptoDetector: CryptoDetector;
  private readonly hookManager: HookManager;
  private readonly tokenBudget: TokenBudgetManager;
  private readonly unifiedCache: UnifiedCacheManager;
  private readonly coreAnalysisHandlers: CoreAnalysisHandlers;
  private readonly coreMaintenanceHandlers: CoreMaintenanceHandlers;
  private readonly processHandlers: ProcessToolHandlers;
  private readonly router: ToolExecutionRouter;

  constructor(config: Config) {
    this.cache = new CacheManager(config.cache);
    this.collector = new CodeCollector(config.puppeteer);
    this.pageController = new PageController(this.collector);
    this.domInspector = new DOMInspector(this.collector);
    this.scriptManager = new ScriptManager(this.collector);
    this.debuggerManager = new DebuggerManager(this.collector);
    this.consoleMonitor = new ConsoleMonitor(this.collector);
    this.runtimeInspector = new RuntimeInspector(this.collector, this.debuggerManager);
    this.llm = new LLMService(config.llm);

    this.browserHandlers = new BrowserToolHandlers(
      this.collector,
      this.pageController,
      this.domInspector,
      this.scriptManager,
      this.consoleMonitor,
      this.llm
    );
    this.debuggerHandlers = new DebuggerToolHandlers(this.debuggerManager, this.runtimeInspector);
    this.advancedHandlers = new AdvancedToolHandlers(this.collector, this.consoleMonitor);
    this.aiHookHandlers = new AIHookToolHandlers(this.pageController);
    this.hookPresetHandlers = new HookPresetToolHandlers(this.pageController);

    this.deobfuscator = new Deobfuscator(this.llm);
    this.advancedDeobfuscator = new AdvancedDeobfuscator(this.llm);
    this.astOptimizer = new ASTOptimizer();
    this.obfuscationDetector = new ObfuscationDetector();
    this.analyzer = new CodeAnalyzer(this.llm);
    this.cryptoDetector = new CryptoDetector(this.llm);
    this.hookManager = new HookManager();
    this.tokenBudget = TokenBudgetManager.getInstance();
    this.unifiedCache = UnifiedCacheManager.getInstance();

    this.coreAnalysisHandlers = new CoreAnalysisHandlers({
      collector: this.collector,
      scriptManager: this.scriptManager,
      deobfuscator: this.deobfuscator,
      advancedDeobfuscator: this.advancedDeobfuscator,
      astOptimizer: this.astOptimizer,
      obfuscationDetector: this.obfuscationDetector,
      analyzer: this.analyzer,
      cryptoDetector: this.cryptoDetector,
      hookManager: this.hookManager,
    });

    this.coreMaintenanceHandlers = new CoreMaintenanceHandlers({
      tokenBudget: this.tokenBudget,
      unifiedCache: this.unifiedCache,
    });

    this.processHandlers = new ProcessToolHandlers();

    this.router = new ToolExecutionRouter(
      createToolHandlerMap({
        browserHandlers: this.browserHandlers,
        debuggerHandlers: this.debuggerHandlers,
        advancedHandlers: this.advancedHandlers,
        aiHookHandlers: this.aiHookHandlers,
        hookPresetHandlers: this.hookPresetHandlers,
        coreAnalysisHandlers: this.coreAnalysisHandlers,
        coreMaintenanceHandlers: this.coreMaintenanceHandlers,
        processHandlers: this.processHandlers,
      })
    );

    this.server = new Server(
      {
        name: config.mcp.name,
        version: config.mcp.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private async registerCaches(): Promise<void> {
    try {
      const { DetailedDataManager } = await import('../utils/DetailedDataManager.js');
      const { createCacheAdapters } = await import('../utils/CacheAdapters.js');
      const detailedDataManager = DetailedDataManager.getInstance();
      const codeCache = this.collector.getCache();
      const codeCompressor = this.collector.getCompressor();

      const adapters = createCacheAdapters(detailedDataManager, codeCache, codeCompressor);
      for (const adapter of adapters) {
        this.unifiedCache.registerCache(adapter);
      }
      logger.info(`Registered ${adapters.length} cache adapters.`);
    } catch (error) {
      logger.error('Cache registration failed:', error);
    }
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allTools,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const payload = (args || {}) as ToolArgs;
        return await this.executeToolWithTracking(name, payload);
      } catch (error) {
        logger.error(`Tool execution failed: ${name}`, error);
        return asErrorResponse(error);
      }
    });
  }

  private async executeToolWithTracking(name: string, args: ToolArgs) {
    try {
      const response = await this.router.execute(name, args);
      this.tokenBudget.recordToolCall(name, args, response);
      return response;
    } catch (error) {
      const errorResponse = asErrorResponse(error);
      this.tokenBudget.recordToolCall(name, args, errorResponse);
      throw error;
    }
  }

  async start(): Promise<void> {
    await this.registerCaches();
    await this.cache.init();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.success('MCP server started');
  }

  async close(): Promise<void> {
    await this.collector.close();
    await this.server.close();
    logger.success('MCP server closed');
  }
}
