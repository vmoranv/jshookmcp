/**
 * Handler for the search_tools meta-tool.
 *
 * Includes BM25 search, domain auto-activation with TTL,
 * and nextActions guidance.
 */
import { asTextResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import {
  getActiveToolNames,
  getSearchEngine,
  getVisibleDomainsForTier,
  getBaseTier,
} from '@server/MCPServer.search.helpers';
import { describeTool, generateExampleArgs } from '@server/ToolRouter';

export async function handleSearchTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const query = args.query as string;
  const topK = (args.top_k as number | undefined) ?? 10;

  const engine = getSearchEngine(ctx);
  const activeNames = getActiveToolNames(ctx);
  const visibleDomains = getVisibleDomainsForTier(ctx);
  const results = await engine.search(query, topK, activeNames, visibleDomains, getBaseTier(ctx));

  // SECURITY: Domain auto-activation is disabled for safety.
  // Auto-activation bypassed tier guardrails and could escalate privileges.
  // Users must explicitly activate domains via activate_domain.

  // Build nextActions for top result(s)
  const topResult = results[0];
  const topTool = topResult ? describeTool(topResult.name, ctx) : null;
  const topExampleArgs = topTool ? generateExampleArgs(topTool.inputSchema) : undefined;
  const searchNextActions: Array<{
    step: number;
    action: string;
    command: string;
    description: string;
    exampleArgs?: Record<string, unknown>;
  }> = [];

  if (topResult) {
    if (!topResult.isActive) {
      const activateNames = results
        .filter((r) => !r.isActive)
        .slice(0, 3)
        .map((r) => r.name);
      searchNextActions.push({
        step: 1,
        action: 'activate_tools',
        command: `activate_tools with names: [${activateNames.map((n) => `"${n}"`).join(', ')}]`,
        description: `Activate top ${activateNames.length} result(s)`,
      });
      searchNextActions.push({
        step: 2,
        action: 'call',
        command: topResult.name,
        exampleArgs: topExampleArgs,
        description: `Call ${topResult.name}. Use describe_tool("${topResult.name}") only if you need the full schema.`,
      });
    } else {
      searchNextActions.push({
        step: 1,
        action: 'call',
        command: topResult.name,
        exampleArgs: topExampleArgs,
        description: `Call ${topResult.name} directly. Use describe_tool("${topResult.name}") only if you need the full schema.`,
      });
    }
  }

  const response: Record<string, unknown> = {
    query,
    resultCount: results.length,
    results,
    nextActions: searchNextActions,
    hint:
      'For guided tool discovery with workflow detection, use route_tool instead. ' +
      'Use activate_tools to enable specific tools, activate_domain for entire domains.',
  };

  // Auto-activation metadata removed — feature disabled for security.

  return asTextResponse(JSON.stringify(response, null, 2));
}
