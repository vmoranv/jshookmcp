/**
 * got-inspector — PLT/GOT trampoline mapper for ARM64 ELF shared objects.
 *
 * Scans .text for the 4-instruction trampoline pattern used by libsgmainso-style
 * obfuscated SO files and maps each trampoline slot to its GOT entry and the
 * resolved symbol (from dynamic relocations). This answers "what is bl 0xACD0
 * actually calling?" without manual readelf / Python scripts.
 *
 * Pattern (one slot per 16 bytes):
 *   adrp x16, page_base       @ 1b00 0035 D0
 *   ldr  x17, [x16, #offset]  @ single ldr
 *   add  x17, x16, x17        @ 8b 02 11 91
 *   br   x17                  @ 20 02 1F D6
 */
import {
  ElfLoader,
  R_AARCH64_GLOB_DAT,
  R_AARCH64_JUMP_SLOT,
  type ElfRelocation,
} from './ElfLoader';

export interface GotEntry {
  /** Trampoline virtual address (entry point callers use). */
  trampolineAddr: number;
  /** Slot index within the trampoline table. */
  slotIndex: number;
  /** GOT entry virtual address. */
  gotAddr: number;
  /** Resolved symbol name (empty if unmatched). */
  symbol: string;
  /** Relocation type name. */
  relocType: string;
}

export interface GotDump {
  pageBase: number;
  tableStart: number;
  entryCount: number;
  entries: GotEntry[];
  /** Trampoline addrs that couldn't be matched to any relocation. */
  unmatched: number[];
}

// ---- ARM64 instruction decode helpers ----

/** Sign-extend a 21-bit ADRP immediate to a 33-bit page offset (low 12 bits = 0). */
function decodeAdrpImm(insn: number): number {
  // immlo = bits[30:29], immhi = bits[23:5]
  const immlo = (insn >>> 29) & 3;
  const immhi = (insn >>> 5) & 0x7ffff;
  let imm = (immhi << 2) | immlo;
  if (imm & (1 << 20)) imm -= 1 << 21; // sign-extend 21→33 bits
  return imm << 12;
}

/** Extract the unsigned scaled offset from an LDR (unsigned immediate) instruction. */
function decodeLdrImm12(insn: number): number {
  return ((insn >>> 10) & 0xfff) * 8;
}

// ---- Trampoline scanner ----

/**
 * Walk the whole .text-ish range and collect every 4-insn trampoline cluster
 * whose adrp shares the same page. Returns trampolines grouped by page base.
 *
 * Heuristic: a trampoline is 4 consecutive instructions matching the pattern.
 * We only accept clusters of ≥3 slots sharing the same page base, which filters
 * out false positives from random adrp/ldr/add/br sequences in regular code.
 */
function scanTrampolines(elf: ElfLoader, bytes: Uint8Array): Map<number, number[]> {
  const result = new Map<number, number[]>();
  // Scan from the typical .text start (first loadable segment) to the end of code.
  // For performance we limit to 256KB range — covers all practical trampoline tables.
  const minAddr = elf.entry > 0 ? 0x4000 : 0x8000;
  const maxAddr = Math.min(bytes.length, 0x90000);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = true;

  for (let addr = minAddr; addr <= maxAddr - 16; addr += 4) {
    const insn0 = view.getUint32(addr, le);
    const insn1 = view.getUint32(addr + 4, le);
    const insn2 = view.getUint32(addr + 8, le);
    const insn3 = view.getUint32(addr + 12, le);

    // adrp x16, ...
    // NOTE: `&` yields a signed 32-bit int; apply `>>> 0` *after* the AND or
    // every masked value with bit 31 set compares against a positive literal.
    if ((insn0 & 0x9f00001f) >>> 0 !== 0x90000010) continue;
    // ldr  x17, [x16, #imm]  (unsigned imm; imm12/Rn are masked out)
    if ((insn1 & 0xffc0001f) >>> 0 !== 0xf9400011) continue;
    // add  x17, x16, x17  (Rn/Rd are masked out)
    if ((insn2 & 0xfffffc00) >>> 0 !== 0x8b110200) continue;
    // br   x17
    if ((insn3 & 0xffffffe0) >>> 0 !== 0xd61f0220) continue;

    const pageBase = (addr & ~0xfff) + decodeAdrpImm(insn0);

    let list = result.get(pageBase);
    if (!list) {
      list = [];
      result.set(pageBase, list);
    }
    list.push(addr);
  }

  // Only keep clusters with ≥3 entries
  const filtered = new Map<number, number[]>();
  for (const [pb, addrs] of result) {
    if (addrs.length >= 3) filtered.set(pb, addrs);
  }
  return filtered;
}

