import type {
  SearchCjkQueryAliasConfig,
  SearchConfig,
  SearchIntentToolBoostRuleConfig,
  SearchQueryCategoryProfileConfig,
} from '@internal-types/config';
import {
  SEARCH_VECTOR_ENABLED,
  SEARCH_VECTOR_MODEL_ID,
  SEARCH_VECTOR_COSINE_WEIGHT,
  SEARCH_VECTOR_DYNAMIC_WEIGHT,
} from '@src/constants';

export const DEFAULT_QUERY_CATEGORY_PROFILE_CONFIGS = [
  {
    pattern:
      '(?:security|vuln|xss|injection|csrf|exploit|attack|prototype\\s*pollution|漏洞|安全|注入|攻击)',
    flags: 'i',
    domainBoosts: [
      { domain: 'security', weight: 1.6 },
      { domain: 'analysis', weight: 1.2 },
    ],
  },
  {
    pattern: '(?:debug|breakpoint|pause|step\\s*over|step\\s*into|stack\\s*trace|断点|调试|单步)',
    flags: 'i',
    domainBoosts: [
      { domain: 'debugger', weight: 1.6 },
      { domain: 'runtime', weight: 1.2 },
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
      { domain: 'analysis', weight: 1.2 },
    ],
  },
  {
    pattern: '(?:memory|heap|dump|scan|inject|内存|堆|扫描)',
    flags: 'i',
    domainBoosts: [
      { domain: 'memory', weight: 1.6 },
      { domain: 'native', weight: 1.2 },
    ],
  },
  {
    pattern: '(?:wasm|webassembly)',
    flags: 'i',
    domainBoosts: [{ domain: 'wasm', weight: 1.6 }],
  },
  {
    pattern: '(?:browser|page|tab|navigate|click|screenshot|浏览器|页面|标签)',
    flags: 'i',
    domainBoosts: [{ domain: 'browser', weight: 1.4 }],
  },
  {
    pattern: '(?:captcha|人机验证|验证码|图形验证)',
    flags: 'i',
    domainBoosts: [
      { domain: 'captcha', weight: 1.6 },
      { domain: 'browser', weight: 1.1 },
    ],
  },
  {
    pattern:
      '(?:reverse|mission|signature|hook|crypto|encrypt|websocket|\\bws\\b|protocol|bundle|webpack|deobfusc|stealth|fingerprint|evidence|\\bhar\\b|逆向|签名|加签|协议|反混淆|反检测|指纹|证据|报告)',
    flags: 'i',
    domainBoosts: [
      { domain: 'workflow', weight: 1.8 },
      { domain: 'analysis', weight: 1.1 },
    ],
  },
] satisfies SearchQueryCategoryProfileConfig[];

