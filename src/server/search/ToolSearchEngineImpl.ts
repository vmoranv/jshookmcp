import type { Tool } from '@modelcontextprotocol/server';
import { allTools, getToolDomain } from '@server/ToolCatalog';
import type { ToolProfile } from '@server/ToolCatalog';
import type { SearchConfig } from '@internal-types/config';
import { readEnvInteger } from '@src/config/environment';
import {
  SEARCH_BM25_B,
  SEARCH_BM25_K1,
  SEARCH_COVERAGE_PRECISION_FACTOR,
  SEARCH_DESC_TOKEN_WEIGHT,
  SEARCH_DOMAIN_TOKEN_WEIGHT,
  SEARCH_EXACT_NAME_MATCH_MULTIPLIER,
  SEARCH_NAME_TOKEN_WEIGHT,
  SEARCH_PARAM_TOKEN_WEIGHT,
  SEARCH_PREFIX_MATCH_MULTIPLIER,
  SEARCH_QUERY_CACHE_CAPACITY,
  SEARCH_RECENCY_MAX_BOOST,
  SEARCH_RECENCY_TRACKER_MAX,
  SEARCH_RECENCY_WINDOW_MS,
  SEARCH_SCENE_KEYWORD_WEIGHT,
  SEARCH_MIN_CONTENT_TOKENS,
  SEARCH_SELF_RAG_ENABLED,
  SEARCH_TIER_PENALTY,
  SEARCH_TIER_PENALTY_SEARCH,
  SEARCH_TIER_PENALTY_WORKFLOW,
  SEARCH_TIER_PENALTY_FULL,
  SEARCH_TRIGRAM_THRESHOLD,
  SEARCH_TRIGRAM_WEIGHT,
  SEARCH_VECTOR_ENABLED,
  SEARCH_VECTOR_MODEL_ID,
  SEARCH_VECTOR_PREWARM,
  SEARCH_VECTOR_RETRY_COOLDOWN_MS,
} from '@src/constants';
import { BM25ScorerImpl } from './BM25Scorer';
import { EmbeddingEngine } from './EmbeddingEngine';
import { loadToolEmbeddingsCachePartial, saveToolEmbeddingsCacheV2 } from './EmbeddingCache';
import { IntentBoostImpl } from './IntentBoost';
import { TrigramIndex } from './TrigramIndex';
import { applyIntentBonusBandToScores } from './SearchIntentBonus';
import { SearchFusion } from './SearchFusion';
import { VectorScorer } from './VectorScorer';
import { SearchResultProjector } from './SearchResultProjector';
import { SearchResultCache, type CachedSearchEntry } from './SearchResultCache';
import { FeedbackTracker } from './FeedbackTracker';
import {
  QueryNormalizer,
  readStemMode,
  foldTokenSetWithMode,
  type StemMode,
} from './QueryNormalizer';
import { ReRanker, type ToolMetadata } from './ReRanker';
import { ScoreCalibrator } from './ScoreCalibrator';
import { WorkflowTransitionGraph } from './WorkflowTransitionGraph';
import { SearchQualityTracker } from './SearchQualityTracker';
import {
  getGlobalInstrumentation,
  MetricNames,
  SpanNames,
  type SpanLike,
} from '@server/observability/InstrumentationContract';
import { redactQueryText } from '@server/observability/queryTextPolicy';
import { logger } from '@utils/logger';
import {
  applyGraphExpansionToScores,
  buildAffinityGraph,
  findDelimitedIndex,
  type AffinityEdge,
} from './ToolSearchEngine.helpers';
import {
  buildSearchCacheKey,
  capturePositiveScores,
  materializeScores,
  type SearchWitness,
} from './SearchStatement';
import { ToolMerkleTree, type ToolStateWitness } from './ToolMerkleWitness';

// ── public types ──

export interface ToolSearchResult {
  name: string;
  domain: string | null;
  shortDescription: string;
  score: number;
  isActive: boolean;
}

/**
 * Internal strategy toggles. Not exported: the values are fixed at construction
 * and every consumer reads them through the engine, so there is no external
 * caller to serve. (The setter that made these runtime-mutable existed only for
 * an ablation harness that has been removed.)
 */
interface SearchStrategyFlags {
  /** S1: Expand synonyms & reverse-engineering shorthands (bp, dbg, mem, etc.) */
  enableSynonyms?: boolean;
  /** S2: Boost scores based on inputSchema parameter & required field matching */
  enableTypeSchema?: boolean;
  /** S3: Out-of-domain vocabulary check and query length term-drift penalty */
  enableOutOfDomainGating?: boolean;
  /** S4: Platt logistic calibrated confidence floor to reject irrelevant queries */
  enableScoreCalibration?: boolean;
  /** S5: Maximal Marginal Relevance & category slot saturation diversification */
  enableMMR?: boolean;
  /** S6: Sequential ItemCF / Swing workflow transition graph boosts */
  enableWorkflowTransitions?: boolean;
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
  /** Pre-computed parameter names for type-directed signature matching. */
  paramNames: ReadonlySet<string>;
  /** Pre-computed required parameters for signature matching. */
  requiredParams: ReadonlySet<string>;
  /** Pre-computed Set of all tokens for O(1) query-coverage validation. */
  tokenSet: ReadonlySet<string>;
  /**
   * Doc-expansion scene phrases (natural-language paraphrases of the tool's
   * intent). Kept on the document so downstream layers that only see
   * name+description — notably the re-ranker's keyword-overlap and
   * intent-alignment features — can see the expansion corpus too.
   */
  scenePhrases: readonly string[];
}

