import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { wasmTools } from '@server/domains/wasm/definitions';
import type { WasmToolHandlers } from '@server/domains/wasm/index';

const DOMAIN = 'wasm' as const;
const DEP_KEY = 'wasmHandlers' as const;
type H = WasmToolHandlers;
const t = toolLookup(wasmTools);
const registrations = defineMethodRegistrations<H, (typeof wasmTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'wasm_capabilities', method: 'handleWasmCapabilitiesTool' },
    { tool: 'wasm_dump', method: 'handleWasmDumpTool' },
    { tool: 'wasm_disassemble', method: 'handleWasmDisassembleTool' },
    { tool: 'wasm_decompile', method: 'handleWasmDecompileTool' },
    { tool: 'wasm_inspect_sections', method: 'handleWasmInspectSectionsTool' },
    { tool: 'wasm_offline_run', method: 'handleWasmOfflineRunTool' },
    { tool: 'wasm_optimize', method: 'handleWasmOptimizeTool' },
    { tool: 'wasm_vmp_trace', method: 'handleWasmVmpTraceTool' },
    { tool: 'wasm_memory_inspect', method: 'handleWasmMemoryInspectTool' },
    { tool: 'wasm_to_c', method: 'handleWasmToCTool' },
    { tool: 'wasm_detect_obfuscation', method: 'handleWasmDetectObfuscationTool' },
    { tool: 'wasm_instrument_trace', method: 'handleWasmInstrumentTraceTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { CodeCollector } = await import('@server/domains/shared/modules/collector');
  const { WasmToolHandlers } = await import('@server/domains/wasm/index');
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.wasmHandlers) ctx.wasmHandlers = new WasmToolHandlers(ctx.collector);
  return ctx.wasmHandlers;
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
