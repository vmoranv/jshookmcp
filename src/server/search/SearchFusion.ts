/**
 * RRF fusion stage for tool search.
 *
 * Combines BM25, trigram, and dense-vector rankings into one score array.
 * Extracted from ToolSearchEngineImpl so retrieval math has one owner and the
 * engine only orchestrates query → stages → results.
 */
import {
  SEARCH_RRF_K,
  SEARCH_TRIGRAM_THRESHOLD,
  SEARCH_TRIGRAM_WEIGHT,
  SEARCH_VECTOR_BM25_SKIP_THRESHOLD,
} from '@src/constants';
import type { FeedbackTracker } from './FeedbackTracker';
import type { TrigramIndex } from './TrigramIndex';
import { blendRrfIntoScores, rankByMap, rankByScores } from './ToolSearchEngine.helpers';

interface NamedDocument {
  name: string;
}

export interface SearchFusionDeps {
  readonly docs: readonly NamedDocument[];
  readonly trigramIndex: TrigramIndex;
  readonly feedbackTracker: FeedbackTracker;
  readonly computeVectorCosineScores: (query: string) => Promise<Map<number, number> | null>;
}

export interface SearchFusionResult {
  topBm25Score: number;
  vectorParticipated: boolean;
  vectorRanking: Map<string, number> | null;
  hasSignal: boolean;
}

export class SearchFusion {
  private readonly deps: SearchFusionDeps;

  constructor(deps: SearchFusionDeps) {
    this.deps = deps;
  }

  async apply(query: string, scores: Float64Array): Promise<SearchFusionResult> {
    const k = SEARCH_RRF_K;
    const trigramWeight = SEARCH_TRIGRAM_WEIGHT;
    const docCount = this.deps.docs.length;

    // ── Signal 1: BM25 ranking (already in scores) ──
    const bm25Ranked = rankByScores(scores);

    // ── Signal 2: Trigram fuzzy matching ──
    const trigramScores = this.deps.trigramIndex.search(query, SEARCH_TRIGRAM_THRESHOLD);
    const trigramRanked = rankByMap(trigramScores);

    // ── Signal 3: Dense vector cosine similarity ──
    // Two-stage retrieval: skip vector scoring when BM25 top result is already
    // strong enough that embeddings rarely change the ranking. `null` marks
    // "vector signal did not participate" (skip threshold, engine disabled, or
    // embeddings unavailable) — distinct from an empty map, which means it
    // participated but matched nothing.
    let vectorScores: Map<number, number> | null;
    const topBm25Idx =
      bm25Ranked.size > 0 ? [...bm25Ranked.entries()].find(([, r]) => r === 0)?.[0] : undefined;
    const topBm25Score = topBm25Idx !== undefined ? scores[topBm25Idx]! : 0;
    if (SEARCH_VECTOR_BM25_SKIP_THRESHOLD > 0 && bm25Ranked.size > 0) {
      vectorScores =
        topBm25Score >= SEARCH_VECTOR_BM25_SKIP_THRESHOLD
          ? null
          : await this.deps.computeVectorCosineScores(query);
    } else {
      vectorScores = await this.deps.computeVectorCosineScores(query);
    }
    const vectorRanked = vectorScores === null ? null : rankByMap(vectorScores);

    // Store the latest vector ranking for feedback tracking. Passing `null`
    // when the signal did not participate matters: a skipped query must not
    // look like "tool not in ranking" and erode the vector weight.
    let vectorRanking: Map<string, number> | null = null;
    if (vectorRanked === null) {
      this.deps.feedbackTracker.recordVectorRanking(null);
    } else {
      vectorRanking = new Map<string, number>();
      for (const [docIdx, rank] of vectorRanked) {
        vectorRanking.set(this.deps.docs[docIdx]!.name, rank);
      }
      this.deps.feedbackTracker.recordVectorRanking(vectorRanking);
    }

    const hasSignal =
      topBm25Score > 0 ||
      trigramScores.size > 0 ||
      (vectorScores !== null && vectorScores.size > 0);

    // ── Fuse via RRF only if at least one signal found candidates ──
    if (hasSignal) {
      const fusedRrfScores = new Float64Array(docCount);
      for (let i = 0; i < docCount; i++) {
        let rrfScore = 0;

        const bm25Rank = bm25Ranked.get(i);
        if (bm25Rank !== undefined) {
          rrfScore += 1 / (k + bm25Rank);
        }

        const trigramRank = trigramRanked.get(i);
        if (trigramRank !== undefined && trigramWeight > 0) {
          rrfScore += trigramWeight * (1 / (k + trigramRank));
        }

        const vectorRank = vectorRanked?.get(i);
        if (vectorRank !== undefined && this.deps.feedbackTracker.getVectorWeight() > 0) {
          rrfScore += this.deps.feedbackTracker.getVectorWeight() * (1 / (k + vectorRank));
        }

        fusedRrfScores[i] = rrfScore;
      }
      blendRrfIntoScores(scores, fusedRrfScores);
    }

    return { topBm25Score, vectorParticipated: vectorScores !== null, vectorRanking, hasSignal };
  }
}
