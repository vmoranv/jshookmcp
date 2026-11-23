/**
 * Public inputs of the search pipeline.
 *
 * Scores that are expensive to rebuild (BM25, RRF, intent, graph) are cached
 * under `BakedStatement`. Recency, tier, explicit mention, and the final
 * re-rank are reapplied on every hit, so they stay out of the cache key.
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
  /**
   * Sorted fingerprint of the active tool set when session-dependent workflow
   * transition boosts were baked into the captured scores. Without it, a later
   * identical query from a different session replays another session's boosts.
   */
  readonly activeToolFingerprint?: string;
}

export function buildSearchCacheKey(statement: BakedStatement): string {
  const query = statement.query.toLowerCase().trim();
  const base = statement.extensionEtag.length > 0 ? `${query}\0${statement.extensionEtag}` : query;
  const active =
    statement.activeToolFingerprint && statement.activeToolFingerprint.length > 0
      ? `\0active=${statement.activeToolFingerprint}`
      : '';
  return `${base}\0stem=${statement.stemMode}${active}`;
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
