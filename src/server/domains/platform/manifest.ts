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
  asar_deobfuscate: ['deobfuscate electron archive code', 'decode asar scripts', 'asar 反混淆'],
  asar_extract: ['unpack electron app archive', 'pull files out of asar', '解包 asar'],
  asar_repack: ['rebuild the app archive', 'pack files back into asar', '重打包 asar'],
  asar_search: ['search inside the app archive', 'find code in asar', 'asar 内检索'],
  electron_check_fuses: ['read electron fuse state', 'which fuses are flipped', '检查 fuse'],
  electron_debug_status: [
    'electron debugging reachable',
    'debug port open on electron',
    '调试状态',
  ],
  electron_inspect_app: ['inspect an electron app', 'analyze the packaged app', '检视应用'],
  electron_ipc_sniff: ['listen to electron ipc messages', 'sniff internal channels', '嗅探 ipc'],
  electron_launch_debug: [
    'start electron with debugging',
    'launch app with remote debugging',
    '带调试启动',
  ],
  electron_patch_fuses: ['flip electron fuses', 'change fuse configuration', '改 fuse'],
  electron_scan_userdata: [
    'scan electron user data dir',
    'inspect profile storage',
    '扫描用户数据',
  ],
  electron_verify_integrity: ['check app integrity', 'verify files are unmodified', '完整性校验'],
  electron_verify_signature: ['check code signature', 'verify app signing', '签名校验'],
  miniapp_pkg_analyze: ['analyze a wechat mini app', 'inspect mini program package', '小程序分析'],
  miniapp_pkg_scan: ['scan mini program contents', 'list package internals', '小程序扫描'],
  miniapp_pkg_unpack: ['unpack a mini app package', 'extract wxapkg files', '解包小程序'],
  platform_capabilities: ['what can this host do', 'environment feature probe', '平台能力'],
  v8_bytecode_decompile: ['decompile v8 bytecode', 'read cached bytecode', '反编译字节码'],
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
