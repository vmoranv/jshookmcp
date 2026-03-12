/**
 * BM25-based tool search engine for progressive tool discovery.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { allTools, getToolDomain } from '@server/ToolCatalog';
import {
  SEARCH_INTENT_TOOL_BOOST_RULES_OVERRIDE,
  type SearchIntentToolBoostRuleConfig,
} from '@src/constants';

/* ---------- public types ---------- */

export interface ToolSearchResult {
  name: string;
  domain: string | null;
  shortDescription: string;
  score: number;
  isActive: boolean;
}

/* ---------- internal types ---------- */

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
}

interface PostingEntry {
  docIndex: number;
  tf: number;
  weight: number;
}

/* ---------- BM25 parameters ---------- */

const K1 = 1.5;
const B = 0.3;

/* ---------- tokenisation ---------- */

const CJK_QUERY_ALIASES: ReadonlyArray<{
  pattern: RegExp;
  tokens: readonly string[];
}> = [
  { pattern: /工作流|流程编排|流程自动化|编排/, tokens: ['workflow', 'flow', 'orchestration'] },
  { pattern: /抓包|抓取|采集|捕获/, tokens: ['capture', 'sniff', 'collect'] },
  { pattern: /接口|端点/, tokens: ['api', 'endpoint', 'request'] },
  { pattern: /探测|探针|扫描/, tokens: ['probe', 'scan'] },
  { pattern: /账号|账户|用户/, tokens: ['account', 'user'] },
  { pattern: /注册|开户|报名/, tokens: ['register', 'signup'] },
  { pattern: /验证|校验|激活/, tokens: ['verify', 'verification', 'activation'] },
  { pattern: /验证码|图形验证码|人机验证/, tokens: ['captcha', 'verify', 'verification'] },
  { pattern: /邮箱|邮件/, tokens: ['email', 'mail'] },
  { pattern: /keygen|密钥|注册码|激活码/, tokens: ['keygen', 'key', 'activation'] },
  { pattern: /轮询|监听/, tokens: ['poll', 'watch'] },
  { pattern: /批量|并发/, tokens: ['batch', 'parallel'] },
  { pattern: /令牌|凭证|鉴权|认证/, tokens: ['token', 'auth', 'credential'] },
  { pattern: /提取|抽取|解析/, tokens: ['extract', 'parse'] },
  { pattern: /多标签页|多标签|标签页/, tokens: ['tab', 'multi'] },
  { pattern: /脚本库|脚本仓库/, tokens: ['script', 'library'] },
  { pattern: /脚本/, tokens: ['script'] },
  { pattern: /执行|运行/, tokens: ['run', 'execute'] },
  { pattern: /导出/, tokens: ['export'] },
  { pattern: /回放|重放/, tokens: ['replay'] },
  { pattern: /请求/, tokens: ['request'] },
];

