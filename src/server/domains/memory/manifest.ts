/**
 * Memory domain manifest.
 *
 * Platform-aware: registers 39 tools on Windows, 24 on macOS.
 * Win32-only tools (heap/PE/anti-cheat/breakpoint/speedhack) are excluded on non-Windows.
 */

import type { DomainManifest } from '@server/registry/contracts';
import type { MCPServerContext } from '@server/MCPServer.context';
import { memoryScanToolDefinitions } from './definitions';
import type { MemoryScanHandlers } from './handlers.impl';
import { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import { readEnvString } from '@src/config/environment';
import { getRuntimeCore } from '@server/domains/shared/runtime-core';

const DOMAIN = 'memory' as const;
const DEP_KEY = 'memoryScanHandlers' as const;
const configuredPlatform = readEnvString('JSHOOK_REGISTRY_PLATFORM', '', { trim: true });
const EFFECTIVE_PLATFORM =
  configuredPlatform === 'win32' ||
  configuredPlatform === 'linux' ||
  configuredPlatform === 'darwin'
    ? configuredPlatform
    : process.platform;
const IS_WIN32 = EFFECTIVE_PLATFORM === 'win32';
type H = MemoryScanHandlers;

// `globalProcessManager` is a process-wide lazy singleton (owns OS handles, not
// request state) — correct to share. The progress eventBus comes from the
// injected `deps.__runtimeCore` (set once by MCPServer.initDomainProxies())
// instead of a per-ensure mutable global.
let globalProcessManager: UnifiedProcessManager | null = null;

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { MemoryScanHandlers } = await import('./handlers.impl');
  const ctxAny = ctx as unknown as Record<string, unknown>;
  if (ctxAny[DEP_KEY]) return ctxAny[DEP_KEY] as H;

  // Startup cleanup: reclaim stale jshook-scan-*.bin orphans and arm the
  // idle-expiry sweep for disk-backed scan sessions. Idempotent.
  const { initDiskScanPersistence } = await import('./handlers/scan-persistence');
  initDiskScanPersistence();

  // Dynamic imports: load native koffi modules AND handler lazily — only when memory domain is accessed.
  // Cross-platform modules (always loaded)
  const [
    memoryScanner,
    nativeMemoryManager,
    scanSessionManager,
    pointerChainEngine,
    structureAnalyzer,
    codeInjector,
    memoryController,
    platformFactory,
    heapAnalyzerMod,
  ] = await Promise.all([
    import('@native/MemoryScanner'),
    import('@native/NativeMemoryManager.impl'),
    import('@native/MemoryScanSession'),
    import('@native/PointerChainEngine'),
    import('@native/StructureAnalyzer'),
    import('@native/CodeInjector'),
    import('@native/MemoryController'),
    import('@native/platform/factory'),
    import('@native/HeapAnalyzer'),
  ]);
  // Compose one provider for the core memory path. Compatibility singletons
  // remain exported from their legacy modules, but domain handlers receive
  // explicitly wired instances so provider lifecycle is visible and testable.
  const provider = platformFactory.createPlatformProvider();
  const domainMemoryManager = new nativeMemoryManager.NativeMemoryManager(provider);
  const domainMemoryScanner = new memoryScanner.MemoryScanner(domainMemoryManager, provider);
  const domainMemoryController = new memoryController.MemoryController(provider);
  if (!globalProcessManager) {
    globalProcessManager = new UnifiedProcessManager();
  }

  if (IS_WIN32) {
    // Lazy-load Win32-only engines — only load on Windows
    const [
      hardwareBreakpointEngine,
      vehDebuggerEngine,
      softwareBreakpointEngine,
      speedhack,
      peAnalyzer,
      antiCheatDetector,
    ] = await Promise.all([
      import('@native/HardwareBreakpoint'),
      import('@native/VehDebugger'),
      import('@native/SoftwareBreakpoint'),
      import('@native/Speedhack'),
      import('@native/PEAnalyzer'),
      import('@native/AntiCheatDetector'),
    ]);

    ctxAny[DEP_KEY] = new MemoryScanHandlers(
      domainMemoryScanner,
      scanSessionManager.scanSessionManager,
      pointerChainEngine.pointerChainEngine,
      structureAnalyzer.structureAnalyzer,
      hardwareBreakpointEngine.hardwareBreakpointEngine,
      vehDebuggerEngine.vehDebuggerEngine,
      softwareBreakpointEngine.softwareBreakpointEngine,
      codeInjector.codeInjector,
      domainMemoryController,
      speedhack.speedhack,
      heapAnalyzerMod.heapAnalyzer,
      peAnalyzer.peAnalyzer,
      antiCheatDetector.antiCheatDetector,
      ctx.eventBus,
      globalProcessManager,
      ctx,
    );
  } else {
    // macOS/Linux: cross-platform modules always wired.
    // Hardware breakpoints now cross-platform via CrossPlatformBreakpointEngine
    // (ptrace PTRACE_POKEUSER on Linux, Mach thread_set_state on macOS).
    const crossPlatformBp = await import('@native/CrossPlatformBreakpointEngine');
    ctxAny[DEP_KEY] = new MemoryScanHandlers(
      domainMemoryScanner,
      scanSessionManager.scanSessionManager,
      pointerChainEngine.pointerChainEngine,
      structureAnalyzer.structureAnalyzer,
      crossPlatformBp.crossPlatformBreakpointEngine,
      null, // vehDebuggerEngine — Win32 VEH only; requires code injection
      null, // softBpEngine — Win32 INT3 only; requires Win32 debug APIs
      codeInjector.codeInjector,
      domainMemoryController,
      null, // speedhack
      heapAnalyzerMod.heapAnalyzer, // heapAnalyzer — cross-platform
      null, // peAnalyzer
      null, // antiCheatDetector
      ctx.eventBus,
      globalProcessManager,
      ctx,
    );
  }
  return ctxAny[DEP_KEY] as H;
}