export const DEFAULT_CJK_QUERY_ALIAS_CONFIGS = [
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
  { pattern: '签名|加签|加密|hook', tokens: ['signature', 'crypto', 'hook', 'sign'] },
  { pattern: '协议|消息|帧|handler', tokens: ['websocket', 'protocol', 'ws', 'handler'] },
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

export const DEFAULT_INTENT_TOOL_BOOST_RULE_CONFIGS = [
  {
    pattern:
      '(?:端到端闭环|全链路闭环|一键闭环|api(?:[_\\s-]*)capture(?:[_\\s-]*)session|web_api_capture_session|抓取接口|抓包流程)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'api_probe_batch', bonus: 18 },
      { tool: 'network_extract_auth', bonus: 10 },
      { tool: 'network_export_har', bonus: 8 },
    ],
  },
  {
    pattern:
      '(?:register|signup|sign\\s*up|账号注册|账户注册|邮箱验证|验证账号|激活账号|注册验证|验证码|邮箱激活|激活链接|mail\\s*verify|email\\s*verify|account\\s*pending|keygen)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'tab_workflow', bonus: 8 },
    ],
  },
  {
    pattern: '(?:script\\s*library|script\\s*preset|run\\s*script|脚本库执行|脚本库|执行脚本)',
    flags: 'i',
    boosts: [
      { tool: 'page_script_run', bonus: 22 },
      { tool: 'page_script_register', bonus: 16 },
      { tool: 'run_extension_workflow', bonus: 10 },
    ],
  },
  {
    pattern: '(?:bundle|webpack|js\\s*bundle|脚本包|静态包|源码包)',
    flags: 'i',
    boosts: [
      { tool: 'js_bundle_search', bonus: 20 },
      { tool: 'source_map_extract', bonus: 10 },
      { tool: 'webpack_enumerate', bonus: 8 },
    ],
  },
  {
    pattern: '(?:workflow|orchestration|工作流|流程编排|流程自动化)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 26 },
      { tool: 'list_extension_workflows', bonus: 16 },
    ],
  },
  {
    pattern:
      '(?=.*(?:抓包|抓取|捕获|capture|sniff|collect))(?=.*(?:鉴权|认证|令牌|凭证|jwt|token|auth|credential))',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 28 },
      { tool: 'list_extension_workflows', bonus: 16 },
      { tool: 'network_extract_auth', bonus: 18 },
    ],
  },
  {
    pattern: '(?:signature|crypto|encrypt|hash|hook|签名|加签|加密)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'search_in_scripts', bonus: 12 },
      { tool: 'detect_crypto', bonus: 10 },
      { tool: 'manage_hooks', bonus: 8 },
    ],
  },
  {
    pattern: '(?:websocket|\\bws\\b|protocol|socket|handler|协议|消息|帧)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'ws_monitor_enable', bonus: 12 },
      { tool: 'ws_get_frames', bonus: 10 },
      { tool: 'ws_get_connections', bonus: 8 },
    ],
  },
  {
    pattern: '(?:bundle|webpack|chunk|source.*map|deobfusc|源码|打包|混淆|反混淆)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'js_bundle_search', bonus: 14 },
      { tool: 'collect_code', bonus: 10 },
      { tool: 'source_map_extract', bonus: 8 },
    ],
  },
  {
    pattern: '(?:stealth|fingerprint|webdriver|antibot|bot.*detect|反爬|反检测|指纹)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'stealth_inject', bonus: 10 },
      { tool: 'stealth_generate_fingerprint', bonus: 10 },
      { tool: 'stealth_verify', bonus: 8 },
    ],
  },
  {
    pattern: '(?:evidence|export|har|report|snapshot|证据|导出|报告|快照|取证)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'evidence_query_url', bonus: 14 },
      { tool: 'evidence_export_markdown', bonus: 12 },
      { tool: 'evidence_export_json', bonus: 10 },
    ],
  },
  {
    pattern:
      '(?:auth.*surface|token.*enum|credential.*map|鉴权面|认证面|凭证枚举|jwt|csrf|api.?key|授权)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'network_extract_auth', bonus: 14 },
      { tool: 'page_get_cookies', bonus: 8 },
    ],
  },
  {
    pattern:
      '(?:protocol.*registry|channel.*enum|通道枚举|协议注册|协议归类|SSE|EventSource|beacon|postMessage)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'ws_monitor_enable', bonus: 10 },
      { tool: 'sse_monitor_enable', bonus: 10 },
      { tool: 'network_get_requests', bonus: 8 },
    ],
  },
  {
    pattern:
      '(?:challenge|turnstile|cloudflare|hcaptcha|datadome|akamai|perimeterx|kasada|人机|挑战|风控|拦截页)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'captcha_detect', bonus: 14 },
      { tool: 'stealth_verify', bonus: 10 },
    ],
  },
  {
    pattern:
      '(?:signing.*lineage|签名谱系|签名链路|加签链路|签名追踪|plaintext.*cipher|明文.*密文)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'detect_crypto', bonus: 12 },
      { tool: 'extract_function_tree', bonus: 10 },
      { tool: 'manage_hooks', bonus: 8 },
    ],
  },
  {
    pattern: '(?:replay.*lab|request.*replay|复现|重发|篡改|参数篡改|request.*tamper)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'network_replay_request', bonus: 14 },
      { tool: 'instrumentation_network_replay', bonus: 12 },
      { tool: 'network_export_har', bonus: 8 },
    ],
  },
  {
    pattern: '(?:deobfusc.*pipeline|反混淆链|反混淆管道|清洗|还原|ast.*transform|packer|unpack)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'webcrack_unpack', bonus: 14 },
      { tool: 'ast_transform_apply', bonus: 12 },
      { tool: 'deobfuscate', bonus: 10 },
      { tool: 'detect_obfuscation', bonus: 8 },
    ],
  },
  {
    pattern: '(?:electron|nwjs|preload|ipc|asar|桌面应用|预加载|桥接|electron.*bridge)',
    flags: 'i',
    boosts: [
      { tool: 'run_extension_workflow', bonus: 40 },
      { tool: 'list_extension_workflows', bonus: 24 },
      { tool: 'electron_inspect_app', bonus: 14 },
      { tool: 'electron_ipc_sniff', bonus: 12 },
      { tool: 'asar_search', bonus: 10 },
      { tool: 'electron_check_fuses', bonus: 8 },
    ],
  },
] satisfies SearchIntentToolBoostRuleConfig[];

export const DEFAULT_SEARCH_CONFIG = {
  queryCategoryProfiles: DEFAULT_QUERY_CATEGORY_PROFILE_CONFIGS,
  cjkQueryAliases: DEFAULT_CJK_QUERY_ALIAS_CONFIGS,
  intentToolBoostRules: DEFAULT_INTENT_TOOL_BOOST_RULE_CONFIGS,
  vectorEnabled: SEARCH_VECTOR_ENABLED,
  vectorModelId: SEARCH_VECTOR_MODEL_ID,
  vectorCosineWeight: SEARCH_VECTOR_COSINE_WEIGHT,
  vectorDynamicWeight: SEARCH_VECTOR_DYNAMIC_WEIGHT,
} satisfies SearchConfig;
