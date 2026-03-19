/**
 * Intent-based tool boosting implementation.
 * Handles query pattern matching and tool bonus resolution.
 */
import { DEFAULT_SEARCH_CONFIG } from '@src/config/search-defaults';
import type { SearchIntentToolBoostRuleConfig } from '@internal-types/config';

// ── Intent tool boost rules ──

export type CompiledIntentToolBoostRule = {
  pattern: RegExp;
  boosts: ReadonlyArray<{ tool: string; bonus: number }>;
};

// ── IntentBoost implementation ──

export class IntentBoostImpl {
  private readonly compiledRules: ReadonlyArray<CompiledIntentToolBoostRule>;

  constructor(intentToolBoostRules?: SearchIntentToolBoostRuleConfig[]) {
    this.compiledRules =
      intentToolBoostRules !== undefined
        ? IntentBoostImpl.compileIntentToolBoostRules(intentToolBoostRules)
        : IntentBoostImpl.compileIntentToolBoostRules(DEFAULT_SEARCH_CONFIG.intentToolBoostRules);
  }

  /**
   * Compile user-provided intent tool boost rules from config.
   */
  static compileIntentToolBoostRules(
    config: SearchIntentToolBoostRuleConfig[]
  ): ReadonlyArray<CompiledIntentToolBoostRule> {
    const compiled: CompiledIntentToolBoostRule[] = [];
    for (const rule of config) {
      if (
        !rule ||
        typeof rule.pattern !== 'string' ||
        !Array.isArray(rule.boosts) ||
        rule.boosts.length === 0
      ) {
        continue;
      }
      let regex: RegExp;
      try {
        regex = new RegExp(rule.pattern, rule.flags ?? 'i');
      } catch {
        continue;
      }

      const boosts = rule.boosts
        .filter((item) => item && typeof item.tool === 'string' && item.tool.length > 0)
        .map((item) => ({
          tool: item.tool,
          bonus: Number.isFinite(item.bonus) ? item.bonus : 0,
        }))
        .filter((item) => item.bonus > 0);
      if (boosts.length === 0) {
        continue;
      }

      compiled.push({ pattern: regex, boosts });
    }

    return compiled;
  }

  /**
   * Resolve intent-based tool bonuses for a query.
   * Returns a map of tool name -> bonus score.
   */
  resolveIntentToolBonuses(query: string): Map<string, number> {
    const lower = query.toLowerCase();
    const bonuses = new Map<string, number>();
    for (const rule of this.compiledRules) {
      if (!rule.pattern.test(lower)) {
        continue;
      }
      for (const { tool, bonus } of rule.boosts) {
        const prev = bonuses.get(tool) ?? 0;
        bonuses.set(tool, Math.max(prev, bonus));
      }
    }
    return bonuses;
  }

  /**
   * Get the compiled rules for inspection.
   */
  getCompiledRules(): ReadonlyArray<CompiledIntentToolBoostRule> {
    return this.compiledRules;
  }
}
