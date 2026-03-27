/**
 * Shared browser-core initialization helper.
 *
 * Centralizes the lazy initialization of CodeCollector, PageController,
 * DOMInspector, ScriptManager, and ConsoleMonitor that was
 * previously duplicated across browser, workflow, hooks, and other manifests.
 *
 * Usage in manifest ensure():
 *   import { ensureBrowserCore } from '@server/registry/ensure-browser-core';
 *   function ensure(ctx: MCPServerContext): MyHandlers {
 *     ensureBrowserCore(ctx);
 *     // ctx.collector, ctx.pageController, etc. are now guaranteed to exist
 *     ...
 *   }
 */
import type { MCPServerContext } from '@server/MCPServer.context';
import { CodeCollector } from '@modules/collector/CodeCollector';
import { PageController } from '@modules/collector/PageController';
import { DOMInspector } from '@modules/collector/DOMInspector';
import { ScriptManager } from '@modules/debugger/ScriptManager';
import { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor';

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
}
