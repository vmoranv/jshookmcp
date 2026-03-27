/**
 * Feedback-based vector weight adjustment for tool search.
 * Tracks which tools were selected after searches and adjusts the vector signal weight
 * based on how well the vector ranking predicted user choices.
 */

import { SEARCH_VECTOR_COSINE_WEIGHT } from '@src/constants';
import type { SearchConfig } from '@internal-types/config';

/**
 * FeedbackTracker manages adaptive vector weight adjustment based on tool call feedback.
 * When a user selects a tool that was highly ranked by the vector signal,
 * the vector weight increases. When the selected tool was not in vector top-5,
 * the weight decreases slightly.
 */
export class FeedbackTracker {
  /** Current weight of the vector cosine signal in RRF fusion. */
  private vectorWeight: number;
  /** Last vector ranking for feedback tracking (tool name → rank). */
  private lastVectorRanking: Map<string, number> | null = null;

  constructor(searchConfig?: SearchConfig) {
    this.vectorWeight = searchConfig?.vectorCosineWeight ?? SEARCH_VECTOR_COSINE_WEIGHT;
  }

  /**
   * Get the current vector weight for RRF fusion.
   */
  getVectorWeight(): number {
    return this.vectorWeight;
  }

  /**
   * Store the vector ranking from the most recent search.
   * Called by the search engine after computing vector cosine scores.
   *
   * @param ranking Map of tool name → rank (0-based, lower = better)
   */
  recordVectorRanking(ranking: Map<string, number>): void {
    this.lastVectorRanking = ranking;
  }

  /**
   * Record feedback from a tool call to adjust the vector weight.
   * If the invoked tool was in the top-5 of the vector ranking, increase weight.
   * Otherwise, slightly decrease it. This creates a self-tuning feedback loop.
   *
   * @param toolName The tool that was invoked
   * @param vectorEnabled Whether vector search is currently enabled (embedding engine exists)
   * @returns true if the feedback was applied and weight was adjusted (caller should invalidate cache)
   */
  recordToolCallFeedback(toolName: string, vectorEnabled: boolean): boolean {
    if (!this.lastVectorRanking || !vectorEnabled) return false;

    const vectorRank = this.lastVectorRanking.get(toolName);

    if (vectorRank !== undefined && vectorRank < 5) {
      // Tool was in vector top-5 — vector signal is working well, increase weight
      this.vectorWeight = Math.min(0.8, this.vectorWeight + 0.02);
    } else {
      // Tool was NOT in vector top-5 — vector signal missed, decrease weight
      this.vectorWeight = Math.max(0.1, this.vectorWeight - 0.01);
    }
    return true;
  }
}
