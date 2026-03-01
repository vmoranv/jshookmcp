import { CodeCollector } from '../modules/collector/CodeCollector.js';
import { PageController } from '../modules/collector/PageController.js';
import { DOMInspector } from '../modules/collector/DOMInspector.js';
import { ScriptManager } from '../modules/debugger/ScriptManager.js';
import { DebuggerManager } from '../modules/debugger/DebuggerManager.js';
import { RuntimeInspector } from '../modules/debugger/RuntimeInspector.js';
import { ConsoleMonitor } from '../modules/monitor/ConsoleMonitor.js';
import { Deobfuscator } from '../modules/deobfuscator/Deobfuscator.js';
import { AdvancedDeobfuscator } from '../modules/deobfuscator/AdvancedDeobfuscator.js';
import { ASTOptimizer } from '../modules/deobfuscator/ASTOptimizer.js';
import { ObfuscationDetector } from '../modules/detector/ObfuscationDetector.js';
import { LLMService } from '../services/LLMService.js';
import { CodeAnalyzer } from '../modules/analyzer/CodeAnalyzer.js';
import { CryptoDetector } from '../modules/crypto/CryptoDetector.js';
import { HookManager } from '../modules/hook/HookManager.js';
import { logger } from '../utils/logger.js';
import { getToolDomain, type ToolDomain } from './ToolCatalog.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BrowserToolHandlers } from './domains/browser/index.js';
import { DebuggerToolHandlers } from './domains/debugger/index.js';
import { AdvancedToolHandlers } from './domains/network/index.js';
import { AIHookToolHandlers, HookPresetToolHandlers } from './domains/hooks/index.js';
import { CoreAnalysisHandlers } from './domains/analysis/index.js';
import { CoreMaintenanceHandlers } from './domains/maintenance/index.js';
import { ProcessToolHandlers } from './domains/process/index.js';
import { WorkflowHandlers } from './domains/workflow/index.js';
import { WasmToolHandlers } from './domains/wasm/index.js';
import { StreamingToolHandlers } from './domains/streaming/index.js';
import { EncodingToolHandlers } from './domains/encoding/index.js';
import { AntiDebugToolHandlers } from './domains/antidebug/index.js';
import { GraphQLToolHandlers } from './domains/graphql/index.js';
import { PlatformToolHandlers } from './domains/platform/index.js';
import { SourcemapToolHandlers } from './domains/sourcemap/index.js';
import { TransformToolHandlers } from './domains/transform/index.js';
import type { MCPServerContext } from './MCPServer.context.js';

export function resolveEnabledDomains(tools: Tool[]): Set<ToolDomain> {
  const domains = new Set<ToolDomain>();
  for (const tool of tools) {
    const domain = getToolDomain(tool.name);
    if (domain) {
      domains.add(domain);
    }
  }
  return domains;
}

