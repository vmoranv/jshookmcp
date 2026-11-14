import { QueryNormalizer } from './QueryNormalizer';

export interface ReRankResult {
  toolName: string;
  originalRank: number;
  reRankedScore: number;
}

export interface ReRankOptions {
  topK?: number;
  /** Whether to apply Maximal Marginal Relevance (MMR) category diversification (default: true). */
  enableMMR?: boolean;
  /** Trade-off between relevance and diversity (0 to 1, default: 0.85). */
  diversityLambda?: number;
  /** Soft quota on maximum tools from the same domain in the top-K selection (default: 2). */
  maxPerDomain?: number;
}

export interface ReRankInput {
  toolName: string;
  score: number;
  domain: string;
  description: string;
}

export interface ToolMetadata {
  name: string;
  domain: string;
  description: string;
}

interface ReRankWeights {
  queryToolNameMatch: number;
  descriptionKeywordOverlap: number;
  domainRelevance: number;
  intentAlignment: number;
}

/**
 * ReRank blend weights between the upstream retrieval score (BM25 + RRF +
 * graph/tier boosts) and the local lexical-similarity reRank score.
 *
 * Both components are normalised to [0, 1] before blending (see reRank), so
 * the upstream absolute-scale score — which can reach tens after RRF + graph
 * expansion — no longer dominates or is dominated by the 0–1 lexical score.
 * 0.6 / 0.4 keeps retrieval relevance as the primary signal while letting
 * name-match / keyword-overlap break ties and reorder near-misses.
 */
const RETRIEVAL_WEIGHT = 0.6;
const LEXICAL_WEIGHT = 0.4;

const DEFAULT_WEIGHTS: Readonly<ReRankWeights> = {
  queryToolNameMatch: 0.35,
  descriptionKeywordOverlap: 0.25,
  domainRelevance: 0.2,
  intentAlignment: 0.2,
};

function normalizeForComparison(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => QueryNormalizer.stemRerankToken(t));
}

function longestCommonSubsequenceRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  let prevRow = new Float64Array(shorter.length + 1);
  let currRow = new Float64Array(shorter.length + 1);

  for (let i = 1; i <= longer.length; i++) {
    const longerCh = longer[i - 1];
    for (let j = 1; j <= shorter.length; j++) {
      const prevVal = prevRow[j - 1] ?? 0;
      if (longerCh === shorter[j - 1]) {
        currRow[j] = prevVal + 1;
      } else {
        currRow[j] = Math.max(prevRow[j] ?? 0, currRow[j - 1] ?? 0);
      }
    }
    const tmp = prevRow;
    prevRow = currRow;
    currRow = tmp;
    currRow.fill(0);
  }

  const lcsLen = prevRow[shorter.length] ?? 0;
  return lcsLen / Math.max(a.length, b.length);
}

function computeDescriptionOverlap(
  queryTokenSet: ReadonlySet<string>,
  description: string,
): number {
  if (queryTokenSet.size === 0) return 0;
  const descTokens = tokenize(description);
  let overlapCount = 0;
  for (const dt of descTokens) {
    if (queryTokenSet.has(dt)) {
      overlapCount++;
    }
  }
  return overlapCount / queryTokenSet.size;
}

export class ReRanker {
  private readonly weights: Readonly<ReRankWeights>;
  private readonly domainKeywords: Map<string, Set<string>>;

  constructor(weights?: Partial<ReRankWeights>) {
    this.weights = weights ? { ...DEFAULT_WEIGHTS, ...weights } : DEFAULT_WEIGHTS;
    this.domainKeywords = new Map();
  }

  buildFromTools(tools: ReadonlyArray<ToolMetadata>): void {
    const domainTokens = new Map<string, Map<string, number>>();

    for (const tool of tools) {
      if (!tool.domain) continue;
      let tokenFreq = domainTokens.get(tool.domain);
      if (!tokenFreq) {
        tokenFreq = new Map();
        domainTokens.set(tool.domain, tokenFreq);
      }

      const nameTokens = tokenize(tool.name);
      for (const t of nameTokens) {
        tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
      }

      const descTokens = tokenize(tool.description);
      for (const t of descTokens) {
        if (t.length >= 3) {
          tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1);
        }
      }
    }

