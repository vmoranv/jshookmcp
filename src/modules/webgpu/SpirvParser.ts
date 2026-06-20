/**
 * SpirvParser — Zero-dependency SPIR-V binary reflection parser.
 *
 * **Purpose**: Security analysis / reverse-engineering. Browsers cannot compile
 * SPIR-V directly (WebGPU only accepts WGSL), but analysts frequently encounter
 * SPIR-V binaries in capture dumps, shader caches, or native tooling output.
 * This module performs pure reflection — extracting structured metadata (entry
 * points, bindings, structs, locations) WITHOUT compiling or executing the
 * shader. It is read-only and side-effect free.
 *
 * **Specification**: https://registry.khronos.org/SPIR-V/specs/unified1/SPIRV.html
 *
 * **Format**: SPIR-V is a stream of 32-bit little-endian words.
 *   Header (5 words): magic(0x07230203) | version | generator | bound | schema
 *   Instruction: word[0] = (wordCount << 16) | opcode; remaining words are operands.
 *
 * **Design**:
 *   - Two-pass reflection: pass 1 builds ID→name / ID→type / decoration tables;
 *     pass 2 resolves entry points, bindings, structs, locations.
 *   - Fail-soft: malformed input never throws — it records warnings and continues.
 *   - Zero external npm dependencies (only the JS standard library).
 *   - Strict type-safety under `noUncheckedIndexedAccess`: every indexed read is
 *     bounds-checked or coalesced with `??`.
 *
 * **No try/catch around normal flow** (project convention). Defensive parsing
 * bounds are explicit: length checks and word-count validation guard every read.
 */

// ─── SPIR-V constants ────────────────────────────────────────────────────────

/** SPIR-V magic number (little-endian word 0x07230203). */
const SPIRV_MAGIC = 0x07230203;

/** Header length in words. */
const HEADER_WORD_COUNT = 5;

// ─── Opcodes (subset relevant to reflection) ─────────────────────────────────

const OpEntryPoint = 15;
const OpName = 19;
const OpMemberName = 20;
const OpTypeVoid = 17;
const OpTypeBool = 18;
const OpTypeInt = 21;
const OpTypeFloat = 22;
const OpTypeVector = 23;
const OpTypeMatrix = 24;
const OpTypeImage = 25;
const OpTypeSampler = 26;
const OpTypeSampledImage = 27;
const OpTypeArray = 28;
const OpTypeRuntimeArray = 29;
const OpTypeStruct = 30;
const OpTypePointer = 32;
const OpTypeFunction = 33;
const OpVariable = 59;
const OpDecorate = 71;
const OpMemberDecorate = 72;

// ─── Decoration enum values (SPIR-V spec) ────────────────────────────────────

const DecorationBlock = 1;
const DecorationBufferBlock = 2;
const DecorationLocation = 28;
const DecorationBinding = 31;
const DecorationDescriptorSet = 32;
const DecorationBuiltIn = 11;

// ─── ExecutionModel enum (SPIR-V spec) ───────────────────────────────────────

const ExecutionModelVertex = 0;
const ExecutionModelTessellationControl = 1;
const ExecutionModelTessellationEvaluation = 2;
const ExecutionModelGeometry = 3;
const ExecutionModelFragment = 4;
const ExecutionModelGLCompute = 5;
const ExecutionModelKernel = 6;
const ExecutionModelRayGenerationKHR = 5311;
const ExecutionModelMissKHR = 5312;
const ExecutionModelClosestHitKHR = 5314;
const ExecutionModelCallableKHR = 5316;

// ─── Storage class enum (subset) ─────────────────────────────────────────────

const StorageClassUniformConstant = 0;
const StorageClassUniform = 2;
const StorageClassStorageBuffer = 12;
const StorageClassInput = 1;
const StorageClassOutput = 3;

// ─── Public types ────────────────────────────────────────────────────────────

