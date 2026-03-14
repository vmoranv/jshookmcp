/**
 * Intent-based tool boosting implementation.
 * Handles query pattern matching and tool bonus resolution.
 */
import {
  SEARCH_INTENT_TOOL_BOOST_RULES_OVERRIDE,
  type SearchIntentToolBoostRuleConfig,
} from '@src/constants';

/* ---------- Intent tool boost rules ---------- */

export type CompiledIntentToolBoostRule = {
  pattern: RegExp;
  boosts: ReadonlyArray<{ tool: string; bonus: number }>;
};

const DEFAULT_INTENT_TOOL_BOOST_RULES: ReadonlyArray<CompiledIntentToolBoostRule> = [
  {
    pattern: /(?:端到端闭环|全链路闭环|一键闭环|api\s*capture\s*session|抓取接口|抓包流程)/i,
    boosts: [
      { tool: 'web_api_capture_session', bonus: 26 },
      { tool: 'api_probe_batch', bonus: 18 },
      { tool: 'network_extract_auth', bonus: 10 },
      { tool: 'network_export_har', bonus: 8 },
    ],
  },
  {
    pattern: /(?:register|signup|sign\s*up|账号注册|账户注册|邮箱验证|验证账号|激活账号|注册验证|验证码|邮箱激活|激活链接|mail\s*verify|email\s*verify|account\s*pending|keygen)/i,
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'register_account_flow', bonus: 20 },
      { tool: 'batch_register', bonus: 18 },
      { tool: 'tab_workflow', bonus: 8 },
    ],
  },
  {
    pattern: /(?:script\s*library|script\s*preset|run\s*script|脚本库执行|脚本库|执行脚本)/i,
    boosts: [
      { tool: 'page_script_run', bonus: 22 },
      { tool: 'page_script_register', bonus: 16 },
      { tool: 'run_extension_workflow', bonus: 10 },
    ],
  },
  {
    pattern: /(?:bundle|webpack|js\s*bundle|脚本包|静态包|源码包)/i,
    boosts: [
      { tool: 'js_bundle_search', bonus: 20 },
      { tool: 'source_map_extract', bonus: 10 },
      { tool: 'webpack_enumerate', bonus: 8 },
    ],
  },
  {
    pattern: /(?:workflow|orchestration|工作流|流程编排|流程自动化)/i,
    boosts: [
      { tool: 'run_extension_workflow', bonus: 26 },
      { tool: 'list_extension_workflows', bonus: 16 },
      { tool: 'web_api_capture_session', bonus: 8 },
    ],
  },
];

/* ---------- IntentBoost implementation ---------- */

export class IntentBoostImpl {
  private readonly compiledRules: ReadonlyArray<CompiledIntentToolBoostRule>;

  constructor() {
    this.compiledRules =
      IntentBoostImpl.compileIntentToolBoostRules(SEARCH_INTENT_TOOL_BOOST_RULES_OVERRIDE) ??
      DEFAULT_INTENT_TOOL_BOOST_RULES;
  }

  /**
   * Compile user-provided intent tool boost rules from config.
   */
  static compileIntentToolBoostRules(
    config: SearchIntentToolBoostRuleConfig[] | null
  ): ReadonlyArray<CompiledIntentToolBoostRule> | null {
    if (!config || !Array.isArray(config)) {
      return null;
    }

    const compiled: CompiledIntentToolBoostRule[] = [];
    for (const rule of config) {
      if (!rule || typeof rule.pattern !== 'string' || !Array.isArray(rule.boosts) || rule.boosts.length === 0) {
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

    return compiled.length > 0 ? compiled : null;
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