type CompiledIntentToolBoostRule = {
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

function compileIntentToolBoostRules(
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

const INTENT_TOOL_BOOST_RULES =
  compileIntentToolBoostRules(SEARCH_INTENT_TOOL_BOOST_RULES_OVERRIDE) ?? DEFAULT_INTENT_TOOL_BOOST_RULES;

function expandCjkAliasTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const result = new Set<string>();
  for (const alias of CJK_QUERY_ALIASES) {
    if (alias.pattern.test(lower)) {
      for (const token of alias.tokens) {
        result.add(token);
      }
    }
  }
  return [...result];
}

function resolveIntentToolBonuses(query: string): Map<string, number> {
  const lower = query.toLowerCase();
  const bonuses = new Map<string, number>();
  for (const rule of INTENT_TOOL_BOOST_RULES) {
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

function tokenise(text: string): string[] {
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
  result.push(...expandCjkAliasTokens(text));
  return result;
}

/* ---------- ToolSearchEngine ---------- */

export class ToolSearchEngine {
  private readonly docs: ToolDocument[] = [];
  private readonly invertedIndex = new Map<string, PostingEntry[]>();
  /** Sorted index keys for O(log V) prefix lookup instead of O(V) scan. */
  private readonly sortedKeys: string[];
  private readonly avgDocLength: number;
  private readonly docCount: number;
  private readonly domainOverrides?: ReadonlyMap<string, string>;
  private readonly domainScoreMultipliers?: ReadonlyMap<string, number>;
  private readonly toolScoreMultipliers?: ReadonlyMap<string, number>;

  constructor(
    tools?: Tool[],
    domainOverrides?: ReadonlyMap<string, string>,
    domainScoreMultipliers?: ReadonlyMap<string, number>,
    toolScoreMultipliers?: ReadonlyMap<string, number>,
  ) {
    const source = tools ?? allTools;
    this.domainOverrides = domainOverrides;
    this.domainScoreMultipliers = domainScoreMultipliers;
    this.toolScoreMultipliers = toolScoreMultipliers;
    this.docCount = source.length;

    let totalLength = 0;
    for (let i = 0; i < source.length; i++) {
      const tool = source[i]!;
      const domain = this.domainOverrides?.get(tool.name) ?? getToolDomain(tool.name);
      const description = tool.description ?? '';
      const shortDescription = extractShortDescription(description);

      const nameTokens = tokenise(tool.name);
      const nameTokenSet = new Set(nameTokens);
      const domainTokens = domain ? tokenise(domain) : [];
      const descTokens = tokenise(description);

      const allTokens = [...nameTokens, ...domainTokens, ...descTokens];

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
      };
      this.docs.push(doc);
      totalLength += doc.length;

      const termFreqs = new Map<string, { tf: number; weight: number }>();

      for (const token of nameTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 3);
        termFreqs.set(token, entry);
      }
      for (const token of domainTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 2);
        termFreqs.set(token, entry);
      }
      for (const token of descTokens) {
        const entry = termFreqs.get(token) ?? { tf: 0, weight: 0 };
        entry.tf++;
        entry.weight = Math.max(entry.weight, 1);
        termFreqs.set(token, entry);
      }

      for (const [token, { tf, weight }] of termFreqs) {
        let postings = this.invertedIndex.get(token);
        if (!postings) {
          postings = [];
          this.invertedIndex.set(token, postings);
        }
        postings.push({ docIndex: i, tf, weight });
      }
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 1;
    this.sortedKeys = [...this.invertedIndex.keys()].sort();
  }

  search(
    query: string,
    topK = 10,
    activeToolNames?: ReadonlySet<string>
  ): ToolSearchResult[] {
    const queryTokens = tokenise(query);
    if (queryTokens.length === 0) {
      return [];
    }
    const intentToolBonuses = resolveIntentToolBonuses(query);

    const scores = new Float64Array(this.docCount);

    for (const qToken of queryTokens) {
      this.scoreToken(qToken, scores);
      if (qToken.length >= 3) {
        // O(log V + P) prefix lookup via binary search on sorted keys,
        // replacing the previous O(V) full-scan approach.
        const prefixMatches = this.findPrefixMatches(qToken);
        for (const indexToken of prefixMatches) {
          if (indexToken !== qToken) {
            const postings = this.invertedIndex.get(indexToken);
            if (postings) {
              this.scorePostings(postings, this.docCount, scores, 0.5);
            }
          }
        }
      }
    }

    const queryNormalised = query.toLowerCase().replace(/[\s-]+/g, '_');
    const queryTokenSet = new Set(queryTokens);

    for (let i = 0; i < this.docCount; i++) {
      const doc = this.docs[i]!;
      const intentBonus = intentToolBonuses.get(doc.name) ?? 0;
      if (scores[i]! <= 0 && intentBonus <= 0) continue;

      if (doc.name === queryNormalised) {
        scores[i]! *= 2.5;
        if (intentBonus > 0) {
          scores[i]! += intentBonus;
        }
        continue;
      }

      // Reuse precomputed nameTokenSet — avoids per-doc tokenise() + Set construction
      let matchedCount = 0;
      for (const qt of queryTokens) {
        if (doc.nameTokenSet.has(qt)) matchedCount++;
      }

      if (matchedCount > 0 && doc.nameTokenCount > 0 && queryTokenSet.size > 0) {
        const coverage = matchedCount / doc.nameTokenCount;
        const precision = matchedCount / queryTokenSet.size;
        scores[i]! *= 1 + 0.5 * coverage * precision;
      }

      const domainMultiplier = doc.domain
        ? (this.domainScoreMultipliers?.get(doc.domain) ?? 1)
        : 1;
      if (domainMultiplier !== 1) {
        scores[i]! *= domainMultiplier;
      }

      const toolMultiplier = this.toolScoreMultipliers?.get(doc.name) ?? 1;
      if (toolMultiplier !== 1) {
        scores[i]! *= toolMultiplier;
      }

      if (intentBonus > 0) {
        scores[i]! += intentBonus;
      }
    }

    const active = activeToolNames ?? new Set<string>();
    const candidates: ToolSearchResult[] = [];

    for (let i = 0; i < this.docCount; i++) {
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

  getDomainSummary(): Array<{ domain: string | null; count: number; tools: string[] }> {
    const domainMap = new Map<string | null, string[]>();
    for (const doc of this.docs) {
      const list = domainMap.get(doc.domain) ?? [];
      list.push(doc.name);
      domainMap.set(doc.domain, list);
    }
    return Array.from(domainMap.entries())
      .map(([domain, tools]) => ({ domain, count: tools.length, tools }))
      .sort((a, b) => b.count - a.count);
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
    // Binary search for the first key >= prefix
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (keys[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    // Collect all keys that start with prefix
    const matches: string[] = [];
    while (lo < keys.length && keys[lo]!.startsWith(prefix)) {
      matches.push(keys[lo]!);
      lo++;
    }
    return matches;
  }

  private scorePostings(
    postings: PostingEntry[],
    _N: number,
    scores: Float64Array,
    multiplier: number
  ): void {
    const df = postings.length;
    const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);

    for (const { docIndex, tf, weight } of postings) {
      const doc = this.docs[docIndex]!;
      const norm = 1 - B + B * (doc.length / this.avgDocLength);
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * norm);
      scores[docIndex]! += idf * tfNorm * weight * multiplier;
    }
  }
}

function extractShortDescription(description: string): string {
  if (!description) return '';
  const firstSentence = description.match(/^[^.!?\n]+[.!?]?/);
  if (firstSentence) {
    const result = firstSentence[0]!.trim();
    return result.length > 120 ? result.slice(0, 117) + '...' : result;
  }
  return description.length > 120 ? description.slice(0, 117) + '...' : description;
}
