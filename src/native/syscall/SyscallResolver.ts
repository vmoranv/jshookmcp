/**
 * Parse on-disk ntdll to extract system-service numbers and a `syscall;ret`
 * gadget.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
const MOV_R10_RCX = 0xd18b4c; // little-endian bytes of "4C 8B D1"

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

  // ── PE parse (lite — no dependency on PEAnalyzer) ─────────────────────
  const e_lfanew = fileData.readUInt32LE(60);
  const peSig = fileData.readUInt32LE(e_lfanew);
  if (peSig !== 0x4550) throw new Error('SyscallResolver: invalid PE signature');

  const machine = fileData.readUInt16LE(e_lfanew + 4);
  if (machine !== 0x8664) throw new Error('SyscallResolver: ntdll is not x64');

  const numSections = fileData.readUInt16LE(e_lfanew + 6);
  const sizeOfOptHdr = fileData.readUInt16LE(e_lfanew + 20);
  const secOff = e_lfanew + 24 + sizeOfOptHdr;

  // Optional header fields (PE32+): export directory at offset 112 within
  // optional header (offset 0 of optional header = offset 24 of NT headers).
  const exportDirRva = fileData.readUInt32LE(e_lfanew + 24 + 112 + 0 * 8);
  const exportDirSize = fileData.readUInt32LE(e_lfanew + 24 + 112 + 4);

  // ── RVA → file-offset helper ───────────────────────────────────────────
  function rvaToOffset(rva: number): number {
    for (let i = 0; i < numSections; i++) {
      const off = secOff + i * 40;
      if (off + 40 > fileData.length) break;
      const vAddr = fileData.readUInt32LE(off + 12);
      const vSize = fileData.readUInt32LE(off + 8);
      const rawOff = fileData.readUInt32LE(off + 20);
      if (rva >= vAddr && rva < vAddr + vSize) return rawOff + (rva - vAddr);
    }
    return -1;
  }

  // ── Parse export directory ─────────────────────────────────────────────
  const syscalls: SyscallEntry[] = [];
  const byName: Record<string, SyscallEntry> = {};

  if (exportDirRva === 0 || exportDirSize === 0) {
    throw new Error('SyscallResolver: ntdll has no export directory');
  }
  const expOff = rvaToOffset(exportDirRva);
  if (expOff < 0) throw new Error('SyscallResolver: cannot resolve export directory RVA');

  const numNames = fileData.readUInt32LE(expOff + 24);
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

    // Read export name
    const nameOff = rvaToOffset(nameRva);
    if (nameOff < 0) continue;
    const nameEnd = fileData.indexOf(0, nameOff);
    const name = fileData
      .subarray(nameOff, nameEnd > nameOff ? nameEnd : nameOff + 128)
      .toString('ascii');

    // Only track Zw exports (the syscall gateway layer).
    if (!name.startsWith('Zw')) continue;

    // Read first 8 bytes of the function body.
    const bodyOff = rvaToOffset(funcRva);
    if (bodyOff < 0 || bodyOff + 8 > fileData.length) {
      warnings.push(`${name}: cannot map RVA to file offset`);
      continue;
    }

    const body = fileData.subarray(bodyOff, bodyOff + 8);
    // Match: 4C 8B D1  B8 XX XX 00 00
    if (body.readUInt32LE(0) !== MOV_R10_RCX || body[4] !== 0xb8) {
      warnings.push(
        `${name}: prologue does not match "mov r10, rcx; mov eax, imm" — ` +
          `got ${[...body.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
      );
      continue;
    }

    const ssn = body.readUInt32LE(4); // B8 imm32 → SSN in low 32 bits
    const entry: SyscallEntry = { name, ssn, rva: funcRva };
    syscalls.push(entry);
    byName[name] = entry;
    // Also register under Nt prefix for convenience.
    byName[name.replace(/^Zw/, 'Nt')] = entry;
  }

  // ── Find syscall gadget (0F 05 C3) ────────────────────────────────────
  let syscallGadgetRva = 0;
  for (let i = 0; i < fileData.length - 3; i++) {
    if (
      fileData[i] === SYSCALL_GADGET_BYTES[0] &&
      fileData[i + 1] === SYSCALL_GADGET_BYTES[1] &&
      fileData[i + 2] === SYSCALL_GADGET_BYTES[2]
    ) {
      // Convert file offset to RVA.
      for (let s = 0; s < numSections; s++) {
        const soff = secOff + s * 40;
        const vAddr = fileData.readUInt32LE(soff + 12);
        const vSize = fileData.readUInt32LE(soff + 8);
        const rawOff = fileData.readUInt32LE(soff + 20);
        if (i >= rawOff && i < rawOff + vSize) {
          syscallGadgetRva = vAddr + (i - rawOff);
          break;
        }
      }
      if (syscallGadgetRva !== 0) break;
    }
  }

  if (syscallGadgetRva === 0) {
    throw new Error('SyscallResolver: no syscall;ret gadget found in ntdll .text');
  }

  _resolved = {
    resolvedPath,
    syscalls,
    byName,
    syscallGadgetRva,
    warnings,
  };

  return _resolved;
}

/** Forcibly reset the cache (testing / hot-reload). */
export function resetNtdllCache(): void {
  _resolved = null;
}
