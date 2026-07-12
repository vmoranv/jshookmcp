import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { platformTools } from '@server/domains/platform/definitions';
import type { PlatformToolHandlers } from '@server/domains/platform/index';

const DOMAIN = 'platform' as const;
const DEP_KEY = 'platformHandlers' as const;
type H = PlatformToolHandlers;
const t = toolLookup(platformTools);
const registrations = defineMethodRegistrations<H, (typeof platformTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'platform_capabilities', method: 'handlePlatformCapabilitiesTool' },
    { tool: 'miniapp_pkg_scan', method: 'handleMiniappPkgScanTool' },
    { tool: 'miniapp_pkg_unpack', method: 'handleMiniappPkgUnpackTool' },
    { tool: 'miniapp_pkg_analyze', method: 'handleMiniappPkgAnalyzeTool' },
    { tool: 'asar_extract', method: 'handleAsarExtractTool' },
    { tool: 'electron_inspect_app', method: 'handleElectronInspectAppTool' },
    { tool: 'electron_scan_userdata', method: 'handleElectronScanUserdataTool' },
    { tool: 'asar_search', method: 'handleAsarSearchTool' },
    { tool: 'electron_check_fuses', method: 'handleElectronCheckFusesTool' },
    { tool: 'electron_patch_fuses', method: 'handleElectronPatchFusesTool' },
    { tool: 'v8_bytecode_decompile', method: 'handleV8BytecodeDecompileTool' },
    { tool: 'electron_launch_debug', method: 'handleElectronLaunchDebugTool' },
    { tool: 'electron_debug_status', method: 'handleElectronDebugStatusTool' },
    { tool: 'electron_ipc_sniff', method: 'handleElectronIPCSniffTool' },
    { tool: 'electron_verify_integrity', method: 'handleElectronVerifyIntegrityTool' },
    { tool: 'asar_deobfuscate', method: 'handleAsarDeobfuscateTool' },
    { tool: 'asar_repack', method: 'handleAsarRepackTool' },
    { tool: 'electron_verify_signature', method: 'handleElectronVerifySignatureTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { CodeCollector } = await import('@server/domains/shared/modules/collector');
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
  registrations,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
