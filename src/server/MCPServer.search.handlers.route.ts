/**
 * Handlers for route_tool and describe_tool meta-tools.
 */
import { asTextResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { routeToolRequest, describeTool } from '@server/ToolRouter';
import { getSearchEngine } from '@server/MCPServer.search.helpers';

/* ---------- route_tool handler ---------- */

export async function handleRouteTool(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const task = args.task as string;
  const context = args.context as {
    preferredDomain?: string;
    autoActivate?: boolean;
    maxRecommendations?: number;
  } | undefined;

  if (!task || typeof task !== 'string') {
    return asTextResponse(JSON.stringify({ success: false, error: 'task must be a non-empty string' }));
  }

  const engine = getSearchEngine(ctx);
  const response = await routeToolRequest({ task, context }, ctx, engine);

  return asTextResponse(JSON.stringify(response, null, 2));
}

/* ---------- describe_tool handler ---------- */

export async function handleDescribeTool(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const name = args.name as string;

  if (!name || typeof name !== 'string') {
    return asTextResponse(JSON.stringify({ success: false, error: 'name must be a non-empty string' }));
  }

  const toolInfo = describeTool(name, ctx);

  if (!toolInfo) {
    return asTextResponse(JSON.stringify({ success: false, error: `Tool not found: ${name}` }));
  }

  return asTextResponse(JSON.stringify({ success: true, tool: toolInfo }, null, 2));
}
