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
    { tool: 'wasm_string_extract', method: 'handleWasmStringExtractTool' },
    { tool: 'wasm_diff', method: 'handleWasmDiffTool' },
    { tool: 'wasm_instrument_binary', method: 'handleWasmInstrumentBinaryTool' },
    { tool: 'wasm_instrument_block', method: 'handleWasmInstrumentBlockTool' },
    { tool: 'wasm_inspect', method: 'handleWasmInspectTool' },
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

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  wasm_inspect: ['look inside a wasm module', 'module overview', '检视 wasm 模块'],
  wasm_inspect_sections: ['list wasm sections', 'enumerate module sections', '列出 wasm 节区'],
  wasm_disassemble: ['wasm bytecode to text', 'list wasm instructions', '反汇编 wasm'],
  wasm_decompile: ['readable wasm pseudocode', 'decompile wasm module', '反编译 wasm'],
  wasm_to_c: ['translate wasm to c code', 'generate c from wasm', 'wasm 转 c'],
  wasm_dump: ['dump wasm module bytes', 'save module to disk', '导出 wasm'],
  wasm_diff: ['compare two wasm modules', 'module version delta', '对比 wasm'],
  wasm_detect_obfuscation: ['spot wasm obfuscation', 'detect packed module', '检测 wasm 混淆'],
  wasm_string_extract: ['pull strings from wasm', 'extract module text', '提取 wasm 字符串'],
  wasm_capabilities: ['what wasm tooling exists', 'check wasm feature support', 'wasm 能力'],
  wasm_offline_run: ['execute wasm without browser', 'run module offline', '离线执行 wasm'],
  wasm_optimize: ['shrink wasm module', 'optimize module size', '优化 wasm'],
  wasm_instrument_binary: ['patch wasm at binary level', 'hook module bytes', '二进制插桩 wasm'],
  wasm_instrument_block: ['hook a basic block', 'trace block entry', '基本块插桩'],
  wasm_instrument_trace: ['trace wasm execution', 'record instruction trace', 'wasm 执行追踪'],
  wasm_memory_inspect: ['look at wasm linear memory', 'inspect memory sections', '检视 wasm 内存'],
  wasm_vmp_trace: ['trace vmp-protected wasm', 'follow vm interpreter loop', 'vmp 追踪'],
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
