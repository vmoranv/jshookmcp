/**
 * FindReferencesHandlers — "find all references to this address" (x64dbg parity)
 *
 * Scans all executable memory regions for instructions that reference a target
 * address. Uses pure-TS byte-pattern heuristics — no disassembler required.
 *
 * Covered patterns:
 *   CALL rel32  (E8 xx xx xx xx) → target = insn + 5 + rel32
 *   JMP  rel32  (E9 xx xx xx xx) → target = insn + 5 + rel32
 *   Jcc  rel32  (0F 8x xx xx xx xx) → target = insn + 6 + rel32
 *   LEA  [RIP+disp32] (48/4C 8D ModRM=05/0D/... disp32) → target = insn + 7 + disp32
 *   MOV  [RIP+disp32] (48/4C 8B ModRM=05/0D/... disp32) → target = insn + 7 + disp32
 *
 * The byte-pattern logic reuses the heuristics from SignatureGenerator.ts
 * (detectRelativeDisplacements), applied in reverse: instead of wildcarding
 * displacements we check whether the computed target matches the user's address.
 *
 * Cross-platform — uses PlatformMemoryAPI for region enumeration and reading.
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argNumber, argString } from '@server/domains/shared/parse-args';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { validateHexAddress } from './validation';
import { createPlatformProvider } from '@native/platform/factory';
import type { PlatformMemoryAPI } from '@native/platform/PlatformMemoryAPI';
import { MemoryProtection } from '@native/platform/types';
import { USERSPACE_MAX_ADDRESS } from '@src/constants';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { logger } from '@utils/logger';

const TOOL_NAME = 'memory_find_references';
const DEFAULT_MAX_RESULTS = 500;
/** Max bytes to read from a single executable region (64 MB). */
const MAX_REGION_SCAN_BYTES = 64 * 1024 * 1024;

export interface ReferenceHit {
  /** Instruction type that references the target */
  type: 'CALL' | 'JMP' | 'LEA' | 'MOV';
  /** Address of the instruction that references the target */
  fromAddress: string;
  /** Human-readable instruction text */
  instruction: string;
  /** Module name (null if region is not module-backed) */
  module: string | null;
  /** Byte offset from the start of the containing module (hex), or region offset if not module-backed */
  offset: string;
}

// ── Byte-pattern scanner ──

/**
 * Scan a byte buffer for instructions that reference `targetAddr`.
 *
 * The buffer starts at `regionBase` in the process address space.
 * Returns an array of reference hits (unsorted).
 */
export function scanForReferences(
  bytes: Buffer,
  regionBase: bigint,
  targetAddr: bigint,
  moduleBase: bigint | null,
  moduleName: string | null,
): ReferenceHit[] {
  const results: ReferenceHit[] = [];
  const ctx: RefScanContext = { bytes, regionBase, targetAddr, moduleBase, moduleName, results };

  for (let i = 0; i < bytes.length /* advance manually */;) {
    const consumed =
      matchCallRel32(ctx, i) ??
      matchJmpRel32(ctx, i) ??
      matchJccRel32(ctx, i) ??
      matchRipRelative(ctx, i, 0x8d, 'LEA') ??
      matchRipRelative(ctx, i, 0x8b, 'MOV');
    if (consumed !== null) {
      i += consumed;
      continue;
    }
    // Unknown byte — advance by 1
    i++;
  }

  return results;
}

interface RefScanContext {
  bytes: Buffer;
  regionBase: bigint;
  targetAddr: bigint;
  moduleBase: bigint | null;
  moduleName: string | null;
  results: ReferenceHit[];
}

/** 5-byte `E8 rel32` call. Returns the consumed length when the opcode
 * matches (whether or not the target matched), else null. */
function matchCallRel32(ctx: RefScanContext, i: number): number | null {
  const { bytes, regionBase, targetAddr } = ctx;
  if (bytes.length - i < 5 || bytes[i] !== 0xe8) return null;
  const target = regionBase + BigInt(i) + 5n + BigInt(bytes.readInt32LE(i + 1));
  if (target === targetAddr) {
    ctx.results.push(
      makeHit('CALL', regionBase + BigInt(i), target, ctx.moduleName, ctx.moduleBase),
    );
  }
  return 5;
}

