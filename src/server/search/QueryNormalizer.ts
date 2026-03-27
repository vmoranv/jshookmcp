/**
 * Query normalization and preprocessing for tool search.
 * Handles stop-word removal, parameter token extraction, and short description extraction.
 */

/**
 * Stop words to filter from parameter descriptions.
 * These common words add noise without improving search relevance.
 */
const PARAM_DESCRIPTION_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'or',
  'and',
  'not',
  'this',
  'that',
  'it',
  'its',
  'if',
  'as',
  'will',
  'can',
  'may',
  'must',
  'should',
  'would',
  'could',
  'e',
  'g',
  'default',
  'optional',
  'required',
  'when',
  'set',
]);

/**
 * QueryNormalizer provides utilities for normalizing and preprocessing search queries
 * and tool metadata for indexing.
 */
export const QueryNormalizer = {
  /**
   * Extract parameter names and description tokens from a tool's inputSchema.
   * Handles both simple flat properties and nested object properties.
   *
   * @param inputSchema The tool's inputSchema object
   * @returns Array of normalized tokens from parameter names and descriptions
   */
  extractParamTokens(inputSchema: unknown): string[] {
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
          const descWords = desc
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
          for (const w of descWords) {
            if (w.length > 2 && !PARAM_DESCRIPTION_STOP_WORDS.has(w)) {
              tokens.push(w);
            }
          }
        }
      }
    }

    return tokens;
  },

  /**
   * Extract a short description from a full tool description.
   * Takes the first sentence and truncates to 120 characters if needed.
   *
   * @param description The full tool description
   * @returns A shortened description suitable for display
   */
  extractShortDescription(description: string): string {
    if (!description) return '';
    const firstSentence = description.match(/^[^.!?\n]+[.!?]?/);
    if (firstSentence) {
      const result = firstSentence[0]!.trim();
      return result.length > 120 ? result.slice(0, 117) + '...' : result;
    }
    return description.length > 120 ? description.slice(0, 117) + '...' : description;
  },

  /**
   * Check if a query contains CJK (Chinese, Japanese, Korean) characters.
   *
   * @param query The search query
   * @returns true if the query contains CJK characters
   */
  containsCJK(query: string): boolean {
    return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(query);
  },

  /**
   * Normalize a tool name for comparison (lowercase, underscores to hyphens/spaces).
   *
   * @param query The search query
   * @returns Normalized query string
   */
  normalizeToolName(query: string): string {
    return query.toLowerCase().replace(/[\s-]+/g, '_');
  },
};
