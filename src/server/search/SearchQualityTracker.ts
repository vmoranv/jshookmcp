import { RingBuffer } from '@utils/RingBuffer';
import type { SnapshotSource } from '@server/persistence/RuntimeSnapshotScheduler';
import {
  getGlobalInstrumentation,
  MetricNames,
} from '@server/observability/InstrumentationContract';

/**
 * Emit the search→usage feedback signal to the instrumentation backend.
 * rank_bucket + tool attributes let the lakehouse join `search.query` spans
 * with `tool.execute` spans across sessions (what ranking actually
 * delivered). Called from SearchQualityTracker.associateLastSearch — the
 * choke point BOTH the engine wrapper and the production execution path go
 * through.
 */
function emitSearchFeedbackMetric(rank0Based: number, toolName: string, searchId: string): void {
  const instrumentation = getGlobalInstrumentation();
  const bucket =
    rank0Based === 0
      ? 'top1'
      : rank0Based < 3
        ? 'top3'
        : rank0Based < 5
          ? 'top5'
          : rank0Based < 10
            ? 'top10'
            : 'beyond';
  instrumentation.emitMetric(MetricNames.searchFeedbackUsed, 1, 'counter', {
    rank_bucket: bucket,
    tool: toolName,
    search_id: searchId,
  });
}

export interface SearchQueryRecord {
  id: string;
  query: string;
  timestamp: number;
  returnedTools: string[];
  returnedScores: number[];
  latencyMs: number;
  usedTool?: string;
  usedToolRank?: number;
  /**
   * Raw top BM25 score of the full ranking pipeline (quick-path/exact-match
   * queries carry no score — they bypass the pipeline by construction).
   * Used as the confidence distribution for offline tuning.
   */
  bm25TopScore?: number;
}

export interface SearchQualityMetrics {
  totalQueries: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p99LatencyMs: number;
  toolUsedRate: number;
  avgUsedRank: number;
  mrr: number;
  topKDistribution: Record<string, number>;
}

/**
 * Serialized search-quality history. `lastRecordId` is carried alongside the
 * records so `associateLastSearch` keeps working after a restore (it targets
 * the most recent record by id).
 */
export interface SearchQualityTrackerSnapshot {
  lastRecordId: string | null;
  records: SearchQueryRecord[];
}

let recordCounter = 0;