/** Execution stage of a SPIR-V entry point. */
export type SpirvStage =
  | 'vertex'
  | 'fragment'
  | 'compute'
  | 'tess-control'
  | 'tess-eval'
  | 'geometry'
  | 'gl-compute'
  | 'raygen'
  | 'ray-miss'
  | 'ray-hit'
  | 'callable'
  | 'kernel'
  | 'unknown';

/** A resolved entry point. */
export interface SpirvEntryPoint {
  name: string;
  stage: SpirvStage;
}

/** A resolved descriptor binding (uniform buffer, sampler, texture, etc.). */
export interface SpirvBinding {
  name: string;
  /** Descriptor set (group in WGSL terminology). */
  group: number;
  /** Binding index within the descriptor set. */
  binding: number;
  /** Optional resolved type id of the bound variable. */
  typeId?: number;
}

/** A location-decorated interface variable (vertex attribute / fragment output). */
export interface SpirvLocation {
  name: string;
  location: number;
}

/** A reflected struct with its member fields. */
export interface SpirvStruct {
  name: string;
  fields: Array<{ name: string; type: string }>;
}

/** Full reflection result. */
export interface SpirvReflectResult {
  magic: number;
  versionMajor: number;
  versionMinor: number;
  generator: number;
  /** ID bound — one past the highest ID used in the module. */
  bound: number;
  entryPoints: SpirvEntryPoint[];
  bindings: SpirvBinding[];
  locations: SpirvLocation[];
  structs: SpirvStruct[];
  /** Non-fatal warnings (malformed input, truncation, bad magic, etc.). */
  warnings: string[];
}

// ─── Input decoding ──────────────────────────────────────────────────────────

/**
 * Result of decoding a SPIR-V input. `format='invalid'` means the input could
 * not be interpreted as hex, base64, or raw bytes.
 */
export interface SpirvDecodedInput {
  bytes: Uint8Array;
  format: 'hex' | 'base64' | 'binary' | 'invalid';
}

/**
 * Decode a SPIR-V binary from flexible input forms.
 *
 * Accepted inputs:
 *  - `Uint8Array` — returned as-is (`binary`).
 *  - hex string: optional `0x` prefix, optional whitespace, any case.
 *    Detected by presence of only hex digits / spaces / `0x` prefix.
 *  - base64 string: standard base64 alphabet (A-Za-z0-9+/=), length a multiple
 *    of 4, and not valid hex.
 *
 * Heuristic ordering: if the string consists solely of hex chars / spaces /
 * `0x` prefixes, treat as hex. Otherwise, if it matches base64 alphabet and a
 * multiple-of-4 length, treat as base64. Otherwise invalid.
 */
export function decodeSpirvInput(input: string | Uint8Array): SpirvDecodedInput {
  if (input instanceof Uint8Array) {
    return { bytes: input, format: 'binary' };
  }

  if (typeof input !== 'string') {
    return { bytes: new Uint8Array(0), format: 'invalid' };
  }

  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { bytes: new Uint8Array(0), format: 'invalid' };
  }

  // Strip optional 0x prefix.
  const noPrefix =
    trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;

  // Remove all whitespace and underscores (common hex formatting).
  const compactHex = noPrefix.replace(/[\s_]/g, '');

  // Try hex: only hex digits, even count.
  if (compactHex.length > 0 && /^[0-9a-fA-F]+$/.test(compactHex) && compactHex.length % 2 === 0) {
    const bytes = new Uint8Array(compactHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      const byte = Number.parseInt(compactHex.slice(i * 2, i * 2 + 2), 16);
      bytes[i] = byte;
    }
    return { bytes, format: 'hex' };
  }

  // Try base64: standard alphabet, length multiple of 4.
  const compactB64 = trimmed.replace(/\s/g, '');
  if (
    compactB64.length > 0 &&
    compactB64.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(compactB64)
  ) {
    // Attempt to decode; if it produces valid bytes, return base64.
    const decoded = tryBase64Decode(compactB64);
    if (decoded !== null) {
      return { bytes: decoded, format: 'base64' };
    }
  }

  return { bytes: new Uint8Array(0), format: 'invalid' };
}

