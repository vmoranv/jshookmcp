import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { nativeBridgeTools } from './definitions';
import type { NativeBridgeHandlers } from './handlers.impl';

const DOMAIN = 'native-bridge' as const;
const DEP_KEY = 'nativeBridgeHandlers' as const;
type H = NativeBridgeHandlers;

const toolByName = toolLookup(nativeBridgeTools);
const registrations = defineMethodRegistrations<H, (typeof nativeBridgeTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: toolByName,
  entries: [
    { tool: 'native_bridge_status', method: 'handleNativeBridgeStatusTool' },
    { tool: 'ghidra_bridge', method: 'handleGhidraBridgeTool' },
    { tool: 'ida_bridge', method: 'handleIdaBridgeTool' },
    { tool: 'rizin_bridge', method: 'handleRizinBridgeTool' },
    { tool: 'binary_ninja_bridge', method: 'handleBinaryNinjaBridgeTool' },
    { tool: 'native_symbol_sync', method: 'handleNativeSymbolSyncTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { NativeBridgeHandlers } = await import('./handlers.impl');
  const existingHandlers = ctx.getDomainInstance<H>(DEP_KEY);
  if (existingHandlers) {
    return existingHandlers;
  }

  const handlers = new NativeBridgeHandlers();
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  registrations,
  ensure,

  // Document-expansion keywords for the retrieval layer (search sceneKeywords).
  sceneKeywords: {
    binary_ninja_bridge: ['talk to binary ninja', 'bn decompiler bridge', 'binja 桥'],
    ghidra_bridge: ['drive ghidra headless', 'ghidra decompiler bridge', 'ghidra 桥'],
    ida_bridge: ['drive ida pro', 'ida decompiler bridge', 'ida 桥'],
    native_bridge_status: [
      'which reverse tools are reachable',
      'bridge availability check',
      '桥状态',
    ],
    native_symbol_sync: ['sync symbols between tools', 'import export symbol tables', '符号同步'],
    rizin_bridge: ['drive rizin', 'rizin cutter bridge', 'rizin 桥'],
  },
  workflowRule: {
    patterns: [
      /\b(native\s?bridge|ghidra|ida|rizin|radare2|r2|binary\s?ninja|decompiler)\b/i,
      /(native|binary).*(decompile|disassemble|xref|segment|symbol|function)/i,
    ],
    priority: 76,
    tools: [
      'native_bridge_status',
      'ghidra_bridge',
      'ida_bridge',
      'rizin_bridge',
      'binary_ninja_bridge',
      'native_symbol_sync',
    ],
    hint: 'Native bridge: check local bridge health, open binaries, decompile/disassemble, sync symbols.',
  },
  prerequisites: {
    native_bridge_status: [
      {
        condition: 'Bridge server endpoints must be local loopback HTTP(S) services',
        fix: 'Start the desired bridge on 127.0.0.1/localhost or use the constructor defaults',
      },
    ],
    ghidra_bridge: [
      {
        condition: 'Ghidra bridge server must be running',
        fix: 'Start ghidra_bridge on http://127.0.0.1:18080',
      },
    ],
    ida_bridge: [
      {
        condition: 'IDA bridge server must be running',
        fix: 'Start the IDA bridge plugin on http://127.0.0.1:18081',
      },
    ],
    rizin_bridge: [
      {
        condition: 'Rizin bridge server must be running',
        fix: 'Start a local rizin/r2 HTTP bridge on http://127.0.0.1:18082',
      },
    ],
    binary_ninja_bridge: [
      {
        condition: 'Binary Ninja bridge server must be running',
        fix: 'Start a local Binary Ninja bridge plugin on http://127.0.0.1:18083',
      },
    ],
  },
  toolDependencies: [
    { from: 'native_symbol_sync', to: 'native_bridge_status', relation: 'requires', weight: 0.7 },
    { from: 'ghidra_bridge', to: 'native_bridge_status', relation: 'suggests', weight: 0.5 },
    { from: 'ida_bridge', to: 'native_bridge_status', relation: 'suggests', weight: 0.5 },
    { from: 'rizin_bridge', to: 'native_bridge_status', relation: 'suggests', weight: 0.5 },
    {
      from: 'binary_ninja_bridge',
      to: 'native_bridge_status',
      relation: 'suggests',
      weight: 0.5,
    },
  ],
};

export default manifest;