import { createProgressDebouncer } from '@server/EventBus';

function bindByKey(invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) {
  return (deps: Record<string, unknown>) => {
    const handler = deps[DEP_KEY] as H;
    const runtime = getRuntimeCore(deps);
    return (args: Record<string, unknown>) => {
      const meta = args._meta as { progressToken?: string | number } | undefined;
      let onProgress: ((progress: number, total?: number) => void) | undefined;

      if (meta?.progressToken !== undefined && runtime) {
        onProgress = createProgressDebouncer(runtime.eventBus, meta.progressToken);
      }
      return invoke(handler, { ...args, onProgress });
    };
  };
}

function toolByName(name: string) {
  const tool = memoryScanToolDefinitions.find((t) => t.name === name);
  if (!tool) throw new Error(`Memory tool not found: ${name}`);
  return tool;
}

// ── Win32-only tool names ──
const WIN32_ONLY_TOOLS = new Set([
  // Heap analysis now cross-platform: HeapAnalyzer has a region-based fallback
  // (readProcMapsRegions / /proc/pid/maps) and is always wired (E5-D-heap).
  // Hardware breakpoints are now cross-platform via CrossPlatformBreakpointEngine:
  //   Win32  → DR0-DR3 via Win32 debug API
  //   Linux  → DR0-DR3 via ptrace PTRACE_POKEUSER
  //   macOS  → ARM64 DBGBVR/DBGWVR via Mach thread_set_state
  // memory_breakpoint and memory_find_accesses are registered on all platforms.
  // Speedhack (Win32 timer hooking — LD_PRELOAD parity pending — E5-D)
  'memory_speedhack',
  // Mono/.NET runtime introspection (Win32 ReadProcessMemory via Unity mono-2.0-bdwgc.dll)
  'memory_mono_detect',
  'memory_mono_assemblies',
  'memory_mono_classes',
  'memory_mono_objects',
  'memory_mono_fields',
  'memory_mono_methods',
  // Code injection tools — Win32 VirtualAllocEx/VirtualFreeEx/CreateRemoteThread
  'memory_allocate',
  'memory_free',
  'memory_inject_shellcode',
  'memory_inject_dll',
  'memory_handle_enum',
  // Auto Assembler — Win32 VirtualAllocEx/VirtualFreeEx/CreateRemoteThread/AOB scan
  'memory_auto_assemble',
  'memory_auto_assemble_disable',
  // Call stack walking — Win32 kernel32/dbghelp koffi
  'memory_call_stack',
  // Ultimap-style INT3 code tracing — Win32 debug API
  'memory_trace_code',
  // EPT Hypervisor — Intel VT-x + Win32 kernel driver
  'memory_hypervisor',
]);

