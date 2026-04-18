import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { PROXY_TOOLS } from '@server/domains/proxy/definitions';
import { ProxyHandlers } from '@server/domains/proxy/index';

const DOMAIN = 'proxy' as const;
const DEP_KEY = 'proxyHandlers' as const;
type H = ProxyHandlers;
const t = toolLookup(PROXY_TOOLS);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.proxyHandlers) {
    ctx.proxyHandlers = new ProxyHandlers();
  }
  return ctx.proxyHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,

  registrations: [
    { tool: t('proxy_start'), domain: DOMAIN, bind: b((h, a) => h.handleProxyStart(a)) },
    { tool: t('proxy_stop'), domain: DOMAIN, bind: b((h, a) => h.handleProxyStop(a)) },
    { tool: t('proxy_status'), domain: DOMAIN, bind: b((h, a) => h.handleProxyStatus(a)) },
    { tool: t('proxy_export_ca'), domain: DOMAIN, bind: b((h, a) => h.handleProxyExportCa(a)) },
    { tool: t('proxy_add_rule'), domain: DOMAIN, bind: b((h, a) => h.handleProxyAddRule(a)) },
    {
      tool: t('proxy_get_requests'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleProxyGetRequests(a)),
    },
    { tool: t('proxy_clear_logs'), domain: DOMAIN, bind: b((h, a) => h.handleProxyClearLogs(a)) },
    {
      tool: t('proxy_setup_adb_device'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleProxySetupAdbDevice(a)),
    },
  ],
};

export default manifest;
