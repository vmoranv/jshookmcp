import type { HardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import type { BreakpointAccess, BreakpointSize } from '@native/HardwareBreakpoint.types';
import type { CodeInjector } from '@native/CodeInjector';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argNumber } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import {
  requirePositiveIntArg,
  requireStringArg,
  validateBytesArray,
  validateHexAddress,
} from './validation';

const TOOL_BREAKPOINT = 'memory_breakpoint';
const TOOL_PATCH_NOP = 'memory_patch_nop';
const TOOL_PATCH_UNDO = 'memory_patch_undo';
const TOOL_CODE_CAVES = 'memory_code_caves';

const BREAKPOINT_ACCESS = new Set<BreakpointAccess>(['read', 'write', 'readwrite', 'execute']);
const BREAKPOINT_SIZES = new Set<BreakpointSize>([1, 2, 4, 8] as unknown as BreakpointSize[]);

const WIN32_UNSUPPORTED_MSG =
  'Hardware breakpoint tools (memory_breakpoint) are only supported on Windows. ' +
  'This tool requires Win32 debug register APIs.';

export class HookHandlers {
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    private readonly bpEngine: HardwareBreakpointEngine | null,
    private readonly injector: CodeInjector,
    private readonly processManager?: UnifiedProcessManager,
    private readonly ctx?: MCPServerContext,
    auditTrail?: MemoryAuditTrail | null,
  ) {
    this.auditTrail = auditTrail ?? null;
  }

  private async resolvePid(value: unknown): Promise<number> {
    if (!this.processManager) {
      return value as number;
    }
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  private recordAudit(entry: {
    operation: string;
    pid: number | null;
    address: string | null;
    size: number | null;
    result: 'success' | 'failure';
    error?: string;
    durationMs: number;
  }): void {
    if (!this.auditTrail) return;
    try {
      this.auditTrail.record(entry);
    } catch (auditError) {
      logger.warn('Memory audit trail recording failed:', auditError);
    }
  }

  async handleBreakpointSet(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.bpEngine) {
        throw new Error(WIN32_UNSUPPORTED_MSG);
      }
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const access = argEnum(args, 'access', BREAKPOINT_ACCESS);
      if (!access) {
        throw new Error(
          `${TOOL_BREAKPOINT}: missing or invalid required argument "access" (expected one of: ${[...BREAKPOINT_ACCESS].join(', ')}), got: ${JSON.stringify(args.access)}`,
        );
      }
      const sizeArg = argNumber(args, 'size', 4);
      const size = (
        BREAKPOINT_SIZES.has(sizeArg as unknown as BreakpointSize) ? sizeArg : 4
      ) as BreakpointSize;
      const config = await this.bpEngine.setBreakpoint(pid, address, access, size);
      return {
        ...config,
        hint: "Hardware breakpoint set on DR register. Use memory_breakpoint with action='trace' to collect hits.",
      };
    });
  }

  async handleBreakpointRemove(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.bpEngine) {
        throw new Error(WIN32_UNSUPPORTED_MSG);
      }
      const breakpointId = requireStringArg(args.breakpointId, 'breakpointId', TOOL_BREAKPOINT);
      return { removed: await this.bpEngine.removeBreakpoint(breakpointId) };
    });
  }

  async handleBreakpointList(_args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.bpEngine) {
        throw new Error(WIN32_UNSUPPORTED_MSG);
      }
      const bps = this.bpEngine.listBreakpoints();
      return { breakpoints: bps, count: bps.length };
    });
  }

  async handleBreakpointTrace(args: Record<string, unknown>) {
    return handleSafe(async () => {
      if (!this.bpEngine) {
        throw new Error(WIN32_UNSUPPORTED_MSG);
      }
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const access = argEnum(args, 'access', BREAKPOINT_ACCESS);
      if (!access) {
        throw new Error(
          `${TOOL_BREAKPOINT}: missing or invalid required argument "access" (expected one of: ${[...BREAKPOINT_ACCESS].join(', ')}), got: ${JSON.stringify(args.access)}`,
        );
      }
      const maxHits = argNumber(args, 'maxHits');
      const timeoutMs = argNumber(args, 'timeoutMs');
      const hits = await this.bpEngine.traceAccess(pid, address, access, maxHits, timeoutMs);
      return {
        hits,
        hitCount: hits.length,
        hint:
          hits.length > 0
            ? `${hits.length} accesses captured. Check instructionAddress to find the code accessing this address.`
            : 'No hits captured within timeout.',
      };
    });
  }

  async handlePatchBytes(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const bytes = validateBytesArray(args.bytes, 'bytes');
      const start = Date.now();
      try {
        const patch = await this.injector.patchBytes(pid, address, bytes);
        this.recordAudit({
          operation: 'patch_bytes',
          pid,
          address,
          size: bytes.length,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          ...patch,
          hint: `Patch applied. Use memory_patch_undo with patchId "${patch.id}" to restore.`,
        };
      } catch (e) {
        this.recordAudit({
          operation: 'patch_bytes',
          pid,
          address,
          size: bytes.length,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handlePatchNop(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const count = requirePositiveIntArg(args.count, 'count', TOOL_PATCH_NOP);
      const start = Date.now();
      try {
        const patch = await this.injector.nopBytes(pid, address, count);
        this.recordAudit({
          operation: 'patch_nop',
          pid,
          address,
          size: count,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          ...patch,
          hint: `${count} bytes NOP'd. Use memory_patch_undo to restore.`,
        };
      } catch (e) {
        this.recordAudit({
          operation: 'patch_nop',
          pid,
          address,
          size: count,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handlePatchUndo(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const patchId = requireStringArg(args.patchId, 'patchId', TOOL_PATCH_UNDO);
      const start = Date.now();
      try {
        const restored = await this.injector.unpatch(patchId);
        this.recordAudit({
          operation: 'patch_undo',
          pid: null,
          address: null,
          size: null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return { restored };
      } catch (e) {
        this.recordAudit({
          operation: 'patch_undo',
          pid: null,
          address: null,
          size: null,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleCodeCaves(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const minSize = argNumber(args, 'minSize');
      if (minSize !== undefined && (!Number.isFinite(minSize) || minSize <= 0)) {
        throw new Error(
          `${TOOL_CODE_CAVES}: argument "minSize" must be a positive number, got: ${JSON.stringify(args.minSize)}`,
        );
      }
      const caves = await this.injector.findCodeCaves(pid, minSize);
      return { caves, count: caves.length };
    });
  }
}
