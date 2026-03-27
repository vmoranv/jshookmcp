/**
 * IntegrityHandlers — PE module introspection and anti-cheat/anti-debug detection.
 */
import type { HeapAnalyzer } from '@native/HeapAnalyzer';
import type { PEAnalyzer } from '@native/PEAnalyzer';
import type { AntiCheatDetector } from '@native/AntiCheatDetector';
import type { Speedhack } from '@native/Speedhack';

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

export class IntegrityHandlers {
  constructor(
    private readonly speedhackEngine: Speedhack | null,
    private readonly heapAnalyzer: HeapAnalyzer | null,
    private readonly peAnalyzer: PEAnalyzer | null,
    private readonly antiCheatDetector: AntiCheatDetector | null,
  ) {}

  // ── Speedhack (Win32 timer hooking) ──

  async handleSpeedhackApply(args: Record<string, unknown>) {
    try {
      const result = await this.speedhackEngine!.apply(args.pid as number, args.speed as number);
      return toTextResponse({
        ...result,
        success: true,
        hint: `Speedhack active (${args.speed}x). Use memory_speedhack_set to adjust.`,
      });
    } catch (error) {
      return toErrorResponse('memory_speedhack_apply', error);
    }
  }

  async handleSpeedhackSet(args: Record<string, unknown>) {
    try {
      return toTextResponse({
        success: true,
        updated: await this.speedhackEngine!.setSpeed(args.pid as number, args.speed as number),
        newSpeed: args.speed,
      });
    } catch (error) {
      return toErrorResponse('memory_speedhack_set', error);
    }
  }

  // ── Heap analysis (Win32 Toolhelp32) ──

  async handleHeapEnumerate(args: Record<string, unknown>) {
    try {
      const result = await this.heapAnalyzer!.enumerateHeaps(args.pid as number);
      return toTextResponse({
        success: true,
        ...result,
        hint: `Enumerated ${result.heaps.length} heaps. Use memory_heap_stats for statistics or memory_heap_anomalies to check for issues.`,
      });
    } catch (error) {
      return toErrorResponse('memory_heap_enumerate', error);
    }
  }

  async handleHeapStats(args: Record<string, unknown>) {
    try {
      const stats = await this.heapAnalyzer!.getStats(args.pid as number);
      return toTextResponse({ success: true, ...stats });
    } catch (error) {
      return toErrorResponse('memory_heap_stats', error);
    }
  }

  async handleHeapAnomalies(args: Record<string, unknown>) {
    try {
      const anomalies = await this.heapAnalyzer!.detectAnomalies(args.pid as number);
      return toTextResponse({
        success: true,
        anomalies,
        count: anomalies.length,
        hint:
          anomalies.length > 0
            ? `Found ${anomalies.length} anomalies — inspect types for spray, UAF, or suspicious patterns.`
            : 'No heap anomalies detected.',
      });
    } catch (error) {
      return toErrorResponse('memory_heap_anomalies', error);
    }
  }

  // ── PE / Module introspection ──

  async handlePEHeaders(args: Record<string, unknown>) {
    try {
      const headers = await this.peAnalyzer!.parseHeaders(
        args.pid as number,
        args.moduleBase as string,
      );
      return toTextResponse({ success: true, ...headers });
    } catch (error) {
      return toErrorResponse('memory_pe_headers', error);
    }
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
    } catch (error) {
      return toErrorResponse('memory_pe_imports_exports', error);
    }
  }

  async handleInlineHookDetect(args: Record<string, unknown>) {
    try {
      const hooks = await this.peAnalyzer!.detectInlineHooks(
        args.pid as number,
        args.moduleName as string | undefined,
      );
      return toTextResponse({
        success: true,
        hooks,
        count: hooks.length,
        hint:
          hooks.length > 0
            ? `Detected ${hooks.length} inline hooks — check hookType and jumpTarget for each.`
            : 'No inline hooks detected — exports match disk bytes.',
      });
    } catch (error) {
      return toErrorResponse('memory_inline_hook_detect', error);
    }
  }

  // ── Anti-cheat / Anti-debug ──

  async handleAntiCheatDetect(args: Record<string, unknown>) {
    try {
      const detections = await this.antiCheatDetector!.detect(args.pid as number);
      return toTextResponse({
        success: true,
        detections,
        count: detections.length,
        hint:
          detections.length > 0
            ? `Found ${detections.length} anti-debug mechanisms. Each includes a bypassSuggestion.`
            : 'No anti-debug mechanisms detected in imports.',
      });
    } catch (error) {
      return toErrorResponse('memory_anticheat_detect', error);
    }
  }

  async handleGuardPages(args: Record<string, unknown>) {
    try {
      const pages = await this.antiCheatDetector!.findGuardPages(args.pid as number);
      return toTextResponse({
        success: true,
        guardPages: pages,
        count: pages.length,
        hint:
          pages.length > 0
            ? `Found ${pages.length} guard page regions — these may indicate anti-tampering.`
            : 'No guard pages found.',
      });
    } catch (error) {
      return toErrorResponse('memory_guard_pages', error);
    }
  }

  async handleIntegrityCheck(args: Record<string, unknown>) {
    try {
      const results = await this.antiCheatDetector!.checkIntegrity(
        args.pid as number,
        args.moduleName as string | undefined,
      );
      const modified = results.filter((r) => r.isModified);
      return toTextResponse({
        success: true,
        sections: results,
        totalChecked: results.length,
        modifiedCount: modified.length,
        hint:
          modified.length > 0
            ? `${modified.length} section(s) modified — code may have been patched or hooked.`
            : 'All checked sections match disk — no runtime modifications detected.',
      });
    } catch (error) {
      return toErrorResponse('memory_integrity_check', error);
    }
  }
}
