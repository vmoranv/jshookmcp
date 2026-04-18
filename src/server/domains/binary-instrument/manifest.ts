import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { GhidraAnalyzer, HookGenerator } from '@modules/binary-instrument';
import { binaryInstrumentTools } from './definitions';
import { BinaryInstrumentHandlers } from './handlers';

const DOMAIN = 'binary-instrument' as const;
const DEP_KEY = 'binaryInstrumentHandlers' as const;
type H = BinaryInstrumentHandlers;
const toolByName = toolLookup(binaryInstrumentTools);
const bind = (invoke: (handlers: H, args: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  let handlers = ctx.getDomainInstance<H>(DEP_KEY);
  if (!handlers) {
    handlers = new BinaryInstrumentHandlers(ctx, new GhidraAnalyzer(), new HookGenerator());
    ctx.setDomainInstance(DEP_KEY, handlers);
  }

  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations: [
    {
      tool: toolByName('frida_attach'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleFridaAttach(args)),
    },
    {
      tool: toolByName('frida_enumerate_modules'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleFridaEnumerateModules(args)),
    },
    {
      tool: toolByName('ghidra_analyze'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleGhidraAnalyze(args)),
    },
    {
      tool: toolByName('generate_hooks'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleGenerateHooks(args)),
    },
    {
      tool: toolByName('unidbg_emulate'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleUnidbgEmulate(args)),
    },
    {
      tool: toolByName('frida_run_script'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleFridaRunScript(args)),
    },
    {
      tool: toolByName('frida_detach'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleFridaDetach(args)),
    },
    {
      tool: toolByName('frida_list_sessions'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleFridaListSessions(args)),
    },
    {
      tool: toolByName('frida_generate_script'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleFridaGenerateScript(args)),
    },
    {
      tool: toolByName('get_available_plugins'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleGetAvailablePlugins(args)),
    },
    {
      tool: toolByName('ghidra_decompile'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleGhidraDecompile(args)),
    },
    {
      tool: toolByName('ida_decompile'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleIdaDecompile(args)),
    },
    {
      tool: toolByName('jadx_decompile'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleJadxDecompile(args)),
    },
    {
      tool: toolByName('unidbg_launch'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleUnidbgLaunch(args)),
    },
    {
      tool: toolByName('unidbg_call'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleUnidbgCall(args)),
    },
    {
      tool: toolByName('unidbg_trace'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleUnidbgTrace(args)),
    },
    {
      tool: toolByName('export_hook_script'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleExportHookScript(args)),
    },
    {
      tool: toolByName('frida_enumerate_functions'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleFridaEnumerateFunctions(args)),
    },
    {
      tool: toolByName('frida_find_symbols'),
      domain: DOMAIN,
      bind: bind((handlers, args) => handlers.handleFridaFindSymbols(args)),
    },
  ],
  workflowRule: {
    patterns: [
      /\b(frida|ghidra|ida|unidbg|jadx|binary|disassemb|decompil|dump\s?so)\b/i,
      /(binary|native|so|dll|elf|apk).*(analyze|hook|instrument|decompile)/i,
    ],
    priority: 88,
    tools: ['frida_attach', 'ghidra_analyze', 'generate_hooks', 'unidbg_launch'],
    hint: 'Binary analysis pipeline: attach Frida → decompile (Ghidra/IDA/JADX) → generate hook scripts → emulate with Unidbg.',
  },
  prerequisites: {
    frida_attach: [
      {
        condition: 'plugin_frida_bridge must be installed and frida-server reachable',
        fix: 'Install @jshookmcpextension/plugin-frida-bridge; launch frida-server on the target',
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
        condition: 'plugin_ghidra_bridge must be installed with Ghidra headless available',
        fix: 'Install @jshookmcpextension/plugin-ghidra-bridge and configure Ghidra path',
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
        condition: 'plugin_jadx_bridge must be installed',
        fix: 'Install @jshookmcpextension/plugin-jadx-bridge',
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
