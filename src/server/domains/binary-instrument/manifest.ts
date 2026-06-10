import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { binaryInstrumentTools } from './definitions';
import { apkPackerTools } from './apk-packer/definitions';
import { binarySecretsTools } from './secrets/definitions';
import type { BinaryInstrumentHandlers } from './handlers';
import type { ApkPackerHandlers } from './apk-packer/handlers';
import type { BinarySecretsHandlers } from './secrets/handlers';

const DOMAIN = 'binary-instrument' as const;
const DEP_KEY = 'binaryInstrumentHandlers' as const;
type H = BinaryInstrumentHandlers;
const toolByName = toolLookup(binaryInstrumentTools);
const registrations = defineMethodRegistrations<H, (typeof binaryInstrumentTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: toolByName,
  entries: [
    { tool: 'binary_instrument_capabilities', method: 'handleBinaryInstrumentCapabilities' },
    { tool: 'frida_attach', method: 'handleFridaAttach' },
    { tool: 'frida_enumerate_modules', method: 'handleFridaEnumerateModules' },
    { tool: 'ghidra_analyze', method: 'handleGhidraAnalyze' },
    { tool: 'generate_hooks', method: 'handleGenerateHooks' },
    { tool: 'unidbg_emulate', method: 'handleUnidbgEmulate' },
    { tool: 'frida_run_script', method: 'handleFridaRunScript' },
    { tool: 'frida_detach', method: 'handleFridaDetach' },
    { tool: 'frida_list_sessions', method: 'handleFridaListSessions' },
    { tool: 'frida_dex_dump', method: 'handleFridaDexDump' },
    { tool: 'android_runtime_dump_session', method: 'handleAndroidRuntimeDumpSession' },
    { tool: 'frida_generate_script', method: 'handleFridaGenerateScript' },
    { tool: 'get_available_plugins', method: 'handleGetAvailablePlugins' },
    { tool: 'ghidra_decompile', method: 'handleGhidraDecompile' },
    { tool: 'ida_decompile', method: 'handleIdaDecompile' },
    { tool: 'jadx_decompile', method: 'handleJadxDecompile' },
    { tool: 'jadx_decompile_apk', method: 'handleJadxDecompileApk' },
    { tool: 'jadx_search_code', method: 'handleJadxSearchCode' },
    { tool: 'apktool_decode', method: 'handleApktoolDecode' },
    { tool: 'apk_manifest_dump', method: 'handleApkManifestDump' },
    { tool: 'apk_manifest_query', method: 'handleApkManifestQuery' },
    { tool: 'apk_static_triage', method: 'handleApkStaticTriage' },
    { tool: 'apk_dex_intake', method: 'handleApkDexIntake' },
    { tool: 'dex_scan_file', method: 'handleDexScanFile' },
    { tool: 'binary_strings_extract', method: 'handleBinaryStringsExtract' },
    { tool: 'apk_native_libs_list', method: 'handleApkNativeLibsList' },
    { tool: 'unidbg_launch', method: 'handleUnidbgLaunch' },
    { tool: 'unidbg_call', method: 'handleUnidbgCall' },
    { tool: 'unidbg_trace', method: 'handleUnidbgTrace' },
    { tool: 'export_hook_script', method: 'handleExportHookScript' },
    { tool: 'frida_enumerate_functions', method: 'handleFridaEnumerateFunctions' },
    { tool: 'frida_find_symbols', method: 'handleFridaFindSymbols' },
  ],
});

// ── Secondary sub-domain registrations ──

const apkPackerLookup = toolLookup(apkPackerTools);
const apkPackerRegistrations = defineMethodRegistrations<
  ApkPackerHandlers,
  (typeof apkPackerTools)[number]['name']
>({
  domain: DOMAIN,
  depKey: 'apkPackerHandlers' as const,
  lookup: apkPackerLookup,
  entries: [
    { tool: 'apk_packer_detect', method: 'handleApkPackerDetect' },
    { tool: 'apk_packer_list_signatures', method: 'handleApkPackerListSignatures' },
    { tool: 'apk_signing_block_parse', method: 'handleApkSigningBlockParse' },
  ],
});

const binarySecretsLookup = toolLookup(binarySecretsTools);
const binarySecretsRegistrations = defineMethodRegistrations<
  BinarySecretsHandlers,
  (typeof binarySecretsTools)[number]['name']
