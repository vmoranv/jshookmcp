import type {
  SearchCjkQueryAliasConfig,
  SearchConfig,
  SearchQueryCategoryProfileConfig,
} from '@internal-types/config';

const DEFAULT_QUERY_CATEGORY_PROFILE_CONFIGS = [
  {
    pattern:
      '(?:security|vuln|xss|injection|csrf|exploit|attack|prototype\\s*pollution|漏洞|安全|注入|攻击)',
    flags: 'i',
    domainBoosts: [
      { domain: 'instrumentation', weight: 1.35 },
      { domain: 'debugger', weight: 1.2 },
      { domain: 'core', weight: 1.1 },
    ],
  },
  {
    pattern: '(?:debug|breakpoint|pause|step\\s*over|step\\s*into|stack\\s*trace|断点|调试|单步)',
    flags: 'i',
    domainBoosts: [
      { domain: 'debugger', weight: 1.6 },
      { domain: 'v8-inspector', weight: 1.2 },
    ],
  },
  {
    pattern: '(?:network|request|response|header|cookie|fetch|xhr|网络|请求|抓包)',
    flags: 'i',
    domainBoosts: [
      { domain: 'network', weight: 1.6 },
      { domain: 'browser', weight: 1.1 },
    ],
  },
  {
    pattern: '(?:transform|deobfuscate|beautify|minify|decode|encode|解密|混淆|反混淆|转换)',
    flags: 'i',
    domainBoosts: [
      { domain: 'transform', weight: 1.6 },
      { domain: 'core', weight: 1.2 },
    ],
  },
  {
    pattern: '(?:memory|heap|dump|scan|inject|内存|堆|扫描)',
    flags: 'i',
    domainBoosts: [
      { domain: 'memory', weight: 1.6 },
      { domain: 'process', weight: 1.15 },
      { domain: 'binary-instrument', weight: 1.1 },
    ],
  },
  {
    pattern: '(?:wasm|webassembly)',
    flags: 'i',
    domainBoosts: [{ domain: 'wasm', weight: 1.6 }],
  },
  {
    pattern: '(?:browser|page|\\btab\\b|navigate|click|screenshot|浏览器|页面|标签)',
    flags: 'i',
    domainBoosts: [{ domain: 'browser', weight: 1.4 }],
  },
  {
    pattern: '(?:captcha|人机验证|验证码|图形验证)',
    flags: 'i',
    domainBoosts: [{ domain: 'browser', weight: 1.65 }],
  },
  {
    pattern:
      '(?:reverse|mission|signature|hook|crypto|encrypt|websocket|\\bws\\b|protocol|bundle|webpack|deobfusc|stealth|' +
      'fingerprint|evidence|\\bhar\\b|逆向|签名|加签|协议|反混淆|反检测|指纹|证据|报告)',
    flags: 'i',
    domainBoosts: [
      { domain: 'workflow', weight: 1.8 },
      { domain: 'core', weight: 1.1 },
    ],
  },
  {
    pattern:
      '(?:v8|heap\\s?(?:snapshot|dump|profile)|bytecode|jit|turbofan|ignition|hidden\\s?class)',
    flags: 'i',
    domainBoosts: [
      { domain: 'v8-inspector', weight: 1.6 },
      { domain: 'memory', weight: 1.2 },
    ],
  },
  {
    pattern: '(?:tls|ssl|boringssl|cert(?:ificate)?|pinning|handshake|keylog|nss)',
    flags: 'i',
    domainBoosts: [
      { domain: 'tls-inspector', weight: 1.6 },
      { domain: 'network', weight: 1.1 },
    ],
  },
  {
    pattern: '(?:skia|gpu|render|scenegraph|scene\\s?tree|raster|draw\\s?call|layer)',
    flags: 'i',
    domainBoosts: [
      { domain: 'canvas', weight: 1.6 },
      { domain: 'browser', weight: 1.1 },
    ],
  },
  {
    pattern: '(?:frida|ghidra|ida|unidbg|jadx|disassemble|instrument)',
    flags: 'i',
    domainBoosts: [
      { domain: 'binary-instrument', weight: 1.6 },
      { domain: 'memory', weight: 1.2 },
    ],
  },
  {
    pattern: '(?:adb|android|webview|apk|dalvik|art\\s?(?:runtime)?)',
    flags: 'i',
    domainBoosts: [
      { domain: 'adb-bridge', weight: 1.6 },
      { domain: 'browser', weight: 1.1 },
    ],
  },
  {
    pattern: '(?:mojo|ipc|chromium.*ipc|broker|chromium.*interface)',
    flags: 'i',
    domainBoosts: [
      { domain: 'mojo-ipc', weight: 1.6 },
      { domain: 'debugger', weight: 1.1 },
    ],
  },
  {
    pattern: '(?:syscall|etw|strace|dtrace|kernel.*call|system\\s?call|tracefs)',
    flags: 'i',
    domainBoosts: [
      { domain: 'syscall-hook', weight: 1.6 },
      { domain: 'process', weight: 1.1 },
    ],
  },
  {
    pattern: '(?:protocol.*analy|state\\s?machine|packet.*decode|field.*extract)',
    flags: 'i',
    domainBoosts: [
      { domain: 'protocol-analysis', weight: 1.6 },
      { domain: 'network', weight: 1.1 },
    ],
  },
  {
    pattern:
      '(?:extension.*(?:install|registry|list)|plugin.*(?:install|manage)|addon|webhook.*(?:create|manage))',
    flags: 'i',
    domainBoosts: [
      { domain: 'extension-registry', weight: 1.6 },
      { domain: 'workflow', weight: 1.1 },
    ],
  },
] satisfies SearchQueryCategoryProfileConfig[];