export function createDomainProxy<T extends object>(
  ctx: MCPServerContext,
  domain: ToolDomain,
  label: string,
  factory: () => T
): T {
  let instance: T | undefined;
  return new Proxy({} as T, {
    get: (_target, prop) => {
      if (!ctx.enabledDomains.has(domain)) {
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

      const value = Reflect.get(instance as object, prop);
      return typeof value === 'function' ? value.bind(instance) : value;
    },
  });
}

export function ensureCollector(ctx: MCPServerContext): CodeCollector {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  return ctx.collector;
}

export function ensurePageController(ctx: MCPServerContext): PageController {
  if (!ctx.pageController) {
    ctx.pageController = new PageController(ensureCollector(ctx));
  }
  return ctx.pageController;
}

export function ensureDOMInspector(ctx: MCPServerContext): DOMInspector {
  if (!ctx.domInspector) {
    ctx.domInspector = new DOMInspector(ensureCollector(ctx));
  }
  return ctx.domInspector;
}

export function ensureScriptManager(ctx: MCPServerContext): ScriptManager {
  if (!ctx.scriptManager) {
    ctx.scriptManager = new ScriptManager(ensureCollector(ctx));
  }
  return ctx.scriptManager;
}

export function ensureDebuggerManager(ctx: MCPServerContext): DebuggerManager {
  if (!ctx.debuggerManager) {
    ctx.debuggerManager = new DebuggerManager(ensureCollector(ctx));
  }
  return ctx.debuggerManager;
}

export function ensureRuntimeInspector(ctx: MCPServerContext): RuntimeInspector {
  if (!ctx.runtimeInspector) {
    ctx.runtimeInspector = new RuntimeInspector(ensureCollector(ctx), ensureDebuggerManager(ctx));
  }
  return ctx.runtimeInspector;
}

export function ensureConsoleMonitor(ctx: MCPServerContext): ConsoleMonitor {
  if (!ctx.consoleMonitor) {
    ctx.consoleMonitor = new ConsoleMonitor(ensureCollector(ctx));
  }
  return ctx.consoleMonitor;
}

export function ensureLLM(ctx: MCPServerContext): LLMService {
  if (!ctx.llm) {
    ctx.llm = new LLMService(ctx.config.llm);
  }
  return ctx.llm;
}

export function ensureBrowserHandlers(ctx: MCPServerContext): BrowserToolHandlers {
  if (!ctx.browserHandlers) {
    ctx.browserHandlers = new BrowserToolHandlers(
      ensureCollector(ctx),
      ensurePageController(ctx),
      ensureDOMInspector(ctx),
      ensureScriptManager(ctx),
      ensureConsoleMonitor(ctx),
      ensureLLM(ctx)
    );
  }
  return ctx.browserHandlers;
}

export function ensureDebuggerHandlers(ctx: MCPServerContext): DebuggerToolHandlers {
  if (!ctx.debuggerHandlers) {
    ctx.debuggerHandlers = new DebuggerToolHandlers(ensureDebuggerManager(ctx), ensureRuntimeInspector(ctx));
  }
  return ctx.debuggerHandlers;
}

export function ensureAdvancedHandlers(ctx: MCPServerContext): AdvancedToolHandlers {
  if (!ctx.advancedHandlers) {
    ctx.advancedHandlers = new AdvancedToolHandlers(ensureCollector(ctx), ensureConsoleMonitor(ctx));
  }
  return ctx.advancedHandlers;
}

export function ensureAIHookHandlers(ctx: MCPServerContext): AIHookToolHandlers {
  if (!ctx.aiHookHandlers) {
    ctx.aiHookHandlers = new AIHookToolHandlers(ensurePageController(ctx));
  }
  return ctx.aiHookHandlers;
}

export function ensureHookPresetHandlers(ctx: MCPServerContext): HookPresetToolHandlers {
  if (!ctx.hookPresetHandlers) {
    ctx.hookPresetHandlers = new HookPresetToolHandlers(ensurePageController(ctx));
  }
  return ctx.hookPresetHandlers;
}

export function ensureCoreAnalysisHandlers(ctx: MCPServerContext): CoreAnalysisHandlers {
  if (!ctx.deobfuscator) {
    ctx.deobfuscator = new Deobfuscator(ensureLLM(ctx));
  }
  if (!ctx.advancedDeobfuscator) {
    ctx.advancedDeobfuscator = new AdvancedDeobfuscator(ensureLLM(ctx));
  }
  if (!ctx.astOptimizer) {
    ctx.astOptimizer = new ASTOptimizer();
  }
  if (!ctx.obfuscationDetector) {
    ctx.obfuscationDetector = new ObfuscationDetector();
  }
  if (!ctx.analyzer) {
    ctx.analyzer = new CodeAnalyzer(ensureLLM(ctx));
  }
  if (!ctx.cryptoDetector) {
    ctx.cryptoDetector = new CryptoDetector(ensureLLM(ctx));
  }
  if (!ctx.hookManager) {
    ctx.hookManager = new HookManager();
  }
  if (!ctx.coreAnalysisHandlers) {
    ctx.coreAnalysisHandlers = new CoreAnalysisHandlers({
      collector: ensureCollector(ctx),
      scriptManager: ensureScriptManager(ctx),
      deobfuscator: ctx.deobfuscator,
      advancedDeobfuscator: ctx.advancedDeobfuscator,
      astOptimizer: ctx.astOptimizer,
      obfuscationDetector: ctx.obfuscationDetector,
      analyzer: ctx.analyzer,
      cryptoDetector: ctx.cryptoDetector,
      hookManager: ctx.hookManager,
    });
  }
  return ctx.coreAnalysisHandlers;
}

export function ensureCoreMaintenanceHandlers(ctx: MCPServerContext): CoreMaintenanceHandlers {
  if (!ctx.coreMaintenanceHandlers) {
    ctx.coreMaintenanceHandlers = new CoreMaintenanceHandlers({
      tokenBudget: ctx.tokenBudget,
      unifiedCache: ctx.unifiedCache,
    });
  }
  return ctx.coreMaintenanceHandlers;
}

export function ensureProcessHandlers(ctx: MCPServerContext): ProcessToolHandlers {
  if (!ctx.processHandlers) {
    ctx.processHandlers = new ProcessToolHandlers();
  }
  return ctx.processHandlers;
}

export function ensureWorkflowHandlers(ctx: MCPServerContext): WorkflowHandlers {
  if (!ctx.workflowHandlers) {
    ctx.workflowHandlers = new WorkflowHandlers({
      browserHandlers: ensureBrowserHandlers(ctx),
      advancedHandlers: ensureAdvancedHandlers(ctx),
    });
  }
  return ctx.workflowHandlers;
}

export function ensureWasmHandlers(ctx: MCPServerContext): WasmToolHandlers {
  if (!ctx.wasmHandlers) {
    ctx.wasmHandlers = new WasmToolHandlers(ensureCollector(ctx));
  }
  return ctx.wasmHandlers;
}

export function ensureStreamingHandlers(ctx: MCPServerContext): StreamingToolHandlers {
  if (!ctx.streamingHandlers) {
    ctx.streamingHandlers = new StreamingToolHandlers(ensureCollector(ctx));
  }
  return ctx.streamingHandlers;
}

export function ensureEncodingHandlers(ctx: MCPServerContext): EncodingToolHandlers {
  if (!ctx.encodingHandlers) {
    ctx.encodingHandlers = new EncodingToolHandlers(ensureCollector(ctx));
  }
  return ctx.encodingHandlers;
}

export function ensureAntiDebugHandlers(ctx: MCPServerContext): AntiDebugToolHandlers {
  if (!ctx.antidebugHandlers) {
    ctx.antidebugHandlers = new AntiDebugToolHandlers(ensureCollector(ctx));
  }
  return ctx.antidebugHandlers;
}

export function ensureGraphQLHandlers(ctx: MCPServerContext): GraphQLToolHandlers {
  if (!ctx.graphqlHandlers) {
    ctx.graphqlHandlers = new GraphQLToolHandlers(ensureCollector(ctx));
  }
  return ctx.graphqlHandlers;
}

export function ensurePlatformHandlers(ctx: MCPServerContext): PlatformToolHandlers {
  if (!ctx.platformHandlers) {
    ctx.platformHandlers = new PlatformToolHandlers(ensureCollector(ctx));
  }
  return ctx.platformHandlers;
}

export function ensureSourcemapHandlers(ctx: MCPServerContext): SourcemapToolHandlers {
  if (!ctx.sourcemapHandlers) {
    ctx.sourcemapHandlers = new SourcemapToolHandlers(ensureCollector(ctx));
  }
  return ctx.sourcemapHandlers;
}

export function ensureTransformHandlers(ctx: MCPServerContext): TransformToolHandlers {
  if (!ctx.transformHandlers) {
    ctx.transformHandlers = new TransformToolHandlers(ensureCollector(ctx));
  }
  return ctx.transformHandlers;
}