/**
 * Minimal standard base64 decoder (no Node Buffer dependency, keeps the module
 * zero-dependency). Returns null on malformed input.
 */
function tryBase64Decode(input: string): Uint8Array | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet.charCodeAt(i)] = i;
  }

  const clean = input.replace(/=+$/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 128) {
      return null;
    }
    const value = lookup[code] ?? -1;
    if (value < 0) {
      return null;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }

  return Uint8Array.from(out);
}

/**
 * Quick magic-number check. Returns true iff the input decodes to at least 4
 * bytes whose first word (little-endian) equals 0x07230203.
 */
export function isSpirv(input: string | Uint8Array): boolean {
  const { bytes } = decodeSpirvInput(input);
  if (bytes.length < 4) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === SPIRV_MAGIC;
}

// ─── Internal reflection state ───────────────────────────────────────────────

interface Instruction {
  opcode: number;
  /** Full word slice including the opcode word. */
  words: number[];
  /** Offset (in words) of this instruction within the module. */
  offset: number;
}

interface DecorationRecord {
  binding?: number;
  descriptorSet?: number;
  location?: number;
  block?: boolean;
  bufferBlock?: boolean;
  builtIn?: number;
}

/** Name collected per struct member: memberId key is `${structTypeId}:${memberIndex}`. */
type MemberKey = string;

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse a SPIR-V binary and return reflected metadata.
 *
 * The parser is fail-soft: malformed instructions, bad magic, truncation, and
 * unknown opcodes all produce warnings rather than throwing. Unknown opcodes are
 * skipped by reading their declared word count; if the word count is invalid
 * (zero, or extends past the buffer), the parser stops and records a warning.
 *
 * @param data - Raw SPIR-V bytes (already decoded from hex/base64/binary).
 * @returns Reflection result. Always returns a result object; check `warnings`.
 */
