import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { wasmTools } from './definitions.js';
import { WasmToolHandlers } from './index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';

const DOMAIN = 'wasm' as const;
const DEP_KEY = 'wasmHandlers' as const;
type H = WasmToolHandlers;
const t = toolLookup(wasmTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.wasmHandlers) ctx.wasmHandlers = new WasmToolHandlers(ctx.collector);
  return ctx.wasmHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest', version: 1,
  domain: DOMAIN, depKey: DEP_KEY,
  profiles: ['full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('wasm_dump'), domain: DOMAIN, bind: b((h, a) => h.handleWasmDump(a)) },
    { tool: t('wasm_disassemble'), domain: DOMAIN, bind: b((h, a) => h.handleWasmDisassemble(a)) },
    { tool: t('wasm_decompile'), domain: DOMAIN, bind: b((h, a) => h.handleWasmDecompile(a)) },
    { tool: t('wasm_inspect_sections'), domain: DOMAIN, bind: b((h, a) => h.handleWasmInspectSections(a)) },
    { tool: t('wasm_offline_run'), domain: DOMAIN, bind: b((h, a) => h.handleWasmOfflineRun(a)) },
    { tool: t('wasm_optimize'), domain: DOMAIN, bind: b((h, a) => h.handleWasmOptimize(a)) },
    { tool: t('wasm_vmp_trace'), domain: DOMAIN, bind: b((h, a) => h.handleWasmVmpTrace(a)) },
    { tool: t('wasm_memory_inspect'), domain: DOMAIN, bind: b((h, a) => h.handleWasmMemoryInspect(a)) },
  ],
};

export default manifest;
