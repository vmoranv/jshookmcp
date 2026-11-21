/** Dense-vector cosine scoring for tool search. */
import { logger } from '@utils/logger';
import type { EmbeddingEngine } from './EmbeddingEngine';

export class VectorScorer {
  private readonly embeddingEngine: EmbeddingEngine | null;
  private readonly getEmbeddings: () => readonly Float32Array[] | null;
  private readonly ensureEmbeddings: () => Promise<void>;
  private readonly minSimilarity: number;

  constructor(options: {
    embeddingEngine: EmbeddingEngine | null;
    getEmbeddings: () => readonly Float32Array[] | null;
    ensureEmbeddings: () => Promise<void>;
    minSimilarity?: number;
  }) {
    this.embeddingEngine = options.embeddingEngine;
    this.getEmbeddings = options.getEmbeddings;
    this.ensureEmbeddings = options.ensureEmbeddings;
    this.minSimilarity = options.minSimilarity ?? 0.25;
  }

  /**
   * Cosine similarity for query vs all tools.
   *
   * Returns `null` when the vector signal did not participate (engine disabled,
   * catalog embeddings not warmed, or query embedding failed), distinct from an
   * empty map (participated, matched nothing).
   */
  async score(query: string): Promise<Map<number, number> | null> {
    const engine = this.embeddingEngine;
    if (!engine) return null;

    const embeddings = this.getEmbeddings();
    if (!embeddings) {
      // Never block a user query on model bootstrap.
      void this.ensureEmbeddings();
      return null;
    }

    if (engine.isReady?.() === false) {
      void engine.embed(query).catch(() => undefined);
      return null;
    }

    let queryEmbedding: Float32Array;
    try {
      queryEmbedding = await engine.embed(query);
    } catch (error) {
      logger.warn(
        `[search] query embedding unavailable; using lexical ranking: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    const results = new Map<number, number>();
    for (let i = 0; i < embeddings.length; i++) {
      const toolEmb = embeddings[i]!;
      if (toolEmb.length !== queryEmbedding.length) continue;
      // Embeddings are already normalised → dot product is cosine similarity.
      let dot = 0;
      for (let j = 0; j < queryEmbedding.length; j++) {
        dot += queryEmbedding[j]! * toolEmb[j]!;
      }
      if (dot >= this.minSimilarity) {
        results.set(i, dot);
      }
    }
    return results;
  }
}
