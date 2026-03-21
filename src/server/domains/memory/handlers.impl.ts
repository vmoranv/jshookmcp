/**
 * Memory domain — handler implementations.
 *
 * Delegates to all memory engines for scan, pointer chain, structure, breakpoint,
 * injection, control, and speedhack operations.
 */

import type { MemoryScanner } from '@native/MemoryScanner';
import type { MemoryScanSessionManager } from '@native/MemoryScanSession';
import type { PointerChainEngine } from '@native/PointerChainEngine';
import type { PointerChain } from '@native/PointerChainEngine.types';
import type { StructureAnalyzer } from '@native/StructureAnalyzer';
import type { InferredStruct } from '@native/StructureAnalyzer.types';
import type { HardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import type { BreakpointAccess, BreakpointSize } from '@native/HardwareBreakpoint.types';
import type { CodeInjector } from '@native/CodeInjector';
import type { MemoryController } from '@native/MemoryController';
import type { Speedhack } from '@native/Speedhack';
import type { HeapAnalyzer } from '@native/HeapAnalyzer';
import type { PEAnalyzer } from '@native/PEAnalyzer';
import type { AntiCheatDetector } from '@native/AntiCheatDetector';
import type { ScanCompareMode, ScanOptions, ScanValueType } from '@native/NativeMemoryManager.types';

function toTextResponse(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function toErrorResponse(tool: string, error: unknown) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
  });
}

export class MemoryScanHandlers {
  constructor(
    private readonly scanner: MemoryScanner,
    private readonly sessionManager: MemoryScanSessionManager,
    private readonly ptrEngine: PointerChainEngine,
    private readonly structAnalyzer: StructureAnalyzer,
    private readonly bpEngine: HardwareBreakpointEngine | null,
    private readonly injector: CodeInjector,
    private readonly memCtrl: MemoryController,
    private readonly speedhackEngine: Speedhack | null,
    private readonly heapAnalyzer: HeapAnalyzer | null,
    private readonly peAnalyzer: PEAnalyzer | null,
    private readonly antiCheatDetector: AntiCheatDetector | null
  ) {}

  // ── Scan Handlers ──

  async handleFirstScan(args: Record<string, unknown>) {
    try {
      const pid = args.pid as number;
      const value = args.value as string;
      const valueType = args.valueType as ScanValueType;
      const options: ScanOptions = {
        valueType,
        alignment: args.alignment as number | undefined,
        maxResults: args.maxResults as number | undefined,
        regionFilter: args.regionFilter as ScanOptions['regionFilter'],
      };
      const result = await this.scanner.firstScan(pid, value, options);
      return toTextResponse({
        success: true, ...result,
        hint: result.totalMatches > 0
          ? `Found ${result.totalMatches} matches. Use memory_next_scan with sessionId "${result.sessionId}" to narrow down.`
          : 'No matches found. Try a different value or type.',
      });
    } catch (error) { return toErrorResponse('memory_first_scan', error); }
  }

  async handleNextScan(args: Record<string, unknown>) {
    try {
      const result = await this.scanner.nextScan(
        args.sessionId as string, args.mode as ScanCompareMode,
        args.value as string | undefined, args.value2 as string | undefined
      );
      return toTextResponse({
        success: true, ...result,
        hint: result.totalMatches <= 10
          ? 'Few matches remaining — inspect these addresses.'
          : `${result.totalMatches} matches remain. Continue narrowing with memory_next_scan.`,
      });
    } catch (error) { return toErrorResponse('memory_next_scan', error); }
  }

  async handleUnknownScan(args: Record<string, unknown>) {
    try {
      const options: ScanOptions = {
        valueType: args.valueType as ScanValueType,
        alignment: args.alignment as number | undefined,
        maxResults: args.maxResults as number | undefined,
        regionFilter: args.regionFilter as ScanOptions['regionFilter'],
      };
      const result = await this.scanner.unknownInitialScan(args.pid as number, options);
      return toTextResponse({
        success: true, ...result,
        hint: `Captured ${result.totalMatches} addresses. Use memory_next_scan with changed/unchanged/increased/decreased to narrow.`,
      });
    } catch (error) { return toErrorResponse('memory_unknown_scan', error); }
  }

