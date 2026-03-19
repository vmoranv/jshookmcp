/**
 * Hybrid BM25 + RRF multi-signal tool search engine for progressive tool discovery.
 *
 * Enhancements:
 * - BM25 keyword scoring with synonym-expanded queries
 * - TF-IDF cosine similarity as an independent RRF signal
 * - Trigram fuzzy matching for typo tolerance
 * - RRF (Reciprocal Rank Fusion) combining all signals
 * - Tool affinity graph with prefix-group expansion (§4.1.4 dependency hull)
 * - Query category adaptive domain weights (§4.1.3 task-type encoding)
 * - Parameter name indexing for schema-aware search
 * - LRU query result cache (§4.3 CSAPC cross-session caching)
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { allTools, getToolDomain } from '@server/ToolCatalog';
import type { SearchConfig } from '@internal-types/config';
import {
  SEARCH_TFIDF_COSINE_WEIGHT,
  SEARCH_AFFINITY_BOOST_FACTOR,
  SEARCH_AFFINITY_TOP_N,
  SEARCH_DOMAIN_HUB_THRESHOLD,
  SEARCH_QUERY_CACHE_CAPACITY,
  SEARCH_TRIGRAM_WEIGHT,
  SEARCH_RRF_K,
  SEARCH_PARAM_TOKEN_WEIGHT,
} from '@src/constants';
import { BM25ScorerImpl } from './BM25Scorer';
import { IntentBoostImpl } from './IntentBoost';
import { TrigramIndex } from './TrigramIndex';

// ── public types ──

export interface ToolSearchResult {
  name: string;
  domain: string | null;
  shortDescription: string;
  score: number;
  isActive: boolean;
}

// ── internal types ──

interface ToolDocument {
  name: string;
  domain: string | null;
  description: string;
  shortDescription: string;
  tokens: string[];
  length: number;
  /** Pre-computed name tokens for search-time reuse. */
  nameTokens: string[];
  /** Pre-computed Set of name tokens — avoids per-search Set construction. */
  nameTokenSet: ReadonlySet<string>;
  /** nameTokenSet.size cached for quick access. */
  nameTokenCount: number;
  /** Sparse TF-IDF vector: term → tfidf weight. */
  tfidfWeights: ReadonlyMap<string, number>;
  /** Pre-computed L2 magnitude of the TF-IDF vector. */
  tfidfMagnitude: number;
}

interface AffinityEdge {
  docIndex: number;
  weight: number;
}

// ── LRU Cache ──

class LRUCache<K, V> {
  private readonly capacity: number;
  private readonly map = new Map<K, V>();

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      // Delete oldest (first entry in insertion order)
      const firstKey = this.map.keys().next().value!;
      this.map.delete(firstKey);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

// ── ToolSearchEngine ──

export class ToolSearchEngine {
  private readonly docs: ToolDocument[] = [];
  private readonly invertedIndex = new Map<
    string,
    { docIndex: number; tf: number; weight: number }[]
  >();
  /** Sorted index keys for O(log V) prefix lookup instead of O(V) scan. */
  private readonly sortedKeys: string[];
  private readonly avgDocLength: number;
  private readonly docCount: number;
  private readonly domainOverrides?: ReadonlyMap<string, string>;
  private readonly domainScoreMultipliers?: ReadonlyMap<string, number>;
  private readonly toolScoreMultipliers?: ReadonlyMap<string, number>;

  /** IDF values per term, used for TF-IDF cosine computation. */
  private readonly idfMap: ReadonlyMap<string, number>;
  /** Name → doc index for O(1) lookup during affinity expansion. */
  private readonly docNameIndex = new Map<string, number>();
  /** Prefix-group affinity graph: docIndex → neighbor edges. */
  private readonly affinityGraph: ReadonlyMap<number, ReadonlyArray<AffinityEdge>>;
  /** Query result LRU cache (§4.3 CSAPC). Stores scored candidates without isActive. */
  private readonly queryCache: LRUCache<string, ToolSearchResult[]>;
  /** Trigram fuzzy matching index over tool names. */
  private readonly trigramIndex: TrigramIndex;

