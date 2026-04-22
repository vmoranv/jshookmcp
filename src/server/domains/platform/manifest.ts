import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { platformTools } from '@server/domains/platform/definitions';
import type { PlatformToolHandlers } from '@server/domains/platform/index';

const DOMAIN = 'platform' as const;
const DEP_KEY = 'platformHandlers' as const;
type H = PlatformToolHandlers;
const t = toolLookup(platformTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { CodeCollector } = await import('@server/domains/shared/modules');
  const { PlatformToolHandlers } = await import('@server/domains/platform/index');
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
    {
      tool: t('electron_scan_userdata'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleElectronScanUserdata(a)),
    },
    { tool: t('asar_search'), domain: DOMAIN, bind: b((h, a) => h.handleAsarSearch(a)) },
    {
      tool: t('electron_check_fuses'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleElectronCheckFuses(a)),
    },
    {
      tool: t('electron_patch_fuses'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleElectronPatchFuses(a)),
    },
    {
      tool: t('v8_bytecode_decompile'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleV8BytecodeDecompile(a)),
    },
    {
      tool: t('electron_launch_debug'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleElectronLaunchDebug(a)),
    },
    {
      tool: t('electron_debug_status'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleElectronDebugStatus(a)),
    },
    {
      tool: t('electron_ipc_sniff'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleElectronIPCSniff(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
