/**
 * Tool affinity graph implementation.
 * Handles prefix-group expansion and domain hub boosting.
 */
import {
  SEARCH_AFFINITY_BOOST_FACTOR,
  SEARCH_AFFINITY_TOP_N,
  SEARCH_DOMAIN_HUB_THRESHOLD,
} from '@src/constants';

export interface AffinityEdge {
  docIndex: number;
  weight: number;
}

interface DocumentInfo {
  name: string;
  domain: string | null;
}

/**
 * AffinityGraph manages tool affinity relationships for search result boosting.
 * Tools sharing a name prefix form affinity groups that boost each other.
 */
export class AffinityGraphImpl {
  private readonly graph: ReadonlyMap<number, ReadonlyArray<AffinityEdge>>;
  private readonly docCount: number;

  constructor(documents: DocumentInfo[]) {
    this.docCount = documents.length;
    this.graph = this.buildAffinityGraph(documents);
  }

  /**
   * Build prefix-group affinity graph (§4.1.4 dependency hull).
   * Tools sharing a name prefix (e.g. "breakpoint_set", "breakpoint_list")
   * form an affinity group with mutual edges.
   */
  private buildAffinityGraph(
    documents: DocumentInfo[]
  ): ReadonlyMap<number, ReadonlyArray<AffinityEdge>> {
    const graph = new Map<number, AffinityEdge[]>();
    const prefixGroups = new Map<string, number[]>();

    for (let i = 0; i < documents.length; i++) {
      const name = documents[i]!.name;
      const underscoreIdx = name.indexOf('_');
      if (underscoreIdx <= 0) continue;
      const prefix = name.slice(0, underscoreIdx);
      const group = prefixGroups.get(prefix) ?? [];
      group.push(i);
      prefixGroups.set(prefix, group);
    }

    for (const [, members] of prefixGroups) {
      // Skip trivial groups (single member) or overly large ones
      if (members.length < 2 || members.length > 15) continue;
      const affinityWeight = 0.3 / Math.sqrt(members.length); // Decay for larger groups
      for (const src of members) {
        const edges: AffinityEdge[] = graph.get(src) ?? [];
        for (const dst of members) {
          if (dst !== src) {
            edges.push({ docIndex: dst, weight: affinityWeight });
          }
        }
        graph.set(src, edges);
      }
    }

    return graph;
  }

  /**
   * Boost affinity neighbors of top results (§4.1.4).
   * For each of the top-N scored documents, add a fraction of its score
   * to its prefix-group neighbors, encouraging co-retrieval.
   */
  applyAffinityExpansion(scores: Float64Array): void {
    if (this.graph.size === 0) return;

    // Find top-N scoring indices
    const topN = SEARCH_AFFINITY_TOP_N;
    const scored: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! > 0) {
        scored.push({ idx: i, score: scores[i]! });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    const boostFactor = SEARCH_AFFINITY_BOOST_FACTOR;
    const limit = Math.min(topN, scored.length);

    for (let rank = 0; rank < limit; rank++) {
      const { idx, score } = scored[rank]!;
      const neighbors = this.graph.get(idx);
      if (!neighbors) continue;

      const rankDecay = 1 / (1 + rank);
      for (const { docIndex, weight } of neighbors) {
        // Only boost neighbors that already have some relevance signal
        if (scores[docIndex]! > 0) {
          scores[docIndex]! += score * weight * rankDecay * boostFactor;
        }
      }
    }
  }

  /**
   * Domain hub expansion (§4.1.4): when a domain is heavily represented
   * in top results, slightly boost remaining tools from that domain.
   */
  static applyDomainHubExpansion(
    scores: Float64Array,
    docCount: number,
    getDomain: (index: number) => string | null
  ): void {
    const threshold = SEARCH_DOMAIN_HUB_THRESHOLD;
    if (threshold <= 0) return;

    // Count domains in top-10 scored results
    const scored: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < docCount; i++) {
      if (scores[i]! > 0) {
        scored.push({ idx: i, score: scores[i]! });
      }
    }
    if (scored.length < threshold) return;

    scored.sort((a, b) => b.score - a.score);
    const top10 = scored.slice(0, 10);

    const domainCounts = new Map<string, number>();
    for (const { idx } of top10) {
      const domain = getDomain(idx);
      if (domain) {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      }
    }

    for (const [domain, count] of domainCounts) {
      if (count >= threshold) {
        // Apply a small coherence boost to other tools in this domain
        for (let i = 0; i < docCount; i++) {
          if (scores[i]! > 0 && getDomain(i) === domain) {
            scores[i]! *= 1.08;
          }
        }
      }
    }
  }

  /**
   * Get the affinity graph for inspection.
   */
  getGraph(): ReadonlyMap<number, ReadonlyArray<AffinityEdge>> {
    return this.graph;
  }
}