  async handlePointerScan(args: Record<string, unknown>) {
    try {
      const result = await this.scanner.pointerScan(args.pid as number, args.targetAddress as string, {
        maxResults: args.maxResults as number | undefined,
        moduleOnly: args.moduleOnly as boolean | undefined,
      });
      return toTextResponse({ success: true, ...result });
    } catch (error) { return toErrorResponse('memory_pointer_scan', error); }
  }

  async handleGroupScan(args: Record<string, unknown>) {
    try {
      const result = await this.scanner.groupScan(
        args.pid as number,
        args.pattern as Array<{ offset: number; value: string; type: ScanValueType }>,
        { alignment: args.alignment as number | undefined, maxResults: args.maxResults as number | undefined }
      );
      return toTextResponse({ success: true, ...result });
    } catch (error) { return toErrorResponse('memory_group_scan', error); }
  }

  async handleScanList(_args: Record<string, unknown>) {
    try {
      const sessions = this.sessionManager.listSessions();
      return toTextResponse({ success: true, sessions, count: sessions.length });
    } catch (error) { return toErrorResponse('memory_scan_list', error); }
  }

  async handleScanDelete(args: Record<string, unknown>) {
    try {
      return toTextResponse({ success: true, deleted: this.sessionManager.deleteSession(args.sessionId as string) });
    } catch (error) { return toErrorResponse('memory_scan_delete', error); }
  }

  async handleScanExport(args: Record<string, unknown>) {
    try {
      return toTextResponse({ success: true, exportedData: this.sessionManager.exportSession(args.sessionId as string) });
    } catch (error) { return toErrorResponse('memory_scan_export', error); }
  }

  // ── Pointer Chain Handlers ──

  async handlePointerChainScan(args: Record<string, unknown>) {
    try {
      const result = await this.ptrEngine.scan(args.pid as number, args.targetAddress as string, {
        maxDepth: args.maxDepth as number | undefined,
        maxOffset: args.maxOffset as number | undefined,
        staticOnly: args.staticOnly as boolean | undefined,
        modules: args.modules as string[] | undefined,
        maxResults: args.maxResults as number | undefined,
      });
      return toTextResponse({
        success: true, ...result,
        hint: result.totalFound > 0
          ? `Found ${result.totalFound} pointer chains. Static chains survive process restarts.`
          : 'No pointer chains found. Try increasing maxDepth or maxOffset.',
      });
    } catch (error) { return toErrorResponse('memory_pointer_chain_scan', error); }
  }

  async handlePointerChainValidate(args: Record<string, unknown>) {
    try {
      const chains = JSON.parse(args.chains as string) as PointerChain[];
      const results = await this.ptrEngine.validateChains(args.pid as number, chains);
      return toTextResponse({ success: true, results, validCount: results.filter((r) => r.isValid).length, totalChecked: chains.length });
    } catch (error) { return toErrorResponse('memory_pointer_chain_validate', error); }
  }

  async handlePointerChainResolve(args: Record<string, unknown>) {
    try {
      const chain = JSON.parse(args.chain as string) as PointerChain;
      const resolved = await this.ptrEngine.resolveChain(args.pid as number, chain);
      return toTextResponse({ success: true, chainId: chain.id, resolvedAddress: resolved, isResolvable: resolved !== null });
    } catch (error) { return toErrorResponse('memory_pointer_chain_resolve', error); }
  }

  async handlePointerChainExport(args: Record<string, unknown>) {
    try {
      const chains = JSON.parse(args.chains as string) as PointerChain[];
      return toTextResponse({ success: true, exportedData: this.ptrEngine.exportChains(chains), chainCount: chains.length });
    } catch (error) { return toErrorResponse('memory_pointer_chain_export', error); }
  }

  // ── Structure Analysis Handlers ──

