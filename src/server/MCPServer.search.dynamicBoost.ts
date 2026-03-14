/**
 * Silent dynamic boost logic for search_tools.
 *
 * Provides:
 * - Tier distribution analysis from search results
 * - Silent boost with retry mechanism
 * - isActive backfill after boost
 * - Configurable boost strategies: max, top1, majority, weighted
 * - Guardrails: skip search->full, max tier jump, optional re-search
 */
import { logger } from '@utils/logger';
import {
  getToolMinimalTier,
  getTierIndex,
  TIER_ORDER,
  type ToolProfile,
} from '@server/ToolCatalog';
import type { ToolProfileId } from '@server/registry/contracts';
import { boostProfile } from '@server/MCPServer.boost';
import type { MCPServerContext } from '@server/MCPServer.context';
import {
  DYNAMIC_BOOST_STRATEGY,
  DYNAMIC_BOOST_SKIP_SEARCH_TO_FULL,
  DYNAMIC_BOOST_MAX_JUMP,
  type DynamicBoostStrategy,
} from '@src/constants';

/* ---------- types ---------- */

export interface SearchResult {
  name: string;
  domain: string | null;
  score: number;
  isActive: boolean;
}

export interface AnalyzeOptions {
  /** Minimum score threshold as fraction of top result (default: 0.6) */
  scoreThreshold?: number;
  /** Minimum number of candidates to consider regardless of score (default: 3) */
  minCandidates?: number;
  /** Strategy for selecting target tier: max | top1 | majority | weighted (default: from config) */
  strategy?: DynamicBoostStrategy;
}

export interface RetryOptions {
  /** Maximum retry attempts (default: 3) */
  maxAttempts?: number;
  /** Initial delay in ms (default: 30) */
  initialDelay?: number;
  /** Use exponential backoff (default: true) */
  exponentialBackoff?: boolean;
}

export interface TierAnalysis {
  targetTier: ToolProfile | null;
  tierCounts: Record<ToolProfile, number>;
  considered: string[];
}

/* ---------- analysis ---------- */

/**
 * Analyze search results to determine minimal satisfying tier.
 *
 * @param ctx - Server context
 * @param results - Search results from engine
 * @param activeNames - Set of currently active tool names
 * @param opts - Analysis options
 * @returns Tier analysis with target tier and statistics
 */
export function analyzeSearchResultTiers(
  ctx: MCPServerContext,
  results: SearchResult[],
  activeNames: Set<string>,
  opts?: AnalyzeOptions
): TierAnalysis {
  if (results.length === 0) {
    return { targetTier: null, tierCounts: {} as Record<ToolProfile, number>, considered: [] };
  }

  const scoreThreshold = opts?.scoreThreshold ?? 0.6;
  const minCandidates = opts?.minCandidates ?? 3;
  const strategy = opts?.strategy ?? DYNAMIC_BOOST_STRATEGY;

  // Filter inactive tools
  const inactive = results.filter((r) => !activeNames.has(r.name));
  if (inactive.length === 0) {
    return { targetTier: null, tierCounts: {} as Record<ToolProfile, number>, considered: [] };
  }

  // Apply score threshold (relative to top result)
  const topScore = inactive[0]?.score ?? 0;
  const threshold = topScore * scoreThreshold;
  const candidates = inactive.filter((r, idx) => r.score >= threshold || idx < minCandidates);

  // Collect tier information with optional score weighting
  const tierCounts: Record<string, number> = { search: 0, workflow: 0, full: 0 };
  const tierScores: Record<string, number> = { search: 0, workflow: 0, full: 0 };
  const tierIndices: number[] = [];
  const considered: string[] = [];

  for (const tool of candidates) {
    // Extension tools with explicit boostTier take precedence
    const extRecord = ctx.extensionToolsByName.get(tool.name);
    if (extRecord?.boostTier) {
      const boostTier = extRecord.boostTier as ToolProfileId;
      const idx = getTierIndex(boostTier);
      if (idx >= 0) {
        tierIndices.push(idx);
        tierCounts[boostTier] = (tierCounts[boostTier] ?? 0) + 1;
        tierScores[boostTier] = (tierScores[boostTier] ?? 0) + tool.score;
        considered.push(tool.name);
        continue;
      }
    }

    // Built-in tools: use domain-based tier calculation
    const tier = getToolMinimalTier(tool.name);
    if (tier) {
      const idx = getTierIndex(tier);
      if (idx >= 0) {
        tierIndices.push(idx);
        tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
        tierScores[tier] = (tierScores[tier] ?? 0) + tool.score;
        considered.push(tool.name);
      }
    }
  }

  if (tierIndices.length === 0) {
    return { targetTier: null, tierCounts: tierCounts as Record<ToolProfile, number>, considered };
  }

  // Determine target tier based on strategy
  let maxTierIndex: number;

  switch (strategy) {
    case 'top1':
      // Use tier of only the top-scoring candidate
      maxTierIndex = tierIndices[0] ?? 0;
      break;

    case 'majority':
      // Use tier that covers majority of candidates (>= 50%)
      const totalCandidates = tierIndices.length;
      const majorityThreshold = totalCandidates / 2;
      let bestTierIndex = -1;
      let maxCount = 0;

      for (const [tier, count] of Object.entries(tierCounts)) {
        if (count > maxCount && count >= majorityThreshold) {
          maxCount = count;
          bestTierIndex = getTierIndex(tier as ToolProfile);
        }
      }

      // If no majority, fall back to lowest tier with any candidates
      maxTierIndex = bestTierIndex >= 0 ? bestTierIndex : Math.min(...tierIndices);
      break;

    case 'weighted':
      // Use tier with highest weighted score (score × count)
      let bestWeightedTierIdx = -1;
      let maxWeightedScore = -Infinity;

      for (const [tier, weightedScore] of Object.entries(tierScores)) {
        if (weightedScore > maxWeightedScore) {
          maxWeightedScore = weightedScore;
          bestWeightedTierIdx = getTierIndex(tier as ToolProfile);
        }
      }

      maxTierIndex = bestWeightedTierIdx >= 0 ? bestWeightedTierIdx : Math.min(...tierIndices);
      break;

    case 'max':
    default:
      // Original behavior: use highest tier among candidates
      maxTierIndex = Math.max(...tierIndices);
      break;
  }

  const targetTier = TIER_ORDER[maxTierIndex];

  return {
    targetTier: targetTier ?? null,
    tierCounts: tierCounts as Record<ToolProfile, number>,
    considered,
  };
}

