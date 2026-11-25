/**
 * MachOParser — read load commands from a Mach-O binary to find segments.
 *
 * Supports FAT binaries (fat_arch → embedded Mach-O) and thin Mach-O 64-bit.
 */
import { readFileSync } from 'node:fs';

export interface MachoSection {
  name: string;
  addr: bigint;
  size: number;
  fileOffset: number;
  isExecutable: boolean;
  isWritable: boolean;
}

// Constants
const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_CIGAM = 0xbebafeca;
const LC_SEGMENT_64 = 0x19;
/** LC_SYMTAB — classic symbol table (nlist_64). */
const LC_SYMTAB = 0x2;
/** n_type bit: external symbol (import or export candidate). */
const N_EXT = 0x01;

function parseThin(data: Buffer, offset: number): MachoSection[] {
  if (offset + 32 > data.length) return [];

  const sizeofcmds = data.readUInt32LE(offset + 20);

  let cursor = offset + 32;
  const end = Math.min(cursor + sizeofcmds, data.length);
  const sections: MachoSection[] = [];

  while (cursor + 8 <= end) {
    const cmd = data.readUInt32LE(cursor);
    const cmdsize = data.readUInt32LE(cursor + 4);
    if (cmdsize < 8) break;

    if (cmd === LC_SEGMENT_64 && cursor + 72 <= data.length) {
      // Segment name at offset 8 (16 bytes)
      const segName = readCString(data, cursor + 8, 16);
      // segment_command_64 layout: cmd(4) cmdsize(4) segname(16) vmaddr(8)
      // vmsize(8) fileoff(8) filesize(8) maxprot(4) initprot(4) nsects(4) flags(4)
      const maxprot = data.readUInt32LE(cursor + 56);
      const nsects = data.readUInt32LE(cursor + 64);

      for (let s = 0; s < Math.min(nsects, 256); s++) {
        const secoff = cursor + 72 + s * 80;
        if (secoff + 80 > data.length) break;

        const secName = readCString(data, secoff, 16);
        const secAddr = data.readBigUInt64LE(secoff + 32);
        const secSize = data.readBigUInt64LE(secoff + 40);
        // section_64.offset (secoff + 48) is the real file offset of the section
        // data — the section struct's own address (secoff) is only valid for
        // zerofill sections and is meaningless as a file position.
        const secOffset = data.readUInt32LE(secoff + 48);
        const secFlags = data.readUInt32LE(secoff + 64);

        sections.push({
          name: `${segName}.${secName}`,
          addr: secAddr,
          size: Number(secSize),
          // section_64.offset is relative to the start of the embedded Mach-O
          // slice; rebase it so FAT consumers get an absolute file offset.
          fileOffset: offset + secOffset,
          isExecutable: (maxprot & 0x4) !== 0 || (secFlags & 0x4) !== 0,
          isWritable: (maxprot & 0x2) !== 0,
        });
      }
    }

    cursor += cmdsize;
  }

  return sections;
}

function readCString(buf: Buffer, off: number, max: number): string {
  let end = off;
  while (end < off + max && end < buf.length && buf[end] !== 0) end++;
  return buf.subarray(off, end).toString('ascii');
}

/**
 * Walk a FAT arch table and return the file offset of the first x86-64 or
 * arm64 thin slice that starts with a Mach-O 64 magic, or -1 when no
 * suitable slice exists. Shared by {@link parseMachoSections} and
 * {@link findThinOffset}.
 */
function findThinOffsetInFAT(data: Buffer): number {
  if (data.length < 8) return -1; // need magic(4) + nfat_arch(4)
  const narch = data.readUInt32BE(4); // FAT header is big-endian
  for (let i = 0; i < narch; i++) {
    const archOff = 8 + i * 20;
    if (archOff + 20 > data.length) break;
    const cputype = data.readUInt32BE(archOff);
    const offset = data.readUInt32BE(archOff + 8);
    const size = data.readUInt32BE(archOff + 12);
    // CPU_TYPE_X86_64 = 0x01000007, CPU_TYPE_ARM64 = 0x0100000C
    if (
      (cputype === 0x01000007 || cputype === 0x0100000c) &&
      size >= 4 &&
      offset + size <= data.length
    ) {
      if (data.readUInt32LE(offset) === MH_MAGIC_64) return offset;
    }
  }
  return -1;
}

/**
 * Parse a Mach-O (or FAT) on-disk binary and return its loadable segments.
 * Returns [] when the file is not a recognised Mach-O.
 */
export function parseMachoSections(filePath: string): MachoSection[] {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return [];
  }

  if (data.length < 4) return [];

  const magic = data.readUInt32LE(0);

  if (magic === FAT_MAGIC || magic === FAT_CIGAM) {
    // FAT binary — parse the first x86-64/arm64 slice found
    const offset = findThinOffsetInFAT(data);
    return offset >= 0 ? parseThin(data, offset) : [];
  }

  if (magic === MH_MAGIC_64) {
    return parseThin(data, 0);
  }

  return [];
}