  async handleStructureAnalyze(args: Record<string, unknown>) {
    try {
      const result = await this.structAnalyzer.analyzeStructure(args.pid as number, args.address as string, {
        size: args.size as number | undefined,
        otherInstances: args.otherInstances as string[] | undefined,
        parseRtti: args.parseRtti as boolean | undefined,
      });
      return toTextResponse({
        success: true, ...result,
        hint: result.className
          ? `Detected class: ${result.className}${result.baseClasses?.length ? ` (inherits: ${result.baseClasses.join(' → ')})` : ''}`
          : `Inferred ${result.fields.length} fields. Use memory_structure_export_c to export as C struct.`,
      });
    } catch (error) { return toErrorResponse('memory_structure_analyze', error); }
  }

  async handleVtableParse(args: Record<string, unknown>) {
    try {
      return toTextResponse({ success: true, ...await this.structAnalyzer.parseVtable(args.pid as number, args.vtableAddress as string) });
    } catch (error) { return toErrorResponse('memory_vtable_parse', error); }
  }

  async handleStructureExportC(args: Record<string, unknown>) {
    try {
      const structure = JSON.parse(args.structure as string) as InferredStruct;
      return toTextResponse({ success: true, ...this.structAnalyzer.exportToCStruct(structure, args.name as string | undefined) });
    } catch (error) { return toErrorResponse('memory_structure_export_c', error); }
  }

  async handleStructureCompare(args: Record<string, unknown>) {
    try {
      const result = await this.structAnalyzer.compareInstances(args.pid as number, args.address1 as string, args.address2 as string, args.size as number | undefined);
      return toTextResponse({ success: true, matchingFieldCount: result.matching.length, differingFieldCount: result.differing.length, ...result });
    } catch (error) { return toErrorResponse('memory_structure_compare', error); }
  }

  // ── Breakpoint Handlers ──

  async handleBreakpointSet(args: Record<string, unknown>) {
    try {
      const config = await this.bpEngine!.setBreakpoint(
        args.pid as number, args.address as string,
        args.access as BreakpointAccess, (args.size as BreakpointSize) ?? 4
      );
      return toTextResponse({
        success: true, ...config,
        hint: `Hardware breakpoint set on DR register. Use memory_breakpoint_trace to collect hits.`,
      });
    } catch (error) { return toErrorResponse('memory_breakpoint_set', error); }
  }

  async handleBreakpointRemove(args: Record<string, unknown>) {
    try {
      return toTextResponse({ success: true, removed: await this.bpEngine!.removeBreakpoint(args.breakpointId as string) });
    } catch (error) { return toErrorResponse('memory_breakpoint_remove', error); }
  }

  async handleBreakpointList(_args: Record<string, unknown>) {
    try {
      const bps = this.bpEngine!.listBreakpoints();
      return toTextResponse({ success: true, breakpoints: bps, count: bps.length });
    } catch (error) { return toErrorResponse('memory_breakpoint_list', error); }
  }

  async handleBreakpointTrace(args: Record<string, unknown>) {
    try {
      const hits = await this.bpEngine!.traceAccess(
        args.pid as number, args.address as string, args.access as BreakpointAccess,
        args.maxHits as number | undefined, args.timeoutMs as number | undefined
      );
      return toTextResponse({
        success: true, hits, hitCount: hits.length,
        hint: hits.length > 0 ? `${hits.length} accesses captured. Check instructionAddress to find the code accessing this address.` : 'No hits captured within timeout.',
      });
    } catch (error) { return toErrorResponse('memory_breakpoint_trace', error); }
  }

  // ── Injection Handlers ──

  async handlePatchBytes(args: Record<string, unknown>) {
    try {
      const patch = await this.injector.patchBytes(args.pid as number, args.address as string, args.bytes as number[]);
      return toTextResponse({ success: true, ...patch, hint: `Patch applied. Use memory_patch_undo with patchId "${patch.id}" to restore.` });
    } catch (error) { return toErrorResponse('memory_patch_bytes', error); }
  }

