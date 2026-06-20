import type { HeapAnalyzer } from '@native/HeapAnalyzer';
import type { PEAnalyzer } from '@native/PEAnalyzer';
import type { AntiCheatDetector } from '@native/AntiCheatDetector';
import type { Speedhack } from '@native/Speedhack';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argNumber, argString } from '@server/domains/shared/parse-args';
import { requirePositiveNumberArg, validateHexAddress } from './validation';

const TOOL_SPEEDHACK = 'memory_speedhack';
const TOOL_GUARD_PAGES = 'memory_guard_pages';
const TOOL_INTEGRITY_CHECK = 'memory_integrity_check';

const PE_TABLE_OPTIONS = new Set<'imports' | 'exports' | 'both'>(['imports', 'exports', 'both']);

export class IntegrityHandlers {
  constructor(
    private readonly speedhackEngine: Speedhack | null,
    private readonly heapAnalyzer: HeapAnalyzer | null,
    private readonly peAnalyzer: PEAnalyzer | null,
    private readonly antiCheatDetector: AntiCheatDetector | null,
    private readonly processManager?: UnifiedProcessManager,
    private readonly ctx?: MCPServerContext,
  ) {}

  private async resolvePid(value: unknown): Promise<number> {
    if (!this.processManager) {
      return value as number;
    }
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handleSpeedhackApply(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.speedhackEngine) {
        throw new Error(
          'Speedhack tools (memory_speedhack) are only supported on Windows. ' +
            'This tool requires Win32 timer manipulation APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const speed = requirePositiveNumberArg(args.speed, 'speed', TOOL_SPEEDHACK);
      const result = await this.speedhackEngine.apply(pid, speed);
      return {
        ...result,
        hint: `Speedhack active (${speed}x). Use memory_speedhack({ action: 'set' }) to adjust.`,
      };
    });
  }

