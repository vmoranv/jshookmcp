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

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  asar_deobfuscate: [
    'deobfuscate electron archive code',
    'decode asar scripts',
    'deobfuscate an asar archive bundle',
    'decode obfuscated archive scripts',
  ],
  asar_extract: [
    'unpack electron app archive',
    'pull files out of asar',
    'unpack an asar archive',
    'unpack electron archive contents',
  ],
  asar_repack: [
    'rebuild the app archive',
    'pack files back into asar',
    'repack an asar archive bundle',
  ],
  asar_search: [
    'search inside the app archive',
    'find code in asar',
    'search inside an asar archive',
  ],
  electron_check_fuses: [
    'read electron fuse state',
    'which fuses are flipped',
    'check the electron fuse settings',
  ],
  electron_debug_status: [
    'electron debugging reachable',
    'debug port open on electron',
    'show the debug status',
  ],
  electron_inspect_app: [
    'inspect an electron app',
    'analyze the packaged app',
    'inspect the electron app',
  ],
  electron_ipc_sniff: [
    'listen to electron ipc messages',
    'sniff internal channels',
    'sniff the electron ipc channel',
  ],
  electron_launch_debug: [
    'start electron with debugging',
    'launch app with remote debugging',
    'launch with the debugger attached',
  ],
  electron_patch_fuses: [
    'flip electron fuses',
    'change fuse configuration',
    'flip the electron fuse',
  ],
  electron_scan_userdata: [
    'scan electron user data dir',
    'inspect profile storage',
    'scan the user data directory',
  ],
  electron_verify_integrity: [
    'check app integrity',
    'verify files are unmodified',
    'verify the integrity',
  ],
  electron_verify_signature: ['check code signature', 'verify app signing', 'verify the signature'],
  miniapp_pkg_analyze: [
    'analyze a wechat mini app',
    'inspect mini program package',
    'analyse the miniprogram package',
  ],
  miniapp_pkg_scan: [
    'scan mini program contents',
    'list package internals',
    'scan the miniprogram package',
  ],
  miniapp_pkg_unpack: [
    'unpack a mini app package',
    'extract wxapkg files',
    'unpack the miniprogram package',
    'extract wxapkg package files',
  ],
  platform_capabilities: [
    'what can this host do',
    'environment feature probe',
    'platform capabilities',
  ],
  v8_bytecode_decompile: [
    'decompile v8 bytecode',
    'read cached bytecode',
    'decompile the bytecode',
  ],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
