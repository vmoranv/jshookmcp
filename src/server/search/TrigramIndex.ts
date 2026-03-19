/**
 * Character trigram fuzzy matching index for typo-tolerant tool name search.
 *
 * Builds trigram sets from tool names at construction time and computes
 * Jaccard similarity at query time for edit-distance-tolerant matching.
 * Memory footprint: ~238 names × ~5 trigrams avg ≈ ~1200 entries (~10KB).
 */

// ── TrigramIndex class ──

export class TrigramIndex {
  /** Per-document trigram sets, indexed by document position. */
  private readonly trigramSets: ReadonlyArray<ReadonlySet<string>>;

  constructor(names: string[]) {
    this.trigramSets = names.map((name) => TrigramIndex.extractTrigrams(name));
  }

  /**
   * Search all indexed names against a query string using trigram Jaccard similarity.
   *
   * @param query  The user query (or individual query token).
   * @param threshold  Minimum Jaccard similarity to include in results (default 0.3).
   * @returns Map from document index to similarity score (0–1).
   */
  search(query: string, threshold = 0.3): Map<number, number> {
    const queryTrigrams = TrigramIndex.extractTrigrams(query);
    if (queryTrigrams.size === 0) return new Map();

    const results = new Map<number, number>();

    for (let i = 0; i < this.trigramSets.length; i++) {
      const docTrigrams = this.trigramSets[i]!;
      if (docTrigrams.size === 0) continue;

      const similarity = TrigramIndex.jaccardSimilarity(queryTrigrams, docTrigrams);
      if (similarity >= threshold) {
        results.set(i, similarity);
      }
    }

    return results;
  }

  /**
   * Extract character trigrams from a string.
   * Normalises: lowercase, replace underscores/hyphens with empty,
   * then generate overlapping 3-char sequences.
   *
   * Example: "page_navigate" → "pag", "age", "gen", "ena", "nav", "avi", "vig", "iga", "gat", "ate"
   */
  static extractTrigrams(text: string): ReadonlySet<string> {
    const normalised = text.toLowerCase().replace(/[_\-\s]+/g, '');
    const trigrams = new Set<string>();

    for (let i = 0; i <= normalised.length - 3; i++) {
      trigrams.add(normalised.slice(i, i + 3));
    }

    return trigrams;
  }

  /**
   * Compute Jaccard similarity between two sets: |A ∩ B| / |A ∪ B|.
   */
  private static jaccardSimilarity(
    a: ReadonlySet<string>,
    b: ReadonlySet<string>
  ): number {
    let intersection = 0;
    // Iterate over the smaller set for efficiency
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const item of smaller) {
      if (larger.has(item)) intersection++;
    }

    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