/** Mach-O 64-bit header fields exposed by `parseMachOHeader` (E5-C parity). */
export interface MachOHeader {
  /** CPU type: 0x01000007=x86_64, 0x0100000C=arm64. */
  cpuType: number;
  /** CPU subtype. */
  cpuSubtype: number;
  /** File type: 1=object, 2=executable, 6=dylib, 7=bundle. */
  fileType: number;
  /** Number of load commands. */
  ncmds: number;
  /** Size of all load commands. */
  sizeofcmds: number;
  /** Header flags. */
  flags: number;
}

/** A single Mach-O symbol (nlist_64). */
export interface MachOSymbol {
  name: string;
  /** Virtual address (n_value; 0 for undefined imports). */
  value: bigint;
  /** Section index (n_sect); 0 = undefined (import). */
  sect: number;
  /** True if external (N_EXT). */
  isExternal: boolean;
  /** True if undefined import (n_sect == 0 && N_EXT). */
  isImport: boolean;
}

export interface MachOSymbolTable {
  imports: MachOSymbol[];
  exports: MachOSymbol[];
}

/** Find the file offset of the thin Mach-O 64 slice inside a FAT binary (or 0). */
function findThinOffset(data: Buffer): number {
  if (data.length < 4) return -1;
  const magic = data.readUInt32LE(0);
  if (magic === FAT_MAGIC || magic === FAT_CIGAM) {
    return findThinOffsetInFAT(data);
  }
  return magic === MH_MAGIC_64 ? 0 : -1;
}

/** Parse the Mach-O 64 header. Returns null for non-Mach-O files. */
export function parseMachOHeader(filePath: string): MachOHeader | null {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return null;
  }
  const offset = findThinOffset(data);
  if (offset < 0 || offset + 32 > data.length) return null;
  return {
    cpuType: data.readUInt32LE(offset + 4),
    cpuSubtype: data.readUInt32LE(offset + 8),
    fileType: data.readUInt32LE(offset + 12),
    ncmds: data.readUInt32LE(offset + 16),
    sizeofcmds: data.readUInt32LE(offset + 20),
    flags: data.readUInt32LE(offset + 24),
  };
}

/**
 * Parse the LC_SYMTAB symbol table and split into imports (undefined external)
 * and exports (defined external). Returns empty lists for non-Mach-O files or
 * files with no symbol table.
 */
export function parseMachOSymbols(filePath: string): MachOSymbolTable {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return { imports: [], exports: [] };
  }
  const offset = findThinOffset(data);
  if (offset < 0 || offset + 32 > data.length) return { imports: [], exports: [] };

  const sizeofcmds = data.readUInt32LE(offset + 20);
  const cmdStart = offset + 32;
  const cmdEnd = Math.min(cmdStart + sizeofcmds, data.length);

  // Find LC_SYMTAB.
  let symoff = 0;
  let nsyms = 0;
  let stroff = 0;
  let strsize = 0;
  let found = false;
  let cursor = cmdStart;
  while (cursor + 8 <= cmdEnd) {
    const cmd = data.readUInt32LE(cursor);
    const cmdsize = data.readUInt32LE(cursor + 4);
    if (cmdsize < 8) break;
    if (cmd === LC_SYMTAB && cursor + 24 <= data.length) {
      symoff = data.readUInt32LE(cursor + 8);
      nsyms = data.readUInt32LE(cursor + 12);
      stroff = data.readUInt32LE(cursor + 16);
      strsize = data.readUInt32LE(cursor + 20);
      found = true;
      break;
    }
    cursor += cmdsize;
  }
  if (!found) return { imports: [], exports: [] };

  const imports: MachOSymbol[] = [];
  const exports: MachOSymbol[] = [];
  // nlist_64 is 16 bytes: n_strx(4) n_type(1) n_sect(1) n_desc(2) n_value(8).
  for (let i = 0; i < Math.min(nsyms, 8192); i++) {
    // symoff/stroff are relative to the embedded Mach-O slice, not the file.
    const entry = offset + symoff + i * 16;
    if (entry + 16 > data.length) break;
    const nStrx = data.readUInt32LE(entry);
    const nType = data[entry + 4]!;
    const nSect = data[entry + 5]!;
    const nValue = data.readBigUInt64LE(entry + 8);
    const isExternal = (nType & N_EXT) !== 0;
    if (!isExternal) continue; // local symbols are not import/export candidates
    const name = readCString(data, offset + stroff + nStrx, 256);
    if (!name) continue;
    const isImport = nSect === 0;
    const sym: MachOSymbol = {
      name,
      value: nValue,
      sect: nSect,
      isExternal,
      isImport,
    };
    if (isImport) imports.push(sym);
    else exports.push(sym);
  }
  void strsize;
  return { imports, exports };
}