export function parseSpirv(data: Uint8Array): SpirvReflectResult {
  const warnings: string[] = [];

  // Handle empty / too-short input.
  if (data.length === 0) {
    return emptyResult(0, warnings, ['empty input']);
  }

  // Truncate to a multiple of 4 bytes (SPIR-V is word-aligned).
  let bytes = data;
  const remainder = data.length % 4;
  if (remainder !== 0) {
    warnings.push(
      `input length ${data.length} is not a multiple of 4; truncating ${remainder} trailing byte(s)`,
    );
    bytes = data.subarray(0, data.length - remainder);
  }

  if (bytes.length < HEADER_WORD_COUNT * 4) {
    warnings.push(`input too short for a SPIR-V header (${bytes.length} bytes)`);
    return emptyResult(0, warnings);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wordCount = bytes.length >>> 2;

  // Read header.
  const magic = view.getUint32(0, true);
  const versionWord = view.getUint32(4, true);
  const generator = view.getUint32(8, true);
  const bound = view.getUint32(12, true);
  // schema word at offset 16 is reserved (always 0 in unified1).

  if (magic !== SPIRV_MAGIC) {
    warnings.push(`invalid magic 0x${magic.toString(16).padStart(8, '0')} (expected 0x07230203)`);
  }

  // Version word per SPIR-V spec: major in bits 31-16, minor in bits 15-8
  // (e.g. version 1.3 is encoded as 0x00010300). The low byte is reserved.
  const versionMajor = (versionWord >>> 16) & 0xffff;
  const versionMinor = (versionWord >>> 8) & 0xff;

  // ── Pass 0: slice instructions ─────────────────────────────────────────────
  const instructions = sliceInstructions(view, wordCount, warnings);
  if (instructions.length === 0) {
    return {
      magic,
      versionMajor,
      versionMinor,
      generator,
      bound,
      entryPoints: [],
      bindings: [],
      locations: [],
      structs: [],
      warnings,
    };
  }

  // ── Pass 1: build ID→name, ID→type-info, decorations, member names ────────
  const idToName = new Map<number, string>();
  const memberNames = new Map<MemberKey, string>();
  const decorations = new Map<number, DecorationRecord>();
  const memberDecorations = new Map<MemberKey, DecorationRecord>();
  // typeId → kind descriptor built lazily.
  const typeInfo = new Map<number, TypeDescriptor>();

  for (const inst of instructions) {
    switch (inst.opcode) {
      case OpName: {
        // OpName: targetId | name(string)
        if (inst.words.length >= 3) {
          const targetId = inst.words[1] ?? 0;
          const name = decodeStringLiteral(inst.words, 2);
          if (name !== null) {
            idToName.set(targetId, name);
          }
        }
        break;
      }
      case OpMemberName: {
        // OpMemberName: structTypeId | memberNum | name(string)
        if (inst.words.length >= 4) {
          const structTypeId = inst.words[1] ?? 0;
          const memberNum = inst.words[2] ?? 0;
          const name = decodeStringLiteral(inst.words, 3);
          if (name !== null) {
            memberNames.set(`${structTypeId}:${memberNum}`, name);
          }
        }
        break;
      }
      case OpDecorate: {
        // OpDecorate: targetId | decoration | [extra operands]
        if (inst.words.length >= 3) {
          const targetId = inst.words[1] ?? 0;
          const decoration = inst.words[2] ?? 0;
          applyDecoration(decorations, targetId, decoration, inst.words, 3);
        }
        break;
      }
      case OpMemberDecorate: {
        // OpMemberDecorate: structTypeId | memberNum | decoration | [extra]
        if (inst.words.length >= 4) {
          const structTypeId = inst.words[1] ?? 0;
          const memberNum = inst.words[2] ?? 0;
          const decoration = inst.words[3] ?? 0;
          const key = `${structTypeId}:${memberNum}`;
          applyDecoration(memberDecorations, key, decoration, inst.words, 4);
        }
        break;
      }
      default:
        // Type instructions are handled in the type-info pass below.
        break;
    }
  }

  // Build type descriptors for all type-defining opcodes.
  for (const inst of instructions) {
    recordTypeInfo(inst, typeInfo);
  }

  // ── Pass 2: resolve entry points, bindings, structs, locations ────────────
  const entryPoints: SpirvEntryPoint[] = [];
  const bindings: SpirvBinding[] = [];
  const locations: SpirvLocation[] = [];

  // Track struct type ids that are marked Block/BufferBlock for struct emission.
  const structIds = new Set<number>();
  for (const [id, info] of typeInfo) {
    if (info.kind === 'struct') {
      structIds.add(id);
    }
  }

  // Also include structs referenced by OpVariable with uniform/storage storage.
  // (Block-decorated structs may not carry Block themselves; the variable does.)
  const variableStructIds = new Set<number>();

  for (const inst of instructions) {
    if (inst.opcode === OpEntryPoint) {
      // OpEntryPoint: ExecutionModel | entryPointId | name(string) | [interfaceIds...]
      if (inst.words.length >= 4) {
        const execModel = inst.words[1] ?? 0;
        const entryId = inst.words[2] ?? 0;
        const name = decodeStringLiteral(inst.words, 3);
        const stage = mapExecutionModel(execModel);
        // Compute the word offset where the string ends to skip interface ids.
        entryPoints.push({
          name: name ?? `<id:${entryId}>`,
          stage,
        });
      }
    } else if (inst.opcode === OpVariable) {
      // OpVariable: resultType | resultId | storageClass | [initializer]
      if (inst.words.length >= 4) {
        const resultType = inst.words[1] ?? 0;
        const resultId = inst.words[2] ?? 0;
        const storageClass = inst.words[3] ?? 0;

        const dec = decorations.get(resultId);
        const isBindingVar =
          (dec?.binding !== undefined || dec?.descriptorSet !== undefined) &&
          isDescriptorStorageClass(storageClass);

        if (isBindingVar) {
          bindings.push({
            name: idToName.get(resultId) ?? `<id:${resultId}>`,
            group: dec?.descriptorSet ?? 0,
            binding: dec?.binding ?? 0,
            typeId: resultType,
          });
        }

        if (dec?.location !== undefined && isInterfaceStorageClass(storageClass)) {
          locations.push({
            name: idToName.get(resultId) ?? `<id:${resultId}>`,
            location: dec.location,
          });
        }

        // Track struct ids used by uniform/storage variables for struct emission.
        if (isDescriptorStorageClass(storageClass)) {
          const pointed = resolvePointerToStruct(resultType, typeInfo);
          if (pointed !== null) {
            variableStructIds.add(pointed);
          }
        }
      }
    }
  }

  // ── Emit structs ───────────────────────────────────────────────────────────
  // Emit any struct type that either has a Block decoration or is referenced by
  // a descriptor variable. Fall back to emitting all structs if none qualify,
  // so reflection still surfaces structure for headerless modules.
  const emittedStructIds = new Set<number>();
  const structs: SpirvStruct[] = [];

  const emitStruct = (structId: number): void => {
    if (emittedStructIds.has(structId)) {
      return;
    }
    const info = typeInfo.get(structId);
    if (!info || info.kind !== 'struct' || !info.memberTypeIds) {
      return;
    }
    emittedStructIds.add(structId);
    const fields = info.memberTypeIds.map((memberTypeId, index) => {
      const memberName = memberNames.get(`${structId}:${index}`) ?? `field${index}`;
      const memberTypeStr = describeType(memberTypeId, typeInfo);
      return { name: memberName, type: memberTypeStr };
    });
    structs.push({
      name: idToName.get(structId) ?? `<struct:${structId}>`,
      fields,
    });
  };

  // Prefer Block/BufferBlock-decorated structs.
  for (const id of structIds) {
    const dec = decorations.get(id);
    if (dec?.block || dec?.bufferBlock) {
      emitStruct(id);
    }
  }
  for (const id of variableStructIds) {
    emitStruct(id);
  }
  // Fallback: if nothing was emitted, surface all structs.
  if (structs.length === 0) {
    for (const id of structIds) {
      emitStruct(id);
    }
  }

  return {
    magic,
    versionMajor,
    versionMinor,
    generator,
    bound,
    entryPoints,
    bindings,
    locations,
    structs,
    warnings,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build an empty result with the given warnings appended. */
function emptyResult(magic: number, warnings: string[], extra: string[] = []): SpirvReflectResult {
  const all = [...warnings, ...extra];
  return {
    magic,
    versionMajor: 0,
    versionMinor: 0,
    generator: 0,
    bound: 0,
    entryPoints: [],
    bindings: [],
    locations: [],
    structs: [],
    warnings: all,
  };
}

/**
 * Walk the word stream and slice instructions. Each instruction's first word
 * encodes (wordCount << 16) | opcode. Stops and warns on:
 *   - wordCount of 0 (invalid)
 *   - wordCount exceeding remaining words (truncation)
 */
function sliceInstructions(view: DataView, wordCount: number, warnings: string[]): Instruction[] {
  const instructions: Instruction[] = [];
  let cursor = HEADER_WORD_COUNT;

  while (cursor < wordCount) {
    const headerWord = view.getUint32(cursor * 4, true);
    const instWordCount = (headerWord >>> 16) & 0xffff;
    const opcode = headerWord & 0xffff;

    if (instWordCount === 0) {
      warnings.push(`instruction at word ${cursor} has zero word count; stopping parse`);
      break;
    }

    if (cursor + instWordCount > wordCount) {
      warnings.push(
        `instruction at word ${cursor} (opcode ${opcode}) declares ${instWordCount} words but only ${wordCount - cursor} remain; stopping parse`,
      );
      break;
    }

    const words: number[] = [];
    for (let i = 0; i < instWordCount; i++) {
      words.push(view.getUint32((cursor + i) * 4, true));
    }
    instructions.push({ opcode, words, offset: cursor });
    cursor += instWordCount;
  }

  return instructions;
}

/**
 * Decode a SPIR-V string literal starting at `startWord` within `words`.
 * Strings are a sequence of little-endian UTF-8 bytes packed into 32-bit words,
 * null-terminated and null-padded to a word boundary. Returns null if no words
 * are available.
 */
function decodeStringLiteral(words: number[], startWord: number): string | null {
  if (startWord >= words.length) {
    return null;
  }

  const bytes: number[] = [];
  for (let i = startWord; i < words.length; i++) {
    const word = words[i] ?? 0;
    const b0 = word & 0xff;
    const b1 = (word >>> 8) & 0xff;
    const b2 = (word >>> 16) & 0xff;
    const b3 = (word >>> 24) & 0xff;
    // Push bytes until a null terminator.
    if (b0 === 0) {
      return decodeUtf8(bytes);
    }
    bytes.push(b0);
    if (b1 === 0) {
      return decodeUtf8(bytes);
    }
    bytes.push(b1);
    if (b2 === 0) {
      return decodeUtf8(bytes);
    }
    bytes.push(b2);
    if (b3 === 0) {
      return decodeUtf8(bytes);
    }
    bytes.push(b3);
  }
  // Unterminated string at end of instruction — still return what we have.
  return decodeUtf8(bytes);
}

/** Minimal UTF-8 decoder (avoids TextDecoder to stay zero-dependency). */
function decodeUtf8(bytes: number[]): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++] ?? 0;
    if (b1 < 0x80) {
      result += String.fromCharCode(b1);
    } else if (b1 < 0xc0) {
      // Continuation byte without lead — skip.
      continue;
    } else if (b1 < 0xe0) {
      const b2 = bytes[i++] ?? 0;
      result += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
    } else if (b1 < 0xf0) {
      const b2 = bytes[i++] ?? 0;
      const b3 = bytes[i++] ?? 0;
      result += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
    } else {
      const b2 = bytes[i++] ?? 0;
      const b3 = bytes[i++] ?? 0;
      const b4 = bytes[i++] ?? 0;
      const codepoint =
        ((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f);
      // Convert to UTF-16 surrogate pair.
      const adjusted = codepoint - 0x10000;
      result += String.fromCharCode(0xd800 | (adjusted >> 10), 0xdc00 | (adjusted & 0x3ff));
    }
  }
  return result;
}

/** Map a SPIR-V ExecutionModel enum to a human-readable stage. */
function mapExecutionModel(model: number): SpirvStage {
  switch (model) {
    case ExecutionModelVertex:
      return 'vertex';
    case ExecutionModelTessellationControl:
      return 'tess-control';
    case ExecutionModelTessellationEvaluation:
      return 'tess-eval';
    case ExecutionModelGeometry:
      return 'geometry';
    case ExecutionModelFragment:
      return 'fragment';
    case ExecutionModelGLCompute:
      return 'gl-compute';
    case ExecutionModelKernel:
      return 'kernel';
    case ExecutionModelRayGenerationKHR:
      return 'raygen';
    case ExecutionModelMissKHR:
      return 'ray-miss';
    case ExecutionModelClosestHitKHR:
      return 'ray-hit';
    case ExecutionModelCallableKHR:
      return 'callable';
    default:
      return 'unknown';
  }
}

/**
 * Apply a decoration to a decoration record (on either a variable id or a
 * member key). `extraStart` is the word index of the first extra operand.
 *
 * Generic over the key type so the `Map<number, _>` and `Map<string, _>`
 * call sites retain precise typing (a bare union would collapse to `never`).
 */
function applyDecoration<K extends number | string>(
  table: Map<K, DecorationRecord>,
  key: K,
  decoration: number,
  words: number[],
  extraStart: number,
): void {
  let record = table.get(key);
  if (!record) {
    record = {};
    table.set(key, record);
  }

  switch (decoration) {
    case DecorationBinding:
      record.binding = words[extraStart] ?? 0;
      break;
    case DecorationDescriptorSet:
      record.descriptorSet = words[extraStart] ?? 0;
      break;
    case DecorationLocation:
      record.location = words[extraStart] ?? 0;
      break;
    case DecorationBlock:
      record.block = true;
      break;
    case DecorationBufferBlock:
      record.bufferBlock = true;
      break;
    case DecorationBuiltIn:
      record.builtIn = words[extraStart] ?? 0;
      break;
    default:
      // Other decorations are not needed for reflection; ignore silently.
      break;
  }
}

// ─── Type descriptors ────────────────────────────────────────────────────────

interface TypeDescriptor {
  kind:
    | 'void'
    | 'bool'
    | 'int'
    | 'float'
    | 'vector'
    | 'matrix'
    | 'image'
    | 'sampler'
    | 'sampled-image'
    | 'array'
    | 'runtime-array'
    | 'struct'
    | 'pointer'
    | 'function'
    | 'unknown';
  // For numeric types:
  width?: number;
  signed?: boolean;
  // For vector/matrix:
  componentTypeId?: number;
  count?: number;
  // For struct/array/pointer:
  memberTypeIds?: number[];
  elementType?: number;
  storageClass?: number;
}

/**
 * Record a type descriptor for a type-defining instruction. Called for every
 * instruction in pass 1; non-type opcodes are ignored.
 */
function recordTypeInfo(inst: Instruction, typeInfo: Map<number, TypeDescriptor>): void {
  const words = inst.words;
  // All OpType* instructions have resultId at word[1].
  const resultId = words[1] ?? 0;
  if (resultId === 0) {
    return;
  }

  switch (inst.opcode) {
    case OpTypeVoid:
      typeInfo.set(resultId, { kind: 'void' });
      break;
    case OpTypeBool:
      typeInfo.set(resultId, { kind: 'bool' });
      break;
    case OpTypeInt:
      // OpTypeInt: resultId | width | signedness
      typeInfo.set(resultId, {
        kind: 'int',
        width: words[2] ?? 32,
        signed: (words[3] ?? 0) !== 0,
      });
      break;
    case OpTypeFloat:
      // OpTypeFloat: resultId | width
      typeInfo.set(resultId, { kind: 'float', width: words[2] ?? 32 });
      break;
    case OpTypeVector:
      // OpTypeVector: resultId | componentType | componentCount
      typeInfo.set(resultId, {
        kind: 'vector',
        componentTypeId: words[2] ?? 0,
        count: words[3] ?? 0,
      });
      break;
    case OpTypeMatrix:
      // OpTypeMatrix: resultId | columnType | columnCount
      typeInfo.set(resultId, {
        kind: 'matrix',
        componentTypeId: words[2] ?? 0,
        count: words[3] ?? 0,
      });
      break;
    case OpTypeImage:
      typeInfo.set(resultId, { kind: 'image' });
      break;
    case OpTypeSampler:
      typeInfo.set(resultId, { kind: 'sampler' });
      break;
    case OpTypeSampledImage:
      typeInfo.set(resultId, { kind: 'sampled-image' });
      break;
    case OpTypeArray:
      // OpTypeArray: resultId | elementType | length(constant-id)
      typeInfo.set(resultId, { kind: 'array', elementType: words[2] ?? 0 });
      break;
    case OpTypeRuntimeArray:
      // OpTypeRuntimeArray: resultId | elementType
      typeInfo.set(resultId, { kind: 'runtime-array', elementType: words[2] ?? 0 });
      break;
    case OpTypeStruct:
      // OpTypeStruct: resultId | member0Type | member1Type | ...
      typeInfo.set(resultId, {
        kind: 'struct',
        memberTypeIds: words.slice(2),
      });
      break;
    case OpTypePointer:
      // OpTypePointer: resultId | storageClass | typeId
      typeInfo.set(resultId, {
        kind: 'pointer',
        storageClass: words[2] ?? 0,
        elementType: words[3] ?? 0,
      });
      break;
    case OpTypeFunction:
      typeInfo.set(resultId, { kind: 'function' });
      break;
    default:
      // Not a type instruction.
      break;
  }
}

/**
 * Resolve a pointer type id to the struct type id it ultimately points to.
 * Returns null if the chain does not terminate at a struct.
 */
function resolvePointerToStruct(
  typeId: number,
  typeInfo: Map<number, TypeDescriptor>,
): number | null {
  const info = typeInfo.get(typeId);
  if (!info) {
    return null;
  }
  if (info.kind === 'pointer') {
    const target = info.elementType ?? 0;
    const targetInfo = typeInfo.get(target);
    if (targetInfo?.kind === 'struct') {
      return target;
    }
  }
  if (info.kind === 'struct') {
    return typeId;
  }
  return null;
}

/**
 * Describe a type id as a human-readable string (WGSL-flavoured for familiarity).
 * Falls back to `type<id:N>` for unresolved or recursive types.
 */
function describeType(typeId: number, typeInfo: Map<number, TypeDescriptor>): string {
  const info = typeInfo.get(typeId);
  if (!info) {
    return `type<id:${typeId}>`;
  }

  switch (info.kind) {
    case 'void':
      return 'void';
    case 'bool':
      return 'bool';
    case 'int': {
      const width = info.width ?? 32;
      const signed = info.signed ?? true;
      if (width === 32) {
        return signed ? 'i32' : 'u32';
      }
      return `${signed ? 'i' : 'u'}${width}`;
    }
    case 'float': {
      const width = info.width ?? 32;
      if (width === 32) {
        return 'f32';
      }
      if (width === 16) {
        return 'f16';
      }
      return `f${width}`;
    }
    case 'vector': {
      const component = describeType(info.componentTypeId ?? 0, typeInfo);
      return `vec${info.count ?? 0}<${component}>`;
    }
    case 'matrix': {
      const component = describeType(info.componentTypeId ?? 0, typeInfo);
      return `mat${info.count ?? 0}x${describeVectorColumns(info.componentTypeId ?? 0, typeInfo)}<${component}>`;
    }
    case 'image':
      return 'texture';
    case 'sampler':
      return 'sampler';
    case 'sampled-image':
      return 'sampled-texture';
    case 'array': {
      const element = describeType(info.elementType ?? 0, typeInfo);
      return `array<${element}>`;
    }
    case 'runtime-array': {
      const element = describeType(info.elementType ?? 0, typeInfo);
      return `array<${element}>`; // runtime-sized
    }
    case 'struct':
      return 'struct';
    case 'pointer': {
      const element = describeType(info.elementType ?? 0, typeInfo);
      return `ptr<${element}>`;
    }
    case 'function':
      return 'function';
    default:
      return `type<id:${typeId}>`;
  }
}

/**
 * For matrix description: the column type is a vector; extract its component
 * count to render `matNxM`. Returns 0 if unresolved.
 */
function describeVectorColumns(
  vectorTypeId: number,
  typeInfo: Map<number, TypeDescriptor>,
): number {
  const info = typeInfo.get(vectorTypeId);
  if (info?.kind === 'vector') {
    return info.count ?? 0;
  }
  return 0;
}

/**
 * Whether a storage class is a descriptor-binding class (uniform constant,
 * uniform, or storage buffer).
 */
function isDescriptorStorageClass(storageClass: number): boolean {
  return (
    storageClass === StorageClassUniformConstant ||
    storageClass === StorageClassUniform ||
    storageClass === StorageClassStorageBuffer
  );
}

/**
 * Whether a storage class is an interface (stage I/O) class (input or output).
 */
function isInterfaceStorageClass(storageClass: number): boolean {
  return storageClass === StorageClassInput || storageClass === StorageClassOutput;
}
