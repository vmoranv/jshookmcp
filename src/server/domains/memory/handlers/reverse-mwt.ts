/**
 * ReverseMWTHandlers — "given a code address, find what data addresses it accesses"
 *
 * Inverse of find_accesses (Cheat Engine MWT). Instead of watching a data address
 * to find what code touches it, this takes a code address and disassembles the
 * instruction there to find what data addresses it accesses.
 *
 * Uses the existing Capstone WASM Disassembler (from exploit-dev) to decode the
 * instruction, then parses the operand string for:
 *   - RIP-relative accesses:  [rip + disp32] / [rip - disp32]
 *     → target = instructionAddress + instructionSize + displacement
 *   - Absolute addresses:     [0x...]
 *     → target = the absolute address
 *
 * The Disassembler does not expose Capstone detail mode directly, so we parse
 * the human-readable opStr. This is honest — we only report what Capstone
 * outputs and clearly mark confidence levels.
 *
 * Cross-platform — uses MemoryController for reading instruction bytes,
 * Capstone WASM for disassembly (no native bindings).
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argBool } from '@server/domains/shared/parse-args';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { validateHexAddress } from './validation';
import { logger } from '@utils/logger';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import type { MemoryController } from '@native/MemoryController';

const TOOL_NAME = 'memory_reverse_mwt';
/** Max bytes to read for disassembly (x64 max instruction length = 15). */
const MAX_INSN_BYTES = 16;

export interface AccessedAddress {
  /** The absolute memory address accessed by this instruction */
  address: string;
  /** Access type classification */
  accessType: 'READ' | 'WRITE' | 'RIP_REL';
  /** How this address was resolved (e.g. "RIP+0x1000", "absolute [0x7FF6...]") */
  resolution: string;
}

// ── opStr parsing ──

/** Regex for RIP-relative: [rip + 0xHEX] or [rip - 0xHEX] or [rip+0xHEX] */
const RIP_REL_RE = /\[rip\s*([+-])\s*(0x[0-9a-fA-F]+)\]/i;

/** Regex for absolute memory address: [0xHEX...]  (not preceded by a register) */
const ABS_ADDR_RE = /\[(0x[0-9a-fA-F]+)\]/;

/**
 * Parse a Capstone opStr to find accessed memory addresses.
 *
 * For RIP-relative: computes absolute target = instructionAddress + instructionSize + displacement.
 * For absolute: extracts the address directly.
 */
export function parseAccessedAddresses(
  opStr: string,
  instructionAddress: bigint,
  instructionSize: number,
): AccessedAddress[] {
  const results: AccessedAddress[] = [];

  // ── RIP-relative ──
  const ripMatch = opStr.match(RIP_REL_RE);
  if (ripMatch) {
    const sign = ripMatch[1] === '-' ? -1n : 1n;
    const displacement = BigInt(parseInt(ripMatch[2]!, 16));
    const target = instructionAddress + BigInt(instructionSize) + sign * displacement;
    results.push({
      address: `0x${target.toString(16).toUpperCase()}`,
      accessType: 'RIP_REL',
      resolution: `RIP${ripMatch[1]}${ripMatch[2]}`,
    });
  }

  // ── Absolute address (only if no RIP-relative was found — avoid duplicates) ──
  if (results.length === 0) {
    const absMatch = opStr.match(ABS_ADDR_RE);
    if (absMatch) {
      const addr = absMatch[1]!;
      results.push({
        address: addr.toUpperCase(),
        accessType: 'READ',
        resolution: `absolute [${addr.toUpperCase()}]`,
      });
    }
  }

  // ── Immediate operands that could be addresses ──
  // Match patterns like "0x7FF6..." (64-bit addresses typically 12+ hex digits)
  const IMM_ADDR_RE = /\b(0x[0-9a-fA-F]{8,16})\b/g;
  let immMatch: RegExpExecArray | null;
  while ((immMatch = IMM_ADDR_RE.exec(opStr)) !== null) {
    const addr = immMatch[1]!;
    // Skip if already matched (case-insensitive)
    if (results.some((r) => r.address === addr.toUpperCase())) continue;
    results.push({
      address: addr.toUpperCase(),
      accessType: 'READ',
      resolution: `immediate ${addr.toUpperCase()}`,
    });
  }

  return results;
}