  async handlePatchNop(args: Record<string, unknown>) {
    try {
      const patch = await this.injector.nopBytes(args.pid as number, args.address as string, args.count as number);
      return toTextResponse({ success: true, ...patch, hint: `${args.count} bytes NOP'd. Use memory_patch_undo to restore.` });
    } catch (error) { return toErrorResponse('memory_patch_nop', error); }
  }

  async handlePatchUndo(args: Record<string, unknown>) {
    try {
      return toTextResponse({ success: true, restored: await this.injector.unpatch(args.patchId as string) });
    } catch (error) { return toErrorResponse('memory_patch_undo', error); }
  }

  async handleCodeCaves(args: Record<string, unknown>) {
    try {
      const caves = await this.injector.findCodeCaves(args.pid as number, args.minSize as number | undefined);
      return toTextResponse({ success: true, caves, count: caves.length });
    } catch (error) { return toErrorResponse('memory_code_caves', error); }
  }

  // ── Control Handlers ──

  async handleWriteValue(args: Record<string, unknown>) {
    try {
      const entry = await this.memCtrl.writeValue(args.pid as number, args.address as string, args.value as string, args.valueType as string);
      return toTextResponse({ success: true, ...entry, hint: 'Use memory_write_undo to revert.' });
    } catch (error) { return toErrorResponse('memory_write_value', error); }
  }

  async handleFreeze(args: Record<string, unknown>) {
    try {
      const entry = await this.memCtrl.freeze(args.pid as number, args.address as string, args.value as string, args.valueType as string, args.intervalMs as number | undefined);
      return toTextResponse({ success: true, ...entry, hint: `Frozen. Use memory_unfreeze with freezeId "${entry.id}" to stop.` });
    } catch (error) { return toErrorResponse('memory_freeze', error); }
  }

  async handleUnfreeze(args: Record<string, unknown>) {
    try {
      return toTextResponse({ success: true, unfrozen: await this.memCtrl.unfreeze(args.freezeId as string) });
    } catch (error) { return toErrorResponse('memory_unfreeze', error); }
  }

  async handleDump(args: Record<string, unknown>) {
    try {
      const hexDump = await this.memCtrl.dumpMemoryHex(args.pid as number, args.address as string, (args.size as number) ?? 256);
      return toTextResponse({ success: true, dump: hexDump });
    } catch (error) { return toErrorResponse('memory_dump', error); }
  }

  // ── Time Handlers ──

  async handleSpeedhackApply(args: Record<string, unknown>) {
    try {
      const result = await this.speedhackEngine!.apply(args.pid as number, args.speed as number);
      return toTextResponse({ ...result, success: true, hint: `Speedhack active (${args.speed}x). Use memory_speedhack_set to adjust.` });
    } catch (error) { return toErrorResponse('memory_speedhack_apply', error); }
  }

  async handleSpeedhackSet(args: Record<string, unknown>) {
    try {
      return toTextResponse({ success: true, updated: await this.speedhackEngine!.setSpeed(args.pid as number, args.speed as number), newSpeed: args.speed });
    } catch (error) { return toErrorResponse('memory_speedhack_set', error); }
  }

  // ── History Handlers ──

  async handleWriteUndo(_args: Record<string, unknown>) {
    try {
      const entry = await this.memCtrl.undo();
      return toTextResponse({ success: true, undone: entry !== null, entry });
    } catch (error) { return toErrorResponse('memory_write_undo', error); }
  }

  async handleWriteRedo(_args: Record<string, unknown>) {
    try {
      const entry = await this.memCtrl.redo();
      return toTextResponse({ success: true, redone: entry !== null, entry });
    } catch (error) { return toErrorResponse('memory_write_redo', error); }
  }

  // ── Heap Analysis Handlers (Phase 4) ──

  async handleHeapEnumerate(args: Record<string, unknown>) {
    try {
      const result = await this.heapAnalyzer!.enumerateHeaps(args.pid as number);
      return toTextResponse({
        success: true, ...result,
        hint: `Enumerated ${result.heaps.length} heaps. Use memory_heap_stats for statistics or memory_heap_anomalies to check for issues.`,
      });
    } catch (error) { return toErrorResponse('memory_heap_enumerate', error); }
  }