/**
 * Pre-adjust scores for one query. Recency, tier, explicit mention, and the
 * re-ranker are replayed on hit so they can change without a new BM25 pass.
 * `feedbackEpoch` invalidates full-path entries when a fold moves the vector
 * weight. Quick-path entries do not read that weight.
 */
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

  /** Extension identity tag — included in query cache keys so extension
   *  reloads invalidate stale cached results. Set externally by the caller. */
  extensionEtag = '';

  /** Name → doc index for O(1) lookup during affinity expansion. */
  private readonly docNameIndex = new Map<string, number>();
  /** Prefix-group affinity graph: docIndex → neighbor edges. */
  private readonly affinityGraph: ReadonlyMap<number, ReadonlyArray<AffinityEdge>>;
  /**
   * Query result LRU cache. Full-path entries are versioned by the feedback
   * fold epoch. Recency and tier are replayed on hit.
   */
  private readonly queryCache: SearchResultCache;
  /** Evidence from the search the caller just saw. Tool-call learning reads this. */
  private lastWitness: SearchWitness | null = null;
  /** Trigram fuzzy matching index over tool names. */
  private readonly trigramIndex: TrigramIndex;

  // ── Dense vector search (Phase 8) ──
  private readonly embeddingEngine: EmbeddingEngine | null;
  private readonly vectorModelId: string;
  private toolEmbeddings: Float32Array[] | null = null;
  /**
   * In-flight prewarm promise guard. Ensures at most one embedBatch runs at a
   * time across the constructor fire-and-forget and any lazy re-trigger after
   * a failure. Reset to null on rejection so the next trigger can retry.
   */
  private prewarmPromise: Promise<void> | null = null;
  private embeddingRetryAfterMs = 0;
  /**
   * Effective SEARCH_STEM_MODE captured at construction. doc.tokenSet is
   * stem-folded once at index time with this mode; including it in the cache
   * key prevents a post-switch query from replaying rankings computed under a
   * different mode. Exposed to the cache-key builder at search time.
   */
  private readonly stemMode: StemMode;
  /** Feedback tracking for adaptive vector weight adjustment. */
  private readonly feedbackTracker: FeedbackTracker;
  /** Per-tool recency tracker for frequency / recency boosts. */
  private readonly recencyTracker = new Map<string, number>();

  // Extracted modules
  private readonly bm25Scorer: BM25ScorerImpl;
  private readonly intentBoost: IntentBoostImpl;
  private readonly reRanker: ReRanker;
  private readonly qualityTracker = new SearchQualityTracker();
  private readonly fusion: SearchFusion;
  private readonly vectorScorer: VectorScorer;
  private readonly resultProjector: SearchResultProjector;

  // ── Lookup tables & Cryptographic State (Mina / PLONK inspired) ──
  private readonly idfLookupTable: Float64Array;
  private readonly docNormTable: Float64Array;
  private readonly merkleTree: ToolMerkleTree;

  /** Dynamic search strategy flags for ablation and DreamRSI counterfactual evaluation. */
  private strategyFlags: Required<SearchStrategyFlags> = {
    enableSynonyms: true,
    enableTypeSchema: true,
    enableOutOfDomainGating: true,
    enableScoreCalibration: true,
    enableMMR: true,
    enableWorkflowTransitions: true,
  };

  /**
   * Tokenise the doc-expansion scene phrases of one tool.
   *
   * sceneKeywords entries are natural-language PHRASES ("watch requests
   * live"). Their individual words must be indexed as tokens — indexing each
   * phrase string as a single token makes the whole expansion corpus
   * unreachable, because word-level query tokens can never equal a full
   * phrase string. Stop words are skipped, mirroring the description-token
   * treatment.
   */
  private tokeniseScenePhrases(phrases: readonly string[]): string[] {
    const tokens: string[] = [];
    for (const phrase of phrases) {
      for (const token of this.bm25Scorer.tokenise(phrase)) {
        if (QueryNormalizer.isStopWord(token)) continue;
        tokens.push(token);
      }
    }
    return tokens;
  }

  /**
   * Index one tool: build its document record and its inverted-index postings.
   *
   * Per-field weights decide how strongly a matched token counts: the tool
   * name outweighs the domain, which outweighs the description, which
   * outweighs the doc-expansion scene phrases.
   *
   * @returns the document length, for the corpus average.
   */
  private indexTool(
    tool: Tool,
    index: number,
    sceneKeywords: ReadonlyMap<string, readonly string[]> | undefined,
  ): number {
    const domain = this.domainOverrides?.get(tool.name) ?? getToolDomain(tool.name);
    const description = tool.description ?? '';
    const shortDescription = QueryNormalizer.extractShortDescription(description);

    const nameTokens = this.bm25Scorer.tokenise(tool.name);
    const nameTokenSet = new Set(nameTokens);
    const domainTokens = domain ? this.bm25Scorer.tokenise(domain) : [];
    const descTokens = this.bm25Scorer.tokenise(description);
    const paramTokens = QueryNormalizer.extractParamTokens(tool.inputSchema);
    const { paramNames, requiredParams } = QueryNormalizer.extractSchemaSignature(tool.inputSchema);

    const allTokens = [...nameTokens, ...domainTokens, ...descTokens, ...paramTokens];

    const toolScenePhrases = sceneKeywords?.get(tool.name) ?? [];
    const sceneTokens = this.tokeniseScenePhrases(toolScenePhrases);

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
      paramNames: new Set(paramNames),
      requiredParams: new Set(requiredParams),
      // The scene tokens belong to the document's vocabulary: the term-drift
      // penalty counts how many query words the candidate covers, and a tool
      // whose expansion phrases match the query must not look like it
      // covers nothing. Tokens are stem-normalised when SEARCH_STEM_MODE
      // enables the tokenSet wiring; off-mode indexes them verbatim.
      tokenSet: new Set(
        [...allTokens, ...sceneTokens].map((t) => foldTokenSetWithMode(t, this.stemMode)),
      ),
      scenePhrases: toolScenePhrases,
    };
    this.docs.push(doc);
    this.docNameIndex.set(tool.name, index);

    const termFreqs = new Map<string, { tf: number; weight: number }>();
    const addTokens = (tokens: readonly string[], weight: number, skipStopWords: boolean) => {
      for (const token of tokens) {
        if (skipStopWords && QueryNormalizer.isStopWord(token)) continue;
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, weight);
        termFreqs.set(token, entry);
      }
    };

    addTokens(nameTokens, SEARCH_NAME_TOKEN_WEIGHT, false);
    addTokens(domainTokens, SEARCH_DOMAIN_TOKEN_WEIGHT, false);
    addTokens(descTokens, SEARCH_DESC_TOKEN_WEIGHT, true);
    addTokens(paramTokens, SEARCH_PARAM_TOKEN_WEIGHT, false);
    addTokens(sceneTokens, SEARCH_SCENE_KEYWORD_WEIGHT, true);

    for (const [token, { tf, weight }] of termFreqs) {
      let postings = this.invertedIndex.get(token);
      if (!postings) {
        postings = [];
        this.invertedIndex.set(token, postings);
      }
      postings.push({ docIndex: index, tf, weight });
    }

    return doc.length;
  }

  constructor(
    tools?: Tool[],
    domainOverrides?: ReadonlyMap<string, string>,
    domainScoreMultipliers?: ReadonlyMap<string, number>,
    toolScoreMultipliers?: ReadonlyMap<string, number>,
    searchConfig?: SearchConfig,
    sceneKeywords?: ReadonlyMap<string, readonly string[]>,
  ) {
    const source = tools ?? allTools;
    // Pin the stem mode for the engine's lifetime. Both index-time doc.tokenSet
    // and query-time folding use this snapshot, and the cache key carries it,
    // so a mid-process SEARCH_STEM_MODE change can neither desync the two
    // sides nor replay rankings computed under the prior mode.
    this.stemMode = readStemMode();
    this.domainOverrides = domainOverrides;
    this.domainScoreMultipliers = domainScoreMultipliers;
    this.toolScoreMultipliers = toolScoreMultipliers;
    this.docCount = source.length;

    // Initialize extracted modules
    this.bm25Scorer = new BM25ScorerImpl(searchConfig);

    // Initialize vector search (Phase 8)
    const vectorEnabled = searchConfig?.vectorEnabled ?? SEARCH_VECTOR_ENABLED;
    this.vectorModelId = searchConfig?.vectorModelId ?? SEARCH_VECTOR_MODEL_ID;
    this.embeddingEngine = vectorEnabled
      ? new EmbeddingEngine({ modelId: this.vectorModelId })
      : null;
    this.feedbackTracker = new FeedbackTracker(searchConfig);
    this.intentBoost = new IntentBoostImpl(searchConfig?.intentToolBoostRules);

    let totalLength = 0;
    for (let i = 0; i < source.length; i++) {
      totalLength += this.indexTool(source[i]!, i, sceneKeywords);
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 1;
    this.sortedKeys = [...this.invertedIndex.keys()].toSorted();

    // ── Lookup tables (PLONK-style lookup argument precomputation) ──
    this.idfLookupTable = new Float64Array(this.docCount + 1);
    for (let df = 0; df <= this.docCount; df++) {
      this.idfLookupTable[df] = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);
    }

    this.docNormTable = new Float64Array(this.docCount);
    const b = SEARCH_BM25_B;
    for (let i = 0; i < this.docCount; i++) {
      this.docNormTable[i] = 1 - b + b * (this.docs[i]!.length / this.avgDocLength);
    }

    // ── Cryptographic State Commitment (Mina-inspired Merkle Tree) ──
    this.merkleTree = new ToolMerkleTree(this.docs);

    // ── Re-ranker: build domain keywords from tool metadata ──
    this.reRanker = new ReRanker();
    this.reRanker.buildFromTools(
      this.docs.map((d): ToolMetadata => ({
        name: d.name,
        domain: d.domain ?? '',
        description: d.description,
      })),
    );
    this.resultProjector = new SearchResultProjector({
      docs: this.docs,
      docNameIndex: this.docNameIndex,
      reRanker: this.reRanker,
      enableMMR: this.strategyFlags.enableMMR === true,
    });

    // ── Tool affinity graph (§4.1.4 dependency hull expansion) ──
    this.affinityGraph = buildAffinityGraph(this.docs);

    // ── Trigram fuzzy index over tool names ──
    this.trigramIndex = new TrigramIndex(this.docs.map((d) => d.name));
    this.vectorScorer = new VectorScorer({
      embeddingEngine: this.embeddingEngine,
      getEmbeddings: () => this.toolEmbeddings,
      ensureEmbeddings: () => this.ensureToolEmbeddings(),
    });
    this.fusion = new SearchFusion({
      docs: this.docs,
      trigramIndex: this.trigramIndex,
      feedbackTracker: this.feedbackTracker,
      computeVectorCosineScores: (query) => this.vectorScorer.score(query),
    });

    // ── Query result cache (§4.3 CSAPC) ──
    this.queryCache = new SearchResultCache(SEARCH_QUERY_CACHE_CAPACITY);

    // A shared daemon should not load the embedding model until vector scoring is needed.
    // Operators can opt back into background prewarm for latency-sensitive deployments.
    if (this.embeddingEngine && SEARCH_VECTOR_PREWARM) {
      void this.ensureToolEmbeddings();
    }
  }

  /**
   * When the query is verbose, keep only the tokens with the highest IDF.
   * Rare tokens carry more signal; out-of-vocabulary tokens are noise.
   */
  private distillQueryTokens(queryTokens: string[]): string[] {
    // Always return a fresh array: the caller pushes synonym expansions into
    // the result, and an aliased reference would also mutate the caller's
    // contentTokens — inflating the confidence-floor query length (L=10 for a
    // 3-token query) and spuriously rejecting short queries.
    if (queryTokens.length <= 6) return [...queryTokens];
    const inVocab = queryTokens.filter((t) => this.invertedIndex.has(t));
    if (inVocab.length < 3) return [...queryTokens];
    const scored = inVocab.map((t) => {
      const df = this.invertedIndex.get(t)!.length;
      const idf = this.idfLookupTable[df] ?? 0;
      return { token: t, idf };
    });
    scored.sort((a, b) => b.idf - a.idf);
    const kept = new Set(scored.slice(0, 6).map((s) => s.token));
    return queryTokens.filter((t) => kept.has(t));
  }

  /**
   * If the query names a known tool and uses an invocation verb, return that
   * tool so it can be promoted to top-1. Probes the name index with the
   * query's n-grams instead of scanning every tool name.
   */
  private findExplicitToolMention(query: string): string | null {
    const lower = query.toLowerCase();
    const hasInvokeVerb = /(?:\b(?:call|use|run|invoke|execute)\b|调用|执行|使用|运行)/i.test(
      lower,
    );
    if (!hasInvokeVerb) return null;

    const wordCharIdent = /[a-z0-9_]/;
    const wordCharPlain = /[a-z0-9]/;
    const tokens = lower.split(/[^a-z0-9_]+/).filter((t) => t.length > 0);
    const maxN = Math.min(tokens.length, 5);

    let bestTool: string | null = null;
    let bestIdx = Number.POSITIVE_INFINITY;

    for (let n = 1; n <= maxN; n++) {
      for (let start = 0; start <= tokens.length - n; start++) {
        const candidate = tokens.slice(start, start + n).join('_');

        let idx = -1;
        if (this.docNameIndex.has(candidate)) {
          idx = findDelimitedIndex(lower, candidate, wordCharIdent);
          if (idx < 0 && n > 1) {
            idx = findDelimitedIndex(lower, candidate.replace(/_/g, '-'), wordCharPlain);
            if (idx < 0) {
              idx = findDelimitedIndex(lower, candidate.replace(/_/g, ' '), wordCharPlain);
            }
          }
        }
        if (idx < 0) continue;

        if (idx < bestIdx || (idx === bestIdx && candidate.length > (bestTool?.length ?? 0))) {
          bestTool = candidate;
          bestIdx = idx;
        }
      }
    }

    return bestTool;
  }

  /** Type-directed schema matching and long-query term drift penalty. */
  private applySchemaAndDriftAdjustments(
    doc: ToolDocument,
    queryTokens: string[],
    queryTokenSet: Set<string>,
    queryNormalised: string,
    intentBonus: number,
    hasWorkflowImmunity = false,
  ): number {
    let multiplier = 1.0;

    let matchedParamCount = 0;
    let matchedRequiredCount = 0;
    for (const qt of queryTokens) {
      if (doc.requiredParams.has(qt)) {
        matchedRequiredCount++;
      } else if (doc.paramNames.has(qt)) {
        matchedParamCount++;
      }
    }
    if (
      this.strategyFlags.enableTypeSchema &&
      (matchedRequiredCount > 0 || matchedParamCount > 0)
    ) {
      const schemaBoost = 1.0 + matchedRequiredCount * 0.15 + matchedParamCount * 0.08;
      multiplier *= Math.min(schemaBoost, 1.4);
    }

    // Suppress term-drift penalty if candidate has contextual workflow transition immunity
    if (
      this.strategyFlags.enableOutOfDomainGating &&
      queryTokenSet.size >= 4 &&
      intentBonus <= 0 &&
      !hasWorkflowImmunity &&
      doc.name !== queryNormalised
    ) {
      let matchedContent = 0;
      // The tokenSet is stem-normalised at index time when the tokenSet
      // wiring is enabled; folding the query tokens with the same function
      // keeps both sides of the comparison symmetric.
      for (const qt of queryTokenSet) {
        if (doc.tokenSet.has(foldTokenSetWithMode(qt, this.stemMode))) matchedContent++;
      }
      // Threshold <=2 (not <=1): a candidate covering 2 of N>=4 query tokens
      // is usually on-topic too — the common failure is a name-token match on
      // one verb ("hook") dragging in unrelated hook-named tools while the
      // true match covers the full query at scene weight. Measured
      // (30-case holdout, 2026-11-14): <=1 -> 65.8 MRR, <=2 -> 79.9 with 10
      // cases improved and none regressed; <=3 -> 78.6 (worse, one regressed).
      // Stem modes shift the matchedContent distribution upward (folded
      // variants match more tokens), so the threshold is env-tunable for the
      // stem scan; the default keeps the measured <=2 behaviour.
      // Strict parse: the old parseInt accepted numeric prefixes ('2junk')
      // and negative/out-of-range values, silently overriding the measured
      // default. readEnvInteger rejects junk and out-of-range, falling back to 2.
      const driftThreshold = readEnvInteger('SEARCH_STEM_DRIFT_THRESHOLD', 2, {
        min: 0,
        max: 100,
      });
      if (matchedContent <= driftThreshold) {
        multiplier *= Math.max(0.1, matchedContent / queryTokenSet.size);
      }
    }

    return multiplier;
  }

  /** Exact-name, coverage/precision, domain, category, and per-tool multipliers. */
  private applyLexicalScoreAdjustments(
    scores: Float64Array,
    query: string,
    queryTokens: string[],
    intentToolBonuses: Map<string, number>,
    categoryDomainBoosts: Map<string, number>,
    workflowBoosts?: ReadonlyMap<string, number>,
  ): void {
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

      let matchedCount = 0;
      for (const qt of queryTokens) {
        if (doc.nameTokenSet.has(qt)) matchedCount++;
      }
      if (matchedCount > 0 && doc.nameTokenCount > 0 && queryTokenSet.size > 0) {
        const coverage = matchedCount / doc.nameTokenCount;
        const precision = matchedCount / queryTokenSet.size;
        scores[i]! *= 1 + SEARCH_COVERAGE_PRECISION_FACTOR * coverage * precision;
      }

      const hasWorkflowImmunity = workflowBoosts !== undefined && workflowBoosts.has(doc.name);
      scores[i]! *= this.applySchemaAndDriftAdjustments(
        doc,
        queryTokens,
        queryTokenSet,
        queryNormalised,
        intentBonus,
        hasWorkflowImmunity,
      );

      const domainMultiplier = doc.domain ? (this.domainScoreMultipliers?.get(doc.domain) ?? 1) : 1;
      if (domainMultiplier !== 1) scores[i]! *= domainMultiplier;

      if (doc.domain && categoryDomainBoosts.size > 0) {
        const categoryBoost = categoryDomainBoosts.get(doc.domain);
        if (categoryBoost !== undefined && categoryBoost > 1) scores[i]! *= categoryBoost;
      }

      const toolMultiplier = this.toolScoreMultipliers?.get(doc.name) ?? 1;
      if (toolMultiplier !== 1) scores[i]! *= toolMultiplier;
    }
  }

  /** Lift an explicitly named tool above everything else. */
  private promoteExplicitMention(scores: Float64Array, explicitToolMention: string | null): void {
    if (!explicitToolMention) return;
    const explicitIdx = this.docNameIndex.get(explicitToolMention);
    if (explicitIdx === undefined) return;
    let maxScore = 0;
    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! > maxScore) maxScore = scores[i]!;
    }
    scores[explicitIdx]! += Math.max(1, maxScore + 1);
  }

  /**
   * Out-of-domain vocabulary specificity check:
   * If a multi-word query (>= 4 unique content words) has fewer than 30% of its content words
   * anywhere in the tool catalog, and neither an intent rule, a category profile,
   * nor an explicit tool mention applies, reject early to eliminate false-positive hallucinations.
   */
  private shouldRejectOutOfDomain(contentTokens: string[], query: string): boolean {
    const uniqueContentTokens = [...new Set(contentTokens)];
    if (uniqueContentTokens.length < 4 || this.isExactNameQuery(query)) {
      return false;
    }
    const intentBonuses = this.intentBoost.resolveIntentToolBonuses(query);
    const catBoosts = this.bm25Scorer.detectQueryCategoryBoosts(query);
    if (
      intentBonuses.size > 0 ||
      catBoosts.size > 0 ||
      this.findExplicitToolMention(query) !== null
    ) {
      return false;
    }
    let inVocab = 0;
    let unknownCount = 0;
    for (const ct of uniqueContentTokens) {
      if (this.invertedIndex.has(ct)) {
        inVocab++;
      } else {
        const alt = QueryNormalizer.inflectWord(ct);
        if (alt && this.invertedIndex.has(alt)) {
          inVocab++;
        } else {
          unknownCount++;
        }
      }
    }
    return inVocab / uniqueContentTokens.length < 0.3 || unknownCount >= 4;
  }

  private scoreLexicalQueryTokens(queryTokens: string[], scores: Float64Array): void {
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
  }

  private executeQuickPathSearch(
    query: string,
    queryTokens: string[],
    topK: number,
    activeToolNames?: ReadonlySet<string>,
    visibleDomains?: ReadonlySet<string>,
    profile?: ToolProfile,
  ): {
    quickResults: ToolSearchResult[];
    preAdjust: Array<[number, number]>;
    quickLatencyMs: number;
  } {
    const quickStartMs = performance.now();
    const scores = this.quickPathSearch(query, queryTokens);
    const preAdjust = capturePositiveScores(scores);
    const quickResults = this.projectScores(
      scores,
      'quick',
      query,
      topK,
      activeToolNames,
      visibleDomains,
      profile,
      null,
    );
    this.feedbackTracker.recordVectorRanking(null);
    const searchId = this.qualityTracker.recordSearch(
      query,
      quickResults.map((r) => r.name),
      quickResults.map((r) => r.score),
      performance.now() - quickStartMs,
      { vectorParticipated: false },
    );
    this.rememberWitness(searchId, quickResults, null);
    const quickLatencyMs = Math.round(performance.now() - quickStartMs);
    return { quickResults, preAdjust, quickLatencyMs };
  }

  async search(
    query: string,
    topK = 10,
    activeToolNames?: ReadonlySet<string>,
    visibleDomains?: ReadonlySet<string>,
    profile?: ToolProfile,
  ): Promise<ToolSearchResult[]> {
    const searchStartTime = performance.now();

    // ── search.query telemetry span ──
    const instrumentation = getGlobalInstrumentation();
    const telemetrySpan = instrumentation.startSpan(SpanNames.searchQuery, {
      'search.query_text': redactQueryText(query),
      'search.query_length': query.length,
      'search.top_k': topK,
    });

    // Tokenise without synonyms first, filter stop words, then keep only the most informative.
    const rawTokens = this.bm25Scorer.tokenise(query);
    const contentTokens = QueryNormalizer.filterQueryStopwords(rawTokens);
    if (contentTokens.length === 0) {
      telemetrySpan.end({ 'search.result_count': 0 });
      instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
        outcome: 'empty_query',
      });
      return [];
    }

    // Degenerate-probe gate: a pure-stopword query (e.g. "a") survives the
    // filter only through the keep-original-tokens fallback, and any query
    // whose content-token count sits below the configured minimum carries too
    // little retrievable intent to rank meaningfully. Quick-path (exact
    // tool-name) queries are exempt.
    if (
      SEARCH_MIN_CONTENT_TOKENS > 0 &&
      !this.isExactNameQuery(query) &&
      contentTokens.length < SEARCH_MIN_CONTENT_TOKENS
    ) {
      telemetrySpan.end({ 'search.result_count': 0 });
      instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
        outcome: 'empty_query',
      });
      return [];
    }

    if (
      this.strategyFlags.enableOutOfDomainGating &&
      this.shouldRejectOutOfDomain(contentTokens, query)
    ) {
      const latencyMs = performance.now() - searchStartTime;
      telemetrySpan.end({
        'search.result_count': 0,
        'search.latency_ms': Math.round(latencyMs),
      });
      instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
        outcome: 'out_of_domain_vocab_rejection',
      });
      return [];
    }

    const queryTokens = this.distillQueryTokens(contentTokens);
    if (queryTokens.length === 0) {
      telemetrySpan.end({ 'search.result_count': 0 });
      instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
        outcome: 'empty_query',
      });
      return [];
    }

    // Cache key is the baked statement only. topK, profile, and visible
    // domains are replayed from the stored pre-adjust scores.
    const cacheKey = buildSearchCacheKey({
      query,
      extensionEtag: this.extensionEtag,
      stemMode: this.stemMode,
    });
    const cached = this.queryCache.get(cacheKey);
    if (cached && this.isCachedEntryFresh(cached)) {
      const results = this.replayCached(
        cached,
        query,
        topK,
        activeToolNames,
        visibleDomains,
        profile,
      );
      telemetrySpan.end({
        'search.cache_hit': true,
        'search.result_count': results.length,
        'search.latency_ms': Math.round(performance.now() - searchStartTime),
      });
      instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
        outcome: 'cache_hit',
      });
      return results;
    }

    // Exact tool names skip RRF and embeddings. A single token does not:
    // intent and affinity still have to run.
    if (SEARCH_SELF_RAG_ENABLED && this.isExactNameQuery(query)) {
      const { quickResults, preAdjust, quickLatencyMs } = this.executeQuickPathSearch(
        query,
        queryTokens,
        topK,
        activeToolNames,
        visibleDomains,
        profile,
      );
      telemetrySpan.end({
        'search.quick_path': true,
        'search.result_count': quickResults.length,
        'search.latency_ms': quickLatencyMs,
      });
      instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
        outcome: 'quick_path',
      });
      instrumentation.emitMetric(MetricNames.searchLatencyMs, quickLatencyMs, 'histogram', {
        outcome: 'quick_path',
      });
      this.writeCache(cacheKey, 'quick', preAdjust, null);
      return quickResults;
    }

    // Shorthand and abbreviation token set for selective expansion on long queries
    const explicitToolMention = this.findExplicitToolMention(query);
    const intentToolBonuses = this.intentBoost.resolveIntentToolBonuses(query);
    return this.runFullSearchPipeline({
      cacheKey,
      query,
      contentTokens,
      queryTokens,
      topK,
      activeToolNames,
      visibleDomains,
      profile,
      explicitToolMention,
      intentToolBonuses,
      searchStartTime,
      telemetrySpan,
    });
  }

  /**
   * Full scoring pipeline: selective synonym expansion -> BM25 + RRF fusion ->
   * lexical adjustments -> graph expansion -> projection -> calibration floor
   * -> quality tracking. Extracted from {@link search} so the orchestrator
   * stays under the complexity gate; pure code motion, no behavior change.
   */
  private async runFullSearchPipeline(args: {
    cacheKey: string;
    query: string;
    contentTokens: string[];
    queryTokens: string[];
    topK: number;
    activeToolNames?: ReadonlySet<string>;
    visibleDomains?: ReadonlySet<string>;
    profile?: ToolProfile;
    explicitToolMention: string | null;
    intentToolBonuses: Map<string, number>;
    searchStartTime: number;
    telemetrySpan: SpanLike;
  }): Promise<ToolSearchResult[]> {
    const {
      cacheKey,
      query,
      contentTokens,
      topK,
      activeToolNames,
      visibleDomains,
      profile,
      explicitToolMention,
      intentToolBonuses,
      searchStartTime,
      telemetrySpan,
    } = args;
    const queryTokens = args.queryTokens;

    const RE_SHORTHAND_TOKENS = new Set([
      'bp',
      'dbg',
      'mem',
      'disasm',
      'syms',
      'fn',
      'dex',
      'pkt',
      'pkts',
      'regs',
      'rop',
      'proc',
      'etw',
      'apk',
      'ws',
      'eval',
      'sec',
      'har',
      'int',
      'diff',
    ]);

    // Selective synonym expansion:
    // If query is verbose (>= 4 content tokens), only expand technical shorthands
    // to prevent broad generic synonyms (e.g. emulate -> adb) from polluting BM25 IDF
    if (this.strategyFlags.enableSynonyms) {
      const tokensToExpand =
        contentTokens.length >= 4
          ? queryTokens.filter((t) => RE_SHORTHAND_TOKENS.has(t.toLowerCase()))
          : queryTokens;

      if (tokensToExpand.length > 0) {
        const synonymTokens = this.bm25Scorer
          .tokenise(tokensToExpand.join(' '), { expandSynonyms: true })
          .filter((t) => !queryTokens.includes(t));
        queryTokens.push(...synonymTokens);
      }
    }

    const instrumentation = getGlobalInstrumentation();
    const scores = new Float64Array(this.docCount);

    this.scoreLexicalQueryTokens(queryTokens, scores);

    // ── RRF multi-signal fusion (replaces multiplicative TF-IDF boost) ──
    const { topBm25Score, vectorParticipated, vectorRanking, hasSignal } = await this.fusion.apply(
      query,
      scores,
    );

    // ── Relevance Confidence Gate ──
    if (!hasSignal && intentToolBonuses.size === 0 && explicitToolMention === null) {
      const latencyMs = performance.now() - searchStartTime;
      telemetrySpan.end({
        'search.quick_path': false,
        'search.result_count': 0,
        'search.latency_ms': Math.round(latencyMs),
      });
      instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
        outcome: 'no_match_relevance_gate',
      });
      return [];
    }

    // ── Session workflow transition boost (Industrial Swing/ItemCF inspired) ──
    const workflowBoosts =
      this.strategyFlags.enableWorkflowTransitions && activeToolNames && activeToolNames.size > 0
        ? WorkflowTransitionGraph.getTransitionBoosts(activeToolNames)
        : undefined;

    // ── Query category adaptive domain weights (§4.1.3 task-type encoding) ──
    const categoryDomainBoosts = this.bm25Scorer.detectQueryCategoryBoosts(query);
    this.applyLexicalScoreAdjustments(
      scores,
      query,
      queryTokens,
      intentToolBonuses,
      categoryDomainBoosts,
      workflowBoosts,
    );

    // Applied BEFORE graph expansion so intent-targeted tools contribute
    // to affinity / domain-hub expansion, preventing zero-score dead zone.
    this.applyIntentBonusBand(scores, intentToolBonuses);

    // ── Graph expansion: affinity + domain hub (§4.1.4) ──
    this.applyGraphExpansion(scores);

    // ── Apply contextual workflow boosts to scoring vector ──
    if (workflowBoosts && workflowBoosts.size > 0) {
      for (let i = 0; i < this.docCount; i++) {
        if (scores[i]! > 0) {
          const boost = workflowBoosts.get(this.docs[i]!.name);
          if (boost !== undefined) scores[i]! *= boost;
        }
      }
    }

    const preAdjust = capturePositiveScores(scores);
    const results = this.projectScores(
      scores,
      'full',
      query,
      topK,
      activeToolNames,
      visibleDomains,
      profile,
      explicitToolMention,
    );

    // Calibrated Relevance Confidence Floor (Platt / Sigmoid calibrated):
    // If no explicit tool was mentioned, no intent rules fired,
    // and the top candidate fails the query-length adaptive confidence floor,
    // treat as out-of-domain noise and reject.
    if (
      this.strategyFlags.enableScoreCalibration &&
      explicitToolMention === null &&
      intentToolBonuses.size === 0 &&
      results.length > 0 &&
      !ScoreCalibrator.isConfidentMatch(results[0]!.score, contentTokens.length)
    ) {
      const latencyMs = performance.now() - searchStartTime;
      telemetrySpan.end({ 'search.result_count': 0, 'search.latency_ms': Math.round(latencyMs) });
      instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
        outcome: 'below_confidence_floor',
      });
      return [];
    }

    this.writeCache(cacheKey, 'full', preAdjust, vectorRanking);

    // ── Search quality tracking ──
    const latencyMs = performance.now() - searchStartTime;
    telemetrySpan.end({
      'search.quick_path': false,
      'search.result_count': results.length,
      'search.latency_ms': Math.round(latencyMs),
      ...(topBm25Score > 0
        ? { 'search.bm25_top_score': Math.round(topBm25Score * 1000) / 1000 }
        : {}),
      'search.vector_participated': vectorParticipated,
    });
    instrumentation.emitMetric(MetricNames.searchQueriesTotal, 1, 'counter', {
      outcome: vectorParticipated ? 'full_path_vector' : 'full_path_lexical',
    });
    instrumentation.emitMetric(MetricNames.searchLatencyMs, Math.round(latencyMs), 'histogram', {
      outcome: vectorParticipated ? 'full_path_vector' : 'full_path_lexical',
    });
    const searchId = this.qualityTracker.recordSearch(
      query,
      results.map((r) => r.name),
      results.map((r) => r.score),
      latencyMs,
      { bm25TopScore: topBm25Score, vectorParticipated },
    );
    this.rememberWitness(searchId, results, vectorRanking);

    return results;
  }

  /**
   * Full-path entries die when a feedback fold moves the vector weight, or when
   * the vector signal has become available since they were computed — a
   * lexical-only ranking must not outlive the readiness transition whose whole
   * point was to add that signal.
   */
  private isCachedEntryFresh(entry: CachedSearchEntry): boolean {
    if (entry.kind === 'quick') return true;
    if (entry.feedbackEpoch !== this.feedbackTracker.getFeedbackEpoch()) return false;
    if (!entry.vectorReady && this.toolEmbeddings !== null) return false;
    return true;
  }

  private replayCached(
    entry: CachedSearchEntry,
    query: string,
    topK: number,
    activeToolNames: ReadonlySet<string> | undefined,
    visibleDomains: ReadonlySet<string> | undefined,
    profile: ToolProfile | undefined,
  ): ToolSearchResult[] {
    const scores = materializeScores(entry.preAdjust, this.docCount);
    const explicit = entry.kind === 'full' ? this.findExplicitToolMention(query) : null;
    const results = this.projectScores(
      scores,
      entry.kind,
      query,
      topK,
      activeToolNames,
      visibleDomains,
      profile,
      explicit,
    );
    const vectorRanking = entry.vectorRanking ? new Map(entry.vectorRanking) : null;
    this.rememberWitness(`cache:${entry.kind}`, results, vectorRanking);
    return results;
  }

  private projectScores(
    scores: Float64Array,
    kind: 'quick' | 'full',
    query: string,
    topK: number,
    activeToolNames: ReadonlySet<string> | undefined,
    visibleDomains: ReadonlySet<string> | undefined,
    profile: ToolProfile | undefined,
    explicitToolMention: string | null,
  ): ToolSearchResult[] {
    if (kind === 'full') this.applyRecencyBoost(scores);
    this.applyTierPenalty(scores, visibleDomains, profile);
    if (kind === 'full') this.promoteExplicitMention(scores, explicitToolMention);
    const ranked = this.resultProjector.collect(scores, activeToolNames, topK);
    return kind === 'full' ? this.resultProjector.rerank(query, ranked, activeToolNames) : ranked;
  }

  private writeCache(
    cacheKey: string,
    kind: 'quick' | 'full',
    preAdjust: Array<[number, number]>,
    vectorRanking: ReadonlyMap<string, number> | null,
  ): void {
    this.queryCache.set(cacheKey, {
      kind,
      feedbackEpoch: this.feedbackTracker.getFeedbackEpoch(),
      // Recorded at write time so a later readiness flip invalidates the entry
      // even if the bootstrap's own clear() lost the race with this write.
      vectorReady: this.toolEmbeddings !== null,
      preAdjust,
      vectorRanking: vectorRanking ? [...vectorRanking] : null,
    });
  }

  private rememberWitness(
    searchId: string,
    results: readonly ToolSearchResult[],
    vectorRanking: ReadonlyMap<string, number> | null,
  ): void {
    this.lastWitness = {
      searchId,
      returnedTools: results.map((result) => result.name),
      vectorRanking,
    };
  }

  /** Exact tool-name queries are the only rank-preserving skip of RRF. */
  private isExactNameQuery(rawQuery: string): boolean {
    const normalised = rawQuery.toLowerCase().replace(/[\s-]+/g, '_');
    return this.docNameIndex.has(normalised);
  }

  /**
   * BM25 + trigram + exact-name multiplier. Tier is applied later so a cache
   * hit can replay a different profile.
   */
  private quickPathSearch(query: string, queryTokens: string[]): Float64Array {
    const scores = new Float64Array(this.docCount);

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

    const trigramScores = this.trigramIndex.search(query, SEARCH_TRIGRAM_THRESHOLD);
    const trigramWeight = SEARCH_TRIGRAM_WEIGHT;
    if (trigramWeight > 0) {
      for (const [docIdx, triScore] of trigramScores) {
        if (triScore > 0) {
          scores[docIdx]! += triScore * trigramWeight;
        }
      }
    }

    const queryNormalised = query.toLowerCase().replace(/[\s-]+/g, '_');
    if (this.docNameIndex.has(queryNormalised)) {
      const idx = this.docNameIndex.get(queryNormalised)!;
      scores[idx]! *= SEARCH_EXACT_NAME_MATCH_MULTIPLIER;
    }

    return scores;
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
   *
   * When visibleDomains is empty (search tier with no base domains), we still
   * apply the penalty but clamp scores to a small epsilon so results remain
   * discoverable — the search → auto-activate pipeline requires results to exist.
   */
  private applyTierPenalty(
    scores: Float64Array,
    visibleDomains: ReadonlySet<string> | undefined,
    profile?: ToolProfile,
  ): void {
    const penalty = profile
      ? profile === 'full'
        ? SEARCH_TIER_PENALTY_FULL
        : profile === 'workflow'
          ? SEARCH_TIER_PENALTY_WORKFLOW
          : SEARCH_TIER_PENALTY_SEARCH
      : SEARCH_TIER_PENALTY;
    if (penalty >= 1 || penalty <= 0) return;

    const hasVisibleDomains = visibleDomains && visibleDomains.size > 0;

    for (let i = 0; i < this.docCount; i++) {
      if (scores[i]! <= 0) continue;
      const domain = this.docs[i]!.domain;
      if (!domain) continue;
      // If no visible domains (search tier), all domains are "out of tier"
      const isOutOfTier = hasVisibleDomains ? !visibleDomains.has(domain) : true;
      if (isOutOfTier) {
        // Penalty is multiplicative on positive scores (line 741 already
        // skipped ≤0 entries); 0 < score × penalty ≤ score for any valid
        // penalty in (0, 1), so scores never need a lower-bound clamp.
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
    const idf = this.idfLookupTable[df] ?? 0;
    const k1 = SEARCH_BM25_K1;
    const k1Plus1 = k1 + 1;

    for (const { docIndex, tf, weight } of postings) {
      const norm = this.docNormTable[docIndex]!;
      const tfNorm = (tf * k1Plus1) / (tf + k1 * norm);
      scores[docIndex]! += idf * tfNorm * weight * multiplier;
    }
  }

  // ── Dense vector search methods (Phase 8) ──

  waitForEmbeddings(): Promise<void> {
    return this.ensureToolEmbeddings();
  }

  /**
   * Load catalog embeddings from disk or compute them once. Concurrent callers
   * share the same promise, while failures degrade to lexical search and remain retryable.
   *
   * Incremental (cache v2): per-tool hash matching lets unchanged tools reuse
   * their cached vectors; only tools whose name/description changed are
   * (re)embedded. A full miss (no cache file, v1 legacy file, or corruption)
   * falls back to embedding the whole catalog.
   */
  private ensureToolEmbeddings(): Promise<void> {
    if (this.toolEmbeddings || !this.embeddingEngine) {
      return Promise.resolve();
    }
    if (this.prewarmPromise) {
      return this.prewarmPromise;
    }
    if (Date.now() < this.embeddingRetryAfterMs) {
      return Promise.resolve();
    }

    const tools = this.docs.map((doc): import('./EmbeddingCache').ToolEmbeddingKey => ({
      name: doc.name,
      description: `${doc.name.replace(/_/g, ' ')}: ${doc.description}`,
    }));
    const modelId = this.vectorModelId;
    const engine = this.embeddingEngine;
    const run = (async () => {
      try {
        const partial = await loadToolEmbeddingsCachePartial(modelId, tools);
        let embeddings: Float32Array[];

        if (partial) {
          const missingIndexes: number[] = [];
          for (const [index, cached] of partial.entries()) {
            if (!cached) missingIndexes.push(index);
          }
          if (missingIndexes.length === 0) {
            this.toolEmbeddings = partial as Float32Array[];
            this.embeddingRetryAfterMs = 0;
            // Queries served while embeddings were absent cached lexical-only
            // results; with the vector signal now live those entries are stale.
            this.queryCache.clear();
            return;
          }
          const fresh = await engine.embedBatch(
            missingIndexes.map((index) => tools[index]!.description),
          );
          for (const [offset, index] of missingIndexes.entries()) {
            partial[index] = fresh[offset] ?? null;
          }
          embeddings = partial as Float32Array[];
        } else {
          embeddings = await engine.embedBatch(tools.map((tool) => tool.description));
        }

        this.toolEmbeddings = embeddings;
        this.embeddingRetryAfterMs = 0;
        // Same staleness as the all-cached fast path: results computed before
        // embeddings existed must not outlive the readiness transition.
        this.queryCache.clear();
        await saveToolEmbeddingsCacheV2(modelId, tools, embeddings);
      } catch (error) {
        // Embeddings are optional; BM25 and trigram remain available.
        this.embeddingRetryAfterMs = Date.now() + Math.max(0, SEARCH_VECTOR_RETRY_COOLDOWN_MS);
        logger.warn(
          `[search] vector embeddings unavailable; using lexical search for ${Math.max(0, SEARCH_VECTOR_RETRY_COOLDOWN_MS)}ms: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        this.prewarmPromise = null;
      }
    })();
    this.prewarmPromise = run;
    return run;
  }

  /**
   * Compute dense vector cosine similarity scores for query vs all tools.
   * Returns Map<docIndex, cosineScore>, or `null` when the vector signal is
   * unavailable (engine disabled, catalog embeddings not yet warmed, or the
   * query embedding failed) — the caller treats `null` as "did not
   * participate" rather than "matched nothing".
   *
   * Prewarm-in-progress fast path: when the background embedding job hasn't
   * finished seeding `toolEmbeddings` yet, return `null` immediately rather
   * than awaiting the in-flight prewarm (which would block the search for the
   * full cold-start duration). The engine falls back to BM25 + trigram for
   * this query; subsequent queries pick up the vector signal once prewarm
   * lands.
   */
  /**
   * Record feedback from a tool call.
   *
   * - Updates the adaptive vector weight via FeedbackTracker.
   * - Records the invocation timestamp for the recency / frequency boost.
   *
   * Learning is bound to `lastWitness`: a tool the latest search did not
   * return does not move the vector weight. The weight itself moves only
   * when a fold commits, which bumps the cache epoch.
   *
   * @param toolName The tool that was invoked
   * @param lastQuery The search query that led to this tool call. Recorded by
   *   FeedbackTracker for quality analysis (no learning is done from it yet);
   *   the call_tool proxy path has no query in scope and passes an empty
   *   string.
   */
  recordToolCallFeedback(toolName: string, lastQuery: string): void {
    const witness = this.lastWitness;
    if (witness && witness.returnedTools.includes(toolName)) {
      const vectorParticipated = witness.vectorRanking !== null;
      this.feedbackTracker.recordToolCallFeedback(toolName, !!this.embeddingEngine, lastQuery, {
        searchId: witness.searchId,
        vectorParticipated,
        vectorRank: vectorParticipated ? (witness.vectorRanking!.get(toolName) ?? null) : null,
      });
    } else {
      this.feedbackTracker.noteQuery(lastQuery);
    }
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
   * Associate a tool call with the most recent search quality record.
   * Called from MCPServer when a tool is invoked after a search.
   */
  associateLastSearch(toolName: string): void {
    // Metric emission (search_feedback_used) lives inside the tracker's
    // associateLastSearch — the production execution path calls the tracker
    // directly, so the engine wrapper must not be the only emission point.
    this.qualityTracker.associateLastSearch(toolName);
  }

  /**
   * Return current search quality metrics.
   */
  getSearchQualityMetrics(): import('./SearchQualityTracker').SearchQualityMetrics {
    return this.qualityTracker.computeMetrics();
  }

  getSearchQualityTracker(): import('./SearchQualityTracker').SearchQualityTracker {
    return this.qualityTracker;
  }

  getFeedbackTracker(): import('./FeedbackTracker').FeedbackTracker {
    return this.feedbackTracker;
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
    applyIntentBonusBandToScores(scores, this.docCount, this.docNameIndex, intentToolBonuses);
  }

  /**
   * Build prefix-group affinity graph (§4.1.4 dependency hull).
   * Tools sharing a name prefix (e.g. legacy "breakpoint_set"/"breakpoint_list"
   * or unified families such as "memory_*")
   * form an affinity group with mutual edges.
   */
  private applyGraphExpansion(scores: Float64Array): void {
    applyGraphExpansionToScores({
      scores,
      docs: this.docs,
      affinityGraph: this.affinityGraph,
    });
  }

  /**
   * Succinct cryptographic state commitment (Merkle Root) over the indexed tools catalog.
   * Inspired by Mina's state commitment model. Enables O(1) state verification.
   */
  getStateRoot(): string {
    return this.merkleTree.root;
  }

  /**
   * Generate an O(log N) membership witness for a tool against the current index state root.
   */
  getToolWitness(toolName: string): ToolStateWitness | null {
    return this.merkleTree.getWitness(toolName);
  }
}
