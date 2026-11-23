import { readFileSync } from 'node:fs';

export interface ElfSection {
  name: string;
  addr: bigint;
  size: number;
  fileOffset: number;
  isExecutable: boolean;
  isWritable: boolean;
}

/** ELF header fields exposed by `parseElfHeader` (E5-C cross-platform parity). */
export interface ElfHeader {
  /** ELF class: 1=32-bit, 2=64-bit. */
  class: number;
  /** Data encoding: 1=LE, 2=BE. */
  dataEncoding: number;
  /** Object type: 1=REL, 2=EXEC, 3=DYN (.so/Pie), 4=CORE. */
  type: number;
  /** Architecture: 0x3E=x86_64, 0xB7=AArch64, 0x28=ARM, 0x03=i386. */
  machine: number;
  /** Entry point virtual address (0 for shared libs without a default entry). */
  entry: bigint;
  /** Processor-specific flags (e_flags). */
  flags: number;
  /** Number of program headers (segments). */
  phnum: number;
  /** Number of section headers. */
  shnum: number;
}

/** A single dynamic symbol (function/object imported or exported). */
export interface ElfSymbol {
  name: string;
  /** Virtual address (0 for imports / undefined symbols). */
  value: bigint;
  /** Symbol binding: 0=LOCAL, 1=GLOBAL, 2=WEAK. */
  bind: number;
  /** Symbol type: 0=NOTYPE, 1=OBJECT, 2=FUNC. */
  type: number;
  /** True if undefined (st_shndx == SHN_UNDEF) — i.e. an import. */
  isImport: boolean;
}

/** Dynamic symbol table split into imports (undefined) and exports (defined). */
export interface ElfSymbolTable {
  imports: ElfSymbol[];
  exports: ElfSymbol[];
}

const ELFCLASS64 = 2;
/** EI_DATA value for little-endian. Every read below uses the *LE decoders. */
const ELFDATA2LSB = 1;
const SHF_EXECINSTR = 0x4;
const SHF_WRITE = 0x1;
const SHF_ALLOC = 0x2;

/** Section header type: dynamic symbol table. */
const SHT_DYNSYM = 11;
/** Section header type: dynamic string table (paired with .dynsym). */
const SHT_DYNSTR = 3;
/** Undefined section index → symbol is an import. */
const SHN_UNDEF = 0;

/** Minimum viable ELF64 sanity check + returns the buffer, or null if not ELF64. */
function readElf64(filePath: string): Buffer | null {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return null;
  }
  if (
    data.length < 64 ||
    data[0] !== 0x7f ||
    data[1] !== 0x45 ||
    data[2] !== 0x4c ||
    data[3] !== 0x46 ||
    data[4] !== ELFCLASS64 ||
    data[5] !== ELFDATA2LSB // reject BE/invalid encoding — reads below are LE
  )
    return null;
  return data;
}

