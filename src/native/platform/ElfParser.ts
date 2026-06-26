import { readFileSync } from 'node:fs';

export interface ElfSection {
  name: string;
  addr: bigint;
  size: number;
  fileOffset: number;
  isExecutable: boolean;
  isWritable: boolean;
}

const ELFCLASS64 = 2;
const SHF_EXECINSTR = 0x4;
const SHF_WRITE = 0x1;
const SHF_ALLOC = 0x2;

export function parseElfSections(filePath: string): ElfSection[] {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch {
    return [];
  }
  if (
    data.length < 20 ||
    data[0] !== 0x7f ||
    data[1] !== 0x45 ||
    data[2] !== 0x4c ||
    data[3] !== 0x46
  )
    return [];
  if (data[4] !== ELFCLASS64) return [];

  const shOff = Number(data.readBigUInt64LE(0x28));
  const shEntSize = data.readUInt16LE(0x3a);
  const shNum = data.readUInt16LE(0x3c);
  const shStrNdx = data.readUInt16LE(0x3e);
  if (shNum === 0 || shEntSize < 64) return [];

  // String table header
  const strHdrOff = shOff + shStrNdx * shEntSize;
  if (strHdrOff + 24 > data.length) return [];
  const strOff = Number(data.readBigUInt64LE(strHdrOff + 0x18));
  const strSz = Number(data.readBigUInt64LE(strHdrOff + 0x20));

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

    let name = '';
    const nameOff = strOff + nameIdx;
    for (let c = nameOff; c < Math.min(nameOff + 64, strOff + strSz, data.length); c++) {
      if (data[c] === 0) break;
      name += String.fromCharCode(data[c]!);
    }

    sections.push({
      name: name || `.sec_${i}`,
      addr,
      size,
      fileOffset: secOff,
      isExecutable: (flags & SHF_EXECINSTR) !== 0,
      isWritable: (flags & SHF_WRITE) !== 0,
    });
  }
  return sections;
}
