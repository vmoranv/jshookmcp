import { describe, it, expect } from 'vitest';
import {
  decodeSpirvInput,
  isSpirv,
  parseSpirv,
  type SpirvReflectResult,
} from '@modules/webgpu/SpirvParser';

// ─── SPIR-V construction helpers ─────────────────────────────────────────────

/** SPIR-V magic number. */
const MAGIC = 0x07230203;

/** Build a Uint8Array from a list of 32-bit words (little-endian). */
function wordsToBytes(words: number[]): Uint8Array {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < words.length; i++) {
    view.setUint32(i * 4, (words[i] ?? 0) >>> 0, true);
  }
  return bytes;
}

/** Encode a word-count+opcode header. */
function makeInstruction(opcode: number, operands: number[]): number[] {
  const wordCount = 1 + operands.length;
  return [((wordCount & 0xffff) << 16) | (opcode & 0xffff), ...operands];
}

/** Encode a SPIR-V string literal as a sequence of words (null-padded). */
function encodeString(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6));
      bytes.push(0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12));
      bytes.push(0x80 | ((code >> 6) & 0x3f));
      bytes.push(0x80 | (code & 0x3f));
    }
  }
  bytes.push(0); // null terminator
  // Pad to a multiple of 4.
  while (bytes.length % 4 !== 0) {
    bytes.push(0);
  }
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      (bytes[i] ?? 0) |
        ((bytes[i + 1] ?? 0) << 8) |
        ((bytes[i + 2] ?? 0) << 16) |
        ((bytes[i + 3] ?? 0) << 24),
    );
  }
  return words;
}

/** Build a SPIR-V header (5 words). */
function makeHeader(version: number, generator: number, bound: number, schema = 0): number[] {
  return [MAGIC, version, generator, bound, schema];
}

// Opcodes used in test fixtures.
const OP_NAME = 19;
const OP_MEMBER_NAME = 20;
const OP_TYPE_VOID = 17;
const OP_TYPE_FLOAT = 22;
const OP_TYPE_INT = 21;
const OP_TYPE_VECTOR = 23;
const OP_TYPE_STRUCT = 30;
const OP_TYPE_POINTER = 32;
const OP_VARIABLE = 59;
const OP_DECORATE = 71;
const OP_ENTRY_POINT = 15;

// Decorations.
const DEC_BLOCK = 1;
const DEC_LOCATION = 28;
const DEC_BINDING = 31;
const DEC_DESCRIPTOR_SET = 32;

// Storage classes.
const SC_UNIFORM = 2;
const SC_INPUT = 1;

// Execution models.
const EM_VERTEX = 0;
const EM_FRAGMENT = 4;