  // Extracted modules
  private readonly bm25Scorer: BM25ScorerImpl;
  private readonly intentBoost: IntentBoostImpl;

  constructor(
    tools?: Tool[],
    domainOverrides?: ReadonlyMap<string, string>,
    domainScoreMultipliers?: ReadonlyMap<string, number>,
    toolScoreMultipliers?: ReadonlyMap<string, number>,
    searchConfig?: SearchConfig
  ) {
    const source = tools ?? allTools;
    this.domainOverrides = domainOverrides;
    this.domainScoreMultipliers = domainScoreMultipliers;
    this.toolScoreMultipliers = toolScoreMultipliers;
    this.docCount = source.length;

    // Initialize extracted modules
    this.bm25Scorer = new BM25ScorerImpl(searchConfig);
    this.intentBoost = new IntentBoostImpl(searchConfig?.intentToolBoostRules);

    let totalLength = 0;
    for (let i = 0; i < source.length; i++) {
      const tool = source[i]!;
      const domain = this.domainOverrides?.get(tool.name) ?? getToolDomain(tool.name);
      const description = tool.description ?? '';
      const shortDescription = extractShortDescription(description);

      const nameTokens = this.bm25Scorer.tokenise(tool.name);
      const nameTokenSet = new Set(nameTokens);
      const domainTokens = domain ? this.bm25Scorer.tokenise(domain) : [];
      const descTokens = this.bm25Scorer.tokenise(description);
      const paramTokens = ToolSearchEngine.extractParamTokens(tool.inputSchema);

      const allTokens = [...nameTokens, ...domainTokens, ...descTokens, ...paramTokens];

      const doc: ToolDocument = {
        name: tool.name,
        domain,
        description,
        shortDescription,
        tokens: allTokens,
        length: allTokens.length,
        nameTokens,
        nameTokenSet,
        nameTokenCount: nameTokenSet.size,
        // TF-IDF fields filled below
        tfidfWeights: new Map(),
        tfidfMagnitude: 0,
      };
      this.docs.push(doc);
      this.docNameIndex.set(tool.name, i);
      totalLength += doc.length;

      const termFreqs = new Map<string, { tf: number; weight: number }>();

      for (const token of nameTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 3);
        termFreqs.set(token, entry);
      }
      for (const token of domainTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 2);
        termFreqs.set(token, entry);
      }
      for (const token of descTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 1);
        termFreqs.set(token, entry);
      }
      for (const token of paramTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, SEARCH_PARAM_TOKEN_WEIGHT);
        termFreqs.set(token, entry);
      }

      for (const [token, { tf, weight }] of termFreqs) {
        let postings = this.invertedIndex.get(token);
        if (!postings) {
          postings = [];
          this.invertedIndex.set(token, postings);
        }
        postings.push({ docIndex: i, tf, weight });
      }
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 1;
    this.sortedKeys = [...this.invertedIndex.keys()].sort();

    // ── TF-IDF vector computation (§4.1.3 hybrid retrieval) ──
    const idfMap = new Map<string, number>();
    for (const [term, postings] of this.invertedIndex) {
      idfMap.set(term, Math.log(1 + this.docCount / postings.length));
    }
    this.idfMap = idfMap;

    for (let i = 0; i < this.docCount; i++) {
      const doc = this.docs[i]!;
      const rawTf = new Map<string, number>();
      for (const token of doc.tokens) {
        rawTf.set(token, (rawTf.get(token) ?? 0) + 1);
      }
      const tfidfWeights = new Map<string, number>();
      let magnitudeSq = 0;
      for (const [term, tf] of rawTf) {
        const idf = idfMap.get(term) ?? 0;
        const w = (1 + Math.log(tf)) * idf;
        tfidfWeights.set(term, w);
        magnitudeSq += w * w;
      }
      // Mutate to assign computed values
      (doc as { tfidfWeights: ReadonlyMap<string, number> }).tfidfWeights = tfidfWeights;
      (doc as { tfidfMagnitude: number }).tfidfMagnitude = Math.sqrt(magnitudeSq);
    }

    // ── Tool affinity graph (§4.1.4 dependency hull expansion) ──
    this.affinityGraph = this.buildAffinityGraph();

    // ── Trigram fuzzy index over tool names ──
    this.trigramIndex = new TrigramIndex(this.docs.map((d) => d.name));

    // ── Query result cache (§4.3 CSAPC) ──
    this.queryCache = new LRUCache<string, ToolSearchResult[]>(SEARCH_QUERY_CACHE_CAPACITY);
  }

  search(query: string, topK = 10, activeToolNames?: ReadonlySet<string>): ToolSearchResult[] {
    // Synonym expansion enabled at query time
    const queryTokens = this.bm25Scorer.tokenise(query, { expandSynonyms: true });
    if (queryTokens.length === 0) {
      return [];
    }

    // ── Explicit tool name mention short-circuit (Scheme 1) ──
    // If the user explicitly mentions a known tool name *and* uses an invocation verb,
    // promote that tool to top-1 to avoid unrelated maintenance tools stealing rank.
    const explicitToolMention = (() => {
      const lower = query.toLowerCase();
      const hasInvokeVerb = /(?:\b(?:call|use|run|invoke|execute)\b|调用|执行|使用|运行)/i.test(
        lower
      );
      if (!hasInvokeVerb) return null;

      const wordCharIdent = /[a-z0-9_]/;
      const wordCharPlain = /[a-z0-9]/;

      const findDelimitedIndex = (haystack: string, needle: string, wordChar: RegExp): number => {
        if (!needle) return -1;
        let idx = haystack.indexOf(needle);
        while (idx >= 0) {
          const before = idx > 0 ? haystack[idx - 1]! : null;
          const after =
            idx + needle.length < haystack.length ? haystack[idx + needle.length]! : null;
          const beforeOk = before === null || !wordChar.test(before);
          const afterOk = after === null || !wordChar.test(after);
          if (beforeOk && afterOk) return idx;
          idx = haystack.indexOf(needle, idx + 1);
        }
        return -1;
      };

      let bestTool: string | null = null;
      let bestIdx = Number.POSITIVE_INFINITY;

      for (const toolName of this.docNameIndex.keys()) {
        // Exact tool name form (snake_case) with strict identifier boundaries.
        let idx = findDelimitedIndex(lower, toolName, wordCharIdent);
        if (idx < 0 && toolName.includes('_')) {
          // Normalized variants: kebab-case / spaced words (underscores ↔ hyphens/spaces).
          idx = findDelimitedIndex(lower, toolName.replace(/_/g, '-'), wordCharPlain);
          if (idx < 0) {
            idx = findDelimitedIndex(lower, toolName.replace(/_/g, ' '), wordCharPlain);
          }
        }
        if (idx < 0) continue;

        if (idx < bestIdx || (idx === bestIdx && toolName.length > (bestTool?.length ?? 0))) {
          bestTool = toolName;
          bestIdx = idx;
        }
      }

      return bestTool;
    })();

    // ── Cache check (§4.3 CSAPC) ──
    const cacheKey = `${query}\0${topK}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      // Update isActive flags from current context
      const active = activeToolNames ?? new Set<string>();
      return cached.map((r) => ({ ...r, isActive: active.has(r.name) }));
    }

    const intentToolBonuses = this.intentBoost.resolveIntentToolBonuses(query);

    const scores = new Float64Array(this.docCount);

    // ── BM25 scoring (existing) ──
    for (const qToken of queryTokens) {
      this.scoreToken(qToken, scores);
      if (qToken.length >= 3) {
        const prefixMatches = this.findPrefixMatches(qToken);
        for (const indexToken of prefixMatches) {
          if (indexToken !== qToken) {
            const postings = this.invertedIndex.get(indexToken);
            if (postings) {
              this.scorePostings(postings, this.docCount, scores, 0.5);
            }
          }
        }
      }
    }

    // ── RRF multi-signal fusion (replaces multiplicative TF-IDF boost) ──
    // Combine BM25 (already in scores), TF-IDF cosine, and trigram signals
    this.applyRRFFusion(queryTokens, query, scores);

    // ── Query category adaptive domain weights (§4.1.3 task-type encoding) ──
    const categoryDomainBoosts = this.bm25Scorer.detectQueryCategoryBoosts(query);

    const queryNormalised = query.toLowerCase().replace(/[\s-]+/g, '_');
    const queryTokenSet = new Set(queryTokens);

    for (let i = 0; i < this.docCount; i++) {
      const doc = this.docs[i]!;
      const intentBonus = intentToolBonuses.get(doc.name) ?? 0;
      if (scores[i]! <= 0 && intentBonus <= 0) continue;

      if (doc.name === queryNormalised) {
        scores[i]! *= 2.5;
        continue;
      }

      // Reuse precomputed nameTokenSet
      let matchedCount = 0;
      for (const qt of queryTokens) {
        if (doc.nameTokenSet.has(qt)) matchedCount++;
      }

      if (matchedCount > 0 && doc.nameTokenCount > 0 && queryTokenSet.size > 0) {
        const coverage = matchedCount / doc.nameTokenCount;
        const precision = matchedCount / queryTokenSet.size;
        scores[i]! *= 1 + 0.5 * coverage * precision;
      }

      // External domain multipliers (e.g. workflow boost from MCPServer.search)
      const domainMultiplier = doc.domain ? (this.domainScoreMultipliers?.get(doc.domain) ?? 1) : 1;
      if (domainMultiplier !== 1) {
        scores[i]! *= domainMultiplier;
      }

      // Category-adaptive domain boost (internal, from query analysis)
      if (doc.domain && categoryDomainBoosts.size > 0) {
        const categoryBoost = categoryDomainBoosts.get(doc.domain);
        if (categoryBoost !== undefined && categoryBoost > 1) {
          scores[i]! *= categoryBoost;
        }
      }

      const toolMultiplier = this.toolScoreMultipliers?.get(doc.name) ?? 1;
      if (toolMultiplier !== 1) {
        scores[i]! *= toolMultiplier;
      }
    }

    // ── Tool affinity expansion (§4.1.4 dependency hull) ──
    this.applyAffinityExpansion(scores);

    // ── Domain hub expansion (§4.1.4) ──
    this.applyDomainHubExpansion(scores);

    // ── Curated intent-routing bonuses ──
    this.applyIntentBonusBand(scores, intentToolBonuses);

    // ── Explicit tool mention promotion (Scheme 1) ──
    if (explicitToolMention) {
      const explicitIdx = this.docNameIndex.get(explicitToolMention);
      if (explicitIdx !== undefined) {
        let maxScore = 0;
        for (let i = 0; i < this.docCount; i++) {
          const s = scores[i]!;
          if (s > maxScore) {
            maxScore = s;
          }
        }
        const bump = Math.max(1, maxScore + 1);
        scores[explicitIdx]! += bump;
      }
    }

    // ── Collect and sort results ──
    const active = activeToolNames ?? new Set<string>();
    const candidates: ToolSearchResult[] = [];

    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! > 0) {
        const doc = this.docs[i]!;
        candidates.push({
          name: doc.name,
          domain: doc.domain,
          shortDescription: doc.shortDescription,
          score: Math.round(scores[i]! * 1000) / 1000,
          isActive: active.has(doc.name),
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const results = candidates.slice(0, topK);

    // ── Cache store ──
    this.queryCache.set(cacheKey, results);

    return results;
  }

  getDomainSummary(): Array<{ domain: string | null; count: number; tools: string[] }> {
    const domainMap = new Map<string | null, string[]>();
    for (const doc of this.docs) {
      const list = domainMap.get(doc.domain) ?? [];
      list.push(doc.name);
      domainMap.set(doc.domain, list);
    }
    return Array.from(domainMap.entries())
      .map(([domain, tools]) => ({ domain, count: tools.length, tools }))
      .sort((a, b) => b.count - a.count);
  }

  private scoreToken(token: string, scores: Float64Array): void {
    const postings = this.invertedIndex.get(token);
    if (!postings) return;
    this.scorePostings(postings, this.docCount, scores, 1.0);
  }

  /**
   * Binary-search the sorted key array to find all tokens starting with `prefix`.
   * O(log V + P) where P = number of prefix matches, instead of O(V) full scan.
   */
  private findPrefixMatches(prefix: string): string[] {
    const keys = this.sortedKeys;
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (keys[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    const matches: string[] = [];
    while (lo < keys.length && keys[lo]!.startsWith(prefix)) {
      matches.push(keys[lo]!);
      lo++;
    }
    return matches;
  }

  private scorePostings(
    postings: { docIndex: number; tf: number; weight: number }[],
    _N: number,
    scores: Float64Array,
    multiplier: number
  ): void {
    const df = postings.length;
    const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);

    for (const { docIndex, tf, weight } of postings) {
      const doc = this.docs[docIndex]!;
      const norm = 1 - 0.3 + 0.3 * (doc.length / this.avgDocLength);
      const tfNorm = (tf * (1.5 + 1)) / (tf + 1.5 * norm);
      scores[docIndex]! += idf * tfNorm * weight * multiplier;
    }
  }

  /**
   * RRF (Reciprocal Rank Fusion) multi-signal scoring.
   *
   * Combines three independent ranking signals:
   *   1. BM25 scores (already computed in `scores`)
   *   2. TF-IDF cosine similarity
   *   3. Trigram Jaccard similarity (fuzzy name matching)
   *
   * RRF formula: finalScore(d) = Σ_signal  1 / (k + rank_signal(d))
   *
   * Unlike the old multiplicative TF-IDF boost, RRF allows each signal to
   * independently contribute — a document with BM25=0 but high trigram
   * similarity can still surface.
   */
  private applyRRFFusion(queryTokens: string[], query: string, scores: Float64Array): void {
    const k = SEARCH_RRF_K;
    const trigramWeight = SEARCH_TRIGRAM_WEIGHT;
    const tfidfWeight = SEARCH_TFIDF_COSINE_WEIGHT;

    // ── Signal 1: BM25 ranking (already in scores) ──
    const bm25Ranked = this.rankByScores(scores);

    // ── Signal 2: TF-IDF cosine similarity ──
    const cosineScores = this.computeTfidfCosineScores(queryTokens);
    const cosineRanked = this.rankByMap(cosineScores);

    // ── Signal 3: Trigram fuzzy matching ──
    const trigramScores = this.trigramIndex.search(query, 0.2);
    const trigramRanked = this.rankByMap(trigramScores);

    // ── Fuse via RRF ──
    // Reset scores and rebuild from RRF
    for (let i = 0; i < this.docCount; i++) {
      let rrfScore = 0;

      const bm25Rank = bm25Ranked.get(i);
      if (bm25Rank !== undefined) {
        rrfScore += 1 / (k + bm25Rank);
      }

      const cosineRank = cosineRanked.get(i);
      if (cosineRank !== undefined && tfidfWeight > 0) {
        rrfScore += tfidfWeight * (1 / (k + cosineRank));
      }

      const trigramRank = trigramRanked.get(i);
      if (trigramRank !== undefined && trigramWeight > 0) {
        rrfScore += trigramWeight * (1 / (k + trigramRank));
      }

      // Scale RRF score up to be comparable with original BM25 magnitude
      // Preserve original BM25 scores for docs in the BM25 ranking to
      // maintain downstream boost compatibility (affinity, domain hub, etc.)
      if (rrfScore > 0) {
        const bm25Original = scores[i]!;
        // Use RRF as a re-ranking signal: blend BM25 and RRF
        // This way pure BM25 matches keep their absolute score for downstream
        // boosting, while RRF can rescue BM25-missed docs.
        const rrfRescaled = rrfScore * 1000; // Scale to BM25-comparable range
        scores[i] = Math.max(bm25Original, rrfRescaled * 0.5) + rrfRescaled * 0.5;
      }
    }
  }

  /**
   * Compute raw TF-IDF cosine similarity scores for each document.
   * Returns Map<docIndex, cosineScore>.
   */
  private computeTfidfCosineScores(queryTokens: string[]): Map<number, number> {
    const queryTf = new Map<string, number>();
    for (const token of queryTokens) {
      queryTf.set(token, (queryTf.get(token) ?? 0) + 1);
    }
    const queryWeights = new Map<string, number>();
    let queryMagSq = 0;
    for (const [term, tf] of queryTf) {
      const idf = this.idfMap.get(term) ?? 0;
      if (idf === 0) continue;
      const w = (1 + Math.log(tf)) * idf;
      queryWeights.set(term, w);
      queryMagSq += w * w;
    }
    if (queryMagSq === 0) return new Map();
    const queryMagnitude = Math.sqrt(queryMagSq);

    const results = new Map<number, number>();
    for (let i = 0; i < this.docCount; i++) {
      const doc = this.docs[i]!;
      if (doc.tfidfMagnitude === 0) continue;

      let dot = 0;
      for (const [term, qw] of queryWeights) {
        const dw = doc.tfidfWeights.get(term);
        if (dw !== undefined) dot += qw * dw;
      }
      if (dot <= 0) continue;

      results.set(i, dot / (queryMagnitude * doc.tfidfMagnitude));
    }
    return results;
  }

  /**
   * Rank documents by Float64Array scores.
   * Returns Map<docIndex, rank> (0-based, lower = better).
   */
  private rankByScores(scores: Float64Array): Map<number, number> {
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

  /**
   * Rank documents by a score map.
   * Returns Map<docIndex, rank> (0-based, lower = better).
   */
  private rankByMap(scoreMap: Map<number, number>): Map<number, number> {
    const entries = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]);
    const ranked = new Map<number, number>();
    for (let rank = 0; rank < entries.length; rank++) {
      ranked.set(entries[rank]![0], rank);
    }
    return ranked;
  }

  /**
   * Apply curated intent bonuses as a final ranking band.
   * Any tool with an explicit routing bonus should outrank non-bonus matches,
   * and higher bonus tiers should outrank lower ones while preserving
   * relevance order within the same tier.
   */
  private applyIntentBonusBand(
    scores: Float64Array,
    intentToolBonuses: ReadonlyMap<string, number>,
  ): void {
    if (intentToolBonuses.size === 0) {
      return;
    }

    let maxScore = 0;
    for (let i = 0; i < this.docCount; i++) {
      maxScore = Math.max(maxScore, scores[i]!);
    }

    let maxBonus = 0;
    for (const bonus of intentToolBonuses.values()) {
      maxBonus = Math.max(maxBonus, bonus);
    }

    if (maxBonus <= 0) {
      return;
    }

    const bonusBand = Math.max(1, maxScore + 1);
    const distinctBonuses = [...new Set([...intentToolBonuses.values()].filter((bonus) => bonus > 0))]
      .sort((a, b) => a - b);
    const bonusTierByValue = new Map<number, number>();
    for (let i = 0; i < distinctBonuses.length; i++) {
      bonusTierByValue.set(distinctBonuses[i]!, i + 1);
    }

    for (const [toolName, bonus] of intentToolBonuses) {
      if (bonus <= 0) {
        continue;
      }
      const docIndex = this.docNameIndex.get(toolName);
      if (docIndex === undefined) {
        continue;
      }
      const tier = bonusTierByValue.get(bonus);
      if (tier === undefined) {
        continue;
      }
      scores[docIndex]! += bonusBand * tier;
    }
  }

  /**
   * Extract parameter names from a tool's inputSchema for indexing.
   * Handles both simple flat properties and nested object properties.
   */
  static extractParamTokens(inputSchema: unknown): string[] {
    const tokens: string[] = [];
    if (!inputSchema || typeof inputSchema !== 'object') return tokens;

    const schema = inputSchema as Record<string, unknown>;
    const properties = schema.properties;
    if (!properties || typeof properties !== 'object') return tokens;

    for (const [paramName, paramDef] of Object.entries(properties as Record<string, unknown>)) {
      // Add the parameter name itself (split on camelCase)
      const nameParts = paramName.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/);
      for (const part of nameParts) {
        const lower = part.toLowerCase();
        if (lower.length > 1) {
          tokens.push(lower);
        }
      }

      // Add description tokens if available
      if (paramDef && typeof paramDef === 'object') {
        const desc = (paramDef as Record<string, unknown>).description;
        if (typeof desc === 'string') {
          // Extract only key terms from description (skip very common words)
          const STOP_WORDS = new Set([
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
            'or', 'and', 'not', 'this', 'that', 'it', 'its', 'if', 'as',
            'will', 'can', 'may', 'must', 'should', 'would', 'could',
            'e', 'g', 'default', 'optional', 'required', 'when', 'set',
          ]);
          const descWords = desc.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          for (const w of descWords) {
            if (w.length > 2 && !STOP_WORDS.has(w)) {
              tokens.push(w);
            }
          }
        }
      }
    }

    return tokens;
  }

  /**
   * Build prefix-group affinity graph (§4.1.4 dependency hull).
   * Tools sharing a name prefix (e.g. "breakpoint_set", "breakpoint_list")
   * form an affinity group with mutual edges.
   */
  private buildAffinityGraph(): ReadonlyMap<number, ReadonlyArray<AffinityEdge>> {
    const graph = new Map<number, AffinityEdge[]>();
    const prefixGroups = new Map<string, number[]>();

    for (let i = 0; i < this.docCount; i++) {
      const name = this.docs[i]!.name;
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
  private applyAffinityExpansion(scores: Float64Array): void {
    if (this.affinityGraph.size === 0) return;

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
      const neighbors = this.affinityGraph.get(idx);
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
  private applyDomainHubExpansion(scores: Float64Array): void {
    const threshold = SEARCH_DOMAIN_HUB_THRESHOLD;
    if (threshold <= 0) return;

    // Count domains in top-10 scored results
    const scored: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! > 0) {
        scored.push({ idx: i, score: scores[i]! });
      }
    }
    if (scored.length < threshold) return;

    scored.sort((a, b) => b.score - a.score);
    const top10 = scored.slice(0, 10);

    const domainCounts = new Map<string, number>();
    for (const { idx } of top10) {
      const domain = this.docs[idx]!.domain;
      if (domain) {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
      }
    }

    for (const [domain, count] of domainCounts) {
      if (count >= threshold) {
        // Apply a small coherence boost to other tools in this domain
        for (let i = 0; i < this.docCount; i++) {
          if (scores[i]! > 0 && this.docs[i]!.domain === domain) {
            scores[i]! *= 1.08;
          }
        }
      }
    }
  }
}

function extractShortDescription(description: string): string {
  if (!description) return '';
  const firstSentence = description.match(/^[^.!?\n]+[.!?]?/);
  if (firstSentence) {
    const result = firstSentence[0]!.trim();
    return result.length > 120 ? result.slice(0, 117) + '...' : result;
  }
  return description.length > 120 ? description.slice(0, 117) + '...' : description;
}
