import {
  SEARCH_AFFINITY_BASE_WEIGHT,
  SEARCH_AFFINITY_BOOST_FACTOR,
  SEARCH_AFFINITY_TOP_N,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER,
  SEARCH_DOMAIN_HUB_THRESHOLD,
  SEARCH_RRF_BM25_BLEND,
  SEARCH_RRF_RESCALE_FACTOR,
} from '@src/constants';

export interface ToolSearchDocumentSnapshot {
  name: string;
  domain: string | null;
}

export interface AffinityEdge {
  docIndex: number;
  weight: number;
}

export function findDelimitedIndex(haystack: string, needle: string, wordChar: RegExp): number {
  if (!needle) return -1;

  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    const before = idx > 0 ? haystack[idx - 1]! : null;
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length]! : null;
    const beforeOk = before === null || !wordChar.test(before);
    const afterOk = after === null || !wordChar.test(after);
    if (beforeOk && afterOk) {
      return idx;
    }
    idx = haystack.indexOf(needle, idx + 1);
  }

  return -1;
}

export function buildAffinityGraph(
  docs: readonly ToolSearchDocumentSnapshot[],
): ReadonlyMap<number, ReadonlyArray<AffinityEdge>> {
  const graph = new Map<number, AffinityEdge[]>();
  const prefixGroups = new Map<string, number[]>();

  for (let i = 0; i < docs.length; i++) {
    const name = docs[i]!.name;
    const underscoreIdx = name.indexOf('_');
    if (underscoreIdx <= 0) continue;

    const prefix = name.slice(0, underscoreIdx);
    const group = prefixGroups.get(prefix) ?? [];
    group.push(i);
    prefixGroups.set(prefix, group);
  }

  for (const [, members] of prefixGroups) {
    if (members.length < 2 || members.length > 15) {
      continue;
    }

    const affinityWeight = SEARCH_AFFINITY_BASE_WEIGHT / Math.sqrt(members.length);
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

export function rankByScores(scores: Float64Array): Map<number, number> {
  const entries: Array<{ idx: number; score: number }> = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i]! > 0) {
      entries.push({ idx: i, score: scores[i]! });
    }
  }

  entries.sort((a, b) => b.score - a.score);
  const ranked = new Map<number, number>();
  for (let rank = 0; rank < entries.length; rank++) {
    ranked.set(entries[rank]!.idx, rank);
  }

  return ranked;
}

export function rankByMap(scoreMap: ReadonlyMap<number, number>): Map<number, number> {
  const entries = [...scoreMap.entries()].toSorted((a, b) => b[1] - a[1]);
  const ranked = new Map<number, number>();
  for (let rank = 0; rank < entries.length; rank++) {
    ranked.set(entries[rank]![0], rank);
  }

  return ranked;
}

export function blendRrfIntoScores(scores: Float64Array, rrfScores: Float64Array): void {
  for (let i = 0; i < scores.length; i++) {
    const rrfScore = rrfScores[i]!;
    if (rrfScore <= 0) {
      continue;
    }

    const bm25Original = scores[i]!;
    const rrfRescaled = rrfScore * SEARCH_RRF_RESCALE_FACTOR;
    const blend = SEARCH_RRF_BM25_BLEND;
    scores[i] = Math.max(bm25Original, rrfRescaled * blend) + rrfRescaled * blend;
  }
}

export function applyGraphExpansionToScores(options: {
  scores: Float64Array;
  docs: readonly ToolSearchDocumentSnapshot[];
  affinityGraph: ReadonlyMap<number, ReadonlyArray<AffinityEdge>>;
}): void {
  const { scores, docs, affinityGraph } = options;

  const scored: Array<{ idx: number; score: number }> = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i]! > 0) {
      scored.push({ idx: i, score: scores[i]! });
    }
  }
  if (scored.length === 0) {
    return;
  }

  scored.sort((a, b) => b.score - a.score);

  if (affinityGraph.size > 0) {
    const limit = Math.min(SEARCH_AFFINITY_TOP_N, scored.length);
    for (let rank = 0; rank < limit; rank++) {
      const { idx, score } = scored[rank]!;
      const neighbors = affinityGraph.get(idx);
      if (!neighbors) {
        continue;
      }

      const rankDecay = 1 / (1 + rank);
      for (const { docIndex, weight } of neighbors) {
        if (scores[docIndex]! > 0) {
          scores[docIndex]! += score * weight * rankDecay * SEARCH_AFFINITY_BOOST_FACTOR;
        }
      }
    }
  }

  if (SEARCH_DOMAIN_HUB_THRESHOLD > 0 && scored.length >= SEARCH_DOMAIN_HUB_THRESHOLD) {
    const top10 = scored.slice(0, 10);
    const domainCounts = new Map<string, number>();

    for (const { idx } of top10) {
      const domain = docs[idx]!.domain;
      if (domain) {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      }
    }

    for (const [domain, count] of domainCounts) {
      if (count < SEARCH_DOMAIN_HUB_THRESHOLD) {
        continue;
      }

      for (let i = 0; i < docs.length; i++) {
        if (scores[i]! > 0 && docs[i]!.domain === domain) {
          scores[i]! *= SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER;
        }
      }
    }
  }
}
