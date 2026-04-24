/**
 * Tests for FeedbackTracker.ts
 *
 * FeedbackTracker manages adaptive vector weight adjustment based on tool call feedback.
 *
 * Learning rates come from env defaults in src/constants.ts:
 *   SEARCH_VECTOR_COSINE_WEIGHT = 0.69
 *   SEARCH_VECTOR_LEARN_UP      = 0.07  (rank < LEARN_TOP_N)
 *   SEARCH_VECTOR_LEARN_DOWN    = 0.02  (rank ≥ 2 × LEARN_TOP_N or unseen)
 *   SEARCH_VECTOR_LEARN_TOP_N   = 6
 *   Between [N, 2N) the up step is scaled by 0.3.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FeedbackTracker } from '@server/search/FeedbackTracker';

const EPS = 1e-9;

describe('FeedbackTracker', () => {
  describe('initialization', () => {
    it('uses default vector weight from constants when no config provided', () => {
      const tracker = new FeedbackTracker();
      expect(tracker.getVectorWeight()).toBe(0.69);
    });

    it('uses custom vector weight from search config', () => {
      const tracker = new FeedbackTracker({ vectorCosineWeight: 0.6 } as any);
      expect(tracker.getVectorWeight()).toBe(0.6);
    });

    it('uses config value of 0 if explicitly set', () => {
      const tracker = new FeedbackTracker({ vectorCosineWeight: 0 } as any);
      expect(tracker.getVectorWeight()).toBe(0);
    });
  });

  describe('recordVectorRanking', () => {
    it('stores the vector ranking for feedback tracking', () => {
      const tracker = new FeedbackTracker();
      const ranking = new Map([
        ['tool_a', 0],
        ['tool_b', 1],
        ['tool_c', 5],
      ]);

      tracker.recordVectorRanking(ranking);
      expect(tracker.getVectorWeight()).toBe(0.69);
    });
  });

  describe('recordToolCallFeedback', () => {
    let tracker: FeedbackTracker;

    beforeEach(() => {
      tracker = new FeedbackTracker();
    });

    it('returns false when no ranking was recorded', () => {
      const result = tracker.recordToolCallFeedback('tool_a', true);
      expect(result).toBe(false);
      expect(tracker.getVectorWeight()).toBe(0.69);
    });

    it('returns false when vector is not enabled', () => {
      tracker.recordVectorRanking(new Map([['tool_a', 0]]));
      const result = tracker.recordToolCallFeedback('tool_a', false);
      expect(result).toBe(false);
      expect(tracker.getVectorWeight()).toBe(0.69);
    });

    it('increases weight when tool was in vector top-N (rank 0)', () => {
      tracker.recordVectorRanking(new Map([['tool_a', 0]]));
      const result = tracker.recordToolCallFeedback('tool_a', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.76, 10); // 0.69 + 0.07
    });

    it('increases weight when tool was in vector top-N (rank N-1 = 5)', () => {
      tracker.recordVectorRanking(new Map([['tool_d', 5]]));
      const result = tracker.recordToolCallFeedback('tool_d', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.76, 10);
    });

    it('applies reduced up-step for intermediate rank zone [N, 2N)', () => {
      tracker.recordVectorRanking(new Map([['tool_mid', 7]]));
      const result = tracker.recordToolCallFeedback('tool_mid', true);

      expect(result).toBe(true);
      // 0.69 + 0.07 * 0.3 = 0.711
      expect(tracker.getVectorWeight()).toBeCloseTo(0.711, 10);
    });

    it('decreases weight when tool was outside 2N window (rank 12)', () => {
      tracker.recordVectorRanking(new Map([['tool_far', 12]]));
      const result = tracker.recordToolCallFeedback('tool_far', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.67, 10); // 0.69 - 0.02
    });

    it('decreases weight when tool was outside 2N window (rank 100)', () => {
      tracker.recordVectorRanking(new Map([['tool_x', 100]]));
      const result = tracker.recordToolCallFeedback('tool_x', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.67, 10);
    });

    it('decreases weight when tool was not in ranking at all', () => {
      tracker.recordVectorRanking(new Map([['other_tool', 0]]));
      const result = tracker.recordToolCallFeedback('unlisted_tool', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.67, 10);
    });

    it('respects upper bound of 0.8', () => {
      const highTracker = new FeedbackTracker({ vectorCosineWeight: 0.77 } as any);
      highTracker.recordVectorRanking(new Map([['tool', 0]]));

      highTracker.recordToolCallFeedback('tool', true); // 0.77 + 0.07 = 0.84 → clamp 0.8
      expect(highTracker.getVectorWeight()).toBe(0.8);

      highTracker.recordVectorRanking(new Map([['tool', 0]]));
      highTracker.recordToolCallFeedback('tool', true); // already at max
      expect(highTracker.getVectorWeight()).toBe(0.8);
    });

    it('respects lower bound of 0.1', () => {
      const lowTracker = new FeedbackTracker({ vectorCosineWeight: 0.11 } as any);
      lowTracker.recordVectorRanking(new Map([['tool', 100]]));

      lowTracker.recordToolCallFeedback('tool', true); // 0.11 - 0.02 = 0.09 → clamp 0.1
      expect(lowTracker.getVectorWeight()).toBe(0.1);

      lowTracker.recordVectorRanking(new Map([['tool', 100]]));
      lowTracker.recordToolCallFeedback('tool', true); // already at min
      expect(lowTracker.getVectorWeight()).toBe(0.1);
    });

    it('accumulates weight changes over multiple feedback calls', () => {
      tracker.recordVectorRanking(new Map([['good', 0]]));
      tracker.recordToolCallFeedback('good', true); // 0.69 → 0.76

      tracker.recordVectorRanking(new Map([['good', 1]]));
      tracker.recordToolCallFeedback('good', true); // 0.76 → 0.83 → clamp 0.8

      tracker.recordVectorRanking(new Map([['bad', 20]]));
      tracker.recordToolCallFeedback('bad', true); // 0.8 → 0.78

      expect(tracker.getVectorWeight()).toBeCloseTo(0.78, 2);
    });
  });

  describe('edge cases', () => {
    it('handles empty ranking map', () => {
      const tracker = new FeedbackTracker();
      tracker.recordVectorRanking(new Map());

      const result = tracker.recordToolCallFeedback('any_tool', true);
      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.67, 10);
    });

    it('handles ranking with negative rank (counts as top hit)', () => {
      const tracker = new FeedbackTracker();
      tracker.recordVectorRanking(new Map([['tool', -1]]));
      const result = tracker.recordToolCallFeedback('tool', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.76, 10);
    });

    it('handles boundary rank of 6 (first outside top-N)', () => {
      const tracker = new FeedbackTracker();
      tracker.recordVectorRanking(new Map([['tool', 6]]));
      const result = tracker.recordToolCallFeedback('tool', true);

      expect(result).toBe(true);
      // Rank 6 is in the [N, 2N) zone → small positive step
      // 0.69 + 0.07 * 0.3 = 0.711
      expect(Math.abs(tracker.getVectorWeight() - 0.711)).toBeLessThan(EPS);
    });
  });
});