function generateId(): string {
  return `sq-${Date.now()}-${++recordCounter}`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export class SearchQualityTracker implements SnapshotSource {
  private readonly MAX_HISTORY = 1000;
  private readonly records = new RingBuffer<SearchQueryRecord>(this.MAX_HISTORY);
  private lastRecordId: string | undefined;
  private dirty = false;

  recordSearch(
    query: string,
    returnedTools: string[],
    returnedScores: number[],
    latencyMs: number,
    options?: { id?: string; bm25TopScore?: number },
  ): string {
    const id = options?.id ?? generateId();
    const record: SearchQueryRecord = {
      id,
      query,
      timestamp: Date.now(),
      returnedTools,
      returnedScores,
      latencyMs,
      ...(options?.bm25TopScore !== undefined ? { bm25TopScore: options.bm25TopScore } : {}),
    };
    this.records.push(record);
    this.lastRecordId = id;
    this.dirty = true;
    return id;
  }

  recordToolUsed(recordId: string, toolName: string): void {
    const arr = this.records.toArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      const record = arr[i]!;
      if (record.id === recordId) {
        // Only record usage when the tool was actually returned by the search,
        // matching associateLastSearch. Recording usedTool without a rank would
        // count toward toolUsedRate while contributing nothing to
        // avgUsedRank/MRR, silently diluting those metrics.
        const rank = record.returnedTools.indexOf(toolName);
        if (rank < 0) return;
        record.usedTool = toolName;
        record.usedToolRank = rank + 1;
        this.dirty = true;
        return;
      }
    }
  }

  /**
   * Associate a tool call with the most recent search record.
   * Returns the 0-based rank the tool held in that search's results when the
   * association landed, or undefined when it did not (no last record, or the
   * tool was not in the returned set). On a successful association the
   * search_feedback_used metric is emitted through the process-global
   * instrumentation — living HERE (not on the engine wrapper) because the
   * production execution path calls this tracker directly, bypassing the
   * engine; the metric must fire on both paths.
   */
  associateLastSearch(toolName: string): number | undefined {
    if (!this.lastRecordId) return undefined;
    const arr = this.records.toArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      const record = arr[i]!;
      if (record.id === this.lastRecordId) {
        const rank = record.returnedTools.indexOf(toolName);
        if (rank >= 0) {
          record.usedTool = toolName;
          record.usedToolRank = rank + 1;
          this.dirty = true;
          emitSearchFeedbackMetric(rank, toolName, record.id);
          return rank;
        }
        return undefined;
      }
    }
    return undefined;
  }

  computeMetrics(): SearchQualityMetrics {
    const arr = this.records.toArray();
    const totalQueries = arr.length;

    if (totalQueries === 0) {
      return {
        totalQueries: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p99LatencyMs: 0,
        toolUsedRate: 0,
        avgUsedRank: 0,
        mrr: 0,
        topKDistribution: {},
      };
    }

    const latencies = arr.map((r) => r.latencyMs).toSorted((a, b) => a - b);
    const totalLatency = latencies.reduce((sum, v) => sum + v, 0);

    // Defensive: a record must carry both fields to count as used. A record
    // with usedTool set but no usedToolRank (e.g. from older callers) would
    // otherwise inflate toolUsedRate while contributing nothing to the rank
    // metrics, diluting avgUsedRank and MRR.
    const usedRecords = arr.filter((r) => r.usedTool !== undefined && r.usedToolRank !== undefined);
    const toolUsedRate = usedRecords.length / totalQueries;

    let avgUsedRank = 0;
    let mrr = 0;
    const topKDistribution: Record<string, number> = {};

    if (usedRecords.length > 0) {
      let rankSum = 0;
      let reciprocalSum = 0;
      for (const record of usedRecords) {
        const rank = record.usedToolRank;
        if (rank !== undefined && rank > 0) {
          rankSum += rank;
          reciprocalSum += 1 / rank;
          const key = String(rank);
          topKDistribution[key] = (topKDistribution[key] ?? 0) + 1;
        }
      }
      avgUsedRank = rankSum / usedRecords.length;
      mrr = reciprocalSum / usedRecords.length;
    }

    return {
      totalQueries,
      avgLatencyMs: totalLatency / totalQueries,
      p50LatencyMs: percentile(latencies, 50),
      p99LatencyMs: percentile(latencies, 99),
      toolUsedRate,
      avgUsedRank,
      mrr,
      topKDistribution,
    };
  }

  getRecentRecords(limit = 10): SearchQueryRecord[] {
    const arr = this.records.toArray();
    return arr.slice(-limit);
  }

  getStats(): SearchQualityMetrics {
    return this.computeMetrics();
  }

  getEnhancementSuggestions(query: string, resultCount: number, topScore: number): string[] | null {
    if (resultCount >= 5 && topScore >= 0.5) return null;

    const suggestions: string[] = [];

    if (resultCount === 0) {
      suggestions.push(
        `No tools found for "${query}". Try broader terms or use search_tools with a different query.`,
      );
    } else if (resultCount < 3) {
      suggestions.push(
        `Only ${resultCount} tools found. Consider using synonyms or breaking down the query.`,
      );
    }

    if (topScore < 0.3 && resultCount > 0) {
      suggestions.push(
        'Low relevance scores. Try more specific tool names or domain prefixes (e.g., "page_", "hook_", "network_").',
      );
    }

    return suggestions.length > 0 ? suggestions : null;
  }

  // ── Snapshot persistence ──────────────────────────────────────────────
  //
  // The search-quality history feeds the search-tune dataset and MRR/MRR-style
  // metrics across process restarts. Implements the SnapshotSource contract
  // (see src/server/persistence/RuntimeSnapshotScheduler.ts); the scheduler
  // owns file I/O (atomic tmp+rename) and calls these methods.

  isPersistDirty(): boolean {
    return this.dirty;
  }

  markPersisted(): void {
    this.dirty = false;
  }

  exportSnapshot(): SearchQualityTrackerSnapshot {
    return {
      lastRecordId: this.lastRecordId ?? null,
      records: this.records.toArray(),
    };
  }

  restoreSnapshot(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const snapshot = data as { lastRecordId?: unknown; records?: unknown };
    if (!Array.isArray(snapshot.records)) return;

    const restored: SearchQueryRecord[] = [];
    for (const item of snapshot.records) {
      // Defensive: validate the snapshot shape — a
      // hand-edited or future-versioned file must not corrupt the buffer.
      if (!item || typeof item !== 'object') return;
      const record = item as Record<string, unknown>;
      if (
        typeof record.id !== 'string' ||
        typeof record.query !== 'string' ||
        typeof record.timestamp !== 'number' ||
        !Array.isArray(record.returnedTools) ||
        !Array.isArray(record.returnedScores) ||
        typeof record.latencyMs !== 'number'
      ) {
        return;
      }
      if (record.usedTool !== undefined && typeof record.usedTool !== 'string') return;
      if (record.usedToolRank !== undefined && typeof record.usedToolRank !== 'number') return;
      // Additive confidence field: absent in pre-instrumentation snapshots,
      // validated only when present. Unknown legacy fields (e.g. the removed
      // vectorParticipated flag) are ignored.
      if (record.bm25TopScore !== undefined && typeof record.bm25TopScore !== 'number') return;

      const tools = record.returnedTools as unknown[];
      if (tools.some((t) => typeof t !== 'string')) return;
      const scores = record.returnedScores as unknown[];
      if (scores.some((s) => typeof s !== 'number')) return;

      restored.push({
        id: record.id,
        query: record.query,
        timestamp: record.timestamp,
        returnedTools: tools as string[],
        returnedScores: scores as number[],
        latencyMs: record.latencyMs,
        usedTool: record.usedTool as string | undefined,
        usedToolRank: record.usedToolRank as number | undefined,
        ...(record.bm25TopScore !== undefined
          ? { bm25TopScore: record.bm25TopScore as number }
          : {}),
      });
    }

    // Rebuild from oldest to newest so the ring buffer evicts the same tail
    // it would have in the original process.
    this.records.clear();
    for (const record of restored) this.records.push(record);

    this.lastRecordId =
      typeof snapshot.lastRecordId === 'string' ? snapshot.lastRecordId : undefined;

    // The module-level id counter (`sq-<ts>-<n>`) is shared across tracker
    // instances, so a restored record's id can in principle collide with one
    // generated later. Reset the counter past the largest restored suffix to
    // make a collision practically impossible; the ids are otherwise opaque.
    let maxSuffix = 0;
    for (const record of restored) {
      const suffix = Number.parseInt(record.id.split('-').pop() ?? '', 10);
      if (Number.isFinite(suffix) && suffix > maxSuffix) maxSuffix = suffix;
    }
    if (maxSuffix > recordCounter) recordCounter = maxSuffix;

    this.dirty = false;
  }
}
