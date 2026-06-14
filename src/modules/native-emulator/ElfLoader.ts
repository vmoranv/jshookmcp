/**
 * ElfLoader — dependency-free ELF64 parser for AArch64 shared objects (A-plan / L1).
 *
 * Parses the subset of ELF needed to map an Android `.so` into the CpuEngine:
 * the Elf64_Ehdr (class/endianness/machine/type/entry), the program header
 * table (PT_LOAD segments → memory layout), and — when present — the dynamic
 * symbol table (.dynsym/.dynstr) for export resolution. Section-header and
 * relocation handling arrive with the milestones that consume them (L2).
 *
 * Layout reference (ELF64, little-endian AArch64):
 *   Elf64_Ehdr (64B): e_type@0x10, e_machine@0x12, e_entry@0x18, e_phoff@0x20,
 *                     e_phentsize@0x36, e_phnum@0x38, e_shoff@0x28, …
 *   Elf64_Phdr (56B): p_type@0x00, p_flags@0x04, p_offset@0x08, p_vaddr@0x10,
 *                     p_filesz@0x20, p_memsz@0x28, p_align@0x30
 */

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46]; // \x7f E L F
const ELFCLASS64 = 2;
const ELFDATA2LSB = 1;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const PF_X = 0b001;
const PF_W = 0b010;
const PF_R = 0b100;
const EHDR_SIZE = 64;
const SHT_DYNSYM = 11;
const SYM_SIZE = 24; // sizeof(Elf64_Sym)
const RELA_SIZE = 24; // sizeof(Elf64_Rela): r_offset(8) r_info(8) r_addend(8)

// Dynamic-section tags (Elf64_Dyn d_tag values) the loader consumes.
const DT_NULL = 0;
const DT_STRTAB = 5;
const DT_SYMTAB = 6;
const DT_RELA = 7;
const DT_RELASZ = 8;
const DT_STRSZ = 10;
const DT_SYMENT = 11;
const DT_JMPREL = 23;
const DT_PLTRELSZ = 2;
const DT_INIT = 12;
const DT_INIT_ARRAY = 25;
const DT_INIT_ARRAYSZ = 27;

// AArch64 relocation types (r_info low 32 bits) the loader applies.
export const R_AARCH64_ABS64 = 257;
export const R_AARCH64_GLOB_DAT = 1025;
export const R_AARCH64_JUMP_SLOT = 1026;
export const R_AARCH64_RELATIVE = 1027;
export const R_AARCH64_COPY = 1024;

/** One dynamic relocation, resolved against the dynamic symbol table when needed. */
export interface ElfRelocation {
  /** Virtual address the relocation patches (r_offset). */
  offset: number;
  /** AArch64 relocation type (R_AARCH64_*). */
  type: number;
  /** r_addend. */
  addend: number;
  /** Referenced symbol name (empty for symbol-less relocs like RELATIVE). */
  symbolName: string;
  /** Referenced symbol's value/vaddr (0 when undefined/imported). */
  symbolValue: number;
}

/** A loadable (PT_LOAD) segment with its memory image (filesz bytes + zeroed .bss tail). */
export interface LoadableSegment {
  vaddr: number;
  fileSize: number;
  memSize: number;
  readable: boolean;
  writable: boolean;
  executable: boolean;
  /** memSize bytes: file contents followed by a zero-filled tail (.bss). */
  data: Uint8Array;
}

export class ElfLoader {
  readonly is64Bit: boolean;
  readonly isLittleEndian: boolean;
  readonly type: number;
  readonly machine: number;
  readonly entry: number;

  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly phoff: number;
  private readonly phentsize: number;
  private readonly phnum: number;
  private readonly shoff: number;
  private readonly shentsize: number;
  private readonly shnum: number;

