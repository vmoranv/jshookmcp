import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { platformTools } from '@server/domains/platform/definitions';
import { PlatformToolHandlers } from '@server/domains/platform/index';
import { CodeCollector } from '@server/domains/shared/modules';

const DOMAIN = 'platform' as const;
const DEP_KEY = 'platformHandlers' as const;
type H = PlatformToolHandlers;
const t = toolLookup(platformTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.platformHandlers) ctx.platformHandlers = new PlatformToolHandlers(ctx.collector);
  return ctx.platformHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations: [
    { tool: t('miniapp_pkg_scan'), domain: DOMAIN, bind: b((h, a) => h.handleMiniappPkgScan(a)) },
    {
      tool: t('miniapp_pkg_unpack'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleMiniappPkgUnpack(a)),
    },
    {
      tool: t('miniapp_pkg_analyze'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleMiniappPkgAnalyze(a)),
    },
    { tool: t('asar_extract'), domain: DOMAIN, bind: b((h, a) => h.handleAsarExtract(a)) },
    {
      tool: t('electron_inspect_app'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleElectronInspectApp(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
