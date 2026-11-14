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
    { tool: 'frida_spawn', method: 'handleFridaSpawn' },
    { tool: 'frida_enumerate_modules', method: 'handleFridaEnumerateModules' },
    { tool: 'ghidra_analyze', method: 'handleGhidraAnalyze' },
    { tool: 'generate_hooks', method: 'handleGenerateHooks' },
    { tool: 'unidbg_emulate', method: 'handleUnidbgEmulate' },
    { tool: 'frida_run_script', method: 'handleFridaRunScript' },
    { tool: 'frida_resume', method: 'handleFridaResume' },
    { tool: 'frida_detach', method: 'handleFridaDetach' },
    { tool: 'frida_list_sessions', method: 'handleFridaListSessions' },
    { tool: 'frida_list_devices', method: 'handleFridaListDevices' },
    { tool: 'frida_list_processes', method: 'handleFridaListProcesses' },
    { tool: 'frida_dex_dump', method: 'handleFridaDexDump' },
    { tool: 'android_runtime_dump_session', method: 'handleAndroidRuntimeDumpSession' },
    { tool: 'frida_generate_script', method: 'handleFridaGenerateScript' },
    { tool: 'frida_attach_interceptor', method: 'handleFridaAttachInterceptor' },
    { tool: 'get_available_plugins', method: 'handleGetAvailablePlugins' },
    { tool: 'ghidra_decompile', method: 'handleGhidraDecompile' },
    { tool: 'ida_decompile', method: 'handleIdaDecompile' },
    { tool: 'jadx_decompile', method: 'handleJadxDecompile' },
    { tool: 'jadx_decompile_apk', method: 'handleJadxDecompileApk' },
    { tool: 'jadx_search_code', method: 'handleJadxSearchCode' },
    { tool: 'apktool_decode', method: 'handleApktoolDecode' },
    { tool: 'apktool_build', method: 'handleApktoolBuild' },
    { tool: 'apk_sign', method: 'handleApktoolSign' },
    { tool: 'apk_manifest_dump', method: 'handleApkManifestDump' },
    { tool: 'apk_manifest_query', method: 'handleApkManifestQuery' },
    { tool: 'apk_static_triage', method: 'handleApkStaticTriage' },
    { tool: 'apk_dex_intake', method: 'handleApkDexIntake' },
    { tool: 'dex_scan_file', method: 'handleDexScanFile' },
    { tool: 'binary_strings_extract', method: 'handleBinaryStringsExtract' },
    { tool: 'binary_entropy_profile', method: 'handleBinaryEntropyProfile' },
    { tool: 'apk_native_libs_list', method: 'handleApkNativeLibsList' },
    { tool: 'unidbg_launch', method: 'handleUnidbgLaunch' },
    { tool: 'unidbg_call', method: 'handleUnidbgCall' },
    { tool: 'unidbg_trace', method: 'handleUnidbgTrace' },
    { tool: 'export_hook_script', method: 'handleExportHookScript' },
    { tool: 'frida_enumerate_functions', method: 'handleFridaEnumerateFunctions' },
    { tool: 'frida_find_symbols', method: 'handleFridaFindSymbols' },
    { tool: 'frida_memory_scan', method: 'handleFridaMemoryScan' },
    { tool: 'frida_memory_read', method: 'handleFridaMemoryRead' },
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

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  android_runtime_dump_session: ['dump the android runtime state', 'capture art runtime info'],
  apk_dex_intake: ['ingest a dex file', 'bring the dex into the pipeline'],
  apk_manifest_dump: ['read the android manifest', 'dump manifest xml'],
  apk_manifest_query: ['query the manifest contents', 'check permissions in manifest'],
  apk_native_libs_list: ['which native libs ship in the apk', 'list so libraries'],
  apk_packer_detect: ['is this apk packed', 'detect the packer vendor'],
  apk_packer_list_signatures: ['packer signature list', 'which packers are known'],
  apk_sign: ['sign the apk again', 're-sign the package'],
  apk_signing_block_parse: ['parse the signing block', 'read the v2 signature block'],
  apk_static_triage: ['static triage of the apk', 'first pass apk assessment'],
  apktool_build: ['rebuild the decoded apk', 'apktool back to apk'],
  apktool_decode: ['decode resources with apktool', 'unpack the apk resources'],
  binary_entropy_profile: ['entropy profile of sections', 'where is the binary packed'],
  binary_instrument_capabilities: ['what binary tooling exists', 'feature check for instrument'],
  binary_key_extract: ['pull keys out of the binary', 'find embedded secrets'],
  binary_strings_extract: ['dump strings from the binary', 'extract readable text'],
  dex_scan_file: ['scan the dex for classes', 'inspect dex contents'],
  export_hook_script: ['export my hooks as a script', 'save the hook script'],
  frida_attach: [
    'hook onto a running process with frida',
    'attach the frida session',
    'hook the live process',
    'trace the calls of a running program',
  ],
  frida_attach_interceptor: ['intercept calls via frida', 'frida interceptor attach'],
  frida_detach: ['release the frida session', 'unhook the process'],
  frida_dex_dump: ['dump dex from memory', 'grab the unpacked dex at runtime'],
  frida_enumerate_functions: ['list functions via frida', 'enumerate the module functions'],
  frida_enumerate_modules: ['list loaded modules via frida', 'enumerate libraries'],
  frida_find_symbols: ['find symbols with frida', 'locate the function addresses'],
  frida_generate_script: ['generate a frida script', 'write the hook code for me'],
  frida_list_devices: ['which devices does frida see', 'list frida targets'],
  frida_list_processes: ['processes frida can attach to', 'list frida process targets'],
  frida_list_sessions: ['active frida sessions', 'list my frida hooks'],
  frida_memory_read: ['read memory through frida', 'frida read at address'],
  frida_memory_scan: ['scan memory through frida', 'frida pattern scan'],
  frida_resume: ['resume the frida spawned process', 'continue the spawned target'],
  frida_run_script: ['run this frida script', 'execute the hook code'],
  frida_spawn: ['spawn the app under frida', 'start the process gated'],
  generate_hooks: ['write hook code for these functions', 'generate the interceptor code'],
  get_available_plugins: ['which binary tool plugins exist', 'list decompiler plugins'],
  ghidra_analyze: ['run ghidra headless analysis', 'extract functions with ghidra'],
  ghidra_decompile: ['decompile with ghidra', 'ghidra pseudocode for this function'],
  ida_decompile: ['ida pseudocode output', 'decompile in ida pro'],
  jadx_decompile: ['decompile the apk with jadx', 'jadx java sources'],
  jadx_decompile_apk: ['full jadx run on the apk', 'decompile the whole package'],
  jadx_search_code: ['search inside the jadx output', 'find code in the java sources'],
  unidbg_call: ['call a function in unidbg', 'invoke the native method emulated'],
  unidbg_emulate: ['emulate the native library', 'run the so file in unidbg'],
  unidbg_launch: ['start an unidbg instance', 'load the library into the emulator'],
  unidbg_trace: ['trace the emulated execution', 'unidbg instruction trace'],
};

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['apkPackerHandlers', 'binarySecretsHandlers'] as const,
  profiles: ['full'],
  ensure,
  registrations: allRegistrations,

  // Document-expansion keywords (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
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
      'frida_list_devices',
      'frida_list_processes',
      'frida_attach',
      'frida_spawn',
      'frida_attach_interceptor',
      'frida_resume',
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
    frida_spawn: [
      {
        condition:
          'Frida CLI must be installed; device targets may also require frida-server and spawn privileges',
        fix: 'Install frida-tools, start frida-server for device targets, and choose a spawnable package or executable.',
      },
    ],
    frida_run_script: [
      {
        condition: 'A Frida session must be active',
        fix: 'Call frida_attach before running a script',
      },
    ],
    frida_list_devices: [
      {
        condition: 'frida-ls-devices CLI must be installed (part of frida-tools)',
        fix: 'Install frida-tools (pip install frida-tools) and ensure frida-ls-devices is on PATH.',
      },
    ],
    frida_list_processes: [
      {
        condition: 'frida-ps CLI must be installed (part of frida-tools)',
        fix: 'Install frida-tools (pip install frida-tools) and ensure frida-ps is on PATH.',
      },
    ],
    frida_resume: [
      {
        condition: 'A Frida spawn session must be active',
        fix: 'Call frida_spawn first, install early hooks, then pass its sessionId to frida_resume.',
      },
    ],
    frida_attach_interceptor: [
      {
        condition: 'A Frida session is required when install=true',
        fix: 'Call frida_attach or frida_spawn first, or omit install to generate the script only.',
      },
    ],
    ghidra_analyze: [
      {
        condition: 'Ghidra analyzeHeadless must be installed and reachable on PATH',
        fix: 'Install Ghidra and ensure analyzeHeadless is on PATH.',
      },
    ],
    ghidra_decompile: [
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
