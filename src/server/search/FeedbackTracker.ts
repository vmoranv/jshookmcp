/**
 * Feedback-based vector weight adjustment for tool search.
 *
 * Tracks which tools were selected after searches and adjusts the vector
 * signal weight based on how well the vector ranking predicted the user's
 * choice. The learning rates and "top N" window are configurable via env
 * (see `src/constants.ts`), which lets operators tune convergence speed
 * vs. stability without patching the code.
 *
 * Learning scheme:
 *   - rank < LEARN_TOP_N          → strong up-step (`LEARN_UP`)
 *   - LEARN_TOP_N ≤ rank < 2×N    → weak up-step (30% of `LEARN_UP`)
 *   - rank ≥ 2×N or unseen        → down-step (`LEARN_DOWN`)
 *
 * Bounds: weight ∈ [0.1, 0.8] to guarantee a minimum of lexical + vector
 * blend even in the pessimistic case.
 */

import {
  SEARCH_VECTOR_COSINE_WEIGHT,
  SEARCH_VECTOR_LEARN_DOWN,
  SEARCH_VECTOR_LEARN_TOP_N,
  SEARCH_VECTOR_LEARN_UP,
} from '@src/constants';
import type { SearchConfig } from '@internal-types/config';

const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 0.8;

export class FeedbackTracker {
  private vectorWeight: number;
  private lastVectorRanking: Map<string, number> | null = null;

  private readonly topN: number;
  private readonly learnUp: number;
  private readonly learnDown: number;

  constructor(searchConfig?: SearchConfig) {
    this.vectorWeight = searchConfig?.vectorCosineWeight ?? SEARCH_VECTOR_COSINE_WEIGHT;
    this.topN = Math.max(1, SEARCH_VECTOR_LEARN_TOP_N);
    this.learnUp = Math.max(0, SEARCH_VECTOR_LEARN_UP);
    this.learnDown = Math.max(0, SEARCH_VECTOR_LEARN_DOWN);
  }

  getVectorWeight(): number {
    return this.vectorWeight;
  }

  /**
   * Store the vector ranking from the most recent search. Called by the
   * search engine after the vector signal has been scored.
   *
   * @param ranking Map of tool name → rank (0-based; lower = better)
   */
  recordVectorRanking(ranking: Map<string, number>): void {
    this.lastVectorRanking = ranking;
  }

  /**
   * Record feedback from a tool call and nudge the vector weight.
   * Returns `true` if the weight actually moved.
   *
   * @param toolName The tool that was invoked after the last search
   * @param vectorEnabled Whether the embedding engine is active
   */
  recordToolCallFeedback(toolName: string, vectorEnabled: boolean): boolean {
    if (!this.lastVectorRanking || !vectorEnabled) return false;

    const vectorRank = this.lastVectorRanking.get(toolName);
    const before = this.vectorWeight;

    if (vectorRank === undefined) {
      this.vectorWeight = Math.max(MIN_WEIGHT, this.vectorWeight - this.learnDown);
    } else if (vectorRank < this.topN) {
      this.vectorWeight = Math.min(MAX_WEIGHT, this.vectorWeight + this.learnUp);
    } else if (vectorRank < this.topN * 2) {
      this.vectorWeight = Math.min(MAX_WEIGHT, this.vectorWeight + this.learnUp * 0.3);
    } else {
      this.vectorWeight = Math.max(MIN_WEIGHT, this.vectorWeight - this.learnDown);
    }

    return this.vectorWeight !== before;
  }
}
