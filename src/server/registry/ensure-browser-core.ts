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
import {
  SessionScopedResourcePool,
  sessionResourcePoolOptions,
} from '@server/runtime/SessionScopedResourcePool';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';

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
  if (typeof ctx.collector.setSessionIdResolver === 'function') {
    ctx.collector.setSessionIdResolver(() => getToolRequestContext()?.sessionId);
  }
  if (!ctx.pageController) ctx.pageController = new PageController(ctx.collector);
  if (!ctx.domInspector) ctx.domInspector = new DOMInspector(ctx.collector);
  if (!ctx.scriptManager) {
    if (typeof ctx.setDomainInstance === 'function') {
      const pool = new SessionScopedResourcePool(
        () => new ScriptManager(ctx.collector!),
        async (manager) => await manager.close(),
        sessionResourcePoolOptions(ctx.config?.mcp),
      );
      ctx.setDomainInstance('sessionScriptManagerPool', pool);
      ctx.scriptManager = pool.getProxy();
    } else {
      ctx.scriptManager = new ScriptManager(ctx.collector);
    }
  }
  if (!ctx.consoleMonitor) {
    const CM = await getConsoleMonitorClass();
    // The dynamic import yields: a concurrent ensureBrowserCore() may have
    // installed the pool while we waited. Re-check before overwriting — the
    // synchronous segment below has no further awaits, so the second caller
    // observes the first caller's write and returns.
    if (ctx.consoleMonitor) return;
    if (typeof ctx.setDomainInstance === 'function') {
      const pool = new SessionScopedResourcePool(
        () => new CM(ctx.collector!),
        async (monitor) => await monitor.close(),
        sessionResourcePoolOptions(ctx.config?.mcp),
      );
      ctx.setDomainInstance('sessionConsoleMonitorPool', pool);
      ctx.consoleMonitor = pool.getProxy();
    } else {
      ctx.consoleMonitor = new CM(ctx.collector);
    }
  }
}