  async handleSpeedhackSet(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.speedhackEngine) {
        throw new Error(
          'Speedhack tools (memory_speedhack) are only supported on Windows. ' +
            'This tool requires Win32 timer manipulation APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const speed = requirePositiveNumberArg(args.speed, 'speed', TOOL_SPEEDHACK);
      return {
        updated: await this.speedhackEngine.setSpeed(pid, speed),
        newSpeed: speed,
      };
    });
  }

  async handleHeapEnumerate(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.heapAnalyzer) {
        throw new Error(
          'Heap analysis tools (memory_heap_*) are only supported on Windows. ' +
            'This tool requires Win32 Toolhelp32 heap enumeration APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const result = await this.heapAnalyzer.enumerateHeaps(pid);
      return {
        ...result,
        hint: `Enumerated ${result.heaps.length} heaps. Use memory_heap_stats for statistics or memory_heap_anomalies to check for issues.`,
      };
    });
  }

  async handleHeapStats(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.heapAnalyzer) {
        throw new Error(
          'Heap analysis tools (memory_heap_*) are only supported on Windows. ' +
            'This tool requires Win32 Toolhelp32 heap enumeration APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      return { ...(await this.heapAnalyzer.getStats(pid)) };
    });
  }

  async handleHeapAnomalies(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.heapAnalyzer) {
        throw new Error(
          'Heap analysis tools (memory_heap_*) are only supported on Windows. ' +
            'This tool requires Win32 Toolhelp32 heap enumeration APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const anomalies = await this.heapAnalyzer.detectAnomalies(pid);
      return {
        anomalies,
        count: anomalies.length,
        hint:
          anomalies.length > 0
            ? `Found ${anomalies.length} anomalies — inspect types for spray, UAF, or suspicious patterns.`
            : 'No heap anomalies detected.',
      };
    });
  }

  async handlePEHeaders(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.peAnalyzer) {
        throw new Error(
          'PE analysis tools (memory_pe_*) are only supported on Windows. ' +
            'This tool requires Win32 PE format introspection.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const moduleBase = validateHexAddress(args.moduleBase, 'moduleBase');
      return { ...(await this.peAnalyzer.parseHeaders(pid, moduleBase)) };
    });
  }

  async handlePEImportsExports(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.peAnalyzer) {
        throw new Error(
          'PE analysis tools (memory_pe_*) are only supported on Windows. ' +
            'This tool requires Win32 PE format introspection.',
        );
      }
      const table = argEnum(args, 'table', PE_TABLE_OPTIONS, 'both');
      const base = validateHexAddress(args.moduleBase, 'moduleBase');
      const pid = await this.resolvePid(args.pid);
      const result: Record<string, unknown> = {};
      if (table === 'imports' || table === 'both') {
        result.imports = await this.peAnalyzer.parseImports(pid, base);
      }
      if (table === 'exports' || table === 'both') {
        result.exports = await this.peAnalyzer.parseExports(pid, base);
      }
      return result;
    });
  }

  async handleInlineHookDetect(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.peAnalyzer) {
        throw new Error(
          'Inline hook detection (memory_inline_hook_detect) is only supported on Windows. ' +
            'This tool requires Win32 PE format introspection.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const moduleName = argString(args, 'moduleName');
      const hooks = await this.peAnalyzer.detectInlineHooks(pid, moduleName);
      return {
        hooks,
        count: hooks.length,
        hint:
          hooks.length > 0
            ? `Detected ${hooks.length} inline hooks — check hookType and jumpTarget for each.`
            : 'No inline hooks detected — exports match disk bytes.',
      };
    });
  }

  async handleAntiCheatDetect(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.antiCheatDetector) {
        throw new Error(
          'Anti-cheat detection tools (memory_anticheat_*, memory_guard_pages, memory_integrity_check) are only supported on Windows. ' +
            'These tools require Win32 process introspection APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const detections = await this.antiCheatDetector.detect(pid);
      return {
        detections,
        count: detections.length,
        hint:
          detections.length > 0
            ? `Found ${detections.length} anti-debug mechanisms. Each includes a bypassSuggestion.`
            : 'No anti-debug mechanisms detected in imports.',
      };
    });
  }

  async handleGuardPages(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.antiCheatDetector) {
        throw new Error(
          'Anti-cheat detection tools (memory_anticheat_*, memory_guard_pages, memory_integrity_check) are only supported on Windows. ' +
            'These tools require Win32 process introspection APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const maxRegions = argNumber(args, 'maxRegions', 10000);
      if (!Number.isFinite(maxRegions) || maxRegions <= 0) {
        throw new Error(
          `${TOOL_GUARD_PAGES}: argument "maxRegions" must be a positive number, got: ${JSON.stringify(args.maxRegions)}`,
        );
      }
      const result = await this.antiCheatDetector.scanGuardPages(pid);
      const { guardPages, stats } = result;

      // Truncate results if exceeding maxRegions
      const truncated = guardPages.length > maxRegions;
      const filteredPages = truncated ? guardPages.slice(0, maxRegions) : guardPages;

      return {
        guardPages: filteredPages,
        count: filteredPages.length,
        scan: stats,
        truncated: truncated || stats.truncated,
        hint:
          truncated || stats.truncated
            ? `Scan stopped after ${truncated ? maxRegions : stats.scannedRegions} regions${truncated ? ' (maxRegions limit)' : ''} in ${stats.durationMs}ms to avoid hanging. Results may be partial.`
            : guardPages.length > 0
              ? `Found ${guardPages.length} guard page regions — these may indicate anti-tampering.`
              : 'No guard pages found.',
      };
    });
  }

  async handleIntegrityCheck(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.antiCheatDetector) {
        throw new Error(
          'Anti-cheat detection tools (memory_anticheat_*, memory_guard_pages, memory_integrity_check) are only supported on Windows. ' +
            'These tools require Win32 process introspection APIs.',
        );
      }
      const pid = await this.resolvePid(args.pid);
      const maxSections = argNumber(args, 'maxSections', 100);
      if (!Number.isFinite(maxSections) || maxSections <= 0) {
        throw new Error(
          `${TOOL_INTEGRITY_CHECK}: argument "maxSections" must be a positive number, got: ${JSON.stringify(args.maxSections)}`,
        );
      }
      const moduleName = argString(args, 'moduleName');
      const result = await this.antiCheatDetector.scanIntegrity(pid, moduleName);
      const { sections, stats } = result;

      // Truncate results if exceeding maxSections
      const truncated = sections.length > maxSections;
      const filteredSections = truncated ? sections.slice(0, maxSections) : sections;
      const filteredModified = filteredSections.filter((r) => r.isModified);

      return {
        sections: filteredSections,
        totalChecked: filteredSections.length,
        modifiedCount: filteredModified.length,
        scan: stats,
        truncated: truncated || stats.truncated,
        hint:
          truncated || stats.truncated
            ? `Checked ${stats.scannedSections} executable section(s)${truncated ? ` (maxSections limit: ${maxSections})` : ''} across ${stats.scannedModules} module(s) before hitting safety limits. Results may be partial.`
            : filteredModified.length > 0
              ? `${filteredModified.length} section(s) modified — code may have been patched or hooked.`
              : 'All checked sections match disk — no runtime modifications detected.',
      };
    });
  }
}