const DEFAULT_CJK_QUERY_ALIAS_CONFIGS = [
  { pattern: '工作流|流程编排|流程自动化|编排', tokens: ['workflow', 'flow', 'orchestration'] },
  { pattern: '抓包|抓取|采集|捕获', tokens: ['capture', 'sniff', 'collect'] },
  { pattern: '接口|端点', tokens: ['api', 'endpoint', 'request'] },
  { pattern: '探测|探针|扫描', tokens: ['probe', 'scan'] },
  { pattern: '账号|账户|用户', tokens: ['account', 'user'] },
  { pattern: '注册|开户|报名', tokens: ['register', 'signup'] },
  { pattern: '验证|校验|激活', tokens: ['verify', 'verification', 'activation'] },
  { pattern: '验证码|图形验证码|人机验证', tokens: ['captcha', 'verify', 'verification'] },
  { pattern: '邮箱|邮件', tokens: ['email', 'mail'] },
  { pattern: 'keygen|密钥|注册码|激活码', tokens: ['keygen', 'key', 'activation'] },
  { pattern: '轮询|监听', tokens: ['poll', 'watch'] },
  { pattern: '批量|并发', tokens: ['batch', 'parallel'] },
  { pattern: '令牌|凭证|鉴权|认证', tokens: ['token', 'auth', 'credential'] },
  { pattern: '提取|抽取|解析', tokens: ['extract', 'parse'] },
  { pattern: '签名|加签|加密', tokens: ['signature', 'crypto', 'hook', 'sign'] },
  { pattern: '协议|消息|帧', tokens: ['websocket', 'protocol', 'ws', 'handler'] },
  { pattern: '打包|webpack|混淆|反混淆', tokens: ['bundle', 'webpack', 'deobfuscate', 'unpack'] },
  {
    pattern: '反爬|反检测|指纹|stealth',
    tokens: ['antibot', 'stealth', 'fingerprint', 'detection'],
  },
  { pattern: '证据|取证|导出|报告|快照', tokens: ['evidence', 'export', 'report', 'forensic'] },
  { pattern: '多标签页|多标签|标签页', tokens: ['tab', 'multi'] },
  { pattern: '脚本库|脚本仓库', tokens: ['script', 'library'] },
  { pattern: '脚本', tokens: ['script'] },
  { pattern: '执行|运行', tokens: ['run', 'execute'] },
  { pattern: '导出', tokens: ['export'] },
  { pattern: '回放|重放', tokens: ['replay'] },
  { pattern: '请求', tokens: ['request'] },
  { pattern: '鉴权面|认证面|授权面|凭证枚举', tokens: ['auth', 'surface', 'token', 'credential'] },
  { pattern: '通道|通信|协议注册|协议枚举', tokens: ['protocol', 'channel', 'registry'] },
  { pattern: '人机|挑战|风控|拦截页', tokens: ['challenge', 'captcha', 'cloudflare', 'turnstile'] },
  {
    pattern: '签名谱系|签名链路|加签链路|签名追踪',
    tokens: ['signing', 'lineage', 'signature', 'trace'],
  },
  { pattern: '复现|重发|篡改|参数篡改', tokens: ['replay', 'tamper', 'request'] },
  {
    pattern: '反混淆链|反混淆管道|清洗|还原',
    tokens: ['deobfuscate', 'pipeline', 'transform', 'ast'],
  },
  { pattern: '桌面应用|electron|nwjs|预加载', tokens: ['electron', 'bridge', 'preload', 'ipc'] },
] satisfies SearchCjkQueryAliasConfig[];

export const DEFAULT_SEARCH_CONFIG = {
  queryCategoryProfiles: DEFAULT_QUERY_CATEGORY_PROFILE_CONFIGS,
  cjkQueryAliases: DEFAULT_CJK_QUERY_ALIAS_CONFIGS,
  intentToolBoostRules: [],
  // Defaults must stay independent from process.env. Runtime overrides are
  // applied by getConfig(); allowing environment-backed constants here would
  // make an invalid override become its own "fallback" value.
} satisfies SearchConfig;
