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
      const maxprot = data.readUInt32LE(cursor + 74);
      const nsects = data.readUInt32LE(cursor + 64);

      for (let s = 0; s < Math.min(nsects, 256); s++) {
        const secoff = cursor + 72 + s * 80;
        if (secoff + 80 > data.length) break;

        const secName = readCString(data, secoff, 16);
        const secAddr = data.readBigUInt64LE(secoff + 32);
        const secSize = data.readBigUInt64LE(secoff + 40);
        const secOffset = secoff; // approximate — section file offset at secoff
        const secFlags = data.readUInt32LE(secoff + 64);

        sections.push({
          name: `${segName}.${secName}`,
          addr: secAddr,
          size: Number(secSize),
          fileOffset: secOffset,
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
    // FAT binary — try the first slice (x86-64 or arm64)
    const narch = data.readUInt32BE(4); // FAT header is big-endian
    for (let i = 0; i < narch; i++) {
      const archOff = 8 + i * 20;
      if (archOff + 20 > data.length) break;
      const cputype = data.readUInt32BE(archOff);
      const offset = data.readUInt32BE(archOff + 8);
      const size = data.readUInt32BE(archOff + 12);
      // CPU_TYPE_X86_64 = 0x01000007, CPU_TYPE_ARM64 = 0x0100000C
      if ((cputype === 0x01000007 || cputype === 0x0100000c) && offset + size <= data.length) {
        const innerMagic = data.readUInt32LE(offset);
        if (innerMagic === MH_MAGIC_64) {
          return parseThin(data, offset);
        }
      }
    }
    return [];
  }

  if (magic === MH_MAGIC_64) {
    return parseThin(data, 0);
  }

  return [];
}