/** 5-byte `E9 rel32` jump. */
function matchJmpRel32(ctx: RefScanContext, i: number): number | null {
  const { bytes, regionBase, targetAddr } = ctx;
  if (bytes.length - i < 5 || bytes[i] !== 0xe9) return null;
  const target = regionBase + BigInt(i) + 5n + BigInt(bytes.readInt32LE(i + 1));
  if (target === targetAddr) {
    ctx.results.push(
      makeHit('JMP', regionBase + BigInt(i), target, ctx.moduleName, ctx.moduleBase),
    );
  }
  return 5;
}

/** 6-byte `0F 8x rel32` conditional jump. */
function matchJccRel32(ctx: RefScanContext, i: number): number | null {
  const { bytes, regionBase, targetAddr } = ctx;
  if (bytes.length - i < 6 || bytes[i] !== 0x0f || (bytes[i + 1]! & 0xf0) !== 0x80) return null;
  const target = regionBase + BigInt(i) + 6n + BigInt(bytes.readInt32LE(i + 2));
  if (target === targetAddr) {
    ctx.results.push(
      makeHit('JMP', regionBase + BigInt(i), target, ctx.moduleName, ctx.moduleBase),
    );
  }
  return 6;
}

/** 7-byte `REX.W <opcode> reg, [RIP+disp32]` (LEA 0x8d / MOV 0x8b). */
function matchRipRelative(
  ctx: RefScanContext,
  i: number,
  opcode: number,
  type: ReferenceHit['type'],
): number | null {
  const { bytes, regionBase, targetAddr } = ctx;
  if (bytes.length - i < 7 || (bytes[i] !== 0x48 && bytes[i] !== 0x4c) || bytes[i + 1] !== opcode) {
    return null;
  }
  const modrm = bytes[i + 2]!;
  // Mod=00 (bits 7-6 == 0), R/M=101 (bits 2-0 == 5)
  if ((modrm & 0xc7) === 0x05) {
    const target = regionBase + BigInt(i) + 7n + BigInt(bytes.readInt32LE(i + 3));
    if (target === targetAddr) {
      ctx.results.push(
        makeHit(type, regionBase + BigInt(i), target, ctx.moduleName, ctx.moduleBase),
      );
    }
  }
  return 7;
}

/** Format a bigint as a 0x-prefixed uppercase hex string. */
function addrHex(addr: bigint): string {
  return `0x${addr.toString(16).toUpperCase()}`;
}

/** Build a ReferenceHit with a human-readable instruction string. */
function makeHit(
  type: ReferenceHit['type'],
  insnAddr: bigint,
  target: bigint,
  moduleName: string | null,
  moduleBase: bigint | null,
): ReferenceHit {
  const offset =
    moduleBase !== null
      ? `+0x${(insnAddr - moduleBase).toString(16).toUpperCase()}`
      : `+0x${insnAddr.toString(16).toUpperCase()}`;

  let instruction: string;
  switch (type) {
    case 'CALL':
      instruction = `call ${addrHex(target)}`;
      break;
    case 'JMP':
      instruction = `jmp ${addrHex(target)}`;
      break;
    case 'LEA':
      instruction = `lea reg, [${addrHex(target)}]`;
      break;
    case 'MOV':
      instruction = `mov reg, [${addrHex(target)}]`;
      break;
  }

  return {
    type,
    fromAddress: addrHex(insnAddr),
    instruction,
    module: moduleName,
    offset,
  };
}

// ── Handler ──

