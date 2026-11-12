import type { SoftwareBreakpointEngine } from '@native/SoftwareBreakpoint';
import type { VehDebuggerEngine } from '@native/VehDebugger';
import type {
  BreakpointAccess,
  BreakpointEngine as PlatformBreakpointEngine,
  BreakpointListEntry,
  BreakpointSize,
} from '@native/HardwareBreakpoint.types';
import type { CodeInjector } from '@native/CodeInjector';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argNumber, argString } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { readEnvString } from '@src/config/environment';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import {
  requirePositiveIntArg,
  requireStringArg,
  validateBytesArray,
  validateHexAddress,
} from './validation';

/** Lazy-load ConditionEvaluator (avoids Node require path-alias issues). */
let conditionEvaluatorCache: Awaited<typeof import('@native/ConditionEvaluator')> | null = null;

async function getConditionEvaluator() {
  if (!conditionEvaluatorCache) {
    conditionEvaluatorCache = await import('@native/ConditionEvaluator');
  }
  return conditionEvaluatorCache;
}

const TOOL_BREAKPOINT = 'memory_breakpoint';
const TOOL_PATCH_NOP = 'memory_patch_nop';
const TOOL_PATCH_UNDO = 'memory_patch_undo';
const TOOL_CODE_CAVES = 'memory_code_caves';
const TOOL_ALLOCATE = 'memory_allocate';
const TOOL_INJECT_SHELLCODE = 'memory_inject_shellcode';
const TOOL_INJECT_DLL = 'memory_inject_dll';
const TOOL_CALL_STACK = 'memory_call_stack';
const TOOL_PROCESS_CONTROL = 'memory_process_control';

const INJECTION_ENV_GATE = 'JSHOOK_INJECTION_ENABLE';

function assertInjectionEnabled(): void {
  if (readEnvString(INJECTION_ENV_GATE, '') !== '1') {
    throw new Error(
      `Code injection tools require ${INJECTION_ENV_GATE}=1 environment variable. ` +
        `Set this to enable memory_allocate, memory_free, memory_inject_shellcode, and memory_inject_dll.`,
    );
  }
}

/** x64 exposes only 4 hardware debug registers (DR0-DR3). */
const HW_BREAKPOINT_MAX = 4;
/** Hardware DR registers support at most 8 bytes per watchpoint (x64). */
const HW_BREAKPOINT_MAX_SIZE = 8; /** NOP patches beyond this size are likely mistakes — reject to avoid zeroing
 * large executable ranges. Use memory_patch_bytes for intentional large writes. */
const PATCH_NOP_MAX_COUNT = 1024;

const BREAKPOINT_ACCESS = new Set<BreakpointAccess>(['read', 'write', 'readwrite', 'execute']);
const BREAKPOINT_SIZES = new Set<BreakpointSize>([1, 2, 4, 8] as unknown as BreakpointSize[]);

/** Parse a hex address string to a numeric value (e.g. "0x7FF6" -> 0x7FF6). */
function parseHexAddr(addr: string): number {
  return parseInt(addr.replace(/^0x/i, ''), 16);
}

/**
 * Detect collision between a new breakpoint address range and existing BPs.
 *
 * Returns the first conflicting breakpoint if any overlap is detected.
 * Software BPs do not collide (unlimited count); only hardware BPs are checked.
 * Overlap is defined as any address-range intersection: [addr1, addr1+size1)
 * overlaps [addr2, addr2+size2) when addr1 < addr2+size2 AND addr2 < addr1+size1.
 */
function detectBreakpointCollision(
  address: string,
  size: number,
  existingBPs: BreakpointListEntry[],
): BreakpointListEntry | null {
  const addrNum = parseHexAddr(address);
  const rangeEnd = addrNum + size;
  for (const bp of existingBPs) {
    const bpAddr = parseHexAddr(bp.address);
    const bpEnd = bpAddr + bp.size;
    if (addrNum < bpEnd && rangeEnd > bpAddr) {
      return bp;
    }
  }
  return null;
}

