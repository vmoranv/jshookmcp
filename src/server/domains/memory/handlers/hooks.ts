/**
 * HookHandlers — breakpoints (hardware) and code injection (patch/NOP/caves).
 */
import type { HardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import type { BreakpointAccess, BreakpointSize } from '@native/HardwareBreakpoint.types';
import type { CodeInjector } from '@native/CodeInjector';

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

export class HookHandlers {
  constructor(
    private readonly bpEngine: HardwareBreakpointEngine | null,
    private readonly injector: CodeInjector,
  ) {}

  // ── Breakpoint (hardware debug register) ──

  async handleBreakpointSet(args: Record<string, unknown>) {
    try {
      const config = await this.bpEngine!.setBreakpoint(
        args.pid as number,
        args.address as string,
        args.access as BreakpointAccess,
        (args.size as BreakpointSize) ?? 4,
      );
      return toTextResponse({
        success: true,
        ...config,
        hint: `Hardware breakpoint set on DR register. Use memory_breakpoint_trace to collect hits.`,
      });
    } catch (error) {
      return toErrorResponse('memory_breakpoint_set', error);
    }
  }

  async handleBreakpointRemove(args: Record<string, unknown>) {
    try {
      return toTextResponse({
        success: true,
        removed: await this.bpEngine!.removeBreakpoint(args.breakpointId as string),
      });
    } catch (error) {
      return toErrorResponse('memory_breakpoint_remove', error);
    }
  }

  async handleBreakpointList(_args: Record<string, unknown>) {
    try {
      const bps = this.bpEngine!.listBreakpoints();
      return toTextResponse({ success: true, breakpoints: bps, count: bps.length });
    } catch (error) {
      return toErrorResponse('memory_breakpoint_list', error);
    }
  }

  async handleBreakpointTrace(args: Record<string, unknown>) {
    try {
      const hits = await this.bpEngine!.traceAccess(
        args.pid as number,
        args.address as string,
        args.access as BreakpointAccess,
        args.maxHits as number | undefined,
        args.timeoutMs as number | undefined,
      );
      return toTextResponse({
        success: true,
        hits,
        hitCount: hits.length,
        hint:
          hits.length > 0
            ? `${hits.length} accesses captured. Check instructionAddress to find the code accessing this address.`
            : 'No hits captured within timeout.',
      });
    } catch (error) {
      return toErrorResponse('memory_breakpoint_trace', error);
    }
  }

  // ── Code injection (patch/NOP/caves) ──

  async handlePatchBytes(args: Record<string, unknown>) {
    try {
      const patch = await this.injector.patchBytes(
        args.pid as number,
        args.address as string,
        args.bytes as number[],
      );
      return toTextResponse({
        success: true,
        ...patch,
        hint: `Patch applied. Use memory_patch_undo with patchId "${patch.id}" to restore.`,
      });
    } catch (error) {
      return toErrorResponse('memory_patch_bytes', error);
    }
  }

  async handlePatchNop(args: Record<string, unknown>) {
    try {
      const patch = await this.injector.nopBytes(
        args.pid as number,
        args.address as string,
        args.count as number,
      );
      return toTextResponse({
        success: true,
        ...patch,
        hint: `${args.count} bytes NOP'd. Use memory_patch_undo to restore.`,
      });
    } catch (error) {
      return toErrorResponse('memory_patch_nop', error);
    }
  }

  async handlePatchUndo(args: Record<string, unknown>) {
    try {
      return toTextResponse({
        success: true,
        restored: await this.injector.unpatch(args.patchId as string),
      });
    } catch (error) {
      return toErrorResponse('memory_patch_undo', error);
    }
  }

  async handleCodeCaves(args: Record<string, unknown>) {
    try {
      const caves = await this.injector.findCodeCaves(
        args.pid as number,
        args.minSize as number | undefined,
      );
      return toTextResponse({ success: true, caves, count: caves.length });
    } catch (error) {
      return toErrorResponse('memory_code_caves', error);
    }
  }
}
