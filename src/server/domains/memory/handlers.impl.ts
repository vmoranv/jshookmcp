/**
 * Memory domain — handler implementations.
 *
 * Delegates to 8 internal sub-handler classes, each owning a focused responsibility:
 *   SessionHandlers      — scan session lifecycle (list/delete/export)
 *   ScanHandlers        — first/next/unknown/pointer/group scans
 *   PointerChainHandlers— pointer chain scan/validate/resolve/export
 *   StructureHandlers   — structure analysis, vtable, C export, compare
 *   HookHandlers        — hardware breakpoints + code injection (patch/NOP/caves)
 *   ReadWriteHandlers   — memory read/write, freeze, undo/redo
 *   IntegrityHandlers   — speedhack, heap analysis, PE introspection, anti-cheat
 *   FindAccessesHandlers— "find what writes/accesses this address" (MWT trace)
 *
 * Constructor signature is unchanged — the manifest creates this facade directly.
 */

import type { MemoryScanner } from '@native/MemoryScanner';
import type { MemoryScanSessionManager } from '@native/MemoryScanSession';
import type { PointerChainEngine } from '@native/PointerChainEngine';
import type { BreakpointEngine } from '@native/HardwareBreakpoint.types';
import type { SoftwareBreakpointEngine } from '@native/SoftwareBreakpoint';
import type { CodeInjector } from '@native/CodeInjector';
import type { MemoryController } from '@native/MemoryController';
import type { Speedhack } from '@native/Speedhack';
import type { HeapAnalyzer } from '@native/HeapAnalyzer';
import type { PEAnalyzer } from '@native/PEAnalyzer';
import type { AntiCheatDetector } from '@native/AntiCheatDetector';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { asJsonResponse } from '@server/domains/shared/response';

import { SessionHandlers } from './handlers/session';
import { ScanHandlers } from './handlers/scan';
import { PointerChainHandlers } from './handlers/pointer-chain';
import { StructureHandlers } from './handlers/structure';
import { HookHandlers } from './handlers/hooks';
import { ReadWriteHandlers } from './handlers/readwrite';
import { IntegrityHandlers } from './handlers/integrity';
import {
  FindAccessesHandlers,
  type DisassemblerFn,
  type MemoryReaderFn,
} from './handlers/find-accesses';
import { RegionHandlers } from './handlers/region-enumerate';
import { MinidumpHandlers } from './handlers/minidump-parse';
import { MonoHandlers } from './handlers/mono';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { HandleEnumHandlers } from './handlers/handle-enum';
import { ProtectHandlers } from './handlers/protect';
import { RegionCompareHandlers } from './handlers/region-compare';
import { BookmarkHandlers } from './handlers/bookmark';
import { FindReferencesHandlers } from './handlers/find-references';
import { ReverseMWTHandlers } from './handlers/reverse-mwt';
import { TraceCodeHandlers } from './handlers/trace-code';
import { PointerMapHandlers } from './handlers/pointer-map';
import { AssembleHandlers } from './handlers/assemble';
import { AutoAssemblerHandlers } from './handlers/auto-assembler';
import { HypervisorHandlers } from './handlers/hypervisor';
import { AntiDetectionHandlers } from './handlers/antidetection';
import { AntiDetectionCheckHandlers } from './handlers/antidetection-check';

import { logger } from '@utils/logger';

export class MemoryScanHandlers {
  private readonly sessions: SessionHandlers;
  private readonly scans: ScanHandlers;
  private readonly ptrChains: PointerChainHandlers;
  private readonly structures: StructureHandlers;
  private readonly hooks: HookHandlers;
  private readonly readwrite: ReadWriteHandlers;
  private readonly integrity: IntegrityHandlers;
  private readonly regions: RegionHandlers;
  private readonly findAccesses: FindAccessesHandlers;
  private readonly minidump: MinidumpHandlers;
  private readonly mono: MonoHandlers;
  private readonly handleEnum: HandleEnumHandlers;
  private readonly protect: ProtectHandlers;
  private readonly regionCompare: RegionCompareHandlers;
  private readonly bookmarks: BookmarkHandlers;
  private readonly findRefs: FindReferencesHandlers;
  private readonly reverseMwt: ReverseMWTHandlers;
  private readonly traceCode: TraceCodeHandlers;
  private readonly ptrMaps: PointerMapHandlers;
  private readonly assembler: AssembleHandlers;
  private readonly aa: AutoAssemblerHandlers;
  private readonly hypervisor: HypervisorHandlers;
  private readonly antidetection: AntiDetectionHandlers;
  private readonly antidetectionCheck: AntiDetectionCheckHandlers;