/**
 * Build a suggestion for splitting an oversized watchpoint into ≤8-byte segments.
 * Returns human-readable guidance with segment count and register-availability check.
 */
function suggestWatchpointSplit(address: string, size: number, activeCount: number): string {
  const segments = Math.ceil(size / 8);
  const remaining = HW_BREAKPOINT_MAX - activeCount;
  const addrNum = parseHexAddr(address);
  const parts: string[] = [];
  let offset = 0;
  for (let i = 0; i < segments && i < remaining; i++) {
    const segSize = Math.min(8, size - offset);
    parts.push(
      `  #${i + 1}: 0x${(addrNum + offset).toString(16).toUpperCase()} (${segSize} bytes)`,
    );
    offset += segSize;
  }
  const warning =
    segments > remaining
      ? ` Only ${remaining} of ${segments} segments fit in available DR registers; free ${segments - remaining} register(s) first.`
      : '';
  return (
    `Hardware watchpoints are limited to ${HW_BREAKPOINT_MAX_SIZE} bytes each (x64 DR registers). ` +
    `To watch ${size} bytes at ${address}, split into ${segments} separate breakpoints:${warning}\n` +
    parts.join('\n')
  );
}

const WIN32_UNSUPPORTED_MSG =
  'Hardware breakpoint tools (memory_breakpoint) are only supported on Windows. ' +
  'This tool requires Win32 debug register APIs.';

const VEH_UNSUPPORTED_MSG =
  'VEH debugger mode is only supported on Windows and requires the VEH debugger engine. ' +
  'Use debuggerMode="win32" or ensure the VEH engine is available.';

type DebuggerBackend = 'win32' | 'veh';
type BreakpointType = 'hardware' | 'software';

/** Union type for engines that support the breakpoint lifecycle interface. */
type BreakpointEngine = PlatformBreakpointEngine | SoftwareBreakpointEngine | VehDebuggerEngine;

