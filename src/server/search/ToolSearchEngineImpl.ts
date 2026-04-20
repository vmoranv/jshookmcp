/**
 * Hybrid BM25 + RRF multi-signal tool search engine for progressive tool discovery.
 *
 * Enhancements:
 * - BM25 keyword scoring with synonym-expanded queries and field weights
 * - Trigram fuzzy matching for typo tolerance
 * - RRF (Reciprocal Rank Fusion) combining all signals
 * - Dense vector similarity (384-dim embeddings) as semantic signal
 * - Tool affinity graph with prefix-group expansion (§4.1.4 dependency hull)
 * - Query category adaptive domain weights (§4.1.3 task-type encoding)
 * - Parameter name indexing for schema-aware search
 * - LRU query result cache (§4.3 CSAPC cross-session caching)
 */
function findDelimitedIndex(haystack: string, needle: string, wordChar: RegExp): number {
  if (!needle) return -1;
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    const before = idx > 0 ? haystack[idx - 1]! : null;
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length]! : null;
    const beforeOk = before === null || !wordChar.test(before);
    const afterOk = after === null || !wordChar.test(after);
    if (beforeOk && afterOk) return idx;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return -1;
}

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { allTools, getToolDomain } from '@server/ToolCatalog';
import type { ToolProfile } from '@server/ToolCatalog';
import type { SearchConfig } from '@internal-types/config';
import {
  SEARCH_AFFINITY_BASE_WEIGHT,
  SEARCH_AFFINITY_BOOST_FACTOR,
  SEARCH_AFFINITY_TOP_N,
  SEARCH_BM25_B,
  SEARCH_BM25_K1,
  SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE,
  SEARCH_COVERAGE_PRECISION_FACTOR,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER,
  SEARCH_DOMAIN_HUB_THRESHOLD,
  SEARCH_EXACT_NAME_MATCH_MULTIPLIER,
  SEARCH_PARAM_TOKEN_WEIGHT,
  SEARCH_PREFIX_MATCH_MULTIPLIER,
  SEARCH_QUERY_CACHE_CAPACITY,
  SEARCH_RECENCY_MAX_BOOST,
  SEARCH_RECENCY_TRACKER_MAX,
  SEARCH_RECENCY_WINDOW_MS,
  SEARCH_RRF_BM25_BLEND,
  SEARCH_RRF_K,
  SEARCH_RRF_RESCALE_FACTOR,
  SEARCH_TIER_PENALTY,
  SEARCH_TIER_PENALTY_SEARCH,
  SEARCH_TIER_PENALTY_WORKFLOW,
  SEARCH_TIER_PENALTY_FULL,
  SEARCH_TRIGRAM_THRESHOLD,
  SEARCH_TRIGRAM_WEIGHT,
  SEARCH_VECTOR_ENABLED,
} from '@src/constants';
import { BM25ScorerImpl } from './BM25Scorer';
import { EmbeddingEngine } from './EmbeddingEngine';
import { IntentBoostImpl } from './IntentBoost';
import { TrigramIndex } from './TrigramIndex';
import { FeedbackTracker } from './FeedbackTracker';
import { QueryNormalizer } from './QueryNormalizer';

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
}

interface AffinityEdge {
  docIndex: number;
  weight: number;
}

/**
 * Cached search result with provenance: the vector weight at cache time and
 * a timestamp used to decide whether to apply recency boost on top.
 */
interface CachedSearchEntry {
  results: ToolSearchResult[];
  vectorWeightAtCache: number;
  cachedAtMs: number;
}

