/**
 * Public inputs of the search pipeline.
 *
 * Scores that are expensive to rebuild (BM25, RRF, intent, graph) are cached
 * under `BakedStatement`. Recency, tier, explicit mention, and the final
 * re-rank are reapplied on every hit, so they stay out of the cache key.
 * `SearchWitness` is the private evidence a later tool call may learn from.
 * It never enters the key.
 */

export interface BakedStatement {
  readonly query: string;
  readonly extensionEtag: string;
  /**
   * Effective SEARCH_STEM_MODE at index time. Part of the key so a query made
   * after a mid-process mode switch never replays scores computed under the
   * prior mode (index-time doc.tokenSet and query-time folding would disagree).
   */
  readonly stemMode: string;
}

export interface FeedbackEvidence {
  readonly searchId: string;
  /** False when this search did not run the vector signal. */
  readonly vectorParticipated: boolean;
  /** Null when the signal ran and the tool was absent from it. */
  readonly vectorRank: number | null;
}

export interface SearchWitness {
  readonly searchId: string;
  readonly returnedTools: readonly string[];
  readonly vectorRanking: ReadonlyMap<string, number> | null;
}

export function buildSearchCacheKey(statement: BakedStatement): string {
  const query = statement.query.toLowerCase().trim();
  const base = statement.extensionEtag.length > 0 ? `${query}\0${statement.extensionEtag}` : query;
  return `${base}\0stem=${statement.stemMode}`;
}

export function capturePositiveScores(scores: Float64Array): Array<[number, number]> {
  const captured: Array<[number, number]> = [];
  for (let i = 0; i < scores.length; i++) {
    const score = scores[i]!;
    if (score > 0) captured.push([i, score]);
  }
  return captured;
}

export function materializeScores(
  entries: readonly (readonly [number, number])[],
  size: number,
): Float64Array {
  const scores = new Float64Array(size);
  for (const [index, score] of entries) scores[index] = score;
  return scores;
}

export function resolveFeedbackFoldSize(
  configured: number | undefined,
  fromEnv: number | undefined,
): number {
  const raw = configured ?? fromEnv;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  // Tests that mock `@src/constants` without this knob keep one-step learning.
  return 1;
}
