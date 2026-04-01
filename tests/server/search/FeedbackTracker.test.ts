/**
 * Tests for FeedbackTracker.ts
 *
 * FeedbackTracker manages adaptive vector weight adjustment based on tool call feedback.
 * Tests cover:
 * - Default and custom initialization
 * - getVectorWeight() returns current weight
 * - recordVectorRanking() stores ranking
 * - recordToolCallFeedback() adjusts weight based on ranking
 * - Weight bounds (min 0.1, max 0.8)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FeedbackTracker } from '@server/search/FeedbackTracker';

describe('FeedbackTracker', () => {
  describe('initialization', () => {
    it('uses default vector weight from constants when no config provided', () => {
      const tracker = new FeedbackTracker();
      // Default is SEARCH_VECTOR_COSINE_WEIGHT = 0.4
      expect(tracker.getVectorWeight()).toBe(0.4);
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

      // Recording alone doesn't change weight
      expect(tracker.getVectorWeight()).toBe(0.4);
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
      expect(tracker.getVectorWeight()).toBe(0.4);
    });

    it('returns false when vector is not enabled', () => {
      tracker.recordVectorRanking(new Map([['tool_a', 0]]));
      const result = tracker.recordToolCallFeedback('tool_a', false);
      expect(result).toBe(false);
      expect(tracker.getVectorWeight()).toBe(0.4);
    });

    it('increases weight when tool was in vector top-5 (rank 0)', () => {
      tracker.recordVectorRanking(new Map([['tool_a', 0]]));
      const result = tracker.recordToolCallFeedback('tool_a', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.42, 10); // 0.4 + 0.02
    });

    it('increases weight when tool was in vector top-5 (rank 4)', () => {
      tracker.recordVectorRanking(new Map([['tool_d', 4]]));
      const result = tracker.recordToolCallFeedback('tool_d', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.42, 10);
    });

    it('decreases weight when tool was NOT in vector top-5 (rank 5)', () => {
      tracker.recordVectorRanking(new Map([['tool_e', 5]]));
      const result = tracker.recordToolCallFeedback('tool_e', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.39, 10); // 0.4 - 0.01
    });

    it('decreases weight when tool was NOT in vector top-5 (rank 100)', () => {
      tracker.recordVectorRanking(new Map([['tool_x', 100]]));
      const result = tracker.recordToolCallFeedback('tool_x', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.39, 10);
    });

    it('decreases weight when tool was not in ranking at all', () => {
      tracker.recordVectorRanking(new Map([['other_tool', 0]]));
      const result = tracker.recordToolCallFeedback('unlisted_tool', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.39, 10);
    });

    it('respects upper bound of 0.8', () => {
      const highTracker = new FeedbackTracker({ vectorCosineWeight: 0.79 } as any);
      highTracker.recordVectorRanking(new Map([['tool', 0]]));

      highTracker.recordToolCallFeedback('tool', true); // +0.02 → clamped to 0.8
      expect(highTracker.getVectorWeight()).toBe(0.8);

      highTracker.recordVectorRanking(new Map([['tool', 0]]));
      highTracker.recordToolCallFeedback('tool', true); // Already at max
      expect(highTracker.getVectorWeight()).toBe(0.8);
    });

    it('respects lower bound of 0.1', () => {
      const lowTracker = new FeedbackTracker({ vectorCosineWeight: 0.11 } as any);
      lowTracker.recordVectorRanking(new Map([['tool', 10]]));

      lowTracker.recordToolCallFeedback('tool', true); // -0.01 → clamped to 0.1
      expect(lowTracker.getVectorWeight()).toBe(0.1);

      lowTracker.recordVectorRanking(new Map([['tool', 10]]));
      lowTracker.recordToolCallFeedback('tool', true); // Already at min
      expect(lowTracker.getVectorWeight()).toBe(0.1);
    });

    it('accumulates weight changes over multiple feedback calls', () => {
      // Start at 0.4
      tracker.recordVectorRanking(new Map([['good', 0]]));
      tracker.recordToolCallFeedback('good', true); // → 0.42

      tracker.recordVectorRanking(new Map([['good', 1]]));
      tracker.recordToolCallFeedback('good', true); // → 0.44

      tracker.recordVectorRanking(new Map([['bad', 10]]));
      tracker.recordToolCallFeedback('bad', true); // → 0.43

      expect(tracker.getVectorWeight()).toBeCloseTo(0.43, 2);
    });
  });

  describe('edge cases', () => {
    it('handles empty ranking map', () => {
      const tracker = new FeedbackTracker();
      tracker.recordVectorRanking(new Map());

      // Tool not found in empty map → decrease weight
      const result = tracker.recordToolCallFeedback('any_tool', true);
      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.39, 10);
    });

    it('handles ranking with negative rank (edge case)', () => {
      const tracker = new FeedbackTracker();
      // Negative rank is < 5, so should increase weight
      tracker.recordVectorRanking(new Map([['tool', -1]]));
      const result = tracker.recordToolCallFeedback('tool', true);

      expect(result).toBe(true);
      expect(tracker.getVectorWeight()).toBeCloseTo(0.42, 10);
    });

    it('handles boundary rank of 5 (first non-top-5)', () => {
      const tracker = new FeedbackTracker();
      tracker.recordVectorRanking(new Map([['tool', 5]]));
      const result = tracker.recordToolCallFeedback('tool', true);

      expect(result).toBe(true);
      // Rank 5 is NOT < 5, so weight decreases
      expect(tracker.getVectorWeight()).toBeCloseTo(0.39, 10);
    });
  });
});