  /** Shared audit trail for destructive operations (write/freeze/patch). */
  readonly auditTrail = new MemoryAuditTrail();

  constructor(
    scanner: MemoryScanner,
    sessionManager: MemoryScanSessionManager,
    ptrEngine: PointerChainEngine,
    structAnalyzer: import('@native/StructureAnalyzer').StructureAnalyzer,
    bpEngine: BreakpointEngine | null,
    vehEngine: import('@native/VehDebugger').VehDebuggerEngine | null,
    softBpEngine: SoftwareBreakpointEngine | null,
    injector: CodeInjector,
    memCtrl: MemoryController,
    speedhackEngine: Speedhack | null,
    heapAnalyzer: HeapAnalyzer | null,
    peAnalyzer: PEAnalyzer | null,
    antiCheatDetector: AntiCheatDetector | null,
    eventBus?: EventBus<ServerEventMap>,
    processManager?: UnifiedProcessManager,
    ctx?: MCPServerContext,
  ) {
    this.sessions = new SessionHandlers(sessionManager, this.auditTrail);
    this.scans = new ScanHandlers(scanner, eventBus, processManager, ctx, this.auditTrail);
    this.ptrChains = new PointerChainHandlers(ptrEngine, processManager, ctx, this.auditTrail);
    this.structures = new StructureHandlers(structAnalyzer, processManager, ctx, this.auditTrail);
    this.hooks = new HookHandlers(
      bpEngine,
      vehEngine,
      softBpEngine,
      injector,
      processManager,
      ctx,
      this.auditTrail,
    );
    this.readwrite = new ReadWriteHandlers(memCtrl, processManager, ctx, this.auditTrail);
    this.integrity = new IntegrityHandlers(
      speedhackEngine,
      heapAnalyzer,
      peAnalyzer,
      antiCheatDetector,
      processManager,
      ctx,
      this.auditTrail,
    );
    this.regions = new RegionHandlers();
    this.findAccesses = new FindAccessesHandlers(
      bpEngine,
      makeMemoryReader(memCtrl),
      makeDisassemblerAdapter(),
      processManager,
      ctx,
    );
    this.minidump = new MinidumpHandlers();
    this.mono = new MonoHandlers(processManager, ctx);
    this.handleEnum = new HandleEnumHandlers(processManager, ctx);
    this.protect = new ProtectHandlers(processManager, ctx, this.auditTrail);
    this.regionCompare = new RegionCompareHandlers(processManager, ctx);
    this.bookmarks = new BookmarkHandlers(processManager, ctx);
    this.findRefs = new FindReferencesHandlers(processManager, ctx);
    this.reverseMwt = new ReverseMWTHandlers(memCtrl, processManager, ctx);
    this.traceCode = new TraceCodeHandlers(processManager, ctx);
    this.ptrMaps = new PointerMapHandlers();
    this.assembler = new AssembleHandlers(processManager, ctx, this.auditTrail);
    this.aa = new AutoAssemblerHandlers(injector, scanner, memCtrl, processManager);
    this.hypervisor = new HypervisorHandlers();
    this.antidetection = new AntiDetectionHandlers();
    this.antidetectionCheck = new AntiDetectionCheckHandlers();
  }

  // ── Session ──

  handleScanSessionDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'delete':
        return this.sessions.handleScanDelete(args);
      case 'export':
        return this.sessions.handleScanExport(args);
      default:
        return this.sessions.handleScanList(args);
    }
  }
  handleScanList = (args: Record<string, unknown>) => this.sessions.handleScanList(args);
  handleScanDelete = (args: Record<string, unknown>) => this.sessions.handleScanDelete(args);
  handleScanExport = (args: Record<string, unknown>) => this.sessions.handleScanExport(args);
  handleSessionExportData = (args: Record<string, unknown>) =>
    this.sessions.handleSessionExportData(args);

  // ── Scan ──

  handleFirstScan = (args: Record<string, unknown>) => this.scans.handleFirstScan(args);
  handleNextScan = (args: Record<string, unknown>) => this.scans.handleNextScan(args);
  handleUnknownScan = (args: Record<string, unknown>) => this.scans.handleUnknownScan(args);
  handlePointerScan = (args: Record<string, unknown>) => this.scans.handlePointerScan(args);
  handleGroupScan = (args: Record<string, unknown>) => this.scans.handleGroupScan(args);
  handleAobScan = (args: Record<string, unknown>) => this.scans.handleAobScan(args);
  handleGenerateSignature = (args: Record<string, unknown>) =>
    this.scans.handleGenerateSignature(args);
  handleSearchString = (args: Record<string, unknown>) => this.scans.handleSearchString(args);
  handleRegisterType = (args: Record<string, unknown>) => this.scans.handleRegisterType(args);
  handleListTypes = (args: Record<string, unknown>) => this.scans.handleListTypes(args);
  handleUnregisterType = (args: Record<string, unknown>) => this.scans.handleUnregisterType(args);

  // ── Pointer Chain ──

  handlePointerChainDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'autoscan':
        return this.ptrChains.handlePointerChainAutoscan(args);
      case 'validate':
        return this.ptrChains.handlePointerChainValidate(args);
      case 'resolve':
        return this.ptrChains.handlePointerChainResolve(args);
      case 'export':
        return this.ptrChains.handlePointerChainExport(args);
      default:
        return this.ptrChains.handlePointerChainScan(args);
    }
  }
  handlePointerChainScan = (args: Record<string, unknown>) =>
    this.ptrChains.handlePointerChainScan(args);
  handlePointerChainAutoscan = (args: Record<string, unknown>) =>
    this.ptrChains.handlePointerChainAutoscan(args);
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
  handleRttiInfo = (args: Record<string, unknown>) => this.structures.handleRttiInfo(args);

  // ── Cheat Table ──

  handleCheatTableDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    if (action === 'import') return this.structures.handleCheatTableImport(args);
    if (action === 'sign') return this.structures.handleCheatTableSign(args);
    if (action === 'verify') return this.structures.handleCheatTableVerify(args);
    return this.structures.handleCheatTableExport(args);
  }

  // ── Hook (breakpoint + injection) ──

  handleBreakpointDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    switch (action) {
      case 'remove':
        return this.hooks.handleBreakpointRemove(args);
      case 'list':
        return this.hooks.handleBreakpointList(args);
      case 'trace':
        return this.hooks.handleBreakpointTrace(args);
      default:
        return this.hooks.handleBreakpointSet(args);
    }
  }
  handleBreakpointSet = (args: Record<string, unknown>) => this.hooks.handleBreakpointSet(args);
  handleBreakpointRemove = (args: Record<string, unknown>) =>
    this.hooks.handleBreakpointRemove(args);
  handleBreakpointList = (args: Record<string, unknown>) => this.hooks.handleBreakpointList(args);
  handleBreakpointTrace = (args: Record<string, unknown>) => this.hooks.handleBreakpointTrace(args);
  handlePatchBytes = (args: Record<string, unknown>) => this.hooks.handlePatchBytes(args);
  handlePatchNop = (args: Record<string, unknown>) => this.hooks.handlePatchNop(args);
  handlePatchUndo = (args: Record<string, unknown>) => this.hooks.handlePatchUndo(args);
  handleCodeCaves = (args: Record<string, unknown>) => this.hooks.handleCodeCaves(args);
  handleMemoryAllocate = (args: Record<string, unknown>) => this.hooks.handleMemoryAllocate(args);
  handleMemoryFree = (args: Record<string, unknown>) => this.hooks.handleMemoryFree(args);
  handleInjectShellcode = (args: Record<string, unknown>) => this.hooks.handleInjectShellcode(args);
  handleInjectDll = (args: Record<string, unknown>) => this.hooks.handleInjectDll(args);
  handleCallStack = (args: Record<string, unknown>) => this.hooks.handleCallStack(args);
  handleProcessControl = (args: Record<string, unknown>) => this.hooks.handleProcessControl(args);

  // ── Read / Write ──

  handleFreezeDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    if (action === 'unfreeze') return this.readwrite.handleUnfreeze(args);
    return this.readwrite.handleFreeze(args);
  }
  handleWriteHistoryDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    if (action === 'redo') return this.readwrite.handleWriteRedo(args);
    return this.readwrite.handleWriteUndo(args);
  }
  handleWriteValue = (args: Record<string, unknown>) => this.readwrite.handleWriteValue(args);
  handleFreeze = (args: Record<string, unknown>) => this.readwrite.handleFreeze(args);
  handleUnfreeze = (args: Record<string, unknown>) => this.readwrite.handleUnfreeze(args);
  handleDump = (args: Record<string, unknown>) => this.readwrite.handleDump(args);
  handleReadTyped = (args: Record<string, unknown>) => this.readwrite.handleReadTyped(args);
  handleWriteUndo = (args: Record<string, unknown>) => this.readwrite.handleWriteUndo(args);
  handleWriteRedo = (args: Record<string, unknown>) => this.readwrite.handleWriteRedo(args);
  handleBatchEdit = (args: Record<string, unknown>) => this.readwrite.handleBatchEdit(args);
  handleWatch = (args: Record<string, unknown>) => this.readwrite.handleWatch(args);
  handleFreezeExport = (args: Record<string, unknown>) => this.readwrite.handleFreezeExport(args);

  // ── Integrity (speedhack + heap + PE + anti-cheat) ──

  handleSpeedhackDispatch(args: Record<string, unknown>) {
    const action = String(args['action'] ?? '');
    if (action === 'set') return this.integrity.handleSpeedhackSet(args);
    if (action === 'restore') return this.integrity.handleSpeedhackRestore(args);
    return this.integrity.handleSpeedhackApply(args);
  }
  handleSpeedhackApply = (args: Record<string, unknown>) =>
    this.integrity.handleSpeedhackApply(args);
  handleSpeedhackSet = (args: Record<string, unknown>) => this.integrity.handleSpeedhackSet(args);
  handleSpeedhackRestore = (args: Record<string, unknown>) =>
    this.integrity.handleSpeedhackRestore(args);
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

  // ── Type Define ──

  handleTypeDefine = (args: Record<string, unknown>) => this.structures.handleTypeDefine(args);

  // ── Emulator Detection ──

  async handleEmulatorDetect(args: Record<string, unknown>) {
    const { detectEmulator, listKnownEmulators } = await import('./handlers/emulator');
    const processName = typeof args.processName === 'string' ? args.processName : '';
    const moduleNames = Array.isArray(args.moduleNames)
      ? (args.moduleNames as string[])
      : undefined;
    const listAll = args.list === true || args.list === 'true';

    if (listAll) {
      return asJsonResponse({
        success: true,
        knownEmulators: listKnownEmulators(),
        count: listKnownEmulators().length,
      });
    }

    if (!processName) {
      throw new Error(
        'memory_emulator_detect: missing required argument "processName" (or set list=true to list all known emulators)',
      );
    }

    const result = detectEmulator(processName, moduleNames);
    return asJsonResponse({
      success: true,
      ...result,
    });
  }

  // ── Region Enumeration ──

  handleRegionEnumerate = (args: Record<string, unknown>) =>
    this.regions.handleRegionEnumerate(args);

  // ── Find Accesses (MWT) ──

  handleFindAccesses = (args: Record<string, unknown>) =>
    this.findAccesses.handleFindAccesses(args);

  // ── Find References (x64dbg parity) ──

  handleFindReferences = (args: Record<string, unknown>) =>
    this.findRefs.handleFindReferences(args);

  // ── Reverse MWT (inverse of find_accesses) ──

  handleReverseMWT = (args: Record<string, unknown>) => this.reverseMwt.handleReverseMWT(args);

  // ── Code Trace (Ultimap-style) ──

  handleTraceCode = (args: Record<string, unknown>) => this.traceCode.handleTraceCode(args);

  // ── Minidump Parser ──

  handleMemoryParseDump = (args: Record<string, unknown>) =>
    this.minidump.handleMemoryParseDump(args);

  // ── Mono / .NET Runtime ──

  handleMonoDetect = (args: Record<string, unknown>) => this.mono.handleMonoDetect(args);
  handleMonoAssemblies = (args: Record<string, unknown>) => this.mono.handleMonoAssemblies(args);
  handleMonoClasses = (args: Record<string, unknown>) => this.mono.handleMonoClasses(args);
  handleMonoObjects = (args: Record<string, unknown>) => this.mono.handleMonoObjects(args);
  handleMonoFields = (args: Record<string, unknown>) => this.mono.handleMonoFields(args);
  handleMonoMethods = (args: Record<string, unknown>) => this.mono.handleMonoMethods(args);
  // ── Handle Enumeration ──

  handleHandleEnum = (args: Record<string, unknown>) => this.handleEnum.handleHandleEnum(args);

  // ── Memory Protection ──

  handleProtect = (args: Record<string, unknown>) => this.protect.handleProtect(args);

  // ── Region Comparison ──

  handleRegionCompare = (args: Record<string, unknown>) =>
    this.regionCompare.handleRegionCompare(args);

  // ── Pointer Map Persistence (.PTR parity) ──

  handlePointerMap = (args: Record<string, unknown>) => this.ptrMaps.handlePointerMap(args);

  // ── Inline Assembler (x64dbg parity) ──

  handleAssemble = (args: Record<string, unknown>) => this.assembler.handleAssemble(args);

  // ── Auto Assembler (CE parity) ──

  handleAutoAssemble = (args: Record<string, unknown>) => this.aa.handleAutoAssemble(args);
  handleAutoAssembleDisable = (args: Record<string, unknown>) =>
    this.aa.handleAutoAssembleDisable(args);

  // ── Bookmarks ──

  handleBookmarkDispatch(args: Record<string, unknown>) {
    return this.bookmarks.handleBookmarkDispatch(args);
  }

  // ── Anti-Detection ──

  handleAntiDetection = (args: Record<string, unknown>) =>
    this.antidetection.handleAntiDetection(args);

  handleAntiDetectionCheck = (args: Record<string, unknown>) =>
    this.antidetectionCheck.handleCheck(args);

  // ── EPT Hypervisor ──

  handleHypervisor = (args: Record<string, unknown>) => this.hypervisor.handleHypervisor(args);

  // ── Remote Debugging Stub ──

  async handleRemote(args: Record<string, unknown>): Promise<unknown> {
    const { getOrCreateRemoteProxy, getRemoteProxy, removeRemoteProxy, listRemoteProxies } =
      await import('@native/RemoteProxy');

    const action = typeof args.action === 'string' ? args.action : 'status';
    const proxyId = typeof args.proxyId === 'string' ? args.proxyId : 'default';
    const url = typeof args.url === 'string' ? args.url : '';

    if (action === 'disconnect') {
      const removed = removeRemoteProxy(proxyId);
      return asJsonResponse({ disconnected: removed, proxyId });
    }

    if (action === 'status') {
      const proxy = getRemoteProxy(proxyId);
      if (proxy) return asJsonResponse(proxy.status);
      return asJsonResponse({ proxies: listRemoteProxies() });
    }

    if (action === 'connect') {
      if (!url) throw new Error('memory_remote: "url" is required for connect action');

      const authToken = typeof args.authToken === 'string' ? args.authToken : undefined;
      const connectTimeoutMs =
        typeof args.connectTimeoutMs === 'number' ? args.connectTimeoutMs : undefined;

      const proxy = getOrCreateRemoteProxy(proxyId, { url, authToken, connectTimeoutMs });
      await proxy.connect();
      return asJsonResponse(proxy.status);
    }

    if (action === 'forward') {
      if (!url) throw new Error('memory_remote: "url" is required for forward action');

      const toolName = typeof args.toolName === 'string' ? args.toolName : '';
      if (!toolName) throw new Error('memory_remote: "toolName" is required for forward action');

      const toolArgs =
        typeof args.toolArgs === 'object' && args.toolArgs !== null
          ? (args.toolArgs as Record<string, unknown>)
          : {};
      const requestTimeoutMs =
        typeof args.requestTimeoutMs === 'number' ? args.requestTimeoutMs : undefined;

      const proxy = getOrCreateRemoteProxy(proxyId, { url });
      const result = await proxy.forward(toolName, toolArgs, requestTimeoutMs);
      return asJsonResponse({ result, proxyId });
    }

    throw new Error(
      `memory_remote: invalid action "${action}" — expected connect, disconnect, status, or forward`,
    );
  }
}

