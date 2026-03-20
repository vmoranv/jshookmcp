/**
 * Memory domain manifest.
 *
 * Registers 32 tools in the 'workflow' profile tier:
 * 8 scan + 4 pointer chain + 4 structure + 4 breakpoint + 4 injection
 * + 4 control + 2 time + 2 history.
 */

import type { DomainManifest } from '@server/registry/contracts';
import type { MCPServerContext } from '@server/MCPServer.context';
import { memoryScanToolDefinitions } from './definitions';
import { MemoryScanHandlers } from './handlers.impl';
import { memoryScanner } from '@native/MemoryScanner';
import { scanSessionManager } from '@native/MemoryScanSession';
import { pointerChainEngine } from '@native/PointerChainEngine';
import { structureAnalyzer } from '@native/StructureAnalyzer';
import { hardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import { codeInjector } from '@native/CodeInjector';
import { memoryController } from '@native/MemoryController';
import { speedhack } from '@native/Speedhack';
import { heapAnalyzer } from '@native/HeapAnalyzer';
import { peAnalyzer } from '@native/PEAnalyzer';
import { antiCheatDetector } from '@native/AntiCheatDetector';

const DOMAIN = 'memory' as const;
const DEP_KEY = 'memoryScanHandlers' as const;
type H = MemoryScanHandlers;

function ensure(ctx: MCPServerContext): H {
  const ctxAny = ctx as unknown as Record<string, unknown>;
  if (!ctxAny[DEP_KEY]) {
    ctxAny[DEP_KEY] = new MemoryScanHandlers(
      memoryScanner,
      scanSessionManager,
      pointerChainEngine,
      structureAnalyzer,
      hardwareBreakpointEngine,
      codeInjector,
      memoryController,
      speedhack,
      heapAnalyzer,
      peAnalyzer,
      antiCheatDetector
    );
  }
  return ctxAny[DEP_KEY] as H;
}

function bindByKey(
  invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>
) {
  return (deps: Record<string, unknown>) => {
    const handler = deps[DEP_KEY] as H;
    return (args: Record<string, unknown>) => invoke(handler, args);
  };
}

function toolByName(name: string) {
  const tool = memoryScanToolDefinitions.find((t) => t.name === name);
  if (!tool) throw new Error(`Memory tool not found: ${name}`);
  return tool;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [
    // ── Scan Tools ──
    { tool: toolByName('memory_first_scan'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleFirstScan(a)) },
    { tool: toolByName('memory_next_scan'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleNextScan(a)) },
    { tool: toolByName('memory_unknown_scan'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleUnknownScan(a)) },
    { tool: toolByName('memory_pointer_scan'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePointerScan(a)) },
    { tool: toolByName('memory_group_scan'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleGroupScan(a)) },
    { tool: toolByName('memory_scan_list'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleScanList(a)) },
    { tool: toolByName('memory_scan_delete'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleScanDelete(a)) },
    { tool: toolByName('memory_scan_export'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleScanExport(a)) },
    // ── Pointer Chain Tools ──
    { tool: toolByName('memory_pointer_chain_scan'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePointerChainScan(a)) },
    { tool: toolByName('memory_pointer_chain_validate'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePointerChainValidate(a)) },
    { tool: toolByName('memory_pointer_chain_resolve'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePointerChainResolve(a)) },
    { tool: toolByName('memory_pointer_chain_export'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePointerChainExport(a)) },
    // ── Structure Analysis Tools ──
    { tool: toolByName('memory_structure_analyze'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleStructureAnalyze(a)) },
    { tool: toolByName('memory_vtable_parse'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleVtableParse(a)) },
    { tool: toolByName('memory_structure_export_c'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleStructureExportC(a)) },
    { tool: toolByName('memory_structure_compare'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleStructureCompare(a)) },
    // ── Breakpoint Tools ──
    { tool: toolByName('memory_breakpoint_set'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleBreakpointSet(a)) },
    { tool: toolByName('memory_breakpoint_remove'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleBreakpointRemove(a)) },
    { tool: toolByName('memory_breakpoint_list'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleBreakpointList(a)) },
    { tool: toolByName('memory_breakpoint_trace'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleBreakpointTrace(a)) },
    // ── Injection Tools ──
    { tool: toolByName('memory_patch_bytes'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePatchBytes(a)) },
    { tool: toolByName('memory_patch_nop'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePatchNop(a)) },
    { tool: toolByName('memory_patch_undo'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePatchUndo(a)) },
    { tool: toolByName('memory_code_caves'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleCodeCaves(a)) },
    // ── Control Tools ──
    { tool: toolByName('memory_write_value'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleWriteValue(a)) },
    { tool: toolByName('memory_freeze'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleFreeze(a)) },
    { tool: toolByName('memory_unfreeze'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleUnfreeze(a)) },
    { tool: toolByName('memory_dump'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleDump(a)) },
    // ── Time Tools ──
    { tool: toolByName('memory_speedhack_apply'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleSpeedhackApply(a)) },
    { tool: toolByName('memory_speedhack_set'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleSpeedhackSet(a)) },
    // ── History Tools ──
    { tool: toolByName('memory_write_undo'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleWriteUndo(a)) },
    { tool: toolByName('memory_write_redo'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleWriteRedo(a)) },
    // ── Heap Analysis Tools (Phase 4) ──
    { tool: toolByName('memory_heap_enumerate'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleHeapEnumerate(a)) },
    { tool: toolByName('memory_heap_stats'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleHeapStats(a)) },
    { tool: toolByName('memory_heap_anomalies'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleHeapAnomalies(a)) },
    // ── PE / Module Introspection (Phase 4) ──
    { tool: toolByName('memory_pe_headers'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePEHeaders(a)) },
    { tool: toolByName('memory_pe_imports_exports'), domain: DOMAIN, bind: bindByKey((h, a) => h.handlePEImportsExports(a)) },
    { tool: toolByName('memory_inline_hook_detect'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleInlineHookDetect(a)) },
    // ── Anti-Cheat Detection (Phase 4) ──
    { tool: toolByName('memory_anticheat_detect'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleAntiCheatDetect(a)) },
    { tool: toolByName('memory_guard_pages'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleGuardPages(a)) },
    { tool: toolByName('memory_integrity_check'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleIntegrityCheck(a)) },
  ],
  workflowRule: {
    patterns: [
      /memory\s*scan/i,
      /cheat\s*engine/i,
      /find\s*(value|address|variable|struct)/i,
      /scan\s*(for|memory)/i,
      /pointer\s*(chain|scan)/i,
      /struct(ure)?\s*(analy|infer|dissect)/i,
      /vtable|rtti/i,
      /breakpoint|watchpoint|hardware\s*bp/i,
      /patch\s*(byte|nop|code)/i,
      /code\s*cave/i,
      /freeze|unfreeze/i,
      /speedhack|time\s*(hack|scale)/i,
      /memory\s*(dump|hex)/i,
      /undo|redo/i,
      /heap|堆\s*(分析|枚举|异常)/i,
      /PE\s*(header|import|export)|inline.*hook/i,
      /anti.?cheat|anti.?debug|反作弊|反调试/i,
      /guard\s*page|integrity\s*check|代码完整性/i,
      /内存\s*(扫描|搜索|分析|结构|断点|注入|冻结|加速|堆|模块|反作弊)/i,
    ],
    priority: 90,
    tools: [
      'memory_first_scan',
      'memory_next_scan',
      'memory_unknown_scan',
      'memory_pointer_chain_scan',
      'memory_structure_analyze',
      'memory_vtable_parse',
      'memory_scan_list',
      'memory_breakpoint_set',
      'memory_breakpoint_trace',
      'memory_patch_bytes',
      'memory_freeze',
      'memory_dump',
      'memory_speedhack_apply',
      'memory_write_undo',
      'memory_heap_enumerate',
      'memory_pe_headers',
      'memory_anticheat_detect',
    ],
    hint: 'Memory domain: scan → narrow → pointer chain → structure | breakpoint trace → patch/NOP → freeze | speedhack | heap analysis | PE introspection | anti-cheat detection',
  },
};

export default manifest;