/** Build a GOT-address → ElfRelocation lookup map. */
function buildRelocMap(elf: ElfLoader): Map<number, ElfRelocation> {
  const map = new Map<number, ElfRelocation>();
  for (const rel of elf.relocations()) {
    if (rel.type === R_AARCH64_JUMP_SLOT || rel.type === R_AARCH64_GLOB_DAT) {
      map.set(rel.offset, rel);
    }
  }
  return map;
}

// ---- Public API ----

export function dumpGot(bytes: Uint8Array): GotDump[] {
  const elf = new ElfLoader(bytes);
  const relocMap = buildRelocMap(elf);
  const clusters = scanTrampolines(elf, bytes);
  const results: GotDump[] = [];

  const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = true;

  for (const [pageBase, addrs] of clusters) {
    const entries: GotEntry[] = [];
    const unmatched: number[] = [];

    for (let i = 0; i < addrs.length; i++) {
      const trampAddr = addrs[i]!;
      const ldrInsn = dataView.getUint32(trampAddr + 4, le);
      const gotAddr = pageBase + decodeLdrImm12(ldrInsn);
      const rel = relocMap.get(gotAddr);
      const entry: GotEntry = {
        trampolineAddr: trampAddr,
        slotIndex: i,
        gotAddr,
        symbol: rel?.symbolName ?? '',
        relocType: rel
          ? rel.type === R_AARCH64_JUMP_SLOT
            ? 'JUMP_SLOT'
            : rel.type === R_AARCH64_GLOB_DAT
              ? 'GLOB_DAT'
              : `TYPE_${rel.type}`
          : '',
      };
      entries.push(entry);
      if (!rel) unmatched.push(trampAddr);
    }

    results.push({
      pageBase,
      tableStart: addrs[0]!,
      entryCount: entries.length,
      entries,
      unmatched,
    });
  }

  return results;
}

export interface GotRelocation {
  /** Virtual address of the GOT slot this relocation writes. */
  gotAddr: number;
  /** Imported symbol name (empty for unnamed/relative relocations). */
  symbol: string;
  /** `JUMP_SLOT` (lazy PLT) or `GLOB_DAT` (absolute GOT entry). */
  relocType: string;
}

/**
 * Dump every dynamic GOT relocation (`R_AARCH64_JUMP_SLOT` / `R_AARCH64_GLOB_DAT`).
 *
 * Libraries built with `-fno-plt`/`-Wl,-z,now` (or otherwise without the
 * adrp/ldr/add/br trampoline table) have GOT slots but no PLT trampolines, so
 * {@link dumpGot} legitimately finds no clusters. The GOT entries still exist
 * as dynamic relocations; this fallback enumerates them directly so the tool
 * answers "which imports resolve through the GOT?" for those binaries too.
 */
export function dumpDynamicRelocations(bytes: Uint8Array): GotRelocation[] {
  const elf = new ElfLoader(bytes);
  const out: GotRelocation[] = [];
  for (const rel of elf.relocations()) {
    if (rel.type !== R_AARCH64_JUMP_SLOT && rel.type !== R_AARCH64_GLOB_DAT) continue;
    out.push({
      gotAddr: rel.offset,
      symbol: rel.symbolName ?? '',
      relocType: rel.type === R_AARCH64_JUMP_SLOT ? 'JUMP_SLOT' : 'GLOB_DAT',
    });
  }
  out.sort((a, b) => a.gotAddr - b.gotAddr);
  return out;
}
