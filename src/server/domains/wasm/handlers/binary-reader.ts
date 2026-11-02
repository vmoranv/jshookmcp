/**
 * Pure-TS wasm binary reader primitives, shared by section-aware tools.
 *
 * Extracted from `./string-extract-handlers.ts` so the new `wasm_inspect`
 * structural inspector (see `./module-structure.ts`) can reuse the same
 * proven LEB128 + section-directory + name-section parsers instead of going
 * through wabt. All functions are pure (no I/O, no ExternalToolRunner) and
 * deterministic — fully CI-verifiable without any external tool installed.
 */

/** wasm section id → human name (index 0 is custom, resolved per-section). */
const SECTION_NAMES = [
  'custom',
  'type',
  'import',
  'function',
  'table',
  'memory',
  'global',
  'export',
  'start',
  'element',
  'code',
  'data',
  'datacount',
] as const;

export interface WasmSection {
  id: number;
  name: string;
  bodyStart: number;
  bodyEnd: number;
}

export interface WasmFunctionName {
  index: number;
  name: string;
}

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d]; // \0asm

/** Read an unsigned LEB128 (wasm varuint32). Returns [value, nextOffset]. */
export function readU32Leb128(bytes: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= bytes.length) throw new Error('truncated LEB128');
    const byte = bytes[pos++]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    // varuint32 is at most 5 bytes; a 6th byte (shift 35+) is out of range.
    // `>=` (not `>`) so the 6-byte boundary is rejected instead of silently
    // wrapping the continuation into a truncated value.
    if (shift >= 35) throw new Error('LEB128 exceeds u32 range');
  }
  return [result >>> 0, pos];
}

/**
 * Read a signed LEB128 (wasm varint32 / varint64). Returns [value, nextOffset].
 * Used for global init constant expressions and signed-33 memarg offsets where
 * present; the structural inspector uses it to skip past const-expr operands
 * it does not need to interpret.
 *
 * Precision boundary: accumulation is arithmetic (not bitwise) so payloads
 * occupying bits 32+ decode correctly; values up to 2^53 are exact, larger
 * magnitudes round like any double. A negative i64 whose encoding spans bit
 * 63 (e.g. i64 min) returns its unsigned-64 approximation, matching wabt's
 * uninterpreted u64 reading — callers needing exact i64 semantics should use
 * BigInt.
 */
export function readS64Leb128(bytes: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  let byte = 0;
  for (;;) {
    if (pos >= bytes.length) throw new Error('truncated signed LEB128');
    byte = bytes[pos++]!;
    // Arithmetic accumulation: JS `<<` truncates to 32 bits, corrupting any
    // varint64 payload that occupies bits 32+ (e.g. 2^40 decodes as 8).
    result += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if ((byte & 0x80) === 0) break;
    // varint64 is at most 10 bytes; `>=` (not `>`) rejects an 11th byte
    // instead of wrapping its continuation into a truncated value.
    if (shift >= 70) throw new Error('signed LEB128 exceeds i64 range');
  }
  // sign-extend from the last payload byte's bit 6 (wasm varint semantics,
  // matching wabt: skip when the encoding already spans bit 63, whose sign
  // lives in the top bit — representable only approximately in a double).
  if (shift < 64 && (byte & 0x40) !== 0) {
    result -= 2 ** shift;
  }
  return [result, pos];
}

/** Parse the wasm section directory. Throws on bad magic / truncated size. */
export function parseWasmSections(bytes: Buffer): WasmSection[] {
  if (
    bytes.length < 8 ||
    bytes[0] !== WASM_MAGIC[0] ||
    bytes[1] !== WASM_MAGIC[1] ||
    bytes[2] !== WASM_MAGIC[2] ||
    bytes[3] !== WASM_MAGIC[3]
  ) {
    throw new Error('Not a valid wasm binary (missing \\0asm magic header)');
  }
  const sections: WasmSection[] = [];
  let offset = 8; // skip magic + version
  while (offset < bytes.length) {
    const id = bytes[offset++]!;
    const [size, bodyStart] = readU32Leb128(bytes, offset);
    const bodyEnd = bodyStart + size;
    if (bodyEnd > bytes.length) {
      throw new Error(
        `Section ${id} declares ${size} bytes but only ${bytes.length - bodyStart} remain`,
      );
    }
    let name: string = SECTION_NAMES[id] ?? `section-${id}`;
    if (id === 0) {
      // custom section body starts with a name string (length-prefixed)
      try {
        const [nameLen, nameStart] = readU32Leb128(bytes, bodyStart);
        const customName = bytes.subarray(nameStart, nameStart + nameLen).toString('utf8');
        name = `custom:${customName || 'unnamed'}`;
      } catch {
        name = 'custom:unnamed';
      }
    }
    sections.push({ id, name, bodyStart, bodyEnd });
    offset = bodyEnd;
  }
  return sections;
}

/** Recover function names (name-section subsection 2) from a custom:name section. */
export function parseFunctionNames(
  bytes: Buffer,
  bodyStart: number,
  bodyEnd: number,
): WasmFunctionName[] {
  try {
    let pos = bodyStart;
    // skip the section name string ("name")
    const [nameLen, afterNameLen] = readU32Leb128(bytes, pos);
    pos = afterNameLen + nameLen;
    const names: WasmFunctionName[] = [];
    while (pos < bodyEnd) {
      const subId = bytes[pos++]!;
      const [subSize, subPayloadStart] = readU32Leb128(bytes, pos);
      const subEnd = subPayloadStart + subSize;
      pos = subEnd; // advance past this subsection regardless of parse success
      if (subId === 2) {
        let p = subPayloadStart;
        const [count, afterCount] = readU32Leb128(bytes, p);
        p = afterCount;
        for (let i = 0; i < count && p < subEnd; i++) {
          const [idx, afterIdx] = readU32Leb128(bytes, p);
          p = afterIdx;
          const [nl, afterNl] = readU32Leb128(bytes, p);
          p = afterNl;
          const name = bytes.subarray(p, p + nl).toString('utf8');
          p += nl;
          names.push({ index: idx, name });
        }
      }
    }
    return names;
  } catch {
    return [];
  }
}
