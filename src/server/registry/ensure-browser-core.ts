/**
 * Shared browser-core initialization helper.
 *
 * Centralizes the lazy initialization of CodeCollector, PageController,
 * DOMInspector, ScriptManager, ConsoleMonitor, and LLMService that was
 * previously duplicated across browser, workflow, hooks, and other manifests.
 *
 * Usage in manifest ensure():
 *   import { ensureBrowserCore } from '../../registry/ensure-browser-core.js';
 *   function ensure(ctx: MCPServerContext): MyHandlers {
 *     ensureBrowserCore(ctx);
 *     // ctx.collector, ctx.pageController, etc. are now guaranteed to exist
 *     ...
 *   }
 */
import type { MCPServerContext } from '../MCPServer.context.js';
import { CodeCollector } from '../../modules/collector/CodeCollector.js';
import { PageController } from '../../modules/collector/PageController.js';
import { DOMInspector } from '../../modules/collector/DOMInspector.js';
import { ScriptManager } from '../../modules/debugger/ScriptManager.js';
import { ConsoleMonitor } from '../../modules/monitor/ConsoleMonitor.js';
import { LLMService } from '../../services/LLMService.js';

/**
 * Ensure all browser-core dependencies are initialized on the context.
 * Safe to call multiple times — only initializes each dependency once.
 */
export function ensureBrowserCore(ctx: MCPServerContext): void {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.pageController) ctx.pageController = new PageController(ctx.collector);
  if (!ctx.domInspector) ctx.domInspector = new DOMInspector(ctx.collector);
  if (!ctx.scriptManager) ctx.scriptManager = new ScriptManager(ctx.collector);
  if (!ctx.consoleMonitor) ctx.consoleMonitor = new ConsoleMonitor(ctx.collector);
  if (!ctx.llm) ctx.llm = new LLMService(ctx.config.llm);
}
