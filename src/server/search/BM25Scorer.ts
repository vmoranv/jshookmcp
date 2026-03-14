/**
 * BM25 and TF-IDF scoring implementation.
 * Contains BM25 parameters, scoring functions, and TF-IDF cosine similarity.
 */

/* ---------- BM25 parameters ---------- */

const K1 = 1.5;
const B = 0.3;

/* ---------- query category adaptive weights (§4.1.3 task-type encoding) ---------- */

export interface QueryCategoryProfile {
  pattern: RegExp;
  domainBoosts: ReadonlyMap<string, number>;
}

export const QUERY_CATEGORY_PROFILES: ReadonlyArray<QueryCategoryProfile> = [
  {
    pattern: /(?:security|vuln|xss|injection|csrf|exploit|attack|prototype\s*pollution|漏洞|安全|注入|攻击)/i,
    domainBoosts: new Map([['security', 1.6], ['analysis', 1.2]]),
  },
  {
    pattern: /(?:debug|breakpoint|pause|step\s*over|step\s*into|stack\s*trace|断点|调试|单步)/i,
    domainBoosts: new Map([['debugger', 1.6], ['runtime', 1.2]]),
  },
  {
    pattern: /(?:network|request|response|header|cookie|fetch|xhr|网络|请求|抓包)/i,
    domainBoosts: new Map([['network', 1.6], ['browser', 1.1]]),
  },
  {
    pattern: /(?:transform|deobfuscate|beautify|minify|decode|encode|解密|混淆|反混淆|转换)/i,
    domainBoosts: new Map([['transform', 1.6], ['analysis', 1.2]]),
  },
  {
    pattern: /(?:memory|heap|dump|scan|inject|内存|堆|扫描)/i,
    domainBoosts: new Map([['memory', 1.6], ['native', 1.2]]),
  },
  {
    pattern: /(?:wasm|webassembly)/i,
    domainBoosts: new Map([['wasm', 1.6]]),
  },
  {
    pattern: /(?:browser|page|tab|navigate|click|screenshot|浏览器|页面|标签)/i,
    domainBoosts: new Map([['browser', 1.4]]),
  },
  {
    pattern: /(?:captcha|人机验证|验证码|图形验证)/i,
    domainBoosts: new Map([['captcha', 1.6], ['browser', 1.1]]),
  },
];

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

/* ---------- BM25Scorer implementation ---------- */

export class BM25ScorerImpl {
  /**
   * Detect query category and return domain boosts based on task-type encoding.
   */
  detectQueryCategoryBoosts(query: string): Map<string, number> {
    const boosts = new Map<string, number>();
    for (const profile of QUERY_CATEGORY_PROFILES) {
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
    for (const alias of CJK_QUERY_ALIASES) {
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