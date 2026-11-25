/**
 * AArch64 cross-reference scanner for ADRP+ADD and ADR instruction pairs.
 *
 * Finds code that materialises a target virtual address, which is how
 * statically-linked Android natives reference strings/tables without exports.
 */
export interface Arm64Xref {
  /** Byte offset of the ADD/ADR instruction that forms the address. */
  at: number;
  kind: 'adrp-add' | 'adr' | 'bl' | 'b';
}

function sext(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value & (sign - 1)) - (value & sign);
}

function adrpTarget(pc: number, insn: number): number {
  const immlo = (insn >>> 29) & 3;
  const immhi = (insn >>> 5) & 0x7ffff;
  return ((pc & ~0xfff) + (sext((immhi << 2) | immlo, 21) << 12)) >>> 0;
}

function adrTarget(pc: number, insn: number): number {
  const immlo = (insn >>> 29) & 3;
  const immhi = (insn >>> 5) & 0x7ffff;
  return (pc + sext((immhi << 2) | immlo, 21)) >>> 0;
}

export function findArm64Xrefs(bytes: Uint8Array, target: number, maxResults = 100): Arm64Xref[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wanted = target >>> 0;
  const out: Arm64Xref[] = [];

  // Single-instruction ADR references.
  for (let at = 0; at + 4 <= bytes.length && out.length < maxResults; at += 4) {
    const insn = view.getUint32(at, true) >>> 0;
    if ((insn & 0x9f00001f) >>> 0 === 0x10000000 && adrTarget(at, insn) === wanted) {
      out.push({ at, kind: 'adr' });
    }
  }

  // ADRP followed (within 4 instructions) by ADD #imm using the same register.
  for (let at = 0; at + 16 <= bytes.length && out.length < maxResults; at += 4) {
    const insn = view.getUint32(at, true) >>> 0;
    if ((insn & 0x9f00001f) >>> 0 !== 0x90000000) continue;
    const rd = insn & 0x1f;
    const page = adrpTarget(at, insn);
    for (let step = 1; step <= 4; step++) {
      const addAt = at + step * 4;
      if (addAt + 4 > bytes.length) break;
      const add = view.getUint32(addAt, true) >>> 0;
      // ADD (immediate), 32-bit or 64-bit.
      const maskedAdd = (add & 0x7f000000) >>> 0;
      const isAdd = maskedAdd === 0x11000000 || maskedAdd === 0x31000000;
      if (!isAdd) continue;
      if (((add >>> 5) & 0x1f) !== rd) continue;
      const imm = (add >>> 10) & 0xfff;
      if ((page + imm) >>> 0 === wanted) out.push({ at: addAt, kind: 'adrp-add' });
      break;
    }
  }

  // Direct branch/call references (BL/B with a 26-bit signed offset).
  for (let at = 0; at + 4 <= bytes.length && out.length < maxResults; at += 4) {
    const insn = view.getUint32(at, true) >>> 0;
    const top = (insn & 0xfc000000) >>> 0;
    if (top !== 0x94000000 && top !== 0x14000000) continue;
    const imm26 = insn & 0x03ffffff;
    const offset = sext(imm26, 26) << 2;
    if ((at + offset) >>> 0 === wanted) {
      out.push({ at, kind: top === 0x94000000 ? 'bl' : 'b' });
    }
  }

  return out;
}