// ── Handler ──

// Instruction-byte read still via MemoryController.dumpMemory (sync on win32) —
// not yet migrated to createPlatformProvider(); see a4-01/b3-09 (commit c047a09b).
export class ReverseMWTHandlers {
  private readonly memCtrl: MemoryController;
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  constructor(
    memCtrl: MemoryController,
    processManager?: UnifiedProcessManager,
    ctx?: MCPServerContext,
  ) {
    this.memCtrl = memCtrl;
    this.processManager = processManager;
    this.ctx = ctx;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handleReverseMWT(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const addressStr = validateHexAddress(args.address, 'address');
      const doDisassemble = argBool(args, 'disassemble', true);

      const addrNum = parseInt(addressStr.replace(/^0x/i, ''), 16);
      if (Number.isNaN(addrNum)) {
        throw new Error(
          `${TOOL_NAME}: argument "address" must be a valid hex address, got: ${JSON.stringify(args.address)}`,
        );
      }
      const insnAddr = BigInt(addrNum);

      // ── Read instruction bytes from process memory ──
      let rawBytes: Buffer;
      try {
        rawBytes = await this.memCtrl.dumpMemory(pid, addressStr, MAX_INSN_BYTES);
      } catch (err) {
        throw new Error(
          `${TOOL_NAME}: failed to read memory at ${addressStr}: ` +
            (err instanceof Error ? err.message : String(err)),
          { cause: err },
        );
      }

      if (rawBytes.length === 0) {
        throw new Error(
          `${TOOL_NAME}: read 0 bytes at ${addressStr}. The address may be invalid or the process is not accessible.`,
        );
      }

      const rawHex = Array.from(rawBytes)
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');

      // ── Disassemble ──
      let instruction = ' (disassembly unavailable)';
      let instructionSize = rawBytes.length;
      const accessedAddresses: AccessedAddress[] = [];

      if (doDisassemble) {
        try {
          const { Disassembler } = await import('@server/domains/exploit-dev/utils/disasm');
          const disasm = new Disassembler();
          const instrs = await disasm.disassemble(rawBytes, {
            arch: 'x64',
            offset: addrNum,
            count: 1,
          });

          if (instrs.length > 0) {
            const first = instrs[0]!;
            instruction = first.opStr ? `${first.mnemonic} ${first.opStr}` : first.mnemonic;
            instructionSize = first.bytes.length;

            // Parse operand string for memory addresses
            if (first.opStr) {
              const parsed = parseAccessedAddresses(first.opStr, insnAddr, instructionSize);
              accessedAddresses.push(...parsed);
            }
          }
        } catch (err) {
          logger.debug(`${TOOL_NAME}: disassembly failed at ${addressStr}:`, err);
          instruction = ' (disassembly failed)';
        }
      } else {
        instruction = ' (disassembly skipped)';
        instructionSize = rawBytes.length;
      }

      return {
        instructionAddress: addressStr,
        instruction,
        instructionBytes: rawHex,
        instructionSize,
        accessedAddresses,
        accessedCount: accessedAddresses.length,
        hint:
          accessedAddresses.length === 0
            ? `Instruction at ${addressStr} does not appear to access any directly-computable data address. ` +
              'It may use register-relative addressing (e.g. [rbx+0x10]) which requires runtime context to resolve, ' +
              'or the address is computed via a chain of instructions.'
            : `Found ${accessedAddresses.length} accessed address(es). ` +
              'Use memory_find_accesses on these addresses to find what else touches them.',
      };
    });
  }
}
