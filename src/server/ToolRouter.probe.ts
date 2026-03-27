/**
 * ToolRouter.probe - Runtime state probing and tool accessors.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerContext } from '@server/MCPServer.context';
import { allTools, getToolDomain } from '@server/ToolCatalog';
import { normalizeToolName } from '@server/MCPServer.search.validation';

// ── Routing State Type ──

export interface RoutingState {
  hasActivePage: boolean;
  networkEnabled: boolean;
  capturedRequestCount: number;
}

// ── Lazy Tool Index ──

let _allToolsByName: Map<string, Tool> | null = null;

export function getAllToolsByName(): Map<string, Tool> {
  if (!_allToolsByName) _allToolsByName = new Map(allTools.map((t) => [t.name, t]));
  return _allToolsByName;
}

// ── Tool Accessors ──

export function getToolInputSchema(
  toolName: string,
  ctx: MCPServerContext,
): Tool['inputSchema'] | undefined {
  const canonicalName = normalizeToolName(toolName);

  const builtInTool = getAllToolsByName().get(canonicalName);
  if (builtInTool) {
    return builtInTool.inputSchema;
  }

  const extTool = ctx.extensionToolsByName.get(canonicalName);
  if (extTool) {
    return extTool.tool.inputSchema;
  }

  const metaTool = ctx.metaToolsByName.get(canonicalName);
  if (metaTool) {
    return metaTool.inputSchema;
  }

  return undefined;
}

export function getToolDescription(toolName: string, ctx: MCPServerContext): string {
  const canonicalName = normalizeToolName(toolName);

  const builtInTool = getAllToolsByName().get(canonicalName);
  if (builtInTool?.description) {
    return builtInTool.description.split('\n')[0] || 'No description available';
  }

  const extTool = ctx.extensionToolsByName.get(canonicalName);
  if (extTool?.tool?.description) {
    return extTool.tool.description.split('\n')[0] || 'No description available';
  }

  const metaTool = ctx.metaToolsByName.get(canonicalName);
  if (metaTool?.description) {
    return metaTool.description.split('\n')[0] || 'No description available';
  }

  return 'No description available';
}

export function isToolActive(toolName: string, ctx: MCPServerContext): boolean {
  const canonicalName = normalizeToolName(toolName);
  const activeTools = new Set([
    ...ctx.selectedTools.map((tool) => tool.name),
    ...ctx.activatedToolNames,
  ]);
  return activeTools.has(canonicalName);
}

export function getAvailableToolNames(ctx: MCPServerContext): Set<string> {
  return new Set([...allTools.map((tool) => tool.name), ...ctx.extensionToolsByName.keys()]);
}

export function getToolDomainFromContext(toolName: string, ctx: MCPServerContext): string | null {
  return getToolDomain(toolName) ?? ctx.extensionToolsByName.get(toolName)?.domain ?? null;
}

// ── Runtime State Probing ──

export async function probeActivePage(ctx: MCPServerContext): Promise<boolean> {
  if (!ctx.pageController || typeof ctx.pageController.getPage !== 'function') return false;
  try {
    return Boolean(await ctx.pageController.getPage());
  } catch {
    return false;
  }
}

export function probeNetworkEnabled(ctx: MCPServerContext): boolean {
  if (!ctx.consoleMonitor) return false;
  try {
    if (typeof ctx.consoleMonitor.getNetworkStatus === 'function') {
      return Boolean(ctx.consoleMonitor.getNetworkStatus().enabled);
    }
    if (typeof ctx.consoleMonitor.isNetworkEnabled === 'function') {
      return Boolean(ctx.consoleMonitor.isNetworkEnabled());
    }
  } catch {
    /* probe failure → not enabled */
  }
  return false;
}

export function probeCapturedRequests(ctx: MCPServerContext): number {
  if (!ctx.consoleMonitor || typeof ctx.consoleMonitor.getNetworkRequests !== 'function') return 0;
  try {
    const requests = ctx.consoleMonitor.getNetworkRequests({ limit: 1 });
    return Array.isArray(requests) ? requests.length : 0;
  } catch {
    try {
      const requests = ctx.consoleMonitor.getNetworkRequests();
      return Array.isArray(requests) ? requests.length : 0;
    } catch {
      return 0;
    }
  }
}

export async function getRoutingState(ctx: MCPServerContext): Promise<RoutingState> {
  return {
    hasActivePage: await probeActivePage(ctx),
    networkEnabled: probeNetworkEnabled(ctx),
    capturedRequestCount: probeCapturedRequests(ctx),
  };
}
