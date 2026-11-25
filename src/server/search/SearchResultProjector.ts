/** Final ranking projection: score collection + optional re-ranking. */
import type { ReRanker, ReRankInput } from './ReRanker';
import type { ToolSearchResult } from './ToolSearchEngineImpl';

interface ProjectorDocument {
  name: string;
  domain: string | null;
  shortDescription: string;
  description: string;
  scenePhrases: readonly string[];
}

export class SearchResultProjector {
  private readonly docs: readonly ProjectorDocument[];
  private readonly docNameIndex: ReadonlyMap<string, number>;
  private readonly reRanker: ReRanker;
  private readonly enableMMR: boolean;

  constructor(options: {
    docs: readonly ProjectorDocument[];
    docNameIndex: ReadonlyMap<string, number>;
    reRanker: ReRanker;
    enableMMR: boolean;
  }) {
    this.docs = options.docs;
    this.docNameIndex = options.docNameIndex;
    this.reRanker = options.reRanker;
    this.enableMMR = options.enableMMR;
  }

  collect(
    scores: Float64Array,
    activeToolNames: ReadonlySet<string> | undefined,
    topK: number,
  ): ToolSearchResult[] {
    const active = activeToolNames ?? new Set<string>();
    const candidates: ToolSearchResult[] = [];
    for (let i = 0; i < this.docs.length; i++) {
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
    return candidates.slice(0, topK);
  }

  rerank(
    query: string,
    results: ToolSearchResult[],
    activeToolNames?: ReadonlySet<string>,
  ): ToolSearchResult[] {
    if (results.length <= 1) return results;
    const reRankInputs: ReRankInput[] = results.map((result) => {
      const docIndex = this.docNameIndex.get(result.name);
      const doc = docIndex === undefined ? undefined : this.docs[docIndex];
      // The re-ranker's lexical features (keyword overlap, intent alignment)
      // read a single description string. Fold the doc-expansion scene phrases
      // into it so expansion text is visible to this layer too — otherwise a
      // tool can win the BM25 stage on its expansion phrases and still be
      // re-ranked away by a tool with a longer raw description.
      const description =
        doc && doc.scenePhrases.length > 0
          ? `${doc.description} ${doc.scenePhrases.join(' ')}`
          : (doc?.description ?? '');
      return {
        toolName: result.name,
        score: result.score,
        domain: result.domain ?? '',
        description,
      };
    });
    // If active session indicates a focused workflow, relax slot capping and boost relevance lambda
    const isSessionFocused = Boolean(activeToolNames && activeToolNames.size > 0);
    const reRanked = this.reRanker.reRank(query, reRankInputs, {
      topK: results.length,
      enableMMR: this.enableMMR,
      diversityLambda: isSessionFocused ? 0.95 : 0.85,
      maxPerDomain: isSessionFocused ? 4 : 2,
    });
    const rankMap = new Map(reRanked.map((item, index) => [item.toolName, index]));
    // A result absent from reRanked (duplicate name / smaller topK) must not be
    // promoted to rank 0; sort it after every ranked entry instead.
    return results
      .slice()
      .toSorted(
        (a, b) => (rankMap.get(a.name) ?? results.length) - (rankMap.get(b.name) ?? results.length),
      );
  }
}
