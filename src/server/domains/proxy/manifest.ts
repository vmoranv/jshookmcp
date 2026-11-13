import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { PROXY_TOOLS } from '@server/domains/proxy/definitions';
import type { ProxyHandlers } from '@server/domains/proxy/index';

const DOMAIN = 'proxy' as const;
const DEP_KEY = 'proxyHandlers' as const;
type H = ProxyHandlers;
const t = toolLookup(PROXY_TOOLS);
const registrations = defineMethodRegistrations<H, (typeof PROXY_TOOLS)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'proxy_start', method: 'handleProxyStartTool' },
    { tool: 'proxy_stop', method: 'handleProxyStopTool' },
    { tool: 'proxy_status', method: 'handleProxyStatusTool' },
    { tool: 'proxy_export_ca', method: 'handleProxyExportCaTool' },
    { tool: 'proxy_add_rule', method: 'handleProxyAddRuleTool' },
    { tool: 'proxy_remove_rule', method: 'handleProxyRemoveRuleTool' },
    { tool: 'proxy_list_rules', method: 'handleProxyListRulesTool' },
    { tool: 'proxy_clear_rules', method: 'handleProxyClearRulesTool' },
    { tool: 'proxy_get_requests', method: 'handleProxyGetRequestsTool' },
    { tool: 'proxy_clear_logs', method: 'handleProxyClearLogsTool' },
    { tool: 'proxy_setup_adb_device', method: 'handleProxySetupAdbDeviceTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { ProxyHandlers } = await import('@server/domains/proxy/index');
  if (!ctx.proxyHandlers) {
    ctx.proxyHandlers = new ProxyHandlers();
  }
  return ctx.proxyHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  proxy_start: ['launch mitm proxy', 'spin up intercepting proxy', '启动抓包代理'],
  proxy_stop: ['shut the proxy down', 'kill mitm session', '关闭代理'],
  proxy_status: ['proxy running check', 'mitm state', '代理状态'],
  proxy_add_rule: ['add rewrite rule to proxy', 'new traffic rule', '加代理规则'],
  proxy_remove_rule: ['delete proxy rule', 'drop traffic rule', '删代理规则'],
  proxy_list_rules: ['show proxy rules', 'enumerate traffic rules', '列出代理规则'],
  proxy_clear_rules: ['wipe proxy rules', 'reset rule set', '清空代理规则'],
  proxy_get_requests: ['traffic seen through proxy', 'mitm captured requests', '代理流量'],
  proxy_clear_logs: ['flush proxy history', 'empty traffic log', '清代理日志'],
  proxy_export_ca: ['export proxy certificate', 'get mitm root ca', '导出 ca 证书'],
  proxy_setup_adb_device: [
    'route phone through proxy',
    'configure device wifi proxy',
    '手机挂代理',
  ],
};

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
};

export default manifest;