export class FindReferencesHandlers {
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  constructor(processManager?: UnifiedProcessManager, ctx?: MCPServerContext) {
    this.processManager = processManager;
    this.ctx = ctx;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handleFindReferences(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const targetAddrStr = validateHexAddress(args.address, 'address');
      const moduleFilter = argString(args, 'moduleName');
      const maxResults = argNumber(args, 'maxResults', DEFAULT_MAX_RESULTS);

      if (!Number.isFinite(maxResults) || (maxResults as number) <= 0) {
        throw new Error(
          `${TOOL_NAME}: argument "maxResults" must be a positive number, got: ${JSON.stringify(args.maxResults)}`,
        );
      }

      const targetAddrNum = parseInt(targetAddrStr.replace(/^0x/i, ''), 16);
      if (Number.isNaN(targetAddrNum)) {
        throw new Error(
          `${TOOL_NAME}: argument "address" must be a valid hex address, got: ${JSON.stringify(args.address)}`,
        );
      }
      const targetAddr = BigInt(targetAddrNum);

      // ── Platform API ──
      let api: PlatformMemoryAPI;
      try {
        api = createPlatformProvider();
      } catch {
        throw new Error(
          `${TOOL_NAME}: no platform memory provider is available on ${process.platform}. ` +
            'This tool requires a native memory backend.',
        );
      }

      const handle = api.openProcess(pid, false);
      try {
        // ── Build module map (best-effort) ──
        interface ModuleInfo {
          base: bigint;
          size: number;
          name: string;
        }
        const modules: ModuleInfo[] = [];
        try {
          for (const mod of api.enumerateModules(handle)) {
            modules.push({
              base: mod.baseAddress,
              size: mod.size,
              name: mod.name,
            });
          }
        } catch {
          // Module enumeration is best-effort
        }

        /** Find which module a region address falls within. */
        function findModule(addr: bigint): ModuleInfo | null {
          for (const m of modules) {
            if (addr >= m.base && addr < m.base + BigInt(m.size)) {
              return m;
            }
          }
          return null;
        }

        const results: ReferenceHit[] = [];
        let cursor = 0n;

        while (cursor < USERSPACE_MAX_ADDRESS && results.length < maxResults) {
          const region = api.queryRegion(handle, cursor);
          if (!region) break;

          const regionBase = region.baseAddress;
          const regionSize = region.size;
          const isExecutable = (region.protection & MemoryProtection.Execute) !== 0;

          if (isExecutable && regionSize > 0) {
            const mod = findModule(regionBase);

            // Apply module filter
            if (
              !moduleFilter ||
              (mod && mod.name.toLowerCase().includes(moduleFilter.toLowerCase()))
            ) {
              const readSize = Math.min(Number(regionSize), MAX_REGION_SCAN_BYTES);
              try {
                const readResult = await api.readMemory(handle, regionBase, readSize);
                const bytes = Buffer.from(readResult.data.subarray(0, readResult.bytesRead));

                const hits = scanForReferences(
                  bytes,
                  regionBase,
                  targetAddr,
                  mod?.base ?? null,
                  mod?.name ?? null,
                );

                for (const hit of hits) {
                  if (results.length >= maxResults) break;
                  results.push(hit);
                }
              } catch (err) {
                logger.debug(
                  `${TOOL_NAME}: readMemory failed for region ${regionBase.toString(16)}:`,
                  err,
                );
              }
            }
          }

          cursor = regionBase + BigInt(regionSize);

          // Guard against bogus region sizes
          if (regionSize === 0) break;
        }

        const truncated = results.length >= maxResults;

        return {
          targetAddress: targetAddrStr,
          references: results,
          referenceCount: results.length,
          truncated,
          hint:
            results.length === 0
              ? `No references to ${targetAddrStr} found in executable memory. ` +
                'The address may not be referenced directly via CALL/JMP/LEA/MOV, ' +
                'or it may be in non-executable memory. Try a broader address range.'
              : truncated
                ? `Found ${results.length} references (truncated at ${maxResults}). ` +
                  'Narrow the search with moduleName to see more specific results.'
                : `Found ${results.length} references to ${targetAddrStr}.`,
        };
      } finally {
        api.closeProcess(handle);
      }
    });
  }
}
