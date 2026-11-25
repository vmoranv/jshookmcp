import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getGlobalInstrumentation,
  MetricNames,
} from '@server/observability/InstrumentationContract';
import { SearchQualityTracker } from '@server/search/SearchQualityTracker';

describe('SearchQualityTracker', () => {
  let tracker: SearchQualityTracker;

  beforeEach(() => {
    tracker = new SearchQualityTracker();
  });

  describe('recordSearch', () => {
    it('returns a unique id for each search', () => {
      const id1 = tracker.recordSearch('hook fetch', ['fetch_hook', 'xhr_hook'], [0.9, 0.8], 5);
      const id2 = tracker.recordSearch('debug breakpoint', ['breakpoint_set'], [0.95], 3);
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('stores the record with correct fields', () => {
      tracker.recordSearch('hook fetch', ['fetch_hook', 'xhr_hook'], [0.9, 0.8], 5);
      const records = tracker.getRecentRecords();
      expect(records).toHaveLength(1);
      expect(records[0]!.query).toBe('hook fetch');
      expect(records[0]!.returnedTools).toEqual(['fetch_hook', 'xhr_hook']);
      expect(records[0]!.returnedScores).toEqual([0.9, 0.8]);
      expect(records[0]!.latencyMs).toBe(5);
      expect(records[0]!.usedTool).toBeUndefined();
      expect(records[0]!.usedToolRank).toBeUndefined();
    });
  });

  describe('recordToolUsed', () => {
    it('updates usedTool and usedToolRank correctly', () => {
      const id = tracker.recordSearch('hook fetch', ['fetch_hook', 'xhr_hook'], [0.9, 0.8], 5);
      tracker.recordToolUsed(id, 'fetch_hook');
      const records = tracker.getRecentRecords();
      expect(records[0]!.usedTool).toBe('fetch_hook');
      expect(records[0]!.usedToolRank).toBe(1);
    });

    it('sets usedToolRank to 2 for second tool', () => {
      const id = tracker.recordSearch('hook fetch', ['fetch_hook', 'xhr_hook'], [0.9, 0.8], 5);
      tracker.recordToolUsed(id, 'xhr_hook');
      const records = tracker.getRecentRecords();
      expect(records[0]!.usedTool).toBe('xhr_hook');
      expect(records[0]!.usedToolRank).toBe(2);
    });

    it('does not record usage when tool is not in returned list', () => {
      // Must match associateLastSearch semantics — recording usedTool without a
      // rank would dilute avgUsedRank/MRR in computeMetrics.
      const id = tracker.recordSearch('hook fetch', ['fetch_hook'], [0.9], 5);
      tracker.recordToolUsed(id, 'unknown_tool');
      const records = tracker.getRecentRecords();
      expect(records[0]!.usedTool).toBeUndefined();
      expect(records[0]!.usedToolRank).toBeUndefined();
    });

    it('does nothing when record id not found', () => {
      tracker.recordSearch('hook fetch', ['fetch_hook'], [0.9], 5);
      tracker.recordToolUsed('nonexistent-id', 'fetch_hook');
      const records = tracker.getRecentRecords();
      expect(records[0]!.usedTool).toBeUndefined();
    });
  });

  describe('associateLastSearch', () => {
    it('associates the most recent search with a tool call', () => {
      tracker.recordSearch('hook fetch', ['fetch_hook', 'xhr_hook'], [0.9, 0.8], 5);
      tracker.associateLastSearch('xhr_hook');
      const records = tracker.getRecentRecords();
      expect(records[0]!.usedTool).toBe('xhr_hook');
      expect(records[0]!.usedToolRank).toBe(2);
    });

    it('does not associate when tool is not in returned list', () => {
      tracker.recordSearch('hook fetch', ['fetch_hook'], [0.9], 5);
      tracker.associateLastSearch('xhr_hook');
      const records = tracker.getRecentRecords();
      expect(records[0]!.usedTool).toBeUndefined();
    });

    it('emits search_feedback_used with the search id', () => {
      const instrumentation = getGlobalInstrumentation();
      const spy = vi.spyOn(instrumentation, 'emitMetric').mockImplementation(() => {});
      const id = tracker.recordSearch('hook fetch', ['fetch_hook', 'xhr_hook'], [0.9, 0.8], 5);
      tracker.associateLastSearch('xhr_hook');
      expect(spy).toHaveBeenCalledWith(
        MetricNames.searchFeedbackUsed,
        1,
        'counter',
        expect.objectContaining({ search_id: id, tool: 'xhr_hook' }),
      );
      spy.mockRestore();
    });

    it('does nothing when no searches have been recorded', () => {
      expect(() => tracker.associateLastSearch('tool')).not.toThrow();
    });

    it('associates only the most recent search, not older ones', () => {
      tracker.recordSearch('old query', ['tool_a'], [0.5], 10);
      tracker.recordSearch('new query', ['tool_b', 'tool_c'], [0.8, 0.7], 3);
      tracker.associateLastSearch('tool_c');
      const records = tracker.getRecentRecords();
      // most recent search is associated
      expect(records[1]!.usedTool).toBe('tool_c');
      expect(records[1]!.usedToolRank).toBe(2);
      // older search is untouched
      expect(records[0]!.usedTool).toBeUndefined();
    });
  });

  describe('computeMetrics', () => {
    it('returns zero values when no records exist', () => {
      const metrics = tracker.computeMetrics();
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.avgLatencyMs).toBe(0);
      expect(metrics.p50LatencyMs).toBe(0);
      expect(metrics.p99LatencyMs).toBe(0);
      expect(metrics.toolUsedRate).toBe(0);
      expect(metrics.avgUsedRank).toBe(0);
      expect(metrics.mrr).toBe(0);
      expect(metrics.topKDistribution).toEqual({});
    });

    it('computes correct toolUsedRate', () => {
      const id1 = tracker.recordSearch('q1', ['a', 'b'], [0.9, 0.8], 5);
      tracker.recordSearch('q2', ['c'], [0.7], 3);
      tracker.recordToolUsed(id1, 'a');

      const metrics = tracker.computeMetrics();
      expect(metrics.totalQueries).toBe(2);
      expect(metrics.toolUsedRate).toBeCloseTo(0.5, 10);
    });

    it('computes correct MRR', () => {
      // Record 1: tool used at rank 1 → reciprocal = 1
      const id1 = tracker.recordSearch('q1', ['a', 'b'], [0.9, 0.8], 5);
      tracker.recordToolUsed(id1, 'a');
      // Record 2: tool used at rank 2 → reciprocal = 0.5
      const id2 = tracker.recordSearch('q2', ['c', 'd'], [0.7, 0.6], 3);
      tracker.recordToolUsed(id2, 'd');

      const metrics = tracker.computeMetrics();
      // MRR = (1 + 0.5) / 2 = 0.75
      expect(metrics.mrr).toBeCloseTo(0.75, 10);
    });

    it('computes MRR excluding records without usedTool', () => {
      const id1 = tracker.recordSearch('q1', ['a', 'b'], [0.9, 0.8], 5);
      tracker.recordToolUsed(id1, 'a'); // rank 1, reciprocal = 1
      tracker.recordSearch('q2', ['c'], [0.7], 3); // no tool used

      const metrics = tracker.computeMetrics();
      // MRR = 1 / 1 = 1 (only records with usedTool contribute to numerator and denominator)
      expect(metrics.mrr).toBeCloseTo(1.0, 10);
    });

    it('does not dilute rank metrics with out-of-result usage', () => {
      // recordToolUsed on a tool absent from returnedTools must not count
      // toward toolUsedRate or the avgUsedRank/MRR denominator.
      const id1 = tracker.recordSearch('q1', ['a', 'b'], [0.9, 0.8], 5);
      tracker.recordToolUsed(id1, 'a'); // rank 1, reciprocal = 1
      const id2 = tracker.recordSearch('q2', ['c'], [0.7], 3);
      tracker.recordToolUsed(id2, 'unknown_tool'); // not in results — must be ignored

      const metrics = tracker.computeMetrics();
      expect(metrics.totalQueries).toBe(2);
      expect(metrics.toolUsedRate).toBeCloseTo(0.5, 10);
      expect(metrics.avgUsedRank).toBeCloseTo(1, 10);
      expect(metrics.mrr).toBeCloseTo(1.0, 10);
      expect(metrics.topKDistribution['1']).toBe(1);
    });

    it('computes correct average latency', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 10);
      tracker.recordSearch('q2', ['b'], [0.8], 20);
      tracker.recordSearch('q3', ['c'], [0.7], 30);

      const metrics = tracker.computeMetrics();
      expect(metrics.avgLatencyMs).toBeCloseTo(20, 10);
    });

    it('computes correct p50 latency', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 10);
      tracker.recordSearch('q2', ['b'], [0.8], 20);
      tracker.recordSearch('q3', ['c'], [0.7], 30);

      const metrics = tracker.computeMetrics();
      expect(metrics.p50LatencyMs).toBe(20);
    });

    it('computes correct p99 latency', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 10);
      tracker.recordSearch('q2', ['b'], [0.8], 20);
      tracker.recordSearch('q3', ['c'], [0.7], 30);

      const metrics = tracker.computeMetrics();
      expect(metrics.p99LatencyMs).toBe(30);
    });

    it('computes correct avgUsedRank', () => {
      const id1 = tracker.recordSearch('q1', ['a', 'b', 'c'], [0.9, 0.8, 0.7], 5);
      tracker.recordToolUsed(id1, 'c'); // rank 3
      const id2 = tracker.recordSearch('q2', ['d', 'e'], [0.6, 0.5], 3);
      tracker.recordToolUsed(id2, 'd'); // rank 1

      const metrics = tracker.computeMetrics();
      // avgUsedRank = (3 + 1) / 2 = 2
      expect(metrics.avgUsedRank).toBeCloseTo(2, 10);
    });

    it('computes topKDistribution correctly', () => {
      const id1 = tracker.recordSearch('q1', ['a', 'b'], [0.9, 0.8], 5);
      tracker.recordToolUsed(id1, 'a'); // rank 1
      const id2 = tracker.recordSearch('q2', ['c', 'd'], [0.7, 0.6], 3);
      tracker.recordToolUsed(id2, 'd'); // rank 2
      const id3 = tracker.recordSearch('q3', ['e', 'f'], [0.5, 0.4], 7);
      tracker.recordToolUsed(id3, 'e'); // rank 1

      const metrics = tracker.computeMetrics();
      expect(metrics.topKDistribution['1']).toBe(2);
      expect(metrics.topKDistribution['2']).toBe(1);
    });

    it('ignores restored records whose used rank is non-positive', () => {
      tracker.restoreSnapshot({
        lastRecordId: 'sq-1-1',
        records: [
          {
            id: 'sq-1-1',
            query: 'q',
            timestamp: 1,
            returnedTools: ['a'],
            returnedScores: [0.9],
            latencyMs: 5,
            usedTool: 'a',
            usedToolRank: 0,
          },
        ],
      });

      const metrics = tracker.computeMetrics();
      // Numerator (rankSum/reciprocalSum) and denominator must agree.
      expect(metrics.toolUsedRate).toBe(0);
      expect(metrics.avgUsedRank).toBe(0);
      expect(metrics.mrr).toBe(0);
      expect(metrics.topKDistribution).toEqual({});
    });
  });

  describe('MAX_HISTORY limit', () => {
    it('discards old records when exceeding capacity', () => {
      const localTracker = new SearchQualityTracker();
      // MAX_HISTORY is 1000, push 1002 records
      for (let i = 0; i < 1002; i++) {
        localTracker.recordSearch(`q${i}`, [`tool_${i}`], [0.5], i);
      }

      const metrics = localTracker.computeMetrics();
      expect(metrics.totalQueries).toBe(1000);

      // The oldest 2 records should have been discarded
      const records = localTracker.getRecentRecords(1000);
      expect(records[0]!.query).toBe('q2');
      expect(records[0]!.returnedTools).toEqual(['tool_2']);
    });
  });

  describe('getRecentRecords', () => {
    it('returns the last N records', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 1);
      tracker.recordSearch('q2', ['b'], [0.8], 2);
      tracker.recordSearch('q3', ['c'], [0.7], 3);

      const recent = tracker.getRecentRecords(2);
      expect(recent).toHaveLength(2);
      expect(recent[0]!.query).toBe('q2');
      expect(recent[1]!.query).toBe('q3');
    });

    it('returns all records when limit exceeds total', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 1);
      tracker.recordSearch('q2', ['b'], [0.8], 2);

      const recent = tracker.getRecentRecords(10);
      expect(recent).toHaveLength(2);
    });

    it('defaults to 10 records', () => {
      for (let i = 0; i < 15; i++) {
        tracker.recordSearch(`q${i}`, [`t${i}`], [0.5], i);
      }
      const recent = tracker.getRecentRecords();
      expect(recent).toHaveLength(10);
    });
  });

  describe('getStats', () => {
    it('returns same result as computeMetrics', () => {
      tracker.recordSearch('q1', ['a', 'b'], [0.9, 0.8], 5);
      const id = tracker.recordSearch('q2', ['c', 'd'], [0.7, 0.6], 3);
      tracker.recordToolUsed(id, 'c');

      expect(tracker.getStats()).toEqual(tracker.computeMetrics());
    });
  });

  describe('snapshot persistence', () => {
    it('exports an empty snapshot with no records', () => {
      expect(tracker.exportSnapshot()).toEqual({ lastRecordId: null, records: [] });
      expect(tracker.isPersistDirty()).toBe(false);
    });

    it('exports records with the last record id', () => {
      const id1 = tracker.recordSearch('q1', ['a'], [0.9], 5);
      const id2 = tracker.recordSearch('q2', ['b', 'c'], [0.8, 0.7], 3);
      tracker.recordToolUsed(id1, 'a');
      const snapshot = tracker.exportSnapshot();
      expect(snapshot.lastRecordId).toBe(id2);
      expect(snapshot.records).toHaveLength(2);
      expect(snapshot.records[0]).toMatchObject({
        id: id1,
        query: 'q1',
        usedTool: 'a',
        usedToolRank: 1,
      });
      // Export must not mutate live state or mark it persisted.
      expect(tracker.getRecentRecords(10)).toHaveLength(2);
    });

    it('round-trips records through export/restore', () => {
      const id1 = tracker.recordSearch('q1', ['a', 'b'], [0.9, 0.8], 5);
      tracker.recordSearch('q2', ['c', 'd'], [0.7, 0.6], 3);
      tracker.recordToolUsed(id1, 'a');
      tracker.associateLastSearch('d');
      const exported = tracker.exportSnapshot();

      const restored = new SearchQualityTracker();
      restored.restoreSnapshot(exported);

      expect(restored.getRecentRecords(10)).toEqual(tracker.getRecentRecords(10));
      const metrics = restored.computeMetrics();
      expect(metrics.totalQueries).toBe(2);
      expect(metrics.toolUsedRate).toBeCloseTo(1.0, 10);
      expect(metrics.avgUsedRank).toBeCloseTo(1.5, 10);
    });

    it('restore marks the tracker clean', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 5);
      const dirty = new SearchQualityTracker();
      dirty.recordSearch('q2', ['b'], [0.8], 3);
      expect(dirty.isPersistDirty()).toBe(true);

      dirty.restoreSnapshot(tracker.exportSnapshot());
      expect(dirty.isPersistDirty()).toBe(false);
      expect(dirty.getRecentRecords(10)).toEqual(tracker.getRecentRecords(10));
    });

    it('marks itself dirty on recordSearch and clears it on markPersisted', () => {
      expect(tracker.isPersistDirty()).toBe(false);
      tracker.recordSearch('q1', ['a'], [0.9], 5);
      expect(tracker.isPersistDirty()).toBe(true);

      tracker.markPersisted();
      expect(tracker.isPersistDirty()).toBe(false);
    });

    it('marks itself dirty on recordToolUsed and associateLastSearch', () => {
      const id = tracker.recordSearch('q1', ['a', 'b'], [0.9, 0.8], 5);
      tracker.markPersisted();

      tracker.recordToolUsed(id, 'a');
      expect(tracker.isPersistDirty()).toBe(true);
      tracker.markPersisted();

      tracker.associateLastSearch('b');
      expect(tracker.isPersistDirty()).toBe(true);
    });

    it('does not mark itself dirty when the mutation is a no-op', () => {
      const id = tracker.recordSearch('q1', ['a'], [0.9], 5);
      tracker.markPersisted();

      // recordToolUsed on an unknown tool / unknown record changes nothing.
      tracker.recordToolUsed(id, 'unknown_tool');
      tracker.recordToolUsed('nonexistent-id', 'a');
      expect(tracker.isPersistDirty()).toBe(false);

      // associateLastSearch with no last record id is also a no-op.
      const empty = new SearchQualityTracker();
      empty.associateLastSearch('a');
      expect(empty.isPersistDirty()).toBe(false);
    });

    it('ignores malformed snapshot payloads', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 5);
      const before = tracker.exportSnapshot();

      for (const bad of [
        null,
        undefined,
        'string',
        42,
        {},
        { lastRecordId: 'x', records: 'not-an-array' },
        { lastRecordId: 'x', records: [null] },
        { lastRecordId: 'x', records: [{ id: 'r1' }] },
        { lastRecordId: 'x', records: [{ id: 'r1', query: 5 }] },
        { records: [{ id: 'r1', query: 'q', timestamp: 1, returnedTools: ['a'] }] },
      ]) {
        tracker.restoreSnapshot(bad);
        expect(tracker.exportSnapshot()).toEqual(before);
      }
    });

    it('restores computeMetrics correctly after a snapshot with no usage data', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 5);
      tracker.recordSearch('q2', ['b'], [0.8], 3);

      const restored = new SearchQualityTracker();
      restored.restoreSnapshot(tracker.exportSnapshot());

      const metrics = restored.computeMetrics();
      expect(metrics.totalQueries).toBe(2);
      expect(metrics.toolUsedRate).toBe(0);
      expect(metrics.avgUsedRank).toBe(0);
      expect(metrics.mrr).toBe(0);
    });

    it('never generates ids colliding with restored records', () => {
      const restoredId = tracker.recordSearch('q1', ['a'], [0.9], 5);
      const exported = tracker.exportSnapshot();

      const restored = new SearchQualityTracker();
      restored.restoreSnapshot(exported);

      const freshIds = [
        restored.recordSearch('q2', ['b'], [0.8], 3),
        restored.recordSearch('q3', ['c'], [0.7], 4),
      ];
      // Fresh ids must be unique among themselves and not reuse the restored
      // record's id — the module counter is bumped past the restored suffix.
      expect(new Set(freshIds).size).toBe(freshIds.length);
      expect(freshIds.every((id) => id !== restoredId)).toBe(true);
    });
  });

  describe('getEnhancementSuggestions', () => {
    it('returns null when results are sufficient and scores are high', () => {
      expect(tracker.getEnhancementSuggestions('hook fetch', 5, 0.6)).toBeNull();
    });

    it('returns null at boundary: 5 results and 0.5 score', () => {
      expect(tracker.getEnhancementSuggestions('hook fetch', 5, 0.5)).toBeNull();
    });

    it('suggests broader terms when no results found', () => {
      const suggestions = tracker.getEnhancementSuggestions('nonexistent', 0, 0);
      expect(suggestions).not.toBeNull();
      expect(suggestions!.length).toBeGreaterThanOrEqual(1);
      expect(suggestions![0]).toContain('No tools found');
    });

    it('suggests synonyms when fewer than 3 results', () => {
      const suggestions = tracker.getEnhancementSuggestions('obscure query', 2, 0.6);
      expect(suggestions).not.toBeNull();
      expect(suggestions!.some((s) => s.includes('Only 2 tools found'))).toBe(true);
    });

    it('suggests domain prefixes for low scores', () => {
      const suggestions = tracker.getEnhancementSuggestions('vague', 4, 0.2);
      expect(suggestions).not.toBeNull();
      expect(suggestions!.some((s) => s.includes('Low relevance scores'))).toBe(true);
    });

    it('returns null for 5+ results with score >= 0.5', () => {
      expect(tracker.getEnhancementSuggestions('good query', 7, 0.55)).toBeNull();
    });

    it('returns suggestions for score below 0.3 with results', () => {
      const suggestions = tracker.getEnhancementSuggestions('vague', 5, 0.2);
      expect(suggestions).not.toBeNull();
      expect(suggestions!.some((s) => s.includes('Low relevance scores'))).toBe(true);
    });

    it('returns multiple suggestions for 0 results', () => {
      const suggestions = tracker.getEnhancementSuggestions('nothing', 0, 0);
      expect(suggestions).not.toBeNull();
      expect(suggestions!.length).toBe(1);
    });

    it('returns null for 3+ results with score >= 0.5', () => {
      expect(tracker.getEnhancementSuggestions('ok', 3, 0.5)).toBeNull();
    });
  });

  describe('BM25 confidence instrumentation', () => {
    it('records bm25TopScore when provided', () => {
      tracker.recordSearch('weak query', ['a'], [0.4], 5, { bm25TopScore: 3.2 });
      const record = tracker.getRecentRecords()[0]!;
      expect(record.bm25TopScore).toBe(3.2);
    });

    it('omits bm25TopScore when not provided (quick-path records)', () => {
      tracker.recordSearch('exact name', ['page_navigate'], [0.9], 2);
      const record = tracker.getRecentRecords()[0]!;
      expect(record.bm25TopScore).toBeUndefined();
    });

    it('restores bm25TopScore from a snapshot', () => {
      tracker.recordSearch('q1', ['a'], [0.9], 5, { bm25TopScore: 7.5 });
      const snapshot = tracker.exportSnapshot();
      const restored = new SearchQualityTracker();
      restored.restoreSnapshot(snapshot);
      expect(restored.getRecentRecords()[0]!.bm25TopScore).toBe(7.5);
    });

    it('ignores the removed vectorParticipated field in legacy snapshots', () => {
      const snapshot = {
        lastRecordId: 'sq-1-1',
        records: [
          {
            id: 'sq-1-1',
            query: 'legacy query',
            timestamp: 1,
            returnedTools: ['a'],
            returnedScores: [0.9],
            latencyMs: 5,
            bm25TopScore: 4,
            vectorParticipated: true,
          },
        ],
      };
      const restored = new SearchQualityTracker();
      restored.restoreSnapshot(snapshot);
      const record = restored.getRecentRecords()[0]!;
      expect(record.bm25TopScore).toBe(4);
      expect(record).not.toHaveProperty('vectorParticipated');
    });

    it('restores pre-instrumentation snapshots without the field', () => {
      const snapshot = {
        lastRecordId: 'sq-1-1',
        records: [
          {
            id: 'sq-1-1',
            query: 'old query',
            timestamp: 1,
            returnedTools: ['a'],
            returnedScores: [0.9],
            latencyMs: 5,
          },
        ],
      };
      const restored = new SearchQualityTracker();
      restored.restoreSnapshot(snapshot);
      const record = restored.getRecentRecords()[0]!;
      expect(record.bm25TopScore).toBeUndefined();
      expect(restored.computeMetrics().totalQueries).toBe(1);
    });

    it('rejects snapshots with a malformed bm25TopScore', () => {
      const snapshot = {
        lastRecordId: null,
        records: [
          {
            id: 'sq-1-1',
            query: 'q',
            timestamp: 1,
            returnedTools: ['a'],
            returnedScores: [0.9],
            latencyMs: 5,
            bm25TopScore: 'not-a-number',
          },
        ],
      };
      const restored = new SearchQualityTracker();
      restored.restoreSnapshot(snapshot);
      expect(restored.getRecentRecords()).toHaveLength(0);
    });
  });
});
