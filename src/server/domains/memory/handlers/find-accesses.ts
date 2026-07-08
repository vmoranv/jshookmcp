/**
 * FindAccessesHandlers — "Find out what writes to / accesses this address"
 *
 * Implements the Cheat Engine MWT (Memory Write Trace) workflow:
 * 1. Set a hardware breakpoint on the target address
 * 2. On each hit: capture instruction address + register context + timestamp
 * 3. Auto-rearm the breakpoint after each hit
 * 4. Read real instruction bytes at the faulting address via the injected
 *    memory reader (ReadProcessMemory on Win32).
 * 5. If disassemble=true: decode the faulting instruction bytes via the
 *    injected disassembler (Capstone WASM adapter — see handlers.impl.ts).
 * 6. Return aggregated hits with per-hit context
 *
 * The memory reader + disassembler are injectable dependencies for testability
 * — tests provide mocks instead of loading koffi / capstone WASM.
 *
 * Honesty contract: if the byte-read fails or returns short, `instructionBytes`
 * is set to `null` and no mnemonic is produced. We NEVER fabricate bytes.
 */

import type { HardwareBreakpointEngine } from '@native/HardwareBreakpoint';
import type {
  BreakpointAccess,
  BreakpointHit,
  BreakpointSize,
} from '@native/HardwareBreakpoint.types';
import type { MemoryReadResult } from '@modules/process/memory/types';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argNumber, argBool } from '@server/domains/shared/parse-args';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { validateHexAddress } from './validation';
import { logger } from '@utils/logger';

const TOOL_NAME = 'memory_find_accesses';

const FIND_ACCESS_MODES = new Set(['write', 'readwrite'] as const);

const VALID_SIZES = new Set([1, 2, 4, 8]);

/** Number of bytes to read at the faulting instruction address for disassembly. */
const INSTRUCTION_BYTE_READ_SIZE = 16;

const WIN32_UNSUPPORTED_MSG =
  'memory_find_accesses is only supported on Windows. ' +
  'Hardware breakpoint registers (DR0-DR3) require Win32 debug APIs.';

export interface FindAccessHit {
  /** Index of this hit (1-based) */
  hitCount: number;
  /** Address of the instruction that accessed the watched address */
  instructionAddress: string;
  /**
   * Hex-encoded bytes of the faulting instruction (up to 16 bytes).
   * `null` when the byte-read failed or returned short — in that case
   * `instructionMnemonic` is also omitted (we never fabricate bytes).
   */
  instructionBytes: string | null;
  /** Disassembled mnemonic (only when disassemble=true, bytes were read, and disassembler succeeds) */
  instructionMnemonic?: string;
  /** Access type (write or read) */
  accessType: string;
  /** Thread that triggered the hit */
  threadId: number;
  /** Timestamp of the hit (epoch ms) */
  timestamp: number;
}

/**
 * Reads raw bytes from the target process. Returns a `MemoryReadResult`
 * (hex-encoded `data` string on success, `error` on failure).
 */
export type MemoryReaderFn = (
  pid: number,
  address: string,
  size: number,
) => Promise<MemoryReadResult>;

/**
 * Disassembler function type. Takes raw instruction bytes and the instruction
 * address, returns a human-readable mnemonic string.
 *
 * Async because the underlying Capstone WASM disassembles asynchronously.
 */
export type DisassemblerFn = (
  instructionBytes: number[],
  instructionAddress: string,
) => Promise<string>;

