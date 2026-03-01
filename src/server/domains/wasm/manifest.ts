import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { wasmTools } from './definitions.js';

const t = toolLookup(wasmTools);

export const wasmRegistrations: readonly ToolRegistration[] = [
  { tool: t('wasm_dump'), domain: 'wasm', bind: (d) => (a) => d.wasmHandlers.handleWasmDump(a) },
  { tool: t('wasm_disassemble'), domain: 'wasm', bind: (d) => (a) => d.wasmHandlers.handleWasmDisassemble(a) },
  { tool: t('wasm_decompile'), domain: 'wasm', bind: (d) => (a) => d.wasmHandlers.handleWasmDecompile(a) },
  { tool: t('wasm_inspect_sections'), domain: 'wasm', bind: (d) => (a) => d.wasmHandlers.handleWasmInspectSections(a) },
  { tool: t('wasm_offline_run'), domain: 'wasm', bind: (d) => (a) => d.wasmHandlers.handleWasmOfflineRun(a) },
  { tool: t('wasm_optimize'), domain: 'wasm', bind: (d) => (a) => d.wasmHandlers.handleWasmOptimize(a) },
  { tool: t('wasm_vmp_trace'), domain: 'wasm', bind: (d) => (a) => d.wasmHandlers.handleWasmVmpTrace(a) },
  { tool: t('wasm_memory_inspect'), domain: 'wasm', bind: (d) => (a) => d.wasmHandlers.handleWasmMemoryInspect(a) },
];
