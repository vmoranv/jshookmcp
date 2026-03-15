/**
 * Handler for the search_tools meta-tool.
 *
 * Includes BM25 search, domain auto-activation with TTL,
 * and nextActions guidance.
 */
import { logger } from '@utils/logger';
import { asTextResponse } from '@server/domains/shared/response';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import {
  SEARCH_AUTO_ACTIVATE_DOMAINS,
  ACTIVATION_TTL_MINUTES,
} from '@src/constants';
import { handleActivateDomain } from '@server/MCPServer.search.handlers.domain';
import {
  getSearchEngine,
  getActiveToolNames,
} from '@server/MCPServer.search.helpers';
import { describeTool, generateExampleArgs } from '@server/ToolRouter';

export async function handleSearchTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>
): Promise<ToolResponse> {
  const query = args.query as string;
  const topK = (args.top_k as number | undefined) ?? 10;

  const engine = getSearchEngine(ctx);
  const activeNames = getActiveToolNames(ctx);
  let results = engine.search(query, topK, activeNames);

  // Domain auto-activation: activate domains of top inactive results
  let autoActivatedDomains: string[] | null = null;

  if (SEARCH_AUTO_ACTIVATE_DOMAINS && results.length > 0) {
    // Collect domains of inactive results
    const inactiveDomains = new Set<string>();
    for (const result of results) {
      if (!activeNames.has(result.name) && result.domain) {
        inactiveDomains.add(result.domain);
      }
    }

    // Filter out already-enabled domains
    const domainsToActivate: string[] = [];
    for (const domain of inactiveDomains) {
      if (!ctx.enabledDomains.has(domain)) {
        domainsToActivate.push(domain);
      }
    }

    if (domainsToActivate.length > 0) {
      autoActivatedDomains = [];
      for (const domain of domainsToActivate) {
        try {
          await handleActivateDomain(ctx, {
            domain,
            ttlMinutes: ACTIVATION_TTL_MINUTES,
          });
          autoActivatedDomains.push(domain);
          logger.info(
            `[search-auto-activate] Activated domain "${domain}" with TTL=${ACTIVATION_TTL_MINUTES}min`,
          );
        } catch (error) {
          logger.warn(`[search-auto-activate] Failed to activate domain "${domain}":`, error);
        }
      }

      if (autoActivatedDomains.length > 0) {
        // Re-search with updated active tools
        const newActiveNames = getActiveToolNames(ctx);
        results = engine.search(query, topK, newActiveNames);
      }
    }
  }

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
        .filter(r => !r.isActive)
        .slice(0, 3)
        .map(r => r.name);
      searchNextActions.push({
        step: 1,
        action: 'activate_tools',
        command: `activate_tools with names: [${activateNames.map(n => `"${n}"`).join(', ')}]`,
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

  // Include auto-activation metadata
  if (autoActivatedDomains && autoActivatedDomains.length > 0) {
    response.autoActivatedDomains = autoActivatedDomains;
  }

  return asTextResponse(JSON.stringify(response, null, 2));
}