export class FindAccessesHandlers {
  constructor(
    private readonly bpEngine: HardwareBreakpointEngine | null,
    private readonly memoryReader: MemoryReaderFn | null,
    private readonly disassembler: DisassemblerFn | null,
    private readonly processManager?: UnifiedProcessManager,
    private readonly ctx?: MCPServerContext,
  ) {}

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  // NOTE: find_accesses disassembly is only functional on Windows. On macOS/Linux
  // the tool is filtered out at registration (WIN32_ONLY_TOOLS in manifest.ts) and
  // `bpEngine` is constructed as null, so this handler throws early below. The capstone
  // WASM disassembler itself is cross-platform (needs no native binding); the real
  // cross-platform gap is the hardware-breakpoint engine + the process-memory reader.
  // macOS/Linux fallback is a raw hex dump only — no instruction decode. Cross-platform
  // parity tracked at research/memory.md #3.
  async handleFindAccesses(args: Record<string, unknown>) {
    return handleSafe(async () => {
      // TODO(macOS/Linux): wire a cross-platform hardware-breakpoint engine so this
      // stub can be removed — Linux needs ptrace(PTRACE_ATTACH) + INT3 (0xCC) injection
      // + SIGTRAP capture + single-step re-arm; macOS needs mach_vm_protect +
      // EXC_BAD_ACCESS exception handler. Also requires a process_vm_readv (Linux) /
      // mach_vm_read (macOS) memory reader for instructionBytes. See research/memory.md #3.
      if (!this.bpEngine) {
        throw new Error(WIN32_UNSUPPORTED_MSG);
      }

      // ── Validate address ──
      const address = validateHexAddress(args.address, 'address');

      // ── Validate mode ──
      const mode = argEnum<string>(args, 'mode', FIND_ACCESS_MODES);
      if (!mode) {
        throw new Error(
          `${TOOL_NAME}: missing or invalid required argument "mode" (expected one of: ${[...FIND_ACCESS_MODES].join(', ')}), got: ${JSON.stringify(args.mode)}`,
        );
      }

      // ── Validate size ──
      const size = argNumber(args, 'size', 4);
      if (!VALID_SIZES.has(size)) {
        throw new Error(
          `${TOOL_NAME}: argument "size" must be one of 1, 2, 4, 8, got: ${JSON.stringify(size)}`,
        );
      }

      // ── Validate maxHits ──
      const maxHits = argNumber(args, 'maxHits', 20);
      if (typeof maxHits !== 'number' || !Number.isInteger(maxHits) || maxHits < 1) {
        throw new Error(
          `${TOOL_NAME}: argument "maxHits" must be a positive integer, got: ${JSON.stringify(args.maxHits)}`,
        );
      }

      // ── Validate timeoutMs ──
      const timeoutMs = argNumber(args, 'timeoutMs', 15000);
      if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 100) {
        throw new Error(
          `${TOOL_NAME}: argument "timeoutMs" must be a positive integer >= 100, got: ${JSON.stringify(args.timeoutMs)}`,
        );
      }

      // ── Validate disassemble flag ──
      const doDisassemble = argBool(args, 'disassemble', true);

      // ── Resolve PID (was previously passed as `undefined as unknown as number`) ──
      const pid = await this.resolvePid(args.pid);

      // ── Set the hardware breakpoint ──
      let bpConfig = await this.bpEngine.setBreakpoint(
        pid,
        address,
        mode as BreakpointAccess,
        size as BreakpointSize,
      );

      // ── Main trace loop with auto-rearm ──
      const hits: FindAccessHit[] = [];
      const deadline = Date.now() + timeoutMs;
      let stoppedBy: 'maxHits' | 'timeout' = 'timeout';
      let readFailureCount = 0;

      try {
        while (hits.length < maxHits && Date.now() < deadline) {
          const remaining = Math.max(50, deadline - Date.now());
          const hit: BreakpointHit | null = await this.bpEngine.waitForHit(
            Math.min(remaining, 500),
          );

          // No hit returned — waitForHit timed out
          if (!hit) {
            stoppedBy = 'timeout';
            break;
          }

          // Only count hits for our breakpoint
          if (hit.breakpointId !== bpConfig.id) continue;

          // ── Auto-rearm: remove and re-set the breakpoint ──
          await this.bpEngine.removeBreakpoint(bpConfig.id);
          const newConfig = await this.bpEngine.setBreakpoint(
            pid,
            address,
            mode as BreakpointAccess,
            size as BreakpointSize,
          );
          bpConfig = newConfig;

          // ── Read real instruction bytes at the faulting address ──
          // Replaces the former `simulateInstructionBytes` stub which returned
          // hard-coded all-zero bytes for every hit. If the reader is not
          // wired (null) or the read fails / returns short, we honestly
          // report `instructionBytes: null` and skip disassembly.
          const { instructionBytes, byteCount, readFailed } = await this.readInstructionBytes(
            pid,
            hit.instructionAddress,
          );

          if (readFailed) {
            readFailureCount++;
          }

          const entry: FindAccessHit = {
            hitCount: hits.length + 1,
            instructionAddress: hit.instructionAddress,
            instructionBytes,
            accessType: hit.accessType,
            threadId: hit.threadId,
            timestamp: hit.timestamp,
          };

          // ── Disassemble if requested AND we have a full-length byte buffer ──
          if (doDisassemble && this.disassembler && instructionBytes && byteCount > 0) {
            try {
              const byteArray = this.hexToByteArray(instructionBytes);
              entry.instructionMnemonic = await this.disassembler(
                byteArray,
                hit.instructionAddress,
              );
            } catch (err) {
              // Disassembly failure is non-fatal — return raw bytes
              logger.debug(`${TOOL_NAME}: disassembly failed at ${hit.instructionAddress}:`, err);
              entry.instructionMnemonic = '(disassembly failed)';
            }
          }

          hits.push(entry);

          if (hits.length >= maxHits) {
            stoppedBy = 'maxHits';
            break;
          }
        }
      } finally {
        // ── Cleanup: always remove the breakpoint ──
        await this.bpEngine.removeBreakpoint(bpConfig.id);
      }

      const hint =
        hits.length > 0
          ? `${hits.length} accesses captured (stopped by: ${stoppedBy}). ` +
            `Check instructionAddress for each hit to find the code accessing address ${address}.` +
            (readFailureCount > 0
              ? ` ${readFailureCount} hit(s) had unreadable instruction bytes (shown as instructionBytes=null).`
              : '')
          : `No accesses to ${address} captured within ${timeoutMs}ms timeout. Increase timeoutMs or check that the address is being accessed.`;

      return {
        address,
        mode,
        size,
        hits,
        hitCount: hits.length,
        stoppedBy,
        hint,
      };
    });
  }

  /**
   * Read `INSTRUCTION_BYTE_READ_SIZE` bytes at the faulting instruction address.
   *
   * Returns:
   *   - `instructionBytes`: hex string ("DE AD BE EF ...") on success, `null` on failure / short read
   *   - `byteCount`: number of bytes successfully read (0 on failure)
   *   - `readFailed`: true when the read failed or returned short
   *
   * Honesty invariant: we never synthesize placeholder bytes. If the reader is
   * unavailable or the read fails, `instructionBytes` is `null`.
   */
  private async readInstructionBytes(
    pid: number,
    instructionAddress: string,
  ): Promise<{ instructionBytes: string | null; byteCount: number; readFailed: boolean }> {
    if (!this.memoryReader) {
      return { instructionBytes: null, byteCount: 0, readFailed: true };
    }

    try {
      const result = await this.memoryReader(pid, instructionAddress, INSTRUCTION_BYTE_READ_SIZE);
      if (!result.success || !result.data) {
        return { instructionBytes: null, byteCount: 0, readFailed: true };
      }

      const hex = result.data.trim();
      if (!hex) {
        return { instructionBytes: null, byteCount: 0, readFailed: true };
      }

      const byteCount = hex.split(/\s+/).filter((b) => b.length > 0).length;
      // Short read (fewer bytes than requested) → treat as failure. We can't
      // safely disassemble partial instruction data.
      if (byteCount < INSTRUCTION_BYTE_READ_SIZE) {
        return { instructionBytes: null, byteCount, readFailed: true };
      }

      return { instructionBytes: hex, byteCount, readFailed: false };
    } catch (err) {
      logger.debug(`${TOOL_NAME}: instruction byte read failed at ${instructionAddress}:`, err);
      return { instructionBytes: null, byteCount: 0, readFailed: true };
    }
  }

  private hexToByteArray(hex: string): number[] {
    return hex
      .split(/\s+/)
      .filter((b) => b.length > 0)
      .map((b) => parseInt(b, 16));
  }
}