export class HookHandlers {
  private readonly bpEngine: PlatformBreakpointEngine | null;
  private readonly vehEngine: VehDebuggerEngine | null;
  private readonly softBpEngine: SoftwareBreakpointEngine | null;
  private readonly injector: CodeInjector;
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    bpEngine: PlatformBreakpointEngine | null,
    vehEngine: VehDebuggerEngine | null,
    softBpEngine: SoftwareBreakpointEngine | null,
    injector: CodeInjector,
    processManager?: UnifiedProcessManager,
    ctx?: MCPServerContext,
    auditTrail?: MemoryAuditTrail | null,
  ) {
    this.bpEngine = bpEngine;
    this.vehEngine = vehEngine;
    this.softBpEngine = softBpEngine;
    this.injector = injector;
    this.processManager = processManager;
    this.ctx = ctx;
    this.auditTrail = auditTrail ?? null;
  }

  /** Resolve which breakpoint engine to use based on type + debuggerMode. */
  private resolveEngine(bpType: string | undefined, mode: string | undefined): BreakpointEngine {
    const type = (bpType ?? 'hardware').toLowerCase() as BreakpointType;
    if (type === 'software') {
      if (!this.softBpEngine) throw new Error(WIN32_UNSUPPORTED_MSG);
      return this.softBpEngine;
    }
    const modeLower = (mode ?? 'win32').toLowerCase() as DebuggerBackend;
    if (modeLower === 'veh') {
      if (!this.vehEngine) throw new Error(VEH_UNSUPPORTED_MSG);
      return this.vehEngine;
    }
    if (!this.bpEngine) throw new Error(WIN32_UNSUPPORTED_MSG);
    return this.bpEngine;
  }

  private async resolvePid(value: unknown): Promise<number> {
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
      const bpType = argString(args, 'type');
      const debuggerMode = argString(args, 'debuggerMode');
      const engine = this.resolveEngine(bpType, debuggerMode);
      const isHardware = (bpType ?? 'hardware').toLowerCase() === 'hardware';

      // Validate condition early
      const condition = argString(args, 'condition');
      if (condition) {
        try {
          const { validateBreakpointCondition } = await getConditionEvaluator();
          validateBreakpointCondition(condition);
        } catch (e) {
          throw new Error(
            `${TOOL_BREAKPOINT}: invalid condition expression: ${e instanceof Error ? e.message : String(e)}`,
            { cause: e },
          );
        }
      }

      // DR exhaustion guard (hardware only — software BPs are unlimited)
      if (isHardware) {
        const active = engine.listBreakpoints();
        if (active.length >= HW_BREAKPOINT_MAX) {
          throw new Error(
            `${TOOL_BREAKPOINT}: all ${HW_BREAKPOINT_MAX} hardware debug registers (DR0-DR3) are in use. ` +
              `Remove an existing breakpoint (memory_breakpoint action=remove) before setting a new one. ` +
              `Use type='software' for unlimited breakpoints.`,
          );
        }
      }

      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const access = argEnum(args, 'access', BREAKPOINT_ACCESS);
      if (!access) {
        throw new Error(
          `${TOOL_BREAKPOINT}: missing or invalid required argument "access" (expected one of: ${[...BREAKPOINT_ACCESS].join(', ')}), got: ${JSON.stringify(args.access)}`,
        );
      }
      const sizeArg = argNumber(args, 'size', isHardware ? 4 : 1);
      const size = (
        BREAKPOINT_SIZES.has(sizeArg as unknown as BreakpointSize) ? sizeArg : isHardware ? 4 : 1
      ) as BreakpointSize;

      // ── Collision detection (hardware BPs only) ──
      if (isHardware) {
        // Oversized watchpoint: check raw size input before normalization
        const rawSize = sizeArg;
        if (
          rawSize > HW_BREAKPOINT_MAX_SIZE &&
          !BREAKPOINT_SIZES.has(rawSize as unknown as BreakpointSize)
        ) {
          const active = engine.listBreakpoints();
          const suggestion = suggestWatchpointSplit(address, rawSize, active.length);
          return {
            success: true,
            warning: 'Oversized watchpoint — hardware breakpoints are limited to 8 bytes each.',
            suggestion,
            requested: { address, size: rawSize },
            hint: `Use multiple memory_breakpoint set calls with the segments listed above.`,
          };
        }

        // Size > 1: check for overlap with existing breakpoints
        if (size > 1) {
          const existing = engine.listBreakpoints();
          const collision = detectBreakpointCollision(address, size, existing);
          if (collision) {
            return {
              success: true,
              warning:
                'Breakpoint collision detected — the requested address range overlaps an existing breakpoint.',
              collision: {
                breakpointId: collision.id,
                address: collision.address,
                size: collision.size,
                access: collision.access,
              },
              requested: { address, size, access },
              hint:
                `The new breakpoint at ${address} (size ${size}, ${access}) overlaps existing ` +
                `breakpoint ${collision.id} at ${collision.address} (size ${collision.size}, ${collision.access}). ` +
                `Remove the conflicting breakpoint with memory_breakpoint action=remove breakpointId="${collision.id}" first.`,
            };
          }
        }
      }

      const config = await engine.setBreakpoint(pid, address, access, size, condition);
      const typeLabel =
        (bpType ?? 'hardware').toLowerCase() === 'software'
          ? 'INT3/0xCC'
          : 'hardware (DR register)';
      return {
        ...config,
        type: bpType ?? 'hardware',
        mode: debuggerMode ?? 'win32',
        condition: condition || undefined,
        hint: `${typeLabel === 'INT3/0xCC' ? 'Software' : 'Hardware'} breakpoint set (${typeLabel}, ${debuggerMode ?? 'win32'} mode). Use memory_breakpoint with action='trace' to collect hits.`,
      };
    });
  }

  async handleBreakpointRemove(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const bpType = argString(args, 'type');
      const debuggerMode = argString(args, 'debuggerMode');
      const engine = this.resolveEngine(bpType, debuggerMode);
      const breakpointId = requireStringArg(args.breakpointId, 'breakpointId', TOOL_BREAKPOINT);
      return { removed: await engine.removeBreakpoint(breakpointId) };
    });
  }

  async handleBreakpointList(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const bpType = argString(args, 'type');
      const debuggerMode = argString(args, 'debuggerMode');
      const engine = this.resolveEngine(bpType, debuggerMode);
      const bps = engine.listBreakpoints();
      // Also list software BPs if type not explicitly specified
      const allBps: BreakpointListEntry[] = [...bps];
      if (!bpType && this.softBpEngine) {
        allBps.push(...this.softBpEngine.listBreakpoints());
      }
      return { breakpoints: allBps, count: allBps.length, mode: debuggerMode ?? 'win32' };
    });
  }

  async handleBreakpointTrace(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const bpType = argString(args, 'type');
      const debuggerMode = argString(args, 'debuggerMode');
      const engine = this.resolveEngine(bpType, debuggerMode);
      const isHardware = (bpType ?? 'hardware').toLowerCase() === 'hardware';

      // DR exhaustion guard (hardware only)
      if (isHardware) {
        const active = engine.listBreakpoints();
        if (active.length >= HW_BREAKPOINT_MAX) {
          throw new Error(
            `${TOOL_BREAKPOINT}: all ${HW_BREAKPOINT_MAX} hardware debug registers (DR0-DR3) are in use. ` +
              `Remove an existing breakpoint before tracing. Use type='software' for unlimited breakpoints.`,
          );
        }
      }

      // Validate condition early
      const condition = argString(args, 'condition');
      if (condition) {
        try {
          const { validateBreakpointCondition } = await getConditionEvaluator();
          validateBreakpointCondition(condition);
        } catch (e) {
          throw new Error(
            `${TOOL_BREAKPOINT}: invalid condition expression: ${e instanceof Error ? e.message : String(e)}`,
            { cause: e },
          );
        }
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
      const hits = await engine.traceAccess(pid, address, access, maxHits, timeoutMs);

      // Evaluate condition on each hit if specified
      const filteredHits = condition
        ? await (async () => {
            const { evaluateBreakpointCondition, buildConditionContext } =
              await getConditionEvaluator();
            const kept = [];
            for (const hit of hits) {
              if (!hit.registers) {
                kept.push(hit);
                continue;
              }
              try {
                if (evaluateBreakpointCondition(condition, buildConditionContext(hit.registers))) {
                  kept.push(hit);
                }
              } catch {
                kept.push(hit);
              }
            }
            return kept;
          })()
        : hits;

      return {
        hits: filteredHits,
        hitCount: filteredHits.length,
        filteredCount: condition ? hits.length - filteredHits.length : 0,
        type: bpType ?? 'hardware',
        mode: debuggerMode ?? 'win32',
        condition: condition || undefined,
        hint:
          filteredHits.length > 0
            ? `${filteredHits.length} hits captured${condition ? ` (${hits.length - filteredHits.length} filtered by condition)` : ''}.`
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
      if (count > PATCH_NOP_MAX_COUNT) {
        throw new Error(
          `${TOOL_PATCH_NOP}: count ${count} exceeds maximum ${PATCH_NOP_MAX_COUNT} bytes. ` +
            `NOP-ing huge ranges risks corrupting control flow; use memory_patch_bytes for large intentional writes.`,
        );
      }
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

  // ── Code Injection Tools (Win32 only, gated) ──

  async handleMemoryAllocate(args: Record<string, unknown>) {
    return handleSafe(async () => {
      assertInjectionEnabled();
      const pid = await this.resolvePid(args.pid);
      const size = requirePositiveIntArg(args.size, 'size', TOOL_ALLOCATE);
      if (size <= 0 || size > 1024 * 1024 * 1024) {
        throw new Error(
          `${TOOL_ALLOCATE}: "size" must be between 1 and 1GB (1073741824), got: ${size}`,
        );
      }
      const start = Date.now();
      try {
        const address = await this.injector.allocateRemote(pid, size);
        this.recordAudit({
          operation: 'allocate',
          pid,
          address,
          size,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          success: true,
          address,
          size,
          hint: `Allocated ${size} bytes at ${address} (PAGE_EXECUTE_READWRITE). Use memory_free to release.`,
        };
      } catch (e) {
        this.recordAudit({
          operation: 'allocate',
          pid,
          address: null,
          size,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleMemoryFree(args: Record<string, unknown>) {
    return handleSafe(async () => {
      assertInjectionEnabled();
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const start = Date.now();
      try {
        const freed = await this.injector.freeRemote(pid, address, 0);
        this.recordAudit({
          operation: 'free',
          pid,
          address,
          size: null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          success: freed,
          address,
          hint: freed ? `Freed memory at ${address}.` : `Free failed for ${address}.`,
        };
      } catch (e) {
        this.recordAudit({
          operation: 'free',
          pid,
          address,
          size: null,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleInjectShellcode(args: Record<string, unknown>) {
    return handleSafe(async () => {
      assertInjectionEnabled();
      const pid = await this.resolvePid(args.pid);
      const shellcode = requireStringArg(args.shellcode, 'shellcode', TOOL_INJECT_SHELLCODE);
      const method = argString(args, 'method') ?? 'createremote';
      if (method !== 'createremote' && method !== 'ntcreatethread') {
        throw new Error(
          `${TOOL_INJECT_SHELLCODE}: invalid "method" "${method}" (expected "createremote" or "ntcreatethread")`,
        );
      }

      // Parse hex shellcode into bytes
      const hexBytes = shellcode.trim().split(/\s+/).filter(Boolean);
      if (hexBytes.length === 0) {
        throw new Error(
          `${TOOL_INJECT_SHELLCODE}: "shellcode" must be non-empty hex bytes (e.g. "48 31 C0 C3")`,
        );
      }
      const bytes: number[] = [];
      for (const token of hexBytes) {
        const hex = token.startsWith('0x') || token.startsWith('0X') ? token.slice(2) : token;
        if (hex.length !== 2 || !/^[0-9a-fA-F]{2}$/.test(hex)) {
          throw new Error(
            `${TOOL_INJECT_SHELLCODE}: invalid hex byte "${token}" in shellcode (expected 2 hex chars)`,
          );
        }
        bytes.push(parseInt(hex, 16));
      }

      const start = Date.now();
      try {
        const result = await this.injector.injectShellcode(pid, Buffer.from(bytes), method);
        this.recordAudit({
          operation: 'inject_shellcode',
          pid,
          address: result.address,
          size: bytes.length,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          success: true,
          address: result.address,
          threadId: result.threadId,
          method: result.method,
          size: bytes.length,
          hint: `Shellcode (${bytes.length} bytes) injected and executed at ${result.address} via ${result.method} (thread ${result.threadId}).`,
        };
      } catch (e) {
        this.recordAudit({
          operation: 'inject_shellcode',
          pid,
          address: null,
          size: bytes.length,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleInjectDll(args: Record<string, unknown>) {
    return handleSafe(async () => {
      assertInjectionEnabled();
      const pid = await this.resolvePid(args.pid);
      const dllPath = requireStringArg(args.dllPath, 'dllPath', TOOL_INJECT_DLL);
      const mode = argString(args, 'mode') ?? 'loadlibrary';
      if (mode !== 'loadlibrary' && mode !== 'manualmap') {
        throw new Error(
          `${TOOL_INJECT_DLL}: invalid "mode" "${mode}" (expected "loadlibrary" or "manualmap")`,
        );
      }
      const start = Date.now();
      try {
        const result = await this.injector.injectDll(
          pid,
          dllPath,
          mode as 'loadlibrary' | 'manualmap',
        );
        this.recordAudit({
          operation: 'inject_dll',
          pid,
          address: result.allocatedAddress ?? result.imageBase ?? null,
          size: result.imageSize ?? null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          success: true,
          ...result,
          hint:
            mode === 'loadlibrary'
              ? `DLL injected via LoadLibraryW in process ${pid} (thread ${result.threadId}). Verify with memory_pe_headers.`
              : `DLL manually mapped at ${result.imageBase} in process ${pid} (${result.injectionMethod}). Verify with memory_pe_headers.`,
        };
      } catch (e) {
        this.recordAudit({
          operation: 'inject_dll',
          pid,
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

  // ── Call Stack View ──

  async handleCallStack(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const threadId = argNumber(args, 'threadId');
      const maxFrames = argNumber(args, 'maxFrames');

      const { walkCallStack } = await import('@native/CallStack');
      let frames: ReturnType<typeof walkCallStack>;
      try {
        frames = walkCallStack(pid, threadId ?? undefined);
      } catch (err) {
        // walkCallStack is the source of truth for platform support — it
        // throws a descriptive error on non-Windows. Surface that to the
        // caller as a structured response instead of letting the error
        // bubble up as an MCP exception, so the test/mocked path stays in
        // step with real-environment behaviour.
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          pid,
          threadId: threadId ?? null,
          frameCount: 0,
          totalFrames: 0,
          truncated: false,
          frames: [],
          error: `${TOOL_CALL_STACK}: ${message}`,
          hint:
            'Call stack walking requires Windows (x64) with dbghelp.dll / kernel32 Toolhelp32 APIs. ' +
            'On other platforms no frames are available.',
        };
      }

      const sliced = maxFrames && maxFrames > 0 ? frames.slice(0, maxFrames) : frames;

      return {
        success: true,
        pid,
        threadId: (threadId ?? frames[0]) ? 'auto-detected' : null,
        frameCount: sliced.length,
        totalFrames: frames.length,
        truncated: maxFrames ? frames.length > maxFrames : false,
        frames: sliced,
        hint:
          sliced.length > 0
            ? `Call stack with ${sliced.length} frame(s) for process ${pid}.`
            : `No frames captured for process ${pid}. Ensure the target process is suspended and has a valid RBP chain (x64 debug builds work best).`,
      };
    });
  }

  // ── Process Suspend / Resume ──

  async handleProcessControl(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const action = argString(args, 'action')?.toLowerCase();
      if (action !== 'suspend' && action !== 'resume') {
        throw new Error(
          `${TOOL_PROCESS_CONTROL}: required argument "action" must be "suspend" or "resume", got: ${JSON.stringify(args.action)}`,
        );
      }

      const pid = await this.resolvePid(args.pid);

      const configuredPlatform = readEnvString('JSHOOK_REGISTRY_PLATFORM', '', { trim: true });
      const platform: 'win32' | 'linux' | 'darwin' | 'unknown' =
        configuredPlatform === 'win32' ||
        configuredPlatform === 'linux' ||
        configuredPlatform === 'darwin'
          ? configuredPlatform
          : (process.platform as 'win32' | 'linux' | 'darwin' | 'unknown');

      const { suspendProcess, resumeProcess } = await import('@modules/process/memory/scanner');

      if (action === 'suspend') {
        const suspended = await suspendProcess(platform, pid);
        return {
          success: true,
          pid,
          action: 'suspend',
          suspended,
          platform,
          hint: suspended
            ? `Process ${pid} suspended. All threads frozen — safe for consistent memory reads/scans.`
            : `Failed to suspend process ${pid}. Check permissions (Administrator required) or the process may have exited.`,
        };
      }

      // resume
      const resumed = await resumeProcess(platform, pid);
      return {
        success: true,
        pid,
        action: 'resume',
        resumed,
        platform,
        hint: resumed
          ? `Process ${pid} resumed.`
          : `Failed to resume process ${pid}. Check permissions (Administrator required) or the process may have exited.`,
      };
    });
  }
}