// All tool registrations — then filtered by platform
const allRegistrations = [
  // ── Scan Tools ──
  {
    tool: toolByName('memory_first_scan'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleFirstScan(a)),
  },
  {
    tool: toolByName('memory_next_scan'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleNextScan(a)),
  },
  {
    tool: toolByName('memory_unknown_scan'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleUnknownScan(a)),
  },
  {
    tool: toolByName('memory_pointer_scan'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handlePointerScan(a)),
  },
  {
    tool: toolByName('memory_group_scan'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleGroupScan(a)),
  },
  {
    tool: toolByName('memory_scan_session'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleScanSessionDispatch(a)),
  },
  {
    tool: toolByName('memory_search_string'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleSearchString(a)),
  },
  // ── Pointer Chain Tools ──
  {
    tool: toolByName('memory_pointer_chain'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handlePointerChainDispatch(a)),
  },
  // ── Structure Analysis Tools ──
  {
    tool: toolByName('memory_structure_analyze'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleStructureAnalyze(a)),
  },
  {
    tool: toolByName('memory_vtable_parse'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleVtableParse(a)),
  },
  {
    tool: toolByName('memory_structure_export_c'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleStructureExportC(a)),
  },
  {
    tool: toolByName('memory_structure_compare'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleStructureCompare(a)),
  },
  // ── Breakpoint Tools (cross-platform via CrossPlatformBreakpointEngine) ──
  {
    tool: toolByName('memory_breakpoint'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleBreakpointDispatch(a)),
  },
  // ── Injection Tools ──
  {
    tool: toolByName('memory_patch_bytes'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handlePatchBytes(a)),
  },
  {
    tool: toolByName('memory_patch_nop'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handlePatchNop(a)),
  },
  {
    tool: toolByName('memory_patch_undo'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handlePatchUndo(a)),
  },
  {
    tool: toolByName('memory_code_caves'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleCodeCaves(a)),
  },
  // ── Code Injection Tools (Win32 only) ──
  {
    tool: toolByName('memory_allocate'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMemoryAllocate(a)),
  },
  {
    tool: toolByName('memory_free'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMemoryFree(a)),
  },
  {
    tool: toolByName('memory_inject_shellcode'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleInjectShellcode(a)),
  },
  {
    tool: toolByName('memory_inject_dll'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleInjectDll(a)),
  },
  // ── Control Tools ──
  {
    tool: toolByName('memory_write_value'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleWriteValue(a)),
  },
  {
    tool: toolByName('memory_batch_edit'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleBatchEdit(a)),
  },
  {
    tool: toolByName('memory_watch'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleWatch(a)),
  },
  {
    tool: toolByName('memory_freeze'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleFreezeDispatch(a)),
  },
  {
    tool: toolByName('memory_dump'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleDump(a)),
  },
  // ── Typed Read (koffi endian-sensitive decoding, cross-platform) ──
  {
    tool: toolByName('memory_read_typed'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleReadTyped(a)),
  },
  // ── Time Tools (Win32-only) ──
  {
    tool: toolByName('memory_speedhack'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleSpeedhackDispatch(a)),
  },
  // ── History Tools ──
  {
    tool: toolByName('memory_write_history'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleWriteHistoryDispatch(a)),
  },
  // ── Heap Analysis Tools (Win32-only) ──
  {
    tool: toolByName('memory_heap_enumerate'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleHeapEnumerate(a)),
  },
  {
    tool: toolByName('memory_heap_stats'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleHeapStats(a)),
  },
  {
    tool: toolByName('memory_heap_anomalies'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleHeapAnomalies(a)),
  },
  // ── PE / Module Introspection (Win32-only) ──
  {
    tool: toolByName('memory_pe_headers'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handlePEHeaders(a)),
  },
  {
    tool: toolByName('memory_pe_imports_exports'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handlePEImportsExports(a)),
  },
  {
    tool: toolByName('memory_inline_hook_detect'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleInlineHookDetect(a)),
  },
  // ── Anti-Cheat Detection (Win32-only) ──
  {
    tool: toolByName('memory_anticheat_detect'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleAntiCheatDetect(a)),
  },
  {
    tool: toolByName('memory_guard_pages'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleGuardPages(a)),
  },
  {
    tool: toolByName('memory_integrity_check'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleIntegrityCheck(a)),
  },
  // ── Region Enumeration (cross-platform) ──
  {
    tool: toolByName('memory_region_enumerate'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleRegionEnumerate(a)),
  },
  // ── AOB Scan (cross-platform) ──
  {
    tool: toolByName('memory_aob_scan'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleAobScan(a)),
  },
  // ── Find Accesses (cross-platform — uses hardware breakpoint engine) ──
  {
    tool: toolByName('memory_find_accesses'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleFindAccesses(a)),
  },
  // ── Cheat Table (.CT) Import/Export ──
  {
    tool: toolByName('memory_cheat_table'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleCheatTableDispatch(a)),
  },
  // ── AOB Signature Generation ──
  {
    tool: toolByName('memory_generate_signature'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleGenerateSignature(a)),
  },
  // ── RTTI Standalone Tool ──
  {
    tool: toolByName('memory_rtti_info'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleRttiInfo(a)),
  },
  // ── Minidump Parser (cross-platform, pure TS) ──
  {
    tool: toolByName('memory_parse_dump'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMemoryParseDump(a)),
  },
  // ── Mono / .NET Runtime Tools (Win32-only) ──
  {
    tool: toolByName('memory_mono_detect'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMonoDetect(a)),
  },
  {
    tool: toolByName('memory_mono_assemblies'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMonoAssemblies(a)),
  },
  {
    tool: toolByName('memory_mono_classes'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMonoClasses(a)),
  },
  {
    tool: toolByName('memory_mono_objects'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMonoObjects(a)),
  },
  {
    tool: toolByName('memory_mono_fields'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMonoFields(a)),
  },
  {
    tool: toolByName('memory_mono_methods'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMonoMethods(a)),
  },
  // ── Handle Enumeration (Win32-only) ──
  {
    tool: toolByName('memory_handle_enum'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleHandleEnum(a)),
  },
  // ── Memory Protection (cross-platform) ──
  {
    tool: toolByName('memory_protect'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleProtect(a)),
  },
  // ── Region Comparison (cross-platform) ──
  {
    tool: toolByName('memory_region_compare'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleRegionCompare(a)),
  },
  // ── Bookmarks (cross-platform) ──
  {
    tool: toolByName('memory_bookmark'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleBookmarkDispatch(a)),
  },
  // ── Type Define (cross-platform, pure TS) ──
  {
    tool: toolByName('memory_type_define'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleTypeDefine(a)),
  },
  // ── Emulator Detect (cross-platform, pure TS) ──
  {
    tool: toolByName('memory_emulator_detect'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleEmulatorDetect(a)),
  },
  // ── Custom Scan Types (CE parity) ──
  {
    tool: toolByName('memory_register_type'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleRegisterType(a)),
  },
  {
    tool: toolByName('memory_list_types'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleListTypes(a)),
  },
  {
    tool: toolByName('memory_unregister_type'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleUnregisterType(a)),
  },
  // ── Call Stack View (Win32-only) ──
  {
    tool: toolByName('memory_call_stack'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleCallStack(a)),
  },
  // ── Process Suspend / Resume (cross-platform) ──
  {
    tool: toolByName('memory_process_control'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleProcessControl(a)),
  },
  // ── Find References (x64dbg parity, cross-platform) ──
  {
    tool: toolByName('memory_find_references'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleFindReferences(a)),
  },
  // ── Reverse MWT (inverse of find_accesses, cross-platform) ──
  {
    tool: toolByName('memory_reverse_mwt'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleReverseMWT(a)),
  },
  // ── Code Trace (Ultimap-style, Win32-only) ──
  {
    tool: toolByName('memory_trace_code'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleTraceCode(a)),
  },
  // ── Pointer Map Persistence (.PTR parity) ──
  {
    tool: toolByName('memory_pointer_map'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handlePointerMap(a)),
  },
  // ── Inline Assembler (x64dbg parity) ──
  {
    tool: toolByName('memory_assemble'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleAssemble(a)),
  },
  // ── Auto Assembler (CE parity) ──
  {
    tool: toolByName('memory_auto_assemble'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleAutoAssemble(a)),
  },
  {
    tool: toolByName('memory_auto_assemble_disable'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleAutoAssembleDisable(a)),
  },
  // ── Remote Debugging Stub (ceserver-style) ──
  {
    tool: toolByName('memory_remote'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleRemote(a)),
  },
  // ── EPT Hypervisor ──
  {
    tool: toolByName('memory_hypervisor'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleHypervisor(a)),
  },
  // ── Anti-Detection ──
  {
    tool: toolByName('memory_antidetection'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleAntiDetection(a)),
  },
  // ── Anti-Detection Check (read-only pre-flight) ──
  {
    tool: toolByName('memory_antidetection_check'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleAntiDetectionCheck(a)),
  },
  // ── Session Export (structured data dump) ──
  {
    tool: toolByName('memory_session_export'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleSessionExportData(a)),
  },
  // ── Freeze Export (structured data dump) ──
  {
    tool: toolByName('memory_freeze_export'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleFreezeExport(a)),
  },
] as const;