/* ---------- guardrails ---------- */

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  adjustedTier?: ToolProfile;
}

/**
 * Validate if boost to target tier is allowed based on guardrails.
 *
 * Applies:
 * - Never auto-upgrade from 'search' directly to 'full' (when DYNAMIC_BOOST_SKIP_SEARCH_TO_FULL=true)
 * - Respect max tier jump limit (DYNAMIC_BOOST_MAX_JUMP)
 *
 * @param currentTier - Current tier before boost
 * @param targetTier - Desired target tier
 * @returns Result with allowed status, reason, and optional adjusted tier
 */
export function validateBoostGuardrails(
  currentTier: ToolProfile,
  targetTier: ToolProfile
): GuardrailResult {
  const currentIdx = getTierIndex(currentTier);
  const targetIdx = getTierIndex(targetTier);

  // If already at or above target, no boost needed
  if (targetIdx <= currentIdx) {
    return { allowed: true };
  }

  const tierJump = targetIdx - currentIdx;

  // Check max tier jump limit
  if (tierJump > DYNAMIC_BOOST_MAX_JUMP) {
    // Adjust to maximum allowed jump
    const adjustedIdx = currentIdx + DYNAMIC_BOOST_MAX_JUMP;
    const adjustedTier = TIER_ORDER[adjustedIdx];

    if (!adjustedTier) {
      return {
        allowed: false,
        reason: `Max tier jump (${DYNAMIC_BOOST_MAX_JUMP}) exceeded, and could not determine adjusted tier`,
      };
    }

    logger.info(
      `[boost-guardrail] Tier jump ${tierJump} exceeds max ${DYNAMIC_BOOST_MAX_JUMP}. Adjusting from ${targetTier} to ${adjustedTier}`
    );

    return {
      allowed: true,
      reason: `Tier jump limited from ${tierJump} to ${DYNAMIC_BOOST_MAX_JUMP}`,
      adjustedTier,
    };
  }

  // Check skip search->full guardrail
  if (DYNAMIC_BOOST_SKIP_SEARCH_TO_FULL && currentTier === 'search' && targetTier === 'full') {
    // Adjust to workflow tier instead
    logger.info(
      `[boost-guardrail] Blocked direct search->full jump. Adjusting to workflow tier instead`
    );

    return {
      allowed: true,
      reason: 'Direct search->full upgrade blocked by guardrail, adjusting to workflow',
      adjustedTier: 'workflow',
    };
  }

  return { allowed: true };
}

/* ---------- silent boost with retry ---------- */

/**
 * Silently boost to target tier with retry mechanism.
 *
 * @param ctx - Server context
 * @param targetTier - Target tier to boost to
 * @param opts - Retry options
 * @returns Success status and attempt count
 */
export async function silentBoostToTierWithRetry(
  ctx: MCPServerContext,
  targetTier: ToolProfile,
  opts?: RetryOptions
): Promise<{ success: boolean; attempts: number }> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const initialDelay = opts?.initialDelay ?? 30;
  const exponentialBackoff = opts?.exponentialBackoff ?? true;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info(
        `[silent-boost] Attempt ${attempt}/${maxAttempts}: boosting to ${targetTier}`
      );

      const result = await boostProfile(ctx, targetTier);

      if (result.success) {
        logger.info(
          `[silent-boost] Successfully boosted to ${targetTier} on attempt ${attempt}`
        );
        return { success: true, attempts: attempt };
      }

      // Business logic failure (already at tier, unknown tier, etc.) - do not retry
      logger.warn(
        `[silent-boost] Boost returned failure on attempt ${attempt}:`,
        result.error
      );
      return { success: false, attempts: attempt };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        `[silent-boost] Attempt ${attempt} failed with error:`,
        lastError.message
      );

      // Retry on throw/reject (transient errors)
      if (attempt < maxAttempts) {
        const delay = exponentialBackoff
          ? initialDelay * Math.pow(2, attempt - 1)
          : initialDelay;
        logger.info(`[silent-boost] Retrying after ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  logger.error(
    `[silent-boost] All ${maxAttempts} attempts failed. Last error:`,
    lastError?.message
  );
  return { success: false, attempts: maxAttempts };
}

/* ---------- backfill ---------- */

/**
 * Backfill isActive status after boost.
 *
 * @param results - Search results to update
 * @param activeNames - Updated set of active tool names
 * @returns Updated results (same array, mutated in place)
 */
export function backfillIsActive(
  results: SearchResult[],
  activeNames: Set<string>
): SearchResult[] {
  for (const result of results) {
    result.isActive = activeNames.has(result.name);
  }
  return results;
}

/* ---------- utilities ---------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
