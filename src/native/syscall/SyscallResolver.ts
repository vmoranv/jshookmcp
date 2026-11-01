/**
 * Parse on-disk ntdll to extract system-service numbers and a `syscall;ret`
 * gadget.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findKernelModule } from './NtModuleEnumerator';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SyscallEntry {
  /** Zw function name (e.g. 'NtOpenProcess'). */
  name: string;
  /** System Service Number for the current OS build. */
  ssn: number;
  /** RVA of the function body (where MovR10 + MovEax starts). */
  rva: number;
}

export interface ResolvedNtdll {
  /** Full file path used. */
  path: string;
  /** Resolved syscall entries (only Zw exports with a parseable SSN). */
  syscalls: SyscallEntry[];
  /** Named lookup helper. */
  byName: Record<string, SyscallEntry>;
  /** Absolute address of a `syscall;ret` (0F 05 C3) gadget in the clean
   * ntdll mapping — suitable as a JMP target for syscall stubs. */
  syscallGadgetRva: number;
  /** Non-fatal parse warnings (e.g. functions whose prologue didn't match). */
  warnings: string[];
  /** Runtime base address of the loaded ntoskrnl image (Win32, best-effort via
   *  NtQuerySystemInformation — see resolveRuntimeKernelBase). Undefined when
   *  runtime enumeration is unavailable (off-Win32, insufficient privilege). */
  kernelImageBase?: string;
}

// ── Runtime augmentation ────────────────────────────────────────────────────

/**
 * Resolve the loaded ntoskrnl image base at runtime via
 * NtQuerySystemInformation(SystemModuleInformation) (NtModuleEnumerator).
 *
 * Complementary to the on-disk SSN table above: SSN extraction stays static
 * (kernel modules don't carry user-mode ntdll stubs), but the live kernel base
 * is genuine runtime data callers can use for kernel-relative addressing.
 * Best-effort: returns undefined off-Win32, when NtQuerySystemInformation is
 * unavailable, or when ntoskrnl isn't found among loaded modules.
 */
export function resolveRuntimeKernelBase(): string | undefined {
  try {
    const mod = findKernelModule('ntoskrnl');
    if (!mod) return undefined;
    return `0x${mod.imageBase.toString(16).toUpperCase()}`;
  } catch {
    // Non-Win32, koffi/ntdll unavailable, or insufficient privilege.
    return undefined;
  }
}

// ── Implementation ───────────────────────────────────────────────────────────

function getDefaultNtdllPath(): string {
  if (process.platform !== 'win32') {
    throw new Error('SyscallResolver: ntdll resolution is only supported on Windows');
  }
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  return path.join(systemRoot, 'System32', 'ntdll.dll');
}
const SYSCALL_GADGET_BYTES = Buffer.from([0x0f, 0x05, 0xc3]); // syscall;ret
/**
 * Win x64 ntdll Zw stub prologue: `4C 8B D1` (mov r10, rcx) + `B8` (mov eax,
 * imm32 opcode). Compared byte-wise below — a 3-byte `readUInt32LE` would
 * wrongly fold the following `B8` opcode into the comparison and never match
 * (this was the pre-runtime-test bug: SSN extraction silently returned 0 on a
 * real ntdll while mocked tests passed). Verified against
 * C:\Windows\System32\ntdll.dll by SyscallResolver.runtime.test.ts.
 */
const MOV_R10_RCX = [0x4c, 0x8b, 0xd1] as const; // "mov r10, rcx"
const MOV_EAX_IMM = 0xb8; // "mov eax, imm32" opcode

/**
 * Read and parse a clean ntdll.dll from disk to extract SSNs and a
 * syscall gadget. Cached after the first call (immutable per boot).
 */
let _resolved: ResolvedNtdll | null = null;

