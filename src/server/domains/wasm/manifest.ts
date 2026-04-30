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
    { tool: 'wasm_capabilities', method: 'handleWasmCapabilities' },
    { tool: 'wasm_dump', method: 'handleWasmDump' },
    { tool: 'wasm_disassemble', method: 'handleWasmDisassemble' },
    { tool: 'wasm_decompile', method: 'handleWasmDecompile' },
    { tool: 'wasm_inspect_sections', method: 'handleWasmInspectSections' },
    { tool: 'wasm_offline_run', method: 'handleWasmOfflineRun' },
    { tool: 'wasm_optimize', method: 'handleWasmOptimize' },
    { tool: 'wasm_vmp_trace', method: 'handleWasmVmpTrace' },
    { tool: 'wasm_memory_inspect', method: 'handleWasmMemoryInspect' },
    { tool: 'wasm_to_c', method: 'handleWasmToC' },
    { tool: 'wasm_detect_obfuscation', method: 'handleWasmDetectObfuscation' },
    { tool: 'wasm_instrument_trace', method: 'handleWasmInstrumentTrace' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { CodeCollector } = await import('@server/domains/shared/modules');
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