  constructor(bytes: Uint8Array) {
    if (
      bytes.length < EHDR_SIZE ||
      bytes[0] !== ELF_MAGIC[0] ||
      bytes[1] !== ELF_MAGIC[1] ||
      bytes[2] !== ELF_MAGIC[2] ||
      bytes[3] !== ELF_MAGIC[3]
    ) {
      throw new Error('Not an ELF file (bad magic)');
    }

    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.is64Bit = bytes[4] === ELFCLASS64;
    this.isLittleEndian = bytes[5] === ELFDATA2LSB;
    if (!this.is64Bit) {
      throw new Error('Only ELF64 is supported');
    }

    const le = this.isLittleEndian;
    this.type = this.view.getUint16(0x10, le);
    this.machine = this.view.getUint16(0x12, le);
    this.entry = Number(this.view.getBigUint64(0x18, le));
    this.phoff = Number(this.view.getBigUint64(0x20, le));
    this.phentsize = this.view.getUint16(0x36, le);
    this.phnum = this.view.getUint16(0x38, le);
    this.shoff = Number(this.view.getBigUint64(0x28, le));
    this.shentsize = this.view.getUint16(0x3a, le);
    this.shnum = this.view.getUint16(0x3c, le);
  }

  /** Enumerate PT_LOAD segments in program-header order. */
  loadableSegments(): LoadableSegment[] {
    const le = this.isLittleEndian;
    const segments: LoadableSegment[] = [];

    for (let i = 0; i < this.phnum; i++) {
      const ph = this.phoff + i * this.phentsize;
      if (this.view.getUint32(ph + 0x00, le) !== PT_LOAD) continue;

      const flags = this.view.getUint32(ph + 0x04, le);
      const offset = Number(this.view.getBigUint64(ph + 0x08, le));
      const vaddr = Number(this.view.getBigUint64(ph + 0x10, le));
      const fileSize = Number(this.view.getBigUint64(ph + 0x20, le));
      const memSize = Number(this.view.getBigUint64(ph + 0x28, le));

      // Materialize the in-memory image: filesz bytes copied from the file,
      // then a zero-filled tail so memSize bytes are available (.bss).
      const data = new Uint8Array(memSize);
      data.set(this.bytes.subarray(offset, offset + fileSize), 0);

      segments.push({
        vaddr,
        fileSize,
        memSize,
        readable: (flags & PF_R) !== 0,
        writable: (flags & PF_W) !== 0,
        executable: (flags & PF_X) !== 0,
        data,
      });
    }

    return segments;
  }

  /**
   * Resolve exported dynamic symbols (name → virtual address) from .dynsym,
   * using the .dynstr table identified by the SHT_DYNSYM section's sh_link.
   * Falls back to PT_DYNAMIC parsing when section headers are absent (real
   * Android `.so` are frequently stripped of them). Returns an empty map when
   * the object has neither.
   */
  exportedSymbols(): Map<string, number> {
    const result = new Map<string, number>();
    const le = this.isLittleEndian;

    // Locate the SHT_DYNSYM section.
    let dynsymSh = -1;
    for (let i = 0; i < this.shnum; i++) {
      const sh = this.shoff + i * this.shentsize;
      if (this.view.getUint32(sh + 0x04, le) === SHT_DYNSYM) {
        dynsymSh = sh;
        break;
      }
    }
    if (dynsymSh < 0) return this.exportedSymbolsFromDynamic();

    const dynsymOffset = Number(this.view.getBigUint64(dynsymSh + 0x18, le));
    const dynsymSize = Number(this.view.getBigUint64(dynsymSh + 0x20, le));
    const strtabIdx = this.view.getUint32(dynsymSh + 0x28, le); // sh_link → .dynstr

    // Resolve the linked string table.
    const strSh = this.shoff + strtabIdx * this.shentsize;
    const strOffset = Number(this.view.getBigUint64(strSh + 0x18, le));
    const strSize = Number(this.view.getBigUint64(strSh + 0x20, le));

    const count = Math.floor(dynsymSize / SYM_SIZE);
    for (let i = 1; i < count; i++) {
      // skip reserved null symbol at index 0
      const sym = dynsymOffset + i * SYM_SIZE;
      const nameOff = this.view.getUint32(sym + 0x00, le);
      const value = Number(this.view.getBigUint64(sym + 0x08, le));
      const shndx = this.view.getUint16(sym + 0x06, le);
      const name = this.readCString(strOffset, strSize, nameOff);
      // Defined symbols only (shndx != SHN_UNDEF=0): imports have value 0 and no
      // home section, and would otherwise shadow a real export at address 0.
      if (name && shndx !== 0) result.set(name, value);
    }

    return result;
  }

