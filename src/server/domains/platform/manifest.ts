import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { platformTools } from './definitions.js';
import { PlatformToolHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';

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

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest', version: 1,
  domain: DOMAIN, depKey: DEP_KEY,
  profiles: ['full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('miniapp_pkg_scan'), domain: DOMAIN, bind: b((h, a) => h.handleMiniappPkgScan(a)) },
    { tool: t('miniapp_pkg_unpack'), domain: DOMAIN, bind: b((h, a) => h.handleMiniappPkgUnpack(a)) },
    { tool: t('miniapp_pkg_analyze'), domain: DOMAIN, bind: b((h, a) => h.handleMiniappPkgAnalyze(a)) },
    { tool: t('asar_extract'), domain: DOMAIN, bind: b((h, a) => h.handleAsarExtract(a)) },
    { tool: t('electron_inspect_app'), domain: DOMAIN, bind: b((h, a) => h.handleElectronInspectApp(a)) },
    { tool: t('frida_bridge'), domain: DOMAIN, bind: b((h, a) => h.handleFridaBridge(a)) },
    { tool: t('jadx_bridge'), domain: DOMAIN, bind: b((h, a) => h.handleJadxBridge(a)) },
  ],
};

export default manifest;