// ── FindAccessesHandlers dependency adapters ──
//
// `makeMemoryReader` wraps the already-injected MemoryController (Win32 koffi
// ReadProcessMemory). `makeDisassemblerAdapter` wraps the exploit-dev Capstone
// Disassembler. Both are only exercised when find-accesses runs (Win32-only —
// the bpEngine is null on other platforms and the handler throws early), so
// capstone-wasm is never loaded on non-Win32.

/**
 * Build a MemoryReaderFn over MemoryController.dumpMemory.
 * Returns hex-encoded bytes ("DE AD BE EF ...") on success, or an error
 * result on failure — never throws (the handler treats failure as
 * instructionBytes=null rather than crashing the trace loop).
 */
function makeMemoryReader(memCtrl: MemoryController): MemoryReaderFn {
  return async (pid, address, size) => {
    try {
      const buf = await memCtrl.dumpMemory(pid, address, size);
      const hex = Array.from(buf)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
      return { success: true, data: hex };
    } catch (err) {
      logger.debug('memory_find_accesses: MemoryController.dumpMemory failed:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

/**
 * Build a DisassemblerFn adapter over the exploit-dev Capstone Disassembler.
 *
 * The Disassembler module is lazy-imported on first call so capstone-wasm is
 * only loaded when find-accesses actually disassembles a hit (Win32 runtime).
 *
 * Architecture defaults to x64 — the overwhelmingly common Win32 target. A
 * WOW64 (32-bit) process will produce wrong mnemonics; this is a known
 * limitation (follow-up: detect IsWow64Process and switch to x86).
 *
 * Cross-platform note: capstone-wasm itself runs on any platform (no native
 * binding required), but this adapter is only reached on Win32 because
 * find_accesses throws early when `bpEngine` is null on macOS/Linux. The
 * cross-platform gap is the bpEngine, not the disassembler — see
 * research/memory.md #3.
 */
function makeDisassemblerAdapter(): DisassemblerFn {
  let disasmInstance: import('@server/domains/exploit-dev/utils/disasm').Disassembler | null = null;

  return async (instructionBytes, instructionAddress) => {
    if (!disasmInstance) {
      const { Disassembler } = await import('@server/domains/exploit-dev/utils/disasm');
      disasmInstance = new Disassembler();
    }

    const buf = Buffer.from(instructionBytes);
    const addrNum = parseInt(instructionAddress.replace(/^0x/i, ''), 16);
    if (Number.isNaN(addrNum)) {
      throw new Error(`Invalid instruction address: ${instructionAddress}`);
    }

    const instrs = await disasmInstance.disassemble(buf, {
      arch: 'x64',
      offset: addrNum,
      count: 1,
    });

    if (instrs.length === 0) {
      throw new Error('Capstone returned no instructions for the given bytes');
    }

    const first = instrs[0]!;
    return first.opStr ? `${first.mnemonic} ${first.opStr}` : first.mnemonic;
  };
}
