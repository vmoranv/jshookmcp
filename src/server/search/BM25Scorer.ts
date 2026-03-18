/**
 * BM25 and TF-IDF scoring implementation.
 * Contains BM25 parameters, scoring functions, and TF-IDF cosine similarity.
 */
import { DEFAULT_SEARCH_CONFIG } from '@src/config/search-defaults';
import type {
  SearchCjkQueryAliasConfig,
  SearchConfig,
  SearchQueryCategoryProfileConfig,
} from '@internal-types/config';

/* ---------- BM25 parameters ---------- */

const K1 = 1.5;
const B = 0.3;

/* ---------- query category adaptive weights (§4.1.3 task-type encoding) ---------- */

export interface QueryCategoryProfile {
  pattern: RegExp;
  domainBoosts: ReadonlyMap<string, number>;
}

interface CjkQueryAliasRule {
  pattern: RegExp;
  tokens: readonly string[];
}

/* ---------- BM25Scorer implementation ---------- */

export class BM25ScorerImpl {
  private readonly queryCategoryProfiles: ReadonlyArray<QueryCategoryProfile>;
  private readonly cjkQueryAliases: ReadonlyArray<CjkQueryAliasRule>;

  constructor(searchConfig?: Pick<SearchConfig, 'queryCategoryProfiles' | 'cjkQueryAliases'>) {
    this.queryCategoryProfiles =
      searchConfig?.queryCategoryProfiles !== undefined
        ? BM25ScorerImpl.compileQueryCategoryProfiles(searchConfig.queryCategoryProfiles)
        : BM25ScorerImpl.compileQueryCategoryProfiles(DEFAULT_SEARCH_CONFIG.queryCategoryProfiles);
    this.cjkQueryAliases =
      searchConfig?.cjkQueryAliases !== undefined
        ? BM25ScorerImpl.compileCjkQueryAliasRules(searchConfig.cjkQueryAliases)
        : BM25ScorerImpl.compileCjkQueryAliasRules(DEFAULT_SEARCH_CONFIG.cjkQueryAliases);
  }

  static compileQueryCategoryProfiles(
    config: SearchQueryCategoryProfileConfig[]
  ): ReadonlyArray<QueryCategoryProfile> {
    return config.flatMap((profile) => {
      if (!profile || typeof profile.pattern !== 'string' || !Array.isArray(profile.domainBoosts)) {
        return [];
      }

      let pattern: RegExp;
      try {
        pattern = new RegExp(profile.pattern, profile.flags);
      } catch {
        return [];
      }

      const domainBoosts = new Map(
        profile.domainBoosts.flatMap((boost) => {
          if (
            !boost ||
            typeof boost.domain !== 'string' ||
            boost.domain.length === 0 ||
            typeof boost.weight !== 'number' ||
            !Number.isFinite(boost.weight)
          ) {
            return [];
          }
          return [[boost.domain, boost.weight] as const];
        })
      );

      return [{ pattern, domainBoosts }];
    });
  }

  static compileCjkQueryAliasRules(
    config: SearchCjkQueryAliasConfig[]
  ): ReadonlyArray<CjkQueryAliasRule> {
    return config.flatMap((alias) => {
      if (!alias || typeof alias.pattern !== 'string' || !Array.isArray(alias.tokens)) {
        return [];
      }

      let pattern: RegExp;
      try {
        pattern = new RegExp(alias.pattern, alias.flags);
      } catch {
        return [];
      }

      const tokens = alias.tokens.filter(
        (token): token is string => typeof token === 'string' && token.length > 0
      );
      return [{ pattern, tokens }];
    });
  }

  /**
   * Detect query category and return domain boosts based on task-type encoding.
   */
  detectQueryCategoryBoosts(query: string): Map<string, number> {
    const boosts = new Map<string, number>();
    for (const profile of this.queryCategoryProfiles) {
      if (!profile.pattern.test(query)) continue;
      for (const [domain, weight] of profile.domainBoosts) {
        const prev = boosts.get(domain) ?? 1;
        boosts.set(domain, Math.max(prev, weight));
      }
    }
    return boosts;
  }

  /**
   * Expand CJK alias tokens for better Chinese language support.
   */
  expandCjkAliasTokens(text: string): string[] {
    const lower = text.toLowerCase();
    const result = new Set<string>();
    for (const alias of this.cjkQueryAliases) {
      if (alias.pattern.test(lower)) {
        for (const token of alias.tokens) {
          result.add(token);
        }
      }
    }
    return [...result];
  }

  /**
   * Tokenise text for BM25 search.
   * Handles CJK characters, camelCase, hyphens, and underscores.
   */
  tokenise(text: string): string[] {
    let normalised = text.replace(/[_-]/g, ' ');
    normalised = normalised.replace(/([\u4e00-\u9fff])/g, ' $1 ');
    const words = normalised.split(/[^a-zA-Z0-9\u4e00-\u9fff]+/).filter(Boolean);

    const result: string[] = [];
    for (const word of words) {
      const lower = word.toLowerCase();
      const camelParts = word.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
      if (camelParts.length > 1) {
        for (const part of camelParts) {
          result.push(part.toLowerCase());
        }
        result.push(lower);
      } else {
        result.push(lower);
      }
    }
    result.push(...this.expandCjkAliasTokens(text));
    return result;
  }

  /**
   * Get BM25 parameters.
   */
  getK1(): number {
    return K1;
  }

  /**
   * Get BM25 parameters.
   */
  getB(): number {
    return B;
  }
}