  /**
   * Resolve exported symbols via PT_DYNAMIC (DT_SYMTAB/DT_STRTAB), the path real
   * stripped `.so` need since they carry no section header table. Defined
   * symbols (st_shndx != SHN_UNDEF) map name → vaddr.
   */
  private exportedSymbolsFromDynamic(): Map<string, number> {
    const result = new Map<string, number>();
    const dyn = this.dynamicInfo();
    if (!dyn || dyn.symtab === 0 || dyn.strtab === 0) return result;
    const le = this.isLittleEndian;
    const symOff = this.vaddrToOffset(dyn.symtab);
    const strOff = this.vaddrToOffset(dyn.strtab);
    if (symOff < 0 || strOff < 0) return result;
    // DT_SYMTAB has no count; walk until the string-table offset (a common
    // layout where .dynstr immediately follows .dynsym) or the file end.
    const symEnd = strOff > symOff ? strOff : this.bytes.length;
    const count = Math.floor((symEnd - symOff) / SYM_SIZE);
    for (let i = 1; i < count; i++) {
      const sym = symOff + i * SYM_SIZE;
      if (sym + SYM_SIZE > this.bytes.length) break;
      const nameOff = this.view.getUint32(sym + 0x00, le);
      const shndx = this.view.getUint16(sym + 0x06, le);
      const value = Number(this.view.getBigUint64(sym + 0x08, le));
      const name = this.readCString(strOff, dyn.strsz || this.bytes.length - strOff, nameOff);
      if (name && shndx !== 0) result.set(name, value);
    }
    return result;
  }

  /**
   * Parse all dynamic relocations (.rela.dyn + .rela.plt) into a flat list with
   * symbol names/values resolved. Drives GOT/PLT fixups and bionic auto-wiring
   * in CpuEngine.loadElf. Returns an empty list when the object is not dynamic.
   */
  relocations(): ElfRelocation[] {
    const dyn = this.dynamicInfo();
    if (!dyn) return [];
    const le = this.isLittleEndian;
    const out: ElfRelocation[] = [];
    const symOff = dyn.symtab ? this.vaddrToOffset(dyn.symtab) : -1;
    const strOff = dyn.strtab ? this.vaddrToOffset(dyn.strtab) : -1;

    const parseTable = (relaVaddr: number, size: number): void => {
      if (relaVaddr === 0 || size === 0) return;
      const base = this.vaddrToOffset(relaVaddr);
      if (base < 0) return;
      const n = Math.floor(size / RELA_SIZE);
      for (let i = 0; i < n; i++) {
        const rec = base + i * RELA_SIZE;
        if (rec + RELA_SIZE > this.bytes.length) break;
        const offset = Number(this.view.getBigUint64(rec + 0x00, le));
        const info = this.view.getBigUint64(rec + 0x08, le);
        const addend = Number(BigInt.asIntN(64, this.view.getBigUint64(rec + 0x10, le)));
        const type = Number(info & 0xffffffffn);
        const symIndex = Number(info >> 32n);
        let symbolName = '';
        let symbolValue = 0;
        if (symIndex > 0 && symOff >= 0) {
          const sym = symOff + symIndex * SYM_SIZE;
          if (sym + SYM_SIZE <= this.bytes.length) {
            const nameOff = this.view.getUint32(sym + 0x00, le);
            symbolValue = Number(this.view.getBigUint64(sym + 0x08, le));
            if (strOff >= 0) {
              symbolName = this.readCString(
                strOff,
                dyn.strsz || this.bytes.length - strOff,
                nameOff,
              );
            }
          }
        }
        out.push({ offset, type, addend, symbolName, symbolValue });
      }
    };

    parseTable(dyn.rela, dyn.relasz);
    parseTable(dyn.jmprel, dyn.pltrelsz);
    return out;
  }

  /**
   * The object's initializers, in the order a dynamic linker must run them after
   * relocation: the legacy DT_INIT entry first (if present), then each pointer in
   * the DT_INIT_ARRAY. The returned values are the *vaddrs* of the init-array
   * slots (and the DT_INIT function vaddr) — NOT the constructor addresses
   * themselves, because those slots hold R_AARCH64_RELATIVE relocations whose
   * on-disk value is 0 and only becomes the real function address after the
   * caller applies relocations. The caller (CpuEngine) therefore reads each slot
   * out of relocated guest memory to get the actual constructor to call.
   *
   * `init` is the DT_INIT function's vaddr directly (it is an address, not a slot
   * to dereference); `arraySlots` are the vaddrs to read function pointers from.
   */
  initializers(): { init: number; arraySlots: number[] } {
    const dyn = this.dynamicInfo();
    if (!dyn) return { init: 0, arraySlots: [] };
    const slots: number[] = [];
    const count = Math.floor(dyn.initArraySz / 8);
    for (let i = 0; i < count; i++) slots.push(dyn.initArray + i * 8);
    return { init: dyn.init, arraySlots: slots };
  }

