import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { FridaSession, GhidraAnalyzer, HookGenerator } from '@modules/binary-instrument';
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
    handlers = new BinaryInstrumentHandlers(
      new FridaSession(),
      new GhidraAnalyzer(),
      new HookGenerator(),
    );
    ctx.setDomainInstance(DEP_KEY, handlers);
  }

  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
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
  ],
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