    for (const [domain, tokenFreq] of domainTokens) {
      const sorted = [...tokenFreq.entries()].toSorted((a, b) => b[1] - a[1]).slice(0, 15);
      this.domainKeywords.set(domain, new Set(sorted.map(([t]) => t)));
    }
  }

  private computeItemSimilarity(a: ReRankInput, b: ReRankInput): number {
    // Functional redundancy: token overlap between tool names and descriptions
    const tokensA = new Set([...tokenize(a.toolName), ...tokenize(a.description)]);
    const tokensB = [...tokenize(b.toolName), ...tokenize(b.description)];
    if (tokensA.size === 0 || tokensB.length === 0) return 0;

    let intersection = 0;
    for (const t of tokensB) {
      if (tokensA.has(t)) intersection++;
    }
    const unionSize = tokensA.size + tokensB.length - intersection;
    return unionSize > 0 ? intersection / unionSize : 0;
  }

  private diversifyWithMMR(
    candidates: Array<{ result: ReRankInput; originalRank: number; reRankScore: number }>,
    k: number,
    targetDomains: ReadonlySet<string>,
    lambda = 0.9,
    maxPerDomain = 3,
  ): Array<{ result: ReRankInput; originalRank: number; reRankScore: number }> {
    if (candidates.length <= 1) return candidates;

    const remaining = candidates.toSorted((a, b) => b.reRankScore - a.reRankScore);
    const selected: Array<{ result: ReRankInput; originalRank: number; reRankScore: number }> = [];
    const domainCounts = new Map<string, number>();

    // Step 1: Top-1 candidate is always preserved (protects top-1 precision)
    const top1 = remaining.shift()!;
    selected.push(top1);
    if (top1.result.domain) {
      domainCounts.set(top1.result.domain, 1);
    }

    // Step 2: Iteratively select the next candidate that maximizes MMR
    while (selected.length < k && remaining.length > 0) {
      let bestIdx = 0;
      let bestMmrScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]!;

        // Max functional similarity to any already-selected item
        let maxSim = 0;
        for (const s of selected) {
          const sim = this.computeItemSimilarity(candidate.result, s.result);
          if (sim > maxSim) maxSim = sim;
        }

        // Standard MMR formulation: lambda * Relevance - (1 - lambda) * MaxSimilarity
        let mmrScore = lambda * candidate.reRankScore - (1 - lambda) * maxSim;

        // Apply domain slot limit only to non-target domains
        const domain = candidate.result.domain;
        if (domain && !targetDomains.has(domain)) {
          const currentCount = domainCounts.get(domain) ?? 0;
          if (currentCount >= maxPerDomain) {
            mmrScore -= 0.15 * (currentCount - maxPerDomain + 1);
          }
        }

        if (mmrScore > bestMmrScore) {
          bestMmrScore = mmrScore;
          bestIdx = i;
        }
      }

      const [chosen] = remaining.splice(bestIdx, 1);
      if (chosen) {
        selected.push(chosen);
        if (chosen.result.domain) {
          domainCounts.set(chosen.result.domain, (domainCounts.get(chosen.result.domain) ?? 0) + 1);
        }
      }
    }

    return selected;
  }

  reRank(
    query: string,
    results: ReRankInput[],
    topKOrOptions?: number | ReRankOptions,
  ): ReRankResult[] {
    if (results.length === 0) return [];

    const options: ReRankOptions =
      typeof topKOrOptions === 'number' ? { topK: topKOrOptions } : (topKOrOptions ?? {});

    const k = options.topK ?? results.length;
    const enableMMR = options.enableMMR ?? true;
    const lambda = options.diversityLambda ?? 0.9;
    const maxPerDomain = options.maxPerDomain ?? 3;
    const normalizedQuery = normalizeForComparison(query);
    const queryTokens = tokenize(query);
    const queryTokenSet = new Set(queryTokens);

    const targetDomains = this.inferTargetDomain(queryTokens);

    // Min-max normalise the upstream retrieval scores so the blend with the
    // [0,1] lexical reRank score is dimensionally consistent.
    let minScore = Infinity;
    let maxScore = -Infinity;
    for (const r of results) {
      if (r.score < minScore) minScore = r.score;
      if (r.score > maxScore) maxScore = r.score;
    }
    const scoreRange = maxScore - minScore;

    const scored: Array<{ result: ReRankInput; originalRank: number; reRankScore: number }> = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;

      const toolNameNorm = normalizeForComparison(r.toolName);
      const nameMatch = longestCommonSubsequenceRatio(normalizedQuery, toolNameNorm);

      const descriptionOverlap = computeDescriptionOverlap(queryTokenSet, r.description);

      let domainRel = 0;
      if (targetDomains.size > 0 && r.domain) {
        domainRel = targetDomains.has(r.domain) ? 1 : 0;
      }

      const intentAlign = this.computeIntentAlignment(queryTokens, r.description);

      const lexicalScore =
        this.weights.queryToolNameMatch * nameMatch +
        this.weights.descriptionKeywordOverlap * descriptionOverlap +
        this.weights.domainRelevance * domainRel +
        this.weights.intentAlignment * intentAlign;

      const normalizedRetrieval = scoreRange > 0 ? (r.score - minScore) / scoreRange : 1;
      const finalScore = RETRIEVAL_WEIGHT * normalizedRetrieval + LEXICAL_WEIGHT * lexicalScore;

      scored.push({ result: r, originalRank: i, reRankScore: finalScore });
    }

    const ordered = enableMMR
      ? this.diversifyWithMMR(scored, k, targetDomains, lambda, maxPerDomain)
      : scored.toSorted((a, b) => b.reRankScore - a.reRankScore).slice(0, k);

    return ordered.map((s) => ({
      toolName: s.result.toolName,
      originalRank: s.originalRank,
      reRankedScore: Math.round(s.reRankScore * 10000) / 10000,
    }));
  }

  private inferTargetDomain(queryTokens: string[]): Set<string> {
    const domains = new Set<string>();
    const tokenSet = new Set(queryTokens);

    for (const [domain, keywords] of this.domainKeywords) {
      for (const kw of keywords) {
        if (tokenSet.has(kw)) {
          domains.add(domain);
          break;
        }
      }
    }

    return domains;
  }

  private computeIntentAlignment(queryTokens: string[], description: string): number {
    if (queryTokens.length === 0 || this.domainKeywords.size === 0) return 0;
    const lowerDesc = description.toLowerCase();

    const allIntentKeywords: string[] = [];
    for (const keywords of this.domainKeywords.values()) {
      for (const kw of keywords) {
        allIntentKeywords.push(kw);
      }
    }

    const queryIntentTokens = queryTokens.filter((t) => allIntentKeywords.includes(t));

    if (queryIntentTokens.length === 0) return 0;

    let matchCount = 0;
    for (const t of queryIntentTokens) {
      if (lowerDesc.includes(t)) {
        matchCount++;
      }
    }

    return matchCount / queryIntentTokens.length;
  }
}
