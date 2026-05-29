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
const PF_X = 0b001;
const PF_W = 0b010;
const PF_R = 0b100;
const EHDR_SIZE = 64;
const SHT_DYNSYM = 11;
const SYM_SIZE = 24; // sizeof(Elf64_Sym)

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
   * Returns an empty map when the object has no dynamic symbol table.
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
    if (dynsymSh < 0) return result;

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
      const name = this.readCString(strOffset, strSize, nameOff);
      if (name) result.set(name, value);
    }

    return result;
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
