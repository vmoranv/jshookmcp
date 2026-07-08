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

const DOMAIN = 'memory' as const;
const DEP_KEY = 'memoryScanHandlers' as const;
const EFFECTIVE_PLATFORM =
  process.env.JSHOOK_REGISTRY_PLATFORM === 'win32' ||
  process.env.JSHOOK_REGISTRY_PLATFORM === 'linux' ||
  process.env.JSHOOK_REGISTRY_PLATFORM === 'darwin'
    ? process.env.JSHOOK_REGISTRY_PLATFORM
    : process.platform;
const IS_WIN32 = EFFECTIVE_PLATFORM === 'win32';
type H = MemoryScanHandlers;

let globalContext: MCPServerContext | null = null;
let globalProcessManager: UnifiedProcessManager | null = null;

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { MemoryScanHandlers } = await import('./handlers.impl');
  globalContext = ctx;
  const ctxAny = ctx as unknown as Record<string, unknown>;
  if (ctxAny[DEP_KEY]) return ctxAny[DEP_KEY] as H;

  // Dynamic imports: load native koffi modules AND handler lazily — only when memory domain is accessed.
  // Cross-platform modules (always loaded)
  const [
    memoryScanner,
    scanSessionManager,
    pointerChainEngine,
    structureAnalyzer,
    codeInjector,
    memoryController,
    heapAnalyzerMod,
  ] = await Promise.all([
    import('@native/MemoryScanner'),
    import('@native/MemoryScanSession'),
    import('@native/PointerChainEngine'),
    import('@native/StructureAnalyzer'),
    import('@native/CodeInjector'),
    import('@native/MemoryController'),
    import('@native/HeapAnalyzer'),
  ]);
  if (!globalProcessManager) {
    globalProcessManager = new UnifiedProcessManager();
  }

  if (IS_WIN32) {
    // Lazy-load Win32-only engines — only load on Windows
    const [hardwareBreakpointEngine, speedhack, peAnalyzer, antiCheatDetector] = await Promise.all([
      import('@native/HardwareBreakpoint'),
      import('@native/Speedhack'),
      import('@native/PEAnalyzer'),
      import('@native/AntiCheatDetector'),
    ]);

    ctxAny[DEP_KEY] = new MemoryScanHandlers(
      memoryScanner.memoryScanner,
      scanSessionManager.scanSessionManager,
      pointerChainEngine.pointerChainEngine,
      structureAnalyzer.structureAnalyzer,
      hardwareBreakpointEngine.hardwareBreakpointEngine,
      codeInjector.codeInjector,
      memoryController.memoryController,
      speedhack.speedhack,
      heapAnalyzerMod.heapAnalyzer,
      peAnalyzer.peAnalyzer,
      antiCheatDetector.antiCheatDetector,
      ctx.eventBus,
      globalProcessManager,
      ctx,
    );
  } else {
    // macOS/Linux: Win32-only engines not available — pass null.
    // heapAnalyzer is always wired (cross-platform region-based fallback).
    ctxAny[DEP_KEY] = new MemoryScanHandlers(
      memoryScanner.memoryScanner,
      scanSessionManager.scanSessionManager,
      pointerChainEngine.pointerChainEngine,
      structureAnalyzer.structureAnalyzer,
      null, // hardwareBreakpointEngine — Win32 DR0-DR3 only; cross-platform ptrace/mach_vm_protect parity pending (research/memory.md #3)
      codeInjector.codeInjector,
      memoryController.memoryController,
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
    return (args: Record<string, unknown>) => {
      const meta = args._meta as { progressToken?: string | number } | undefined;
      let onProgress: ((progress: number, total?: number) => void) | undefined;

      if (meta?.progressToken !== undefined && globalContext) {
        onProgress = createProgressDebouncer(globalContext.eventBus, meta.progressToken);
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
  // Hardware breakpoints (debug registers) — Win32 DR0-DR3 only. Cross-platform parity
  // (Linux ptrace INT3 + SIGTRAP; macOS mach_vm_protect + EXC_BAD_ACCESS) pending —
  // see research/memory.md #3. find_accesses also needs process_vm_readv/mach_vm_read.
  'memory_breakpoint',
  'memory_find_accesses',
  // Speedhack (Win32 timer hooking — LD_PRELOAD parity pending — E5-D)
  'memory_speedhack',
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
  // ── Breakpoint Tools (Win32-only) ──
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
  // ── Control Tools ──
  {
    tool: toolByName('memory_write_value'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleWriteValue(a)),
  },
  {
    tool: toolByName('memory_freeze'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleFreezeDispatch(a)),
  },
  { tool: toolByName('memory_dump'), domain: DOMAIN, bind: bindByKey((h, a) => h.handleDump(a)) },
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
  // ── Find Accesses (Win32-only, uses hardware breakpoints) ──
  {
    tool: toolByName('memory_find_accesses'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleFindAccesses(a)),
  },
  // ── Minidump Parser (cross-platform, pure TS) ──
  {
    tool: toolByName('memory_parse_dump'),
    domain: DOMAIN,
    bind: bindByKey((h, a) => h.handleMemoryParseDump(a)),
  },
] as const;

// Filter: on non-Windows platforms, exclude Win32-only tools
const registrations = IS_WIN32
  ? allRegistrations
  : allRegistrations.filter((r) => !WIN32_ONLY_TOOLS.has(r.tool.name));

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,
  registrations,
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
      ...(IS_WIN32 ? ['memory_breakpoint', 'memory_find_accesses', 'memory_speedhack'] : []),
      'memory_patch_bytes',
      'memory_freeze',
      'memory_dump',
      ...(IS_WIN32
        ? [
            'memory_speedhack',
            'memory_heap_enumerate',
            'memory_pe_headers',
            'memory_anticheat_detect',
          ]
        : []),
      'memory_write_history',
    ],
    hint: IS_WIN32
      ? 'Memory domain: scan → narrow → pointer chain → structure | breakpoint trace → patch/NOP → freeze ' +
        ' speedhack | heap analysis | PE introspection | anti-cheat detection'
      : 'Memory domain: scan → narrow → pointer chain → structure | patch/NOP → freeze | dump',
  },
};

export default manifest;