export function resolveNtdll(ntdllPath?: string): ResolvedNtdll {
  if (_resolved) return _resolved;

  const resolvedPath = ntdllPath ?? getDefaultNtdllPath();

  const warnings: string[] = [];
  let fileData: Buffer;
  try {
    fileData = readFileSync(resolvedPath);
  } catch (err) {
    throw new Error(
      `SyscallResolver: cannot read ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const layout = parsePeLayout(fileData);
  const { syscalls, byName } = collectZwSyscalls(fileData, layout, warnings);
  const syscallGadgetRva = findSyscallGadget(fileData, layout);

  // Runtime ntoskrnl base (best-effort); SSNs stay static-on-disk above.
  const kernelImageBase = resolveRuntimeKernelBase();

  _resolved = {
    path: resolvedPath,
    syscalls,
    byName,
    syscallGadgetRva,
    warnings,
    kernelImageBase,
  };

  return _resolved;
}

/** Forcibly reset the cache (testing / hot-reload). */
export function resetNtdllCache(): void {
  _resolved = null;
}

/** Section-table geometry needed to map RVAs onto file offsets. */
interface PeLayout {
  /** File offset of the section table. */
  secOff: number;
  numSections: number;
}

/**
 * PE parse (lite -- no dependency on PEAnalyzer).
 *
 * Reads just enough of the NT headers to locate the section table and
 * validates the file is an x64 PE. Every header read is bounds-checked.
 */
function parsePeLayout(fileData: Buffer): PeLayout {
  const e_lfanew = fileData.readUInt32LE(60);
  // Bounds-check every header read below (e_lfanew + optional header must fit).
  if (e_lfanew + 256 > fileData.length) {
    throw new Error('SyscallResolver: truncated PE header');
  }
  const peSig = fileData.readUInt32LE(e_lfanew);
  if (peSig !== 0x4550) throw new Error('SyscallResolver: invalid PE signature');

  const machine = fileData.readUInt16LE(e_lfanew + 4);
  if (machine !== 0x8664) throw new Error('SyscallResolver: ntdll is not x64');

  const numSections = fileData.readUInt16LE(e_lfanew + 6);
  if (numSections > 0x1000) throw new Error('SyscallResolver: implausible section count');
  const sizeOfOptHdr = fileData.readUInt16LE(e_lfanew + 20);
  const secOff = e_lfanew + 24 + sizeOfOptHdr;

  return { secOff, numSections };
}

/** Map an RVA to a file offset via the section table; -1 when unmapped. */
function makeRvaToOffset(fileData: Buffer, layout: PeLayout): (rva: number) => number {
  const { secOff, numSections } = layout;
  return (rva: number): number => {
    for (let i = 0; i < numSections; i++) {
      const off = secOff + i * 40;
      if (off + 40 > fileData.length) break;
      const vAddr = fileData.readUInt32LE(off + 12);
      const vSize = fileData.readUInt32LE(off + 8);
      const rawOff = fileData.readUInt32LE(off + 20);
      if (rva >= vAddr && rva < vAddr + vSize) return rawOff + (rva - vAddr);
    }
    return -1;
  };
}

/**
 * Parse export directory.
 *
 * Walks the export name table and, for every Zw* export, decodes the
 * "mov r10, rcx; mov eax, imm32" prologue into its SSN. Exports whose
 * prologue does not match are reported as warnings instead of being
 * silently skipped.
 */
function collectZwSyscalls(
  fileData: Buffer,
  layout: PeLayout,
  warnings: string[],
): { syscalls: SyscallEntry[]; byName: Record<string, SyscallEntry> } {
  const rvaToOffset = makeRvaToOffset(fileData, layout);
  const e_lfanew = fileData.readUInt32LE(60);

  // Optional header fields (PE32+): export directory at offset 112 within
  // optional header (offset 0 of optional header = offset 24 of NT headers).
  const exportDirRva = fileData.readUInt32LE(e_lfanew + 24 + 112 + 0 * 8);
  const exportDirSize = fileData.readUInt32LE(e_lfanew + 24 + 112 + 4);

  const syscalls: SyscallEntry[] = [];
  const byName: Record<string, SyscallEntry> = {};

  if (exportDirRva === 0 || exportDirSize === 0) {
    throw new Error('SyscallResolver: ntdll has no export directory');
  }
  const expOff = rvaToOffset(exportDirRva);
  if (expOff < 0) throw new Error('SyscallResolver: cannot resolve export directory RVA');

  const numNames = fileData.readUInt32LE(expOff + 24);
  // A malformed count must not drive the export loop into OOB reads -- each
  // name consumes 4 (RVA array) + 2 (ordinal array) bytes inside exportDirSize.
  if (numNames > exportDirSize / 4) {
    throw new Error('SyscallResolver: implausible export count');
  }
  const funcRvaArr = fileData.readUInt32LE(expOff + 28);
  const nameRvaArr = fileData.readUInt32LE(expOff + 32);
  const ordRvaArr = fileData.readUInt32LE(expOff + 36);

  const funcArrOff = rvaToOffset(funcRvaArr);
  const nameArrOff = rvaToOffset(nameRvaArr);
  const ordArrOff = rvaToOffset(ordRvaArr);

  if (funcArrOff < 0 || nameArrOff < 0 || ordArrOff < 0) {
    throw new Error('SyscallResolver: cannot resolve export table arrays');
  }

  for (let i = 0; i < numNames; i++) {
    const nameRva = fileData.readUInt32LE(nameArrOff + i * 4);
    const ordIndex = fileData.readUInt16LE(ordArrOff + i * 2);
    const funcRva = fileData.readUInt32LE(funcArrOff + ordIndex * 4);

    const nameOff = rvaToOffset(nameRva);
    if (nameOff < 0) continue;
    const nameEnd = fileData.indexOf(0, nameOff);
    const name = fileData
      .subarray(nameOff, nameEnd > nameOff ? nameEnd : nameOff + 128)
      .toString('ascii');

    // Only track Zw exports (the syscall gateway layer).
    if (!name.startsWith('Zw')) continue;

    const entry = decodeZwStub(fileData, rvaToOffset, funcRva, name, warnings);
    if (!entry) continue;

    syscalls.push(entry);
    byName[name] = entry;
    // Also register under Nt prefix for convenience.
    byName[name.replace(/^Zw/, 'Nt')] = entry;
  }

  return { syscalls, byName };
}

/**
 * Decode one Zw* export's prologue into a SyscallEntry.
 *
 * Match: 4C 8B D1  B8 XX XX 00 00
 *   offset 0-2: "mov r10, rcx" (4C 8B D1)
 *   offset 3  : "mov eax, imm32" opcode (B8)
 *   offset 4-7: the SSN imm32 (read via readUInt32LE(4) below)
 * Byte-wise: a 3-byte readUInt32LE check would wrongly fold the B8 opcode
 * into the comparison and never match (pre-runtime-test bug: SSN extraction
 * silently returned 0 on a real ntdll while mocked tests passed).
 */
function decodeZwStub(
  fileData: Buffer,
  rvaToOffset: (rva: number) => number,
  funcRva: number,
  name: string,
  warnings: string[],
): SyscallEntry | null {
  const bodyOff = rvaToOffset(funcRva);
  if (bodyOff < 0 || bodyOff + 8 > fileData.length) {
    warnings.push(`${name}: cannot map RVA to file offset`);
    return null;
  }

  const body = fileData.subarray(bodyOff, bodyOff + 8);
  if (
    body[0] !== MOV_R10_RCX[0] ||
    body[1] !== MOV_R10_RCX[1] ||
    body[2] !== MOV_R10_RCX[2] ||
    body[3] !== MOV_EAX_IMM
  ) {
    warnings.push(
      `${name}: prologue does not match "mov r10, rcx; mov eax, imm" -- ` +
        `got ${[...body.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
    );
    return null;
  }

  return { name, ssn: body.readUInt32LE(4), rva: funcRva };
}

/**
 * Find syscall gadget (0F 05 C3).
 *
 * Scans the whole image for the first "syscall; ret" pair and converts its
 * file offset back to an RVA. Throws when the gadget is absent -- a ntdll
 * without it cannot dispatch syscalls at all.
 */
function findSyscallGadget(fileData: Buffer, layout: PeLayout): number {
  const { secOff, numSections } = layout;

  for (let i = 0; i < fileData.length - 3; i++) {
    if (
      fileData[i] !== SYSCALL_GADGET_BYTES[0] ||
      fileData[i + 1] !== SYSCALL_GADGET_BYTES[1] ||
      fileData[i + 2] !== SYSCALL_GADGET_BYTES[2]
    ) {
      continue;
    }
    // Convert file offset to RVA.
    for (let s = 0; s < numSections; s++) {
      const soff = secOff + s * 40;
      const vAddr = fileData.readUInt32LE(soff + 12);
      const vSize = fileData.readUInt32LE(soff + 8);
      const rawOff = fileData.readUInt32LE(soff + 20);
      if (i >= rawOff && i < rawOff + vSize) {
        return vAddr + (i - rawOff);
      }
    }
  }

  throw new Error('SyscallResolver: no syscall;ret gadget found in ntdll .text');
}