function buildSearchCacheKey(
  query: string,
  topK: number,
  visibleDomains?: ReadonlySet<string>,
): string {
  if (!visibleDomains || visibleDomains.size === 0) {
    return `${query}\0${topK}`;
  }
  return `${query}\0${topK}\0${[...visibleDomains].toSorted().join('|')}`;
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

  /** Name → doc index for O(1) lookup during affinity expansion. */
  private readonly docNameIndex = new Map<string, number>();
  /** Prefix-group affinity graph: docIndex → neighbor edges. */
  private readonly affinityGraph: ReadonlyMap<number, ReadonlyArray<AffinityEdge>>;
  /**
   * Query result LRU cache (§4.3 CSAPC). Entries are versioned by the live
   * vector weight; stale entries are dropped only when the weight drifted
   * beyond SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE, avoiding the full-flush
   * behavior of the previous epoch-bump approach.
   */
  private readonly queryCache: LRUCache<string, CachedSearchEntry>;
  /** Trigram fuzzy matching index over tool names. */
  private readonly trigramIndex: TrigramIndex;

  // ── Dense vector search (Phase 8) ──
  private readonly embeddingEngine: EmbeddingEngine | null;
  private toolEmbeddings: Float32Array[] | null = null;
  /** Feedback tracking for adaptive vector weight adjustment. */
  private readonly feedbackTracker: FeedbackTracker;
  /** Per-tool recency tracker for frequency / recency boosts. */
  private readonly recencyTracker = new Map<string, number>();

  // Extracted modules
  private readonly bm25Scorer: BM25ScorerImpl;
  private readonly intentBoost: IntentBoostImpl;

  constructor(
    tools?: Tool[],
    domainOverrides?: ReadonlyMap<string, string>,
    domainScoreMultipliers?: ReadonlyMap<string, number>,
    toolScoreMultipliers?: ReadonlyMap<string, number>,
    searchConfig?: SearchConfig,
  ) {
    const source = tools ?? allTools;
    this.domainOverrides = domainOverrides;
    this.domainScoreMultipliers = domainScoreMultipliers;
    this.toolScoreMultipliers = toolScoreMultipliers;
    this.docCount = source.length;

    // Initialize extracted modules
    this.bm25Scorer = new BM25ScorerImpl(searchConfig);

    // Initialize vector search (Phase 8)
    const vectorEnabled = searchConfig?.vectorEnabled ?? SEARCH_VECTOR_ENABLED;
    this.embeddingEngine = vectorEnabled ? new EmbeddingEngine() : null;
    this.feedbackTracker = new FeedbackTracker(searchConfig);
    this.intentBoost = new IntentBoostImpl(searchConfig?.intentToolBoostRules);

    let totalLength = 0;
    for (let i = 0; i < source.length; i++) {
      const tool = source[i]!;
      const domain = this.domainOverrides?.get(tool.name) ?? getToolDomain(tool.name);
      const description = tool.description ?? '';
      const shortDescription = QueryNormalizer.extractShortDescription(description);

      const nameTokens = this.bm25Scorer.tokenise(tool.name);
      const nameTokenSet = new Set(nameTokens);
      const domainTokens = domain ? this.bm25Scorer.tokenise(domain) : [];
      const descTokens = this.bm25Scorer.tokenise(description);
      const paramTokens = QueryNormalizer.extractParamTokens(tool.inputSchema);

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
    this.sortedKeys = [...this.invertedIndex.keys()].toSorted();

    // ── Tool affinity graph (§4.1.4 dependency hull expansion) ──
    this.affinityGraph = this.buildAffinityGraph();

    // ── Trigram fuzzy index over tool names ──
    this.trigramIndex = new TrigramIndex(this.docs.map((d) => d.name));

    // ── Query result cache (§4.3 CSAPC) ──
    this.queryCache = new LRUCache<string, CachedSearchEntry>(SEARCH_QUERY_CACHE_CAPACITY);
  }

  async search(
    query: string,
    topK = 10,
    activeToolNames?: ReadonlySet<string>,
    visibleDomains?: ReadonlySet<string>,
    profile?: ToolProfile,
  ): Promise<ToolSearchResult[]> {
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
        lower,
      );
      if (!hasInvokeVerb) return null;

      const wordCharIdent = /[a-z0-9_]/;
      const wordCharPlain = /[a-z0-9]/;

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

    // ── Cache check (§4.3 CSAPC) — value-versioned invalidation ──
    // A cached entry stays valid while the live vector weight drifts within
    // SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE of the weight recorded at insert
    // time. Avoids the full flush that the previous epoch counter caused.
    const cacheKey = buildSearchCacheKey(query, topK, visibleDomains);
    const cached = this.queryCache.get(cacheKey);
    if (cached && this.isCachedEntryFresh(cached)) {
      const active = activeToolNames ?? new Set<string>();
      return cached.results.map((r) => ({ ...r, isActive: active.has(r.name) }));
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
              this.scorePostings(postings, this.docCount, scores, SEARCH_PREFIX_MATCH_MULTIPLIER);
            }
          }
        }
      }
    }

    // ── RRF multi-signal fusion (replaces multiplicative TF-IDF boost) ──
    // Combine BM25 (already in scores), TF-IDF cosine, trigram, and vector signals
    await this.applyRRFFusion(queryTokens, query, scores);

    // ── Query category adaptive domain weights (§4.1.3 task-type encoding) ──
    const categoryDomainBoosts = this.bm25Scorer.detectQueryCategoryBoosts(query);

    const queryNormalised = query.toLowerCase().replace(/[\s-]+/g, '_');
    const queryTokenSet = new Set(queryTokens);

    for (let i = 0; i < this.docCount; i++) {
      const doc = this.docs[i]!;
      const intentBonus = intentToolBonuses.get(doc.name) ?? 0;
      if (scores[i]! <= 0 && intentBonus <= 0) continue;

      if (doc.name === queryNormalised) {
        scores[i]! *= SEARCH_EXACT_NAME_MATCH_MULTIPLIER;
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
        scores[i]! *= 1 + SEARCH_COVERAGE_PRECISION_FACTOR * coverage * precision;
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

    // ── Graph expansion: affinity + domain hub (§4.1.4) ──
    this.applyGraphExpansion(scores);

    // ── Curated intent-routing bonuses ──
    this.applyIntentBonusBand(scores, intentToolBonuses);

    // ── Recency / frequency boost ──
    this.applyRecencyBoost(scores);

    // ── Profile tier penalty ──
    // Downweight (do NOT filter) tools whose domain is not in the caller's
    // active tier. Keeping them visible lets the LLM discover higher-tier
    // capabilities when lexical evidence is strong, but prevents them from
    // crowding the top of workflow/search tier results.
    this.applyTierPenalty(scores, visibleDomains, profile);

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

    // ── Cache store (value-versioned) ──
    this.queryCache.set(cacheKey, {
      results,
      vectorWeightAtCache: this.feedbackTracker.getVectorWeight(),
      cachedAtMs: Date.now(),
    });

    return results;
  }

  /**
   * Decide whether a cached entry is still usable. Entries drift out of date
   * primarily because the adaptive vector weight moved; we tolerate a small
   * delta to avoid flushing on every feedback event.
   */
  private isCachedEntryFresh(entry: CachedSearchEntry): boolean {
    const currentWeight = this.feedbackTracker.getVectorWeight();
    return (
      Math.abs(currentWeight - entry.vectorWeightAtCache) <= SEARCH_CACHE_VECTOR_WEIGHT_TOLERANCE
    );
  }

  /**
   * Apply recency / frequency boost: tools invoked within the configured
   * window receive a log-scaled bonus proportional to how recent the hit
   * was. Helps surface user-preferred tools for repeat queries without
   * overwhelming the lexical signals.
   */
  private applyRecencyBoost(scores: Float64Array): void {
    if (SEARCH_RECENCY_MAX_BOOST <= 0 || this.recencyTracker.size === 0) {
      return;
    }
    const windowMs = SEARCH_RECENCY_WINDOW_MS;
    if (windowMs <= 0) return;
    const now = Date.now();
    const base = SEARCH_RECENCY_MAX_BOOST;

    for (const [name, lastUsedMs] of this.recencyTracker) {
      const age = now - lastUsedMs;
      if (age < 0 || age > windowMs) continue;
      const docIdx = this.docNameIndex.get(name);
      if (docIdx === undefined) continue;
      if (scores[docIdx]! <= 0) continue;
      const freshness = 1 - age / windowMs; // 1 = just used, 0 = at window edge
      const multiplier = 1 + base * freshness;
      scores[docIdx]! *= multiplier;
    }
  }

  /**
   * Downweight tools whose domain is not visible under the caller's profile
   * tier. The penalty is a soft multiplier in [0, 1]; 1 disables the feature.
   * Tools without a resolved domain are left untouched.
   */
  private applyTierPenalty(
    scores: Float64Array,
    visibleDomains: ReadonlySet<string> | undefined,
    profile?: ToolProfile,
  ): void {
    if (!visibleDomains || visibleDomains.size === 0) return;
    const penalty = profile
      ? profile === 'full'
        ? SEARCH_TIER_PENALTY_FULL
        : profile === 'workflow'
          ? SEARCH_TIER_PENALTY_WORKFLOW
          : SEARCH_TIER_PENALTY_SEARCH
      : SEARCH_TIER_PENALTY;
    if (penalty >= 1 || penalty <= 0) return;

    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! <= 0) continue;
      const domain = this.docs[i]!.domain;
      if (!domain) continue;
      if (!visibleDomains.has(domain)) {
        scores[i]! *= penalty;
      }
    }
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
      .toSorted((a, b) => b.count - a.count);
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
    multiplier: number,
  ): void {
    const df = postings.length;
    const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);
    const b = SEARCH_BM25_B;
    const k1 = SEARCH_BM25_K1;

    for (const { docIndex, tf, weight } of postings) {
      const doc = this.docs[docIndex]!;
      const norm = 1 - b + b * (doc.length / this.avgDocLength);
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * norm);
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
  private async applyRRFFusion(
    _queryTokens: string[],
    query: string,
    scores: Float64Array,
  ): Promise<void> {
    const k = SEARCH_RRF_K;
    const trigramWeight = SEARCH_TRIGRAM_WEIGHT;

    // ── Signal 1: BM25 ranking (already in scores) ──
    const bm25Ranked = this.rankByScores(scores);

    // ── Signal 2: Trigram fuzzy matching ──
    const trigramScores = this.trigramIndex.search(query, SEARCH_TRIGRAM_THRESHOLD);
    const trigramRanked = this.rankByMap(trigramScores);

    // ── Signal 3: Dense vector cosine similarity ──
    const vectorScores = await this.computeVectorCosineScores(query);
    const vectorRanked = this.rankByMap(vectorScores);

    // Store last vector ranking for feedback tracking (Plan 08-04)
    if (vectorRanked.size > 0) {
      const ranking = new Map<string, number>();
      for (const [docIdx, rank] of vectorRanked) {
        ranking.set(this.docs[docIdx]!.name, rank);
      }
      this.feedbackTracker.recordVectorRanking(ranking);
    }

    // ── Fuse via RRF ──
    for (let i = 0; i < this.docCount; i++) {
      let rrfScore = 0;

      const bm25Rank = bm25Ranked.get(i);
      if (bm25Rank !== undefined) {
        rrfScore += 1 / (k + bm25Rank);
      }

      const trigramRank = trigramRanked.get(i);
      if (trigramRank !== undefined && trigramWeight > 0) {
        rrfScore += trigramWeight * (1 / (k + trigramRank));
      }

      const vectorRank = vectorRanked.get(i);
      if (vectorRank !== undefined && this.feedbackTracker.getVectorWeight() > 0) {
        rrfScore += this.feedbackTracker.getVectorWeight() * (1 / (k + vectorRank));
      }

      // Scale RRF score up to be comparable with original BM25 magnitude
      // while preserving original BM25 so downstream boosts (affinity, domain
      // hub, intent bonus) keep their absolute ordering meaning.
      if (rrfScore > 0) {
        const bm25Original = scores[i]!;
        const rrfRescaled = rrfScore * SEARCH_RRF_RESCALE_FACTOR;
        const blend = SEARCH_RRF_BM25_BLEND;
        scores[i] = Math.max(bm25Original, rrfRescaled * blend) + rrfRescaled * blend;
      }
    }
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
    const entries = [...scoreMap.entries()].toSorted((a, b) => b[1] - a[1]);
    const ranked = new Map<number, number>();
    for (let rank = 0; rank < entries.length; rank++) {
      ranked.set(entries[rank]![0], rank);
    }
    return ranked;
  }

  // ── Dense vector search methods (Phase 8) ──

  /**
   * Lazy-compute and cache tool description embeddings.
   * Called once on first search; subsequent searches reuse cached embeddings.
   */
  private async ensureToolEmbeddings(): Promise<void> {
    if (this.toolEmbeddings || !this.embeddingEngine) return;

    const descriptions = this.docs.map(
      (doc) => `${doc.name.replace(/_/g, ' ')}: ${doc.description}`,
    );
    this.toolEmbeddings = await this.embeddingEngine.embedBatch(descriptions);
  }

  /**
   * Compute dense vector cosine similarity scores for query vs all tools.
   * Returns Map<docIndex, cosineScore>.
   * If the embedding engine is not ready or disabled, returns an empty Map (graceful fallback).
   */
  private async computeVectorCosineScores(query: string): Promise<Map<number, number>> {
    if (!this.embeddingEngine) return new Map();

    try {
      await this.ensureToolEmbeddings();
    } catch {
      // Model not loaded yet — graceful fallback to 3-signal RRF
      return new Map();
    }

    if (!this.toolEmbeddings) return new Map();

    let queryEmbedding: Float32Array;
    try {
      queryEmbedding = await this.embeddingEngine.embed(query);
    } catch {
      return new Map();
    }

    const results = new Map<number, number>();
    for (let i = 0; i < this.toolEmbeddings.length; i++) {
      const toolEmb = this.toolEmbeddings[i]!;
      // Dot product (embeddings are already normalised → cosine similarity)
      let dot = 0;
      for (let j = 0; j < queryEmbedding.length; j++) {
        dot += queryEmbedding[j]! * toolEmb[j]!;
      }
      if (dot > 0) {
        results.set(i, dot);
      }
    }
    return results;
  }

  /**
   * Record feedback from a tool call.
   *
   * - Updates the adaptive vector weight via FeedbackTracker.
   * - Records the invocation timestamp for the recency / frequency boost.
   *
   * Cached entries are not forcibly invalidated; they self-expire through
   * the vector-weight tolerance check (see `isCachedEntryFresh`).
   *
   * @param toolName The tool that was invoked
   * @param _lastQuery The search query that led to this tool call (reserved for future use)
   */
  recordToolCallFeedback(toolName: string, _lastQuery: string): void {
    this.feedbackTracker.recordToolCallFeedback(toolName, !!this.embeddingEngine);
    // Move-to-end ensures LRU ordering via Map insertion-order semantics.
    this.recencyTracker.delete(toolName);
    this.recencyTracker.set(toolName, Date.now());
    while (this.recencyTracker.size > SEARCH_RECENCY_TRACKER_MAX) {
      const oldest = this.recencyTracker.keys().next().value;
      if (oldest === undefined) break;
      this.recencyTracker.delete(oldest);
    }
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
    const distinctBonuses = [
      ...new Set([...intentToolBonuses.values()].filter((bonus) => bonus > 0)),
    ].toSorted((a, b) => a - b);
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
      const affinityWeight = SEARCH_AFFINITY_BASE_WEIGHT / Math.sqrt(members.length); // Decay for larger groups
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
   * Combined graph-based expansion: affinity (prefix-group co-retrieval) +
   * domain hub (coherence boost for well-represented domains).
   * Single sort of scored documents feeds both expansion strategies.
   */
  private applyGraphExpansion(scores: Float64Array): void {
    // ── Find top scored indices (shared by both strategies) ──
    const scored: Array<{ idx: number; score: number }> = [];
    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! > 0) {
        scored.push({ idx: i, score: scores[i]! });
      }
    }
    if (scored.length === 0) return;
    scored.sort((a, b) => b.score - a.score);

    // ── Affinity expansion: boost prefix-group neighbors of top-N ──
    if (this.affinityGraph.size > 0) {
      const topN = SEARCH_AFFINITY_TOP_N;
      const boostFactor = SEARCH_AFFINITY_BOOST_FACTOR;
      const limit = Math.min(topN, scored.length);

      for (let rank = 0; rank < limit; rank++) {
        const { idx, score } = scored[rank]!;
        const neighbors = this.affinityGraph.get(idx);
        if (!neighbors) continue;

        const rankDecay = 1 / (1 + rank);
        for (const { docIndex, weight } of neighbors) {
          if (scores[docIndex]! > 0) {
            scores[docIndex]! += score * weight * rankDecay * boostFactor;
          }
        }
      }
    }

    // ── Domain hub expansion: coherence boost for well-represented domains ──
    const threshold = SEARCH_DOMAIN_HUB_THRESHOLD;
    if (threshold > 0 && scored.length >= threshold) {
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
          for (let i = 0; i < this.docCount; i++) {
            if (scores[i]! > 0 && this.docs[i]!.domain === domain) {
              scores[i]! *= SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER;
            }
          }
        }
      }
    }
  }
}
