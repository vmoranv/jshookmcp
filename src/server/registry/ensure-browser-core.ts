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

let ConsoleMonitorClass: typeof import('@modules/monitor/ConsoleMonitor').ConsoleMonitor | null =
  null;

async function getConsoleMonitorClass() {
  if (!ConsoleMonitorClass) {
    const mod = await import('@modules/monitor/ConsoleMonitor');
    ConsoleMonitorClass = mod.ConsoleMonitor;
  }
  return ConsoleMonitorClass;
}

export async function ensureBrowserCore(ctx: MCPServerContext): Promise<void> {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.pageController) ctx.pageController = new PageController(ctx.collector);
  if (!ctx.domInspector) ctx.domInspector = new DOMInspector(ctx.collector);
  if (!ctx.scriptManager) ctx.scriptManager = new ScriptManager(ctx.collector);
  if (!ctx.consoleMonitor) {
    const CM = await getConsoleMonitorClass();
    ctx.consoleMonitor = new CM(ctx.collector);
  }
}