/** Read a NUL-terminated string from `data` at `offset`, capped at `maxLen`. */
function readCString(data: Buffer, offset: number, maxLen: number): string {
  const end = Math.min(offset + maxLen, data.length);
  let s = '';
  for (let i = offset; i < end; i++) {
    const c = data[i]!;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export function parseElfHeader(filePath: string): ElfHeader | null {
  const data = readElf64(filePath);
  if (!data) return null;
  return {
    class: data[4]!,
    dataEncoding: data[5]!,
    type: data.readUInt16LE(16),
    machine: data.readUInt16LE(18),
    entry: data.readBigUInt64LE(24),
    flags: data.readUInt32LE(48),
    phnum: data.readUInt16LE(56),
    shnum: data.readUInt16LE(60),
  };
}

export function parseElfSections(filePath: string): ElfSection[] {
  const data = readElf64(filePath);
  if (!data) return [];

  const shOff = Number(data.readBigUInt64LE(0x28));
  const shEntSize = data.readUInt16LE(0x3a);
  const shNum = data.readUInt16LE(0x3c);
  const shStrNdx = data.readUInt16LE(0x3e);
  if (shNum === 0 || shEntSize < 64) return [];

  // String table header — only the sh_offset field (8 bytes at +0x18) is read,
  // so the check must cover through byte 0x20; a truncated header would
  // otherwise throw ERR_BUFFER_OUT_OF_BOUNDS from readBigUInt64LE.
  const strHdrOff = shOff + shStrNdx * shEntSize;
  if (strHdrOff + 32 > data.length) return [];
  const strOff = Number(data.readBigUInt64LE(strHdrOff + 0x18));

  const sections: ElfSection[] = [];
  for (let i = 0; i < Math.min(shNum, 512); i++) {
    const hdrOff = shOff + i * shEntSize;
    if (hdrOff + shEntSize > data.length) break;

    const nameIdx = data.readUInt32LE(hdrOff);
    const flags = Number(data.readBigUInt64LE(hdrOff + 0x8));
    const addr = data.readBigUInt64LE(hdrOff + 0x10);
    const secOff = Number(data.readBigUInt64LE(hdrOff + 0x18));
    const size = Number(data.readBigUInt64LE(hdrOff + 0x20));

    if ((flags & SHF_ALLOC) === 0) continue;

    sections.push({
      name: readCString(data, strOff + nameIdx, 64) || `.sec_${i}`,
      addr,
      size,
      fileOffset: secOff,
      isExecutable: (flags & SHF_EXECINSTR) !== 0,
      isWritable: (flags & SHF_WRITE) !== 0,
    });
  }
  return sections;
}

/**
 * Parse the ELF dynamic symbol table (.dynsym + .dynstr) and split it into
 * imports (undefined symbols — st_shndx == SHN_UNDEF) and exports (defined
 * global/weak functions/objects). Returns empty lists if the file has no
 * dynamic symbol table (static archives, relocatable objects).
 */
export function parseElfSymbols(filePath: string): ElfSymbolTable {
  const data = readElf64(filePath);
  if (!data) return { imports: [], exports: [] };

  const shOff = Number(data.readBigUInt64LE(0x28));
  const shEntSize = data.readUInt16LE(0x3a);
  const shNum = data.readUInt16LE(0x3c);
  if (shNum === 0 || shEntSize < 64) return { imports: [], exports: [] };

  // Locate .dynsym (SHT_DYNSYM) and its paired .dynstr.
  let dynsymOff = -1;
  let dynsymSize = 0;
  let dynsymEntSize = 24; // Elf64_Sym is 24 bytes
  let dynstrOff = -1;
  for (let i = 0; i < shNum; i++) {
    const hdrOff = shOff + i * shEntSize;
    if (hdrOff + shEntSize > data.length) break;
    const shType = data.readUInt32LE(hdrOff + 4);
    if (shType === SHT_DYNSYM) {
      dynsymOff = Number(data.readBigUInt64LE(hdrOff + 0x18));
      dynsymSize = Number(data.readBigUInt64LE(hdrOff + 0x20));
      dynsymEntSize = data.readUInt32LE(hdrOff + 0x38) || 24;
      const linkIdx = data.readUInt32LE(hdrOff + 0x28); // sh_link → .dynstr index
      const strHdr = shOff + linkIdx * shEntSize;
      if (strHdr + shEntSize <= data.length) {
        dynstrOff = Number(data.readBigUInt64LE(strHdr + 0x18));
      }
    } else if (shType === SHT_DYNSTR && dynstrOff < 0) {
      // Fallback if sh_link was malformed.
      dynstrOff = Number(data.readBigUInt64LE(hdrOff + 0x18));
    }
  }
  if (dynsymOff < 0 || dynstrOff < 0) return { imports: [], exports: [] };

  const imports: ElfSymbol[] = [];
  const exports: ElfSymbol[] = [];
  const count = Math.floor(dynsymSize / dynsymEntSize);
  for (let i = 0; i < Math.min(count, 8192); i++) {
    const off = dynsymOff + i * dynsymEntSize;
    if (off + 24 > data.length) break;
    const stName = data.readUInt32LE(off);
    const stInfo = data[off + 4]!;
    const stShndx = data.readUInt16LE(off + 6);
    const stValue = data.readBigUInt64LE(off + 8);
    const name = readCString(data, dynstrOff + stName, 256);
    if (!name) continue;
    const bind = stInfo >> 4;
    const type = stInfo & 0xf;
    const isImport = stShndx === SHN_UNDEF;
    const sym: ElfSymbol = { name, value: stValue, bind, type, isImport };
    if (isImport) {
      imports.push(sym);
    } else if (bind === 1 || bind === 2) {
      // GLOBAL or WEAK defined symbol → export.
      exports.push(sym);
    }
  }
  return { imports, exports };
}