>({
  domain: DOMAIN,
  depKey: 'binarySecretsHandlers' as const,
  lookup: binarySecretsLookup,
  entries: [{ tool: 'binary_key_extract', method: 'handleBinaryKeyExtract' }],
});

const allRegistrations = [
  ...registrations,
  ...apkPackerRegistrations,
  ...binarySecretsRegistrations,
];

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { BinaryInstrumentHandlers } = await import('./handlers');
  const { GhidraAnalyzer, HookGenerator } = await import('@modules/binary-instrument');

  let handlers = ctx.getDomainInstance<H>(DEP_KEY);
  if (!handlers) {
    handlers = new BinaryInstrumentHandlers(ctx, new GhidraAnalyzer(), new HookGenerator());
    ctx.setDomainInstance(DEP_KEY, handlers);
  }

  // Instantiate secondary sub-domain handlers and store on context
  if (!ctx.getDomainInstance('apkPackerHandlers')) {
    const { ApkPackerHandlers } = await import('./apk-packer/handlers');
    ctx.setDomainInstance('apkPackerHandlers', new ApkPackerHandlers());
  }

  if (!ctx.getDomainInstance('binarySecretsHandlers')) {
    const { BinarySecretsHandlers } = await import('./secrets/handlers');
    ctx.setDomainInstance('binarySecretsHandlers', new BinarySecretsHandlers());
  }

  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['apkPackerHandlers', 'binarySecretsHandlers'] as const,
  profiles: ['full'],
  ensure,
  registrations: allRegistrations,
  workflowRule: {
    patterns: [
      /\b(frida|ghidra|ida|unidbg|jadx|binary|disassemb|decompil|dump\s?so)\b/i,
      /(binary|native|so|dll|elf|apk).*(analyze|hook|instrument|decompile)/i,
      /(apk|android).*(manifest|apktool|native\s+libs|shared\s+library|\.so)/i,
      /(apk|android).*(triage|static|packer|protector|launcher|splash)/i,
      /(dex|cdex|vdex|binary|memory).*(scan|string|extract|dump)/i,
    ],
    priority: 88,
    tools: [
      'ghidra_analyze',
      'jadx_decompile',
      'jadx_decompile_apk',
      'apktool_decode',
      'apk_manifest_dump',
      'apk_manifest_query',
      'apk_static_triage',
      'apk_dex_intake',
      'dex_scan_file',
      'android_runtime_dump_session',
      'binary_strings_extract',
      'apk_native_libs_list',
      'generate_hooks',
      'unidbg_launch',
    ],
    hint: 'Binary analysis pipeline: start with apk_dex_intake for one evidence packet, then decompile/inspect APK, manifest, DEX files, and native libs → generate hook scripts → emulate with Unidbg when needed.',
  },
  prerequisites: {
    frida_attach: [
      {
        condition:
          'Frida CLI must be installed; device targets may also require frida-server and elevated privileges',
        fix: 'Install frida-tools and, for Android/device targets, launch frida-server on the target.',
      },
    ],
    frida_run_script: [
      {
        condition: 'A Frida session must be active',
        fix: 'Call frida_attach before running a script',
      },
    ],
    ghidra_analyze: [
      {
        condition: 'Ghidra analyzeHeadless must be installed and reachable on PATH',
        fix: 'Install Ghidra and ensure analyzeHeadless is on PATH.',
      },
    ],
    ida_decompile: [
      {
        condition: 'plugin_ida_bridge must be installed',
        fix: 'Install @jshookmcpextension/plugin-ida-bridge and provide IDA Pro license',
      },
    ],
    jadx_decompile: [
      {
        condition: 'jadx CLI or plugin_jadx_bridge must be available',
        fix: 'Install JADX and ensure jadx is on PATH, or install @jshookmcpextension/plugin-jadx-bridge.',
      },
    ],
    apktool_decode: [
      {
        condition: 'apktool CLI must be installed',
        fix: 'Install apktool and ensure it is on PATH.',
      },
    ],
    unidbg_launch: [
      {
        condition: 'Java 17+ and unidbg JAR must be reachable',
        fix: 'Install JDK 17+ and download unidbg from its official release',
      },
    ],
    generate_hooks: [
      {
        condition: 'Ghidra analysis output required',
        fix: 'Run ghidra_analyze first and pass the output to generate_hooks',
      },
    ],
  },
  toolDependencies: [
    {
      from: 'process',
      to: 'binary-instrument',
      relation: 'uses',
      weight: 0.6,
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