  /**
   * Walk PT_DYNAMIC and collect the d_tag/d_val pairs the loader needs. Returns
   * null when the object has no dynamic segment (a static or relocatable file).
   */
  private dynamicInfo(): {
    symtab: number;
    strtab: number;
    strsz: number;
    rela: number;
    relasz: number;
    jmprel: number;
    pltrelsz: number;
    init: number;
    initArray: number;
    initArraySz: number;
  } | null {
    const le = this.isLittleEndian;
    let dynOff = -1;
    let dynSize = 0;
    for (let i = 0; i < this.phnum; i++) {
      const ph = this.phoff + i * this.phentsize;
      if (this.view.getUint32(ph + 0x00, le) === PT_DYNAMIC) {
        dynOff = Number(this.view.getBigUint64(ph + 0x08, le)); // p_offset
        dynSize = Number(this.view.getBigUint64(ph + 0x20, le)); // p_filesz
        break;
      }
    }
    if (dynOff < 0) return null;
    const info = {
      symtab: 0,
      strtab: 0,
      strsz: 0,
      rela: 0,
      relasz: 0,
      jmprel: 0,
      pltrelsz: 0,
      init: 0,
      initArray: 0,
      initArraySz: 0,
    };
    const entries = Math.floor(dynSize / 16); // Elf64_Dyn = { i64 tag; u64 val }
    for (let i = 0; i < entries; i++) {
      const e = dynOff + i * 16;
      const tag = Number(BigInt.asIntN(64, this.view.getBigUint64(e + 0x00, le)));
      const val = Number(this.view.getBigUint64(e + 0x08, le));
      if (tag === DT_NULL) break;
      switch (tag) {
        case DT_SYMTAB:
          info.symtab = val;
          break;
        case DT_STRTAB:
          info.strtab = val;
          break;
        case DT_STRSZ:
          info.strsz = val;
          break;
        case DT_RELA:
          info.rela = val;
          break;
        case DT_RELASZ:
          info.relasz = val;
          break;
        case DT_JMPREL:
          info.jmprel = val;
          break;
        case DT_PLTRELSZ:
          info.pltrelsz = val;
          break;
        case DT_INIT:
          info.init = val;
          break;
        case DT_INIT_ARRAY:
          info.initArray = val;
          break;
        case DT_INIT_ARRAYSZ:
          info.initArraySz = val;
          break;
        case DT_SYMENT:
        default:
          break;
      }
    }
    return info;
  }

  /**
   * Translate a virtual address to a file offset using the PT_LOAD segments.
   * Dynamic-section pointers (DT_SYMTAB/STRTAB/RELA, r_offset) are vaddrs; we
   * read them out of the on-disk image. Returns -1 when unmapped.
   */
  private vaddrToOffset(vaddr: number): number {
    const le = this.isLittleEndian;
    for (let i = 0; i < this.phnum; i++) {
      const ph = this.phoff + i * this.phentsize;
      if (this.view.getUint32(ph + 0x00, le) !== PT_LOAD) continue;
      const off = Number(this.view.getBigUint64(ph + 0x08, le));
      const va = Number(this.view.getBigUint64(ph + 0x10, le));
      const filesz = Number(this.view.getBigUint64(ph + 0x20, le));
      if (vaddr >= va && vaddr < va + filesz) return off + (vaddr - va);
    }
    return -1;
  }

  /** Read a NUL-terminated string from a string table at the given index. */
  private readCString(tableOffset: number, tableSize: number, index: number): string {
    if (index <= 0 || index >= tableSize) return '';
    let end = tableOffset + index;
    const limit = tableOffset + tableSize;
    while (end < limit && this.bytes[end] !== 0) end++;
    return new TextDecoder().decode(this.bytes.subarray(tableOffset + index, end));
  }
}