  async handleHeapStats(args: Record<string, unknown>) {
    try {
      const stats = await this.heapAnalyzer!.getStats(args.pid as number);
      return toTextResponse({ success: true, ...stats });
    } catch (error) { return toErrorResponse('memory_heap_stats', error); }
  }

  async handleHeapAnomalies(args: Record<string, unknown>) {
    try {
      const anomalies = await this.heapAnalyzer!.detectAnomalies(args.pid as number);
      return toTextResponse({
        success: true, anomalies, count: anomalies.length,
        hint: anomalies.length > 0
          ? `Found ${anomalies.length} anomalies — inspect types for spray, UAF, or suspicious patterns.`
          : 'No heap anomalies detected.',
      });
    } catch (error) { return toErrorResponse('memory_heap_anomalies', error); }
  }

  // ── PE / Module Introspection Handlers (Phase 4) ──

  async handlePEHeaders(args: Record<string, unknown>) {
    try {
      const headers = await this.peAnalyzer!.parseHeaders(args.pid as number, args.moduleBase as string);
      return toTextResponse({ success: true, ...headers });
    } catch (error) { return toErrorResponse('memory_pe_headers', error); }
  }

  async handlePEImportsExports(args: Record<string, unknown>) {
    try {
      const table = (args.table as string) || 'both';
      const base = args.moduleBase as string;
      const pid = args.pid as number;
      const result: Record<string, unknown> = { success: true };
      if (table === 'imports' || table === 'both') {
        result.imports = await this.peAnalyzer!.parseImports(pid, base);
      }
      if (table === 'exports' || table === 'both') {
        result.exports = await this.peAnalyzer!.parseExports(pid, base);
      }
      return toTextResponse(result);
    } catch (error) { return toErrorResponse('memory_pe_imports_exports', error); }
  }

  async handleInlineHookDetect(args: Record<string, unknown>) {
    try {
      const hooks = await this.peAnalyzer!.detectInlineHooks(args.pid as number, args.moduleName as string | undefined);
      return toTextResponse({
        success: true, hooks, count: hooks.length,
        hint: hooks.length > 0
          ? `Detected ${hooks.length} inline hooks — check hookType and jumpTarget for each.`
          : 'No inline hooks detected — exports match disk bytes.',
      });
    } catch (error) { return toErrorResponse('memory_inline_hook_detect', error); }
  }

  // ── Anti-Cheat / Anti-Debug Handlers (Phase 4) ──

  async handleAntiCheatDetect(args: Record<string, unknown>) {
    try {
      const detections = await this.antiCheatDetector!.detect(args.pid as number);
      return toTextResponse({
        success: true, detections, count: detections.length,
        hint: detections.length > 0
          ? `Found ${detections.length} anti-debug mechanisms. Each includes a bypassSuggestion.`
          : 'No anti-debug mechanisms detected in imports.',
      });
    } catch (error) { return toErrorResponse('memory_anticheat_detect', error); }
  }

  async handleGuardPages(args: Record<string, unknown>) {
    try {
      const pages = await this.antiCheatDetector!.findGuardPages(args.pid as number);
      return toTextResponse({
        success: true, guardPages: pages, count: pages.length,
        hint: pages.length > 0
          ? `Found ${pages.length} guard page regions — these may indicate anti-tampering.`
          : 'No guard pages found.',
      });
    } catch (error) { return toErrorResponse('memory_guard_pages', error); }
  }

  async handleIntegrityCheck(args: Record<string, unknown>) {
    try {
      const results = await this.antiCheatDetector!.checkIntegrity(args.pid as number, args.moduleName as string | undefined);
      const modified = results.filter(r => r.isModified);
      return toTextResponse({
        success: true, sections: results, totalChecked: results.length, modifiedCount: modified.length,
        hint: modified.length > 0
          ? `${modified.length} section(s) modified — code may have been patched or hooked.`
          : 'All checked sections match disk — no runtime modifications detected.',
      });
    } catch (error) { return toErrorResponse('memory_integrity_check', error); }
  }
}

