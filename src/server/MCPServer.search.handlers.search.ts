/**
 * Handler for the search_tools meta-tool.
 *
 * Includes BM25 search, dynamic boost with transparent metadata,
 * and nextActions guidance.
 */
import { logger } from '@utils/logger';
import { asTextResponse } from '@server/domains/shared/response';
import { getTierIndex } from '@server/ToolCatalog';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { ToolResponse } from '@server/types';
import {
  DYNAMIC_BOOST_ENABLED,
  DYNAMIC_BOOST_RERESEARCH_AFTER_BOOST,
} from '@src/constants';
import {
  analyzeSearchResultTiers,
  silentBoostToTierWithRetry,
  backfillIsActive,
  validateBoostGuardrails,
} from '@server/MCPServer.search.dynamicBoost';
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

  // Dynamic boost with transparent metadata
  let preBoostResults: typeof results | null = null;
  let boostMetadata: { from: string; to: string; reason: string; reSearched: boolean } | null = null;

  if (DYNAMIC_BOOST_ENABLED && results.length > 0) {
    const analysis = analyzeSearchResultTiers(ctx, results, activeNames, {
      scoreThreshold: 0.6,
      minCandidates: 3,
    });

    if (analysis.targetTier) {
      const guardrail = validateBoostGuardrails(ctx.currentTier, analysis.targetTier);

      if (!guardrail.allowed) {
        logger.info(
          `[dynamic-boost] Boost blocked by guardrail: ${guardrail.reason}`
        );
      } else {
        const actualTargetTier = guardrail.adjustedTier ?? analysis.targetTier;
        const targetIdx = getTierIndex(actualTargetTier);
        const currentIdx = getTierIndex(ctx.currentTier);

        if (targetIdx > currentIdx) {
          try {
            let finalResults = results;

            if (DYNAMIC_BOOST_RERESEARCH_AFTER_BOOST) {
              preBoostResults = [...results];
            }

            const { success, attempts } = await silentBoostToTierWithRetry(
              ctx,
              actualTargetTier,
              { maxAttempts: 3, initialDelay: 30, exponentialBackoff: true }
            );

            if (success) {
              const fromTier = ctx.currentTier;
              const newActiveNames = getActiveToolNames(ctx);
              backfillIsActive(results, newActiveNames);

              if (DYNAMIC_BOOST_RERESEARCH_AFTER_BOOST) {
                finalResults = engine.search(query, topK, newActiveNames);
                backfillIsActive(finalResults, newActiveNames);
                results = finalResults;
              }

              boostMetadata = {
                from: fromTier,
                to: actualTargetTier,
                reason: guardrail.adjustedTier
                  ? `adjusted from ${analysis.targetTier}: ${guardrail.reason}`
                  : `${analysis.considered.length} candidates, tier distribution: ${JSON.stringify(analysis.tierCounts)}`,
                reSearched: DYNAMIC_BOOST_RERESEARCH_AFTER_BOOST,
              };

              logger.info(
                `[dynamic-boost] Boosted ${boostMetadata.from} → ${boostMetadata.to} ` +
                `(${attempts} attempt(s), reSearched=${boostMetadata.reSearched})`
              );
            } else {
              logger.warn(
                `[dynamic-boost] Failed to boost to ${actualTargetTier} after ${attempts} attempt(s)`
              );
            }
          } catch (error) {
            logger.error('[dynamic-boost] Unexpected error during boost:', error);
          }
        }
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

  // Include boost transparency metadata
  if (boostMetadata) {
    response.dynamicBoost = boostMetadata;
    if (!boostMetadata.reSearched) {
      response.boostHint = 'Tier was upgraded. Re-run search_tools to see updated rankings with newly available tools.';
    }
  }

  if (DYNAMIC_BOOST_RERESEARCH_AFTER_BOOST && preBoostResults !== null) {
    response.preBoostResults = preBoostResults;
  }

  return asTextResponse(JSON.stringify(response, null, 2));
}
