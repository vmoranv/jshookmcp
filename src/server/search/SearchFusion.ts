/**
 * RRF fusion stage for tool search.
 *
 * Combines BM25 and trigram rankings. The dense-vector signal was removed in
 * the dense path, so this stage is lexical-only and has no model or feedback-weight
 * dependency.
 */
import { SEARCH_RRF_K, SEARCH_TRIGRAM_THRESHOLD, SEARCH_TRIGRAM_WEIGHT } from '@src/constants';
import type { TrigramIndex } from './TrigramIndex';
import { blendRrfIntoScores, rankByMap, rankByScores } from './ToolSearchEngine.helpers';

interface NamedDocument {
  name: string;
}

export interface SearchFusionDeps {
  readonly docs: readonly NamedDocument[];
  readonly trigramIndex: TrigramIndex;
}

export interface SearchFusionResult {
  topBm25Score: number;
  /** Always false after the dense-path removal; kept for telemetry/cache schema compatibility. */
  vectorParticipated: false;
  /** Always null after the dense-path removal; kept for telemetry/cache schema compatibility. */
  vectorRanking: null;
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

    const bm25Ranked = rankByScores(scores);
    const trigramScores = this.deps.trigramIndex.search(query, SEARCH_TRIGRAM_THRESHOLD);
    const trigramRanked = rankByMap(trigramScores);

    const topBm25Idx =
      bm25Ranked.size > 0
        ? [...bm25Ranked.entries()].find(([, rank]) => rank === 0)?.[0]
        : undefined;
    const topBm25Score = topBm25Idx !== undefined ? scores[topBm25Idx]! : 0;
    const hasSignal = topBm25Score > 0 || trigramScores.size > 0;

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
        fusedRrfScores[i] = rrfScore;
      }
      blendRrfIntoScores(scores, fusedRrfScores);
    }

    return { topBm25Score, vectorParticipated: false, vectorRanking: null, hasSignal };
  }
}
