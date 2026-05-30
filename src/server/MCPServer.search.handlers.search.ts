/**
 * Handler for the search_tools meta-tool.
 *
 * Includes BM25 search, auto-activation of top results with TTL,
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
import { activateToolNames } from '@server/MCPServer.search.handlers.activate';
import { ACTIVATION_TTL_MINUTES, SEARCH_AUTO_ACTIVATE_DOMAINS } from '@src/constants';
import { getAllKnownDomains } from '@server/registry/index';

export async function handleSearchTools(
  ctx: MCPServerContext,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const query = args.query as string;
  const topK = (args.top_k as number | undefined) ?? 10;
  // Allow opt-out via top_k=0 or explicit flag
  const autoActivate = (args.auto_activate as boolean | undefined) ?? true;

  const searchStart = performance.now();
  const engine = await getSearchEngine(ctx);
  const activeNames = getActiveToolNames(ctx);
  const visibleDomains = getVisibleDomainsForTier(ctx);
  const results = await engine.search(query, topK, activeNames, visibleDomains, getBaseTier(ctx));
  const latencyMs = Math.round(performance.now() - searchStart);

  ctx.mcpLog.info('jshookmcp', {
    event: 'search_executed',
    query,
    resultCount: results.length,
    latencyMs,
  });

  // Auto-activate top inactive results so they are immediately usable.
  if (autoActivate && topK > 0 && SEARCH_AUTO_ACTIVATE_DOMAINS) {
    const inactiveResults = results.filter((r) => !r.isActive);
    if (inactiveResults.length > 0) {
      // Collect unique domains from inactive results
      const domainsToActivate = new Set<string>();
      const toolsWithoutDomain: string[] = [];

      for (const r of inactiveResults) {
        if (r.domain && !ctx.enabledDomains.has(r.domain)) {
          domainsToActivate.add(r.domain);
        } else if (!r.domain) {
          toolsWithoutDomain.push(r.name);
        }
      }

      // Activate entire domains with TTL
      const { handleActivateDomain } = await import('@server/MCPServer.search.handlers.domain');
      for (const domain of domainsToActivate) {
        try {
          await handleActivateDomain(ctx, { domain, ttlMinutes: ACTIVATION_TTL_MINUTES });
        } catch {
          /* fall through to individual activation */
        }
      }

      // Activate tools without a domain or that belong to already-enabled domains
      const domainsEnabledSet = new Set(domainsToActivate);
      const remainingInactive = inactiveResults
        .filter((r) => !domainsEnabledSet.has(r.domain ?? ''))
        .map((r) => r.name);
      const names = [...new Set([...remainingInactive, ...toolsWithoutDomain])];
      if (names.length > 0) {
        await activateToolNames(ctx, names);
      }
    } else if (results.length === 0) {
      // No results at all — try fuzzy domain name matching from query tokens
      const queryLower = query.toLowerCase();
      const queryTokens = queryLower.split(/[\s\-_.,;:|/(){}[\]]+/).filter((t) => t.length >= 2);
      const allDomains = [...getAllKnownDomains()];
      const matchedDomains = allDomains.filter((d) =>
        queryTokens.some(
          (t) =>
            d.includes(t) || t.includes(d.replace(/-/g, '')) || d.replace(/-/g, '').includes(t),
        ),
      );

      if (matchedDomains.length > 0) {
        const { handleActivateDomain } = await import('@server/MCPServer.search.handlers.domain');
        for (const domain of matchedDomains) {
          try {
            await handleActivateDomain(ctx, { domain, ttlMinutes: ACTIVATION_TTL_MINUTES });
          } catch {
            /* fall through */
          }
        }
        // Re-run search after domain activation to pick up newly available tools
        const activeNamesAfter = getActiveToolNames(ctx);
        const visibleDomainsAfter = getVisibleDomainsForTier(ctx);
        const retryResults = await engine.search(
          query,
          topK,
          activeNamesAfter,
          visibleDomainsAfter,
          getBaseTier(ctx),
        );
        if (retryResults.length > 0) {
          return retryResults;
        }
      }
    }
  }

  // Refresh activeNames to reflect post-activation state for response accuracy
  const postActivationActiveNames = autoActivate ? getActiveToolNames(ctx) : activeNames;

  // Build nextActions for top result(s) — tools are now activated if autoActivate=true
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
    if (postActivationActiveNames.has(topResult.name)) {
      // Tool is now active — can be called directly
      searchNextActions.push({
        step: 1,
        action: 'call',
        command: topResult.name,
        exampleArgs: topExampleArgs,
        description:
          `Call ${topResult.name} directly. Use describe_tool("${topResult.name}") only if you ` +
          `need the full schema.`,
      });
    } else {
      // Not activated (autoActivate=false or tool not found)
      searchNextActions.push({
        step: 1,
        action: 'activate_tools',
        command: `activate_tools({ names: ["${topResult.name}"] })`,
        description: `Activate ${topResult.name} before calling.`,
      });
      searchNextActions.push({
        step: 2,
        action: 'call',
        command: topResult.name,
        exampleArgs: topExampleArgs,
        description: `Call ${topResult.name}. Use describe_tool("${topResult.name}") only if you need the full schema.`,
      });
    }
  }

  const baseHint =
    'For guided tool discovery with workflow detection, use route_tool instead. ' +
    'Tools are auto-activated. If a tool does not appear in your tool list, use call_tool({ name: "<tool>", args: {...} }) to invoke it directly.';
  const refinementHint =
    results.length < 3
      ? ' Few results — try distilling your query to key concepts (e.g. "hook fetch" instead of "how to intercept ' +
        'fetch requests").'
      : '';

  // Update isActive flags in results to reflect post-activation state
  const resultsWithActiveState = results.map((r) => ({
    ...r,
    isActive: postActivationActiveNames.has(r.name) ? true : r.isActive,
  }));

  const response: Record<string, unknown> = {
    query,
    resultCount: results.length,
    results: resultsWithActiveState,
    nextActions: searchNextActions,
    hint: baseHint + refinementHint,
    autoActivated:
      autoActivate && results.some((r) => !r.isActive && postActivationActiveNames.has(r.name)),
  };

  let responseText = JSON.stringify(response, null, 2);

  const suggestions = engine
    .getSearchQualityTracker()
    .getEnhancementSuggestions(query, results.length, results[0]?.score ?? 0);
  if (suggestions && suggestions.length > 0) {
    responseText += `\n\n---\n**Search Enhancement Suggestions:**\n${suggestions.map((s) => `- ${s}`).join('\n')}`;
  }

  return asTextResponse(responseText);
}
