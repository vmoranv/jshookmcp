/**
 * Handlers for route_tool and describe_tool meta-tools.
 */
import { asTextResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import { routeToolRequest, describeTool } from '@server/ToolRouter';
import { activateToolNames } from '@server/MCPServer.search.handlers.activate';
import { handleActivateDomain } from '@server/MCPServer.search.handlers.domain';
import { getSearchEngine } from '@server/MCPServer.search.helpers';
import { ACTIVATION_TTL_MINUTES } from '@src/constants';

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
  const autoActivate = context?.autoActivate !== false;
  let response = await routeToolRequest({ task, context }, ctx, engine);

  if (autoActivate) {
    const inactiveRecs = response.recommendations
      .filter((recommendation) => !recommendation.isActive);

    if (inactiveRecs.length > 0) {
      // Collect unique domains from inactive recommendations
      const domainsToActivate = new Set<string>();
      const toolsWithoutDomain: string[] = [];

      for (const rec of inactiveRecs) {
        if (rec.domain && !ctx.enabledDomains.has(rec.domain)) {
          domainsToActivate.add(rec.domain);
        } else if (!rec.domain) {
          toolsWithoutDomain.push(rec.name);
        }
      }

      let activated = false;

      // Activate entire domains with TTL
      for (const domain of domainsToActivate) {
        try {
          await handleActivateDomain(ctx, {
            domain,
            ttlMinutes: ACTIVATION_TTL_MINUTES,
          });
          activated = true;
        } catch {
          // Fall through to individual activation
        }
      }

      // For tools without a domain or already-enabled domains, activate individually
      const remainingInactive = inactiveRecs
        .filter((rec) => !domainsToActivate.has(rec.domain ?? ''))
        .map((rec) => rec.name);

      if (remainingInactive.length > 0 || toolsWithoutDomain.length > 0) {
        const names = [...new Set([...remainingInactive, ...toolsWithoutDomain])];
        const activation = await activateToolNames(ctx, names);
        if (activation.activated.length > 0) {
          activated = true;
        }
      }

      if (activated) {
        response = await routeToolRequest(
          { task, context: { ...context, autoActivate: false } },
          ctx,
          engine
        );
        response.autoActivated = true;
        response.activatedNames = inactiveRecs.map((r) => r.name)
          .filter((name) => ctx.activatedToolNames.has(name));
      }
    }
  }

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
