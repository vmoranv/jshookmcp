/**
 * Memory domain — handler implementations.
 *
 * Delegates to 7 internal sub-handler classes, each owning a focused responsibility:
 *   SessionHandlers      — scan session lifecycle (list/delete/export)
 *   ScanHandlers        — first/next/unknown/pointer/group scans
 *   PointerChainHandlers— pointer chain scan/validate/resolve/export
 *   StructureHandlers   — structure analysis, vtable, C export, compare
 *   HookHandlers        — hardware breakpoints + code injection (patch/NOP/caves)
 *   ReadWriteHandlers   — memory read/write, freeze, undo/redo
 *   IntegrityHandlers   — speedhack, heap analysis, PE introspection, anti-cheat
 *
 * Constructor signature is unchanged — the manifest creates this facade directly.
 */

import type { MemoryScanner } from '@native/MemoryScanner';
import type { MemoryScanSessionManager } from '@native/MemoryScanSession';
import type { PointerChainEngine } from '@native/PointerChainEngine';
import type { HardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import type { CodeInjector } from '@native/CodeInjector';
import type { MemoryController } from '@native/MemoryController';
import type { Speedhack } from '@native/Speedhack';
import type { HeapAnalyzer } from '@native/HeapAnalyzer';
import type { PEAnalyzer } from '@native/PEAnalyzer';
import type { AntiCheatDetector } from '@native/AntiCheatDetector';

import { SessionHandlers } from './handlers/session';
import { ScanHandlers } from './handlers/scan';
import { PointerChainHandlers } from './handlers/pointer-chain';
import { StructureHandlers } from './handlers/structure';
import { HookHandlers } from './handlers/hooks';
import { ReadWriteHandlers } from './handlers/readwrite';
import { IntegrityHandlers } from './handlers/integrity';

export class MemoryScanHandlers {
  private readonly sessions: SessionHandlers;
  private readonly scans: ScanHandlers;
  private readonly ptrChains: PointerChainHandlers;
  private readonly structures: StructureHandlers;
  private readonly hooks: HookHandlers;
  private readonly readwrite: ReadWriteHandlers;
  private readonly integrity: IntegrityHandlers;

  constructor(
    scanner: MemoryScanner,
    sessionManager: MemoryScanSessionManager,
    ptrEngine: PointerChainEngine,
    structAnalyzer: import('@native/StructureAnalyzer').StructureAnalyzer,
    bpEngine: HardwareBreakpointEngine | null,
    injector: CodeInjector,
    memCtrl: MemoryController,
    speedhackEngine: Speedhack | null,
    heapAnalyzer: HeapAnalyzer | null,
    peAnalyzer: PEAnalyzer | null,
    antiCheatDetector: AntiCheatDetector | null,
  ) {
    this.sessions = new SessionHandlers(sessionManager);
    this.scans = new ScanHandlers(scanner);
    this.ptrChains = new PointerChainHandlers(ptrEngine);
    this.structures = new StructureHandlers(structAnalyzer);
    this.hooks = new HookHandlers(bpEngine, injector);
    this.readwrite = new ReadWriteHandlers(memCtrl);
    this.integrity = new IntegrityHandlers(
      speedhackEngine,
      heapAnalyzer,
      peAnalyzer,
      antiCheatDetector,
    );
  }

  // ── Session ──

  handleScanList = (args: Record<string, unknown>) => this.sessions.handleScanList(args);
  handleScanDelete = (args: Record<string, unknown>) => this.sessions.handleScanDelete(args);
  handleScanExport = (args: Record<string, unknown>) => this.sessions.handleScanExport(args);

  // ── Scan ──

  handleFirstScan = (args: Record<string, unknown>) => this.scans.handleFirstScan(args);
  handleNextScan = (args: Record<string, unknown>) => this.scans.handleNextScan(args);
  handleUnknownScan = (args: Record<string, unknown>) => this.scans.handleUnknownScan(args);
  handlePointerScan = (args: Record<string, unknown>) => this.scans.handlePointerScan(args);
  handleGroupScan = (args: Record<string, unknown>) => this.scans.handleGroupScan(args);

  // ── Pointer Chain ──

  handlePointerChainScan = (args: Record<string, unknown>) =>
    this.ptrChains.handlePointerChainScan(args);
  handlePointerChainValidate = (args: Record<string, unknown>) =>
    this.ptrChains.handlePointerChainValidate(args);
  handlePointerChainResolve = (args: Record<string, unknown>) =>
    this.ptrChains.handlePointerChainResolve(args);
  handlePointerChainExport = (args: Record<string, unknown>) =>
    this.ptrChains.handlePointerChainExport(args);

  // ── Structure ──

  handleStructureAnalyze = (args: Record<string, unknown>) =>
    this.structures.handleStructureAnalyze(args);
  handleVtableParse = (args: Record<string, unknown>) => this.structures.handleVtableParse(args);
  handleStructureExportC = (args: Record<string, unknown>) =>
    this.structures.handleStructureExportC(args);
  handleStructureCompare = (args: Record<string, unknown>) =>
    this.structures.handleStructureCompare(args);

  // ── Hook (breakpoint + injection) ──

  handleBreakpointSet = (args: Record<string, unknown>) => this.hooks.handleBreakpointSet(args);
  handleBreakpointRemove = (args: Record<string, unknown>) =>
    this.hooks.handleBreakpointRemove(args);
  handleBreakpointList = (args: Record<string, unknown>) => this.hooks.handleBreakpointList(args);
  handleBreakpointTrace = (args: Record<string, unknown>) => this.hooks.handleBreakpointTrace(args);
  handlePatchBytes = (args: Record<string, unknown>) => this.hooks.handlePatchBytes(args);
  handlePatchNop = (args: Record<string, unknown>) => this.hooks.handlePatchNop(args);
  handlePatchUndo = (args: Record<string, unknown>) => this.hooks.handlePatchUndo(args);
  handleCodeCaves = (args: Record<string, unknown>) => this.hooks.handleCodeCaves(args);

  // ── Read / Write ──

  handleWriteValue = (args: Record<string, unknown>) => this.readwrite.handleWriteValue(args);
  handleFreeze = (args: Record<string, unknown>) => this.readwrite.handleFreeze(args);
  handleUnfreeze = (args: Record<string, unknown>) => this.readwrite.handleUnfreeze(args);
  handleDump = (args: Record<string, unknown>) => this.readwrite.handleDump(args);
  handleWriteUndo = (args: Record<string, unknown>) => this.readwrite.handleWriteUndo(args);
  handleWriteRedo = (args: Record<string, unknown>) => this.readwrite.handleWriteRedo(args);

  // ── Integrity (speedhack + heap + PE + anti-cheat) ──

  handleSpeedhackApply = (args: Record<string, unknown>) =>
    this.integrity.handleSpeedhackApply(args);
  handleSpeedhackSet = (args: Record<string, unknown>) => this.integrity.handleSpeedhackSet(args);
  handleHeapEnumerate = (args: Record<string, unknown>) => this.integrity.handleHeapEnumerate(args);
  handleHeapStats = (args: Record<string, unknown>) => this.integrity.handleHeapStats(args);
  handleHeapAnomalies = (args: Record<string, unknown>) => this.integrity.handleHeapAnomalies(args);
  handlePEHeaders = (args: Record<string, unknown>) => this.integrity.handlePEHeaders(args);
  handlePEImportsExports = (args: Record<string, unknown>) =>
    this.integrity.handlePEImportsExports(args);
  handleInlineHookDetect = (args: Record<string, unknown>) =>
    this.integrity.handleInlineHookDetect(args);
  handleAntiCheatDetect = (args: Record<string, unknown>) =>
    this.integrity.handleAntiCheatDetect(args);
  handleGuardPages = (args: Record<string, unknown>) => this.integrity.handleGuardPages(args);
  handleIntegrityCheck = (args: Record<string, unknown>) =>
    this.integrity.handleIntegrityCheck(args);
}