// Filter: on non-Windows platforms, exclude Win32-only tools
const registrations = IS_WIN32
  ? allRegistrations
  : allRegistrations.filter((r) => !WIN32_ONLY_TOOLS.has(r.tool.name));

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  memory_allocate: ['allocate memory in the target', 'reserve a memory block'],
  memory_anticheat_detect: ['which anticheat is watching', 'detect the ac module'],
  memory_antidetection: ['hide my memory operations', 'anti ac concealment'],
  memory_antidetection_check: ['is my tooling visible', 'check concealment state'],
  memory_aob_scan: ['scan for this byte pattern', 'array of bytes search'],
  memory_assemble: ['assemble this instruction text', 'turn assembly into bytes'],
  memory_auto_assemble: ['run an auto assembler script', 'apply aa script'],
  memory_auto_assemble_disable: ['remove the aa script', 'undo auto assemble'],
  memory_batch_edit: ['edit many addresses at once', 'batch value changes'],
  memory_bookmark: ['bookmark this address', 'save the location for later'],
  memory_breakpoint: ['break on memory access', 'stop when this address is touched'],
  memory_call_stack: ['walk the stack of this thread', 'capture the call frames'],
  memory_cheat_table: ['export a cheat table', 'ct file with my entries'],
  memory_code_caves: ['find a code cave', 'empty space in the sections'],
  memory_dump: ['dump this memory range to file', 'save the region bytes'],
  memory_emulator_detect: ['is this an emulator environment', 'detect emulator artifacts'],
  memory_find_accesses: ['what reads this address', 'find code touching the value'],
  memory_find_references: ['what points to this address', 'find pointers to it'],
  memory_first_scan: ['first search for this value', 'initial exact scan'],
  memory_free: ['free the allocated block', 'release reserved memory'],
  memory_freeze: [
    'freeze this value in place',
    'lock the value constant',
    'keep this value pinned so it never changes',
    'pin a value at an address',
    'lock the value so it never changes',
    'freeze the value in memory',
  ],
  memory_freeze_export: ['export the frozen entries', 'save the freeze list'],
  memory_generate_signature: ['generate a scan signature', 'aob signature from this address'],
  memory_group_scan: ['scan for several values together', 'grouped value search'],
  memory_guard_pages: ['set guard pages on the region', 'protect with guard'],
  memory_handle_enum: ['enumerate open handles', 'list process handles'],
  memory_heap_anomalies: ['heap anomalies in the target', 'odd heap structures'],
  memory_heap_enumerate: ['walk the heap allocations', 'list heap blocks'],
  memory_heap_stats: ['heap usage numbers', 'heap totals'],
  memory_hypervisor: ['hypervisor backed operations', 'vt powered memory ops'],
  memory_inject_dll: ['inject a dll into the game', 'load my library in target'],
  memory_inject_shellcode: ['inject shellcode into the game', 'run my code in target'],
  memory_inline_hook_detect: ['detect inline hooks', 'patched prologue scan'],
  memory_integrity_check: ['check code integrity of sections', 'verify section hashes'],
  memory_list_types: ['registered custom types', 'list my type definitions'],
  memory_mono_assemblies: ['list mono assemblies in the game', 'unity assembly list'],
  memory_mono_classes: ['list mono classes in the assembly', 'unity class enumeration'],
  memory_mono_detect: ['is this a mono game', 'detect the unity runtime'],
  memory_mono_fields: ['fields of this mono class', 'unity field offsets'],
  memory_mono_methods: ['methods of this mono class', 'unity method list'],
  memory_mono_objects: ['find instances of this class', 'unity object instances'],
  memory_next_scan: ['narrow the scan results', 'next scan with the new value'],
  memory_parse_dump: ['parse the dumped region', 'read the dump structure'],
  memory_patch_bytes: ['patch these bytes in place', 'write instruction bytes'],
  memory_patch_nop: ['nop out this instruction', 'replace with nops'],
  memory_patch_undo: ['undo the last patch', 'restore original bytes'],
  memory_pe_headers: ['read the pe headers', 'section table of the module'],
  memory_pe_imports_exports: ['imports and exports of the module', 'pe iat eat'],
  memory_pointer_chain: ['walk this pointer chain', 'follow the multi level pointer'],
  memory_pointer_map: ['map the pointer paths', 'pointer relationships'],
  memory_pointer_scan: ['scan for pointers to this address', 'pointer search'],
  memory_process_control: ['suspend or resume from memory tool', 'control target execution'],
  memory_protect: ['change memory protection flags', 'set the guard bits'],
  memory_read_typed: ['read a typed value', 'read as int or float'],
  memory_region_compare: ['compare two memory regions', 'region byte delta'],
  memory_region_enumerate: ['list committed regions', 'enumerate readable ranges'],
  memory_register_type: ['register a custom type', 'define a new struct type'],
  memory_remote: ['operate on a remote target', 'remote memory session'],
  memory_reverse_mwt: ['reverse the write trace timing', 'mwt timing reversal'],
  memory_rtti_info: ['rtti class info of this object', 'read the vtable type'],
  memory_scan_session: ['saved scan sessions', 'list my scan history'],
  memory_search_string: ['search memory for this string', 'find text in memory'],
  memory_session_export: ['export the scan session', 'save scan state'],
  memory_speedhack: ['speed up the game time', 'adjust the game clock'],
  memory_structure_analyze: ['analyze this structure', 'field layout discovery'],
  memory_structure_compare: ['compare two structures', 'struct layout delta'],
  memory_structure_export_c: ['export the struct as c code', 'generate c header'],
  memory_trace_code: ['trace which code executes here', 'record execution at region'],
  memory_type_define: ['define a structure type', 'create a custom layout'],
  memory_unknown_scan: ['scan for unknown initial value', 'changed or unchanged scan'],
  memory_unregister_type: ['remove my custom type', 'delete the type definition'],
  memory_vtable_parse: ['parse the vtable entries', 'read the virtual table'],
  memory_watch: ['watch this address for changes', 'notify on value change'],
  memory_write_history: ['history of writes to this address', 'who wrote this value'],
  memory_write_value: ['write this value to the address', 'set the memory value'],
};

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,

  // Document-expansion keywords (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,

  workflowRule: {
    patterns: [
      /memory\s*scan/i,
      /cheat\s*engine/i,
      /find\s*(value|address|variable|struct)/i,
      /scan\s*(for|memory)/i,
      /aob\s*scan|signature\s*scan|byte\s*pattern/i,
      /region\s*(enum|list)/i,
      /pointer\s*(chain|scan)/i,
      /struct(ure)?\s*(analy|infer|dissect)/i,
      /vtable|rtti/i,
      /breakpoint|watchpoint|hardware\s*bp/i,
      /find\s*(what|access|write|read).*address/i,
      /MWT|memory\s*write\s*trace/i,
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
      /mono|il2cpp|unity|\.net\s*assembly|managed\s*heap/i,
      /Mono\s*(class|object|field|assembly|method|domain|runtime)/i,
    ],
    priority: 90,
    tools: [
      'memory_first_scan',
      'memory_next_scan',
      'memory_unknown_scan',
      'memory_aob_scan',
      'memory_region_enumerate',
      'memory_pointer_chain',
      'memory_structure_analyze',
      'memory_vtable_parse',
      'memory_scan_session',
      'memory_breakpoint',
      'memory_find_accesses',
      'memory_find_references',
      ...(IS_WIN32 ? ['memory_speedhack'] : []),
      'memory_patch_bytes',
      'memory_freeze',
      'memory_dump',
      ...(IS_WIN32
        ? [
            'memory_speedhack',
            'memory_heap_enumerate',
            'memory_pe_headers',
            'memory_anticheat_detect',
            'memory_mono_detect',
            'memory_mono_assemblies',
            'memory_mono_classes',
            'memory_mono_objects',
            'memory_mono_fields',
          ]
        : []),
      'memory_write_history',
      'memory_batch_edit',
      'memory_watch',
    ],
    hint: IS_WIN32
      ? 'Memory domain: scan → narrow → pointer chain → structure | breakpoint trace → patch/NOP → freeze ' +
        ' speedhack | heap analysis | PE introspection | anti-cheat detection | Mono/.NET runtime introspection'
      : 'Memory domain: scan → narrow → pointer chain → structure | breakpoint trace → patch/NOP → freeze | dump',
  },
};

export default manifest;