/** Convenience: build a full module from header words + instruction words. */
function buildModule(headerWords: number[], instructionWords: number[]): Uint8Array {
  return wordsToBytes([...headerWords, ...instructionWords]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SpirvParser', () => {
  describe('isSpirv', () => {
    it('identifies valid SPIR-V magic from hex input', () => {
      // SPIR-V magic 0x07230203 stored little-endian => bytes 03 02 23 07.
      expect(isSpirv('03022307')).toBe(true);
      expect(isSpirv('0x03022307')).toBe(true);
      expect(isSpirv('0x 0302 2307')).toBe(true);
    });

    it('rejects non-SPIR-V input', () => {
      // '07230203' decodes to bytes 07 23 02 03; as LE uint32 = 0x03022307 != magic.
      expect(isSpirv('07230203')).toBe(false);
      expect(isSpirv('deadbeef')).toBe(false);
      expect(isSpirv('hello world')).toBe(false);
      expect(isSpirv('')).toBe(false);
      expect(isSpirv('AB')).toBe(false); // too short
    });
  });

  describe('decodeSpirvInput', () => {
    it('decodes hex with 0x prefix, spaces, and mixed case', () => {
      // Even-length hex with 0x prefix, whitespace, and mixed case.
      const result = decodeSpirvInput('0x 0723 0203 0aBc');
      expect(result.format).toBe('hex');
      expect(result.bytes.length).toBe(6);
      expect(result.bytes[0]).toBe(0x07);
      expect(result.bytes[1]).toBe(0x23);
      expect(result.bytes[2]).toBe(0x02);
      expect(result.bytes[3]).toBe(0x03);
      expect(result.bytes[4]).toBe(0x0a);
      expect(result.bytes[5]).toBe(0xbc);
    });

    it('decodes plain hex without prefix', () => {
      const result = decodeSpirvInput('07230203');
      expect(result.format).toBe('hex');
      expect(result.bytes).toEqual(new Uint8Array([0x07, 0x23, 0x02, 0x03]));
    });

    it('decodes base64 input', () => {
      // 4 bytes 0x07230203 -> base64
      const expected = new Uint8Array([0x07, 0x23, 0x02, 0x03]);
      // Manually compute expected base64
      const b64 = 'ByMCAw=='; // 0x07 0x23 0x02 0x03
      const result = decodeSpirvInput(b64);
      expect(result.format).toBe('base64');
      expect(result.bytes).toEqual(expected);
    });

    it('returns binary format for Uint8Array input', () => {
      const input = new Uint8Array([1, 2, 3, 4]);
      const result = decodeSpirvInput(input);
      expect(result.format).toBe('binary');
      expect(result.bytes).toBe(input);
    });

    it('returns invalid format for unrecognizable input', () => {
      expect(decodeSpirvInput('!!!not hex or base64@@@').format).toBe('invalid');
      expect(decodeSpirvInput('').format).toBe('invalid');
      // Odd-length hex is invalid
      expect(decodeSpirvInput('abc').format).toBe('invalid');
    });
  });

  describe('parseSpirv header', () => {
    it('extracts magic, version, generator, and bound', () => {
      // SPIR-V version 1.0 is encoded as 0x00010000 (major<<16 | minor<<8).
      const header = makeHeader(0x00010000, 42, 100);
      const module = buildModule(header, []);

      const result = parseSpirv(module);

      expect(result.magic).toBe(MAGIC);
      expect(result.versionMajor).toBe(1);
      expect(result.versionMinor).toBe(0);
      expect(result.generator).toBe(42);
      expect(result.bound).toBe(100);
      expect(result.warnings).toEqual([]);
    });

    it('parses version 1.6', () => {
      // SPIR-V 1.6 → 0x00010600 (major=1, minor=6 in bits 15-8).
      const header = makeHeader(0x00010600, 1, 10);
      const result = parseSpirv(buildModule(header, []));
      expect(result.versionMajor).toBe(1);
      expect(result.versionMinor).toBe(6);
    });
  });

  describe('parseSpirv entry points', () => {
    it('extracts a vertex entry point with its name', () => {
      // OpEntryPoint: ExecutionModel(0=Vertex) | entryPointId(1) | name("main")
      const entryPoint = makeInstruction(OP_ENTRY_POINT, [EM_VERTEX, 1, ...encodeString('main')]);
      const header = makeHeader(0x00010000, 0, 10);
      const result = parseSpirv(buildModule(header, entryPoint));

      expect(result.entryPoints).toHaveLength(1);
      expect(result.entryPoints[0]?.name).toBe('main');
      expect(result.entryPoints[0]?.stage).toBe('vertex');
    });

    it('extracts multiple entry points with different stages', () => {
      const ep1 = makeInstruction(OP_ENTRY_POINT, [EM_VERTEX, 1, ...encodeString('vs_main')]);
      const ep2 = makeInstruction(OP_ENTRY_POINT, [EM_FRAGMENT, 2, ...encodeString('fs_main')]);
      const header = makeHeader(0x00010000, 0, 10);
      const result = parseSpirv(buildModule(header, [...ep1, ...ep2]));

      expect(result.entryPoints).toHaveLength(2);
      expect(result.entryPoints[0]?.stage).toBe('vertex');
      expect(result.entryPoints[1]?.stage).toBe('fragment');
    });

    it('maps unknown execution model to "unknown"', () => {
      const entryPoint = makeInstruction(OP_ENTRY_POINT, [9999, 1, ...encodeString('weird')]);
      const header = makeHeader(0x00010000, 0, 10);
      const result = parseSpirv(buildModule(header, entryPoint));
      expect(result.entryPoints[0]?.stage).toBe('unknown');
    });
  });

  describe('parseSpirv bindings', () => {
    it('extracts descriptor bindings with group and binding', () => {
      // %1 = OpTypeFloat 32
      // %2 = OpTypePointer Uniform %1
      // %3 = OpVariable %2 Uniform
      // OpDecorate %3 Binding 0
      // OpDecorate %3 DescriptorSet 0
      // OpName %3 "u_color"
      const typeFloat = makeInstruction(OP_TYPE_FLOAT, [1, 32]);
      const typePtr = makeInstruction(OP_TYPE_POINTER, [2, SC_UNIFORM, 1]);
      const variable = makeInstruction(OP_VARIABLE, [2, 3, SC_UNIFORM]);
      const decBinding = makeInstruction(OP_DECORATE, [3, DEC_BINDING, 0]);
      const decSet = makeInstruction(OP_DECORATE, [3, DEC_DESCRIPTOR_SET, 2]);
      const opName = makeInstruction(OP_NAME, [3, ...encodeString('u_color')]);
      const header = makeHeader(0x00010000, 0, 10);

      const result = parseSpirv(
        buildModule(header, [
          ...opName,
          ...typeFloat,
          ...typePtr,
          ...variable,
          ...decBinding,
          ...decSet,
        ]),
      );

      expect(result.bindings).toHaveLength(1);
      expect(result.bindings[0]?.name).toBe('u_color');
      expect(result.bindings[0]?.group).toBe(2);
      expect(result.bindings[0]?.binding).toBe(0);
      expect(result.bindings[0]?.typeId).toBe(2);
    });

    it('uses fallback name when OpName is absent', () => {
      const typeFloat = makeInstruction(OP_TYPE_FLOAT, [1, 32]);
      const typePtr = makeInstruction(OP_TYPE_POINTER, [2, SC_UNIFORM, 1]);
      const variable = makeInstruction(OP_VARIABLE, [2, 3, SC_UNIFORM]);
      const decBinding = makeInstruction(OP_DECORATE, [3, DEC_BINDING, 5]);
      const decSet = makeInstruction(OP_DECORATE, [3, DEC_DESCRIPTOR_SET, 1]);
      const header = makeHeader(0x00010000, 0, 10);

      const result = parseSpirv(
        buildModule(header, [typeFloat, typePtr, variable, decBinding, decSet].flat()),
      );

      expect(result.bindings[0]?.name).toBe('<id:3>');
      expect(result.bindings[0]?.binding).toBe(5);
      expect(result.bindings[0]?.group).toBe(1);
    });
  });

  describe('parseSpirv structs', () => {
    it('extracts a Block struct with member names and types', () => {
      // %1 = OpTypeFloat 32
      // %2 = OpTypeVector %1 4
      // %3 = OpTypeStruct %2 %1   (two members: vec4<f32>, f32)
      // OpName %3 "Uniforms"
      // OpMemberName %3 0 "position"
      // OpMemberName %3 1 "scale"
      // OpDecorate %3 Block
      const typeFloat = makeInstruction(OP_TYPE_FLOAT, [1, 32]);
      const typeVec = makeInstruction(OP_TYPE_VECTOR, [2, 1, 4]);
      const typeStruct = makeInstruction(OP_TYPE_STRUCT, [3, 2, 1]);
      const opName = makeInstruction(OP_NAME, [3, ...encodeString('Uniforms')]);
      const memberName0 = makeInstruction(OP_MEMBER_NAME, [3, 0, ...encodeString('position')]);
      const memberName1 = makeInstruction(OP_MEMBER_NAME, [3, 1, ...encodeString('scale')]);
      const decBlock = makeInstruction(OP_DECORATE, [3, DEC_BLOCK]);
      const header = makeHeader(0x00010000, 0, 10);

      const result = parseSpirv(
        buildModule(header, [
          ...typeFloat,
          ...typeVec,
          ...typeStruct,
          ...opName,
          ...memberName0,
          ...memberName1,
          ...decBlock,
        ]),
      );

      expect(result.structs).toHaveLength(1);
      const struct = result.structs[0];
      expect(struct?.name).toBe('Uniforms');
      expect(struct?.fields).toHaveLength(2);
      expect(struct?.fields[0]?.name).toBe('position');
      expect(struct?.fields[0]?.type).toBe('vec4<f32>');
      expect(struct?.fields[1]?.name).toBe('scale');
      expect(struct?.fields[1]?.type).toBe('f32');
    });

    it('uses fallback field names when OpMemberName is absent', () => {
      const typeFloat = makeInstruction(OP_TYPE_FLOAT, [1, 32]);
      const typeStruct = makeInstruction(OP_TYPE_STRUCT, [2, 1, 1]);
      const decBlock = makeInstruction(OP_DECORATE, [2, DEC_BLOCK]);
      const header = makeHeader(0x00010000, 0, 10);

      const result = parseSpirv(buildModule(header, [...typeFloat, ...typeStruct, ...decBlock]));

      expect(result.structs[0]?.fields[0]?.name).toBe('field0');
      expect(result.structs[0]?.fields[1]?.name).toBe('field1');
    });
  });

  describe('parseSpirv locations', () => {
    it('extracts location decorations on input variables', () => {
      // %1 = OpTypeFloat 32
      // %2 = OpTypePointer Input %1
      // %3 = OpVariable %2 Input
      // OpDecorate %3 Location 0
      // OpName %3 "a_pos"
      const typeFloat = makeInstruction(OP_TYPE_FLOAT, [1, 32]);
      const typePtr = makeInstruction(OP_TYPE_POINTER, [2, SC_INPUT, 1]);
      const variable = makeInstruction(OP_VARIABLE, [2, 3, SC_INPUT]);
      const decLocation = makeInstruction(OP_DECORATE, [3, DEC_LOCATION, 7]);
      const opName = makeInstruction(OP_NAME, [3, ...encodeString('a_pos')]);
      const header = makeHeader(0x00010000, 0, 10);

      const result = parseSpirv(
        buildModule(header, [...typeFloat, ...typePtr, ...variable, ...decLocation, ...opName]),
      );

      expect(result.locations).toHaveLength(1);
      expect(result.locations[0]?.name).toBe('a_pos');
      expect(result.locations[0]?.location).toBe(7);
    });
  });

  describe('parseSpirv robustness', () => {
    it('warns when input length is not a multiple of 4', () => {
      const header = makeHeader(0x00010000, 0, 10);
      const module = buildModule(header, []);
      // Append 2 trailing junk bytes.
      const withJunk = new Uint8Array(module.length + 2);
      withJunk.set(module, 0);
      withJunk.set(new Uint8Array([0xff, 0xee]), module.length);

      const result = parseSpirv(withJunk);

      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/not a multiple of 4/i)]),
      );
      // Header still parsed.
      expect(result.magic).toBe(MAGIC);
    });

    it('warns on invalid magic but still parses', () => {
      const header = [0xdeadbeef, 0x00010000, 0, 10, 0];
      const result = parseSpirv(buildModule(header, []));
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/invalid magic/i)]),
      );
      expect(result.magic).toBe(0xdeadbeef);
    });

    it('does not crash on empty input and returns a warning', () => {
      const result = parseSpirv(new Uint8Array(0));
      expect(result.entryPoints).toEqual([]);
      expect(result.bindings).toEqual([]);
      expect(result.structs).toEqual([]);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/empty input/i)]),
      );
    });

    it('warns on truncated instruction', () => {
      const header = makeHeader(0x00010000, 0, 10);
      // An instruction claiming 5 words but only providing 1 (the header word).
      const truncatedInst = [((5 & 0xffff) << 16) | OP_NAME];
      const result = parseSpirv(buildModule(header, truncatedInst));
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/declares 5 words but only/i)]),
      );
    });

    it('warns on zero word count instruction', () => {
      const header = makeHeader(0x00010000, 0, 10);
      // wordCount=0, opcode=anything
      const zeroInst = [(0 << 16) | OP_NAME];
      const result = parseSpirv(buildModule(header, zeroInst));
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/zero word count/i)]),
      );
    });

    it('handles input shorter than header', () => {
      const result = parseSpirv(new Uint8Array([0x07, 0x23, 0x02, 0x03]));
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/too short for a SPIR-V header/i)]),
      );
      // Magic was still read before the length check path.
      expect(result.bound).toBe(0);
    });
  });

  describe('parseSpirv type translation', () => {
    it('translates OpTypeFloat, OpTypeInt, OpTypeVector, OpTypeMatrix to readable strings', () => {
      // %1 = OpTypeFloat 32 -> f32
      // %2 = OpTypeInt 32 1 -> i32 (signed)
      // %3 = OpTypeInt 32 0 -> u32 (unsigned)
      // %4 = OpTypeVector %1 3 -> vec3<f32>
      // %5 = OpTypeStruct %4 %2 -> struct (emitted via fallback since no Block)
      // To surface the struct, use fallback path (no Block, no descriptor var).
      const typeFloat = makeInstruction(OP_TYPE_FLOAT, [1, 32]);
      const typeIntSigned = makeInstruction(OP_TYPE_INT, [2, 32, 1]);
      const typeIntUnsigned = makeInstruction(OP_TYPE_INT, [3, 32, 0]);
      const typeVec = makeInstruction(OP_TYPE_VECTOR, [4, 1, 3]);
      const typeStruct = makeInstruction(OP_TYPE_STRUCT, [5, 4, 2]);
      const opName = makeInstruction(OP_NAME, [5, ...encodeString('MyStruct')]);
      const memberName0 = makeInstruction(OP_MEMBER_NAME, [5, 0, ...encodeString('dir')]);
      const memberName1 = makeInstruction(OP_MEMBER_NAME, [5, 1, ...encodeString('count')]);
      const header = makeHeader(0x00010000, 0, 10);

      const result: SpirvReflectResult = parseSpirv(
        buildModule(header, [
          ...typeFloat,
          ...typeIntSigned,
          ...typeIntUnsigned,
          ...typeVec,
          ...typeStruct,
          ...opName,
          ...memberName0,
          ...memberName1,
        ]),
      );

      // Struct surfaced via fallback (no Block decoration, no descriptor variable).
      expect(result.structs).toHaveLength(1);
      const struct = result.structs[0];
      expect(struct?.name).toBe('MyStruct');
      // Member 0: vec3<f32>
      expect(struct?.fields[0]?.name).toBe('dir');
      expect(struct?.fields[0]?.type).toBe('vec3<f32>');
      // Member 1: i32 (signed)
      expect(struct?.fields[1]?.name).toBe('count');
      expect(struct?.fields[1]?.type).toBe('i32');
    });

    it('translates unsigned int as u32', () => {
      const typeUnsigned = makeInstruction(OP_TYPE_INT, [1, 32, 0]);
      const typeStruct = makeInstruction(OP_TYPE_STRUCT, [2, 1]);
      const memberName = makeInstruction(OP_MEMBER_NAME, [2, 0, ...encodeString('idx')]);
      const header = makeHeader(0x00010000, 0, 10);

      const result = parseSpirv(
        buildModule(header, [...typeUnsigned, ...typeStruct, ...memberName]),
      );

      // No Block decoration and no descriptor var → fallback emits all structs.
      expect(result.structs[0]?.fields[0]?.type).toBe('u32');
    });
  });

  describe('parseSpirv integration', () => {
    it('parses a minimal but realistic vertex shader module', () => {
      // IDs:
      // 1 = void, 2 = float, 3 = vec4<float>, 4 = ptr<input, float>,
      // 5 = ptr<input, vec4>, 6 = struct{vec4}, 7 = ptr<output, vec4>,
      // 8 = input var (location 0, "a_pos"), 9 = output var (built-in, "gl_Position")
      const instructions: number[] = [];
      const push = (opcode: number, operands: number[]): void => {
        instructions.push(...makeInstruction(opcode, operands));
      };

      push(OP_NAME, [8, ...encodeString('a_pos')]);
      push(OP_NAME, [9, ...encodeString('gl_Position')]);
      push(OP_TYPE_VOID, [1]);
      push(OP_TYPE_FLOAT, [2, 32]);
      push(OP_TYPE_VECTOR, [3, 2, 4]);
      push(OP_TYPE_POINTER, [4, SC_INPUT, 2]);
      push(OP_TYPE_POINTER, [5, SC_INPUT, 3]);
      push(OP_TYPE_STRUCT, [6, 3]);
      push(OP_TYPE_POINTER, [7, 3, 3]); // ptr<output, vec4> (reuse storage 3 for output)
      push(OP_VARIABLE, [4, 8, SC_INPUT]);
      push(OP_VARIABLE, [7, 9, 3]); // storage class 3 = Output
      push(OP_DECORATE, [8, DEC_LOCATION, 0]);
      push(OP_ENTRY_POINT, [EM_VERTEX, 10, ...encodeString('main'), 8, 9]);

      const header = makeHeader(0x00010000, 7, 100);
      const result = parseSpirv(buildModule(header, instructions));

      expect(result.magic).toBe(MAGIC);
      expect(result.entryPoints).toHaveLength(1);
      expect(result.entryPoints[0]?.name).toBe('main');
      expect(result.entryPoints[0]?.stage).toBe('vertex');
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0]?.name).toBe('a_pos');
      expect(result.locations[0]?.location).toBe(0);
      // gl_Position is storage class Output (3) with no Location decoration — not in locations.
      expect(result.locations.find((l) => l.name === 'gl_Position')).toBeUndefined();
      // Struct %6 has no Block and no descriptor var → emitted via fallback.
      expect(result.structs).toHaveLength(1);
      expect(result.structs[0]?.fields[0]?.type).toBe('vec4<f32>');
      expect(result.warnings).toEqual([]);
    });
  });
});
