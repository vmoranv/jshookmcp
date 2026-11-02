/**
 * Composite type export and inference helpers.
 *
 * Pure TS, no native dependencies. Provides:
 * - C#, Rust struct export (x64dbg/ReClass parity)
 * - Composite type detection (Vector3, Matrix4x4, null-terminated arrays)
 * - Type definition override (memory_type_define)
 */

import type { InferredStruct, FieldType } from '@native/StructureAnalyzer.types';

// ── C# Export ──

const CSHARP_TYPE_MAP: Record<string, string> = {
  int8: 'sbyte',
  uint8: 'byte',
  int16: 'short',
  uint16: 'ushort',
  int32: 'int',
  uint32: 'uint',
  int64: 'long',
  uint64: 'ulong',
  float: 'float',
  double: 'double',
  pointer: 'nint',
  string_ptr: 'nint',
  vtable_ptr: 'nint',
  hex: 'uint',
  padding: 'byte',
  unknown: 'byte',
};

/**
 * Export an inferred structure as a C# struct with explicit [FieldOffset] attributes.
 * ReClass.NET parity — each field gets an explicit layout attribute.
 */
export function exportCSharpStruct(structure: InferredStruct, name: string): string {
  const safeName = sanitizeIdentifier(name, 'CSharp');
  const lines: string[] = [
    'using System.Runtime.InteropServices;',
    '',
    `[StructLayout(LayoutKind.Explicit, Size = ${structure.totalSize})]`,
    `public struct ${safeName}`,
    '{',
  ];

  for (const field of structure.fields) {
    const csType = CSHARP_TYPE_MAP[field.type] ?? 'byte';
    const arraySuffix = field.size > 8 && field.type === 'unknown' ? `[${field.size}]` : '';
    const fieldName = sanitizeIdentifier(field.name, 'CSharp');
    const comment = field.notes ? ` // ${field.notes}` : '';
    lines.push(`    [FieldOffset(0x${field.offset.toString(16).toUpperCase()})]`);
    lines.push(`    public ${csType}${arraySuffix} ${fieldName};${comment}`);
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ── Rust Export ──

const RUST_TYPE_MAP: Record<string, string> = {
  int8: 'i8',
  uint8: 'u8',
  int16: 'i16',
  uint16: 'u16',
  int32: 'i32',
  uint32: 'u32',
  int64: 'i64',
  uint64: 'u64',
  float: 'f32',
  double: 'f64',
  pointer: 'usize',
  string_ptr: 'usize',
  vtable_ptr: 'usize',
  hex: 'u32',
  padding: 'u8',
  unknown: 'u8',
};

/**
 * Export an inferred structure as a Rust `#[repr(C)]` struct with offset comments.
 */
export function exportRustStruct(structure: InferredStruct, name: string): string {
  const safeName = sanitizeIdentifier(name, 'Rust');
  const lines: string[] = ['#[repr(C)]', `pub struct ${safeName} {`];

  let prevEnd = 0;
  for (const field of structure.fields) {
    // Emit padding if there's a gap
    if (field.offset > prevEnd) {
      const padSize = field.offset - prevEnd;
      lines.push(`    _pad_${prevEnd.toString(16)}: [u8; ${padSize}],`);
    }

    const rustType = RUST_TYPE_MAP[field.type] ?? 'u8';
    const arraySuffix = field.size > 8 && field.type === 'unknown' ? `; ${field.size}` : '';
    const fieldName = sanitizeIdentifier(field.name, 'Rust');
    const comment = field.notes ? ` // ${field.notes}` : '';
    const offsetComment = `// 0x${field.offset.toString(16).toUpperCase()}`;

    if (field.size > 8 && field.type === 'unknown') {
      lines.push(`    ${offsetComment}`);
      lines.push(`    pub ${fieldName}: [u8${arraySuffix}],${comment}`);
    } else {
      lines.push(`    pub ${fieldName}: ${rustType}, ${offsetComment}${comment}`);
    }
    prevEnd = field.offset + field.size;
  }

  // Final padding to totalSize
  if (prevEnd < structure.totalSize) {
    const finalPad = structure.totalSize - prevEnd;
    lines.push(`    _pad_${prevEnd.toString(16)}: [u8; ${finalPad}],`);
  }

  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ── Identifier Sanitization ──

const CSHARP_KEYWORDS = new Set([
  'abstract',
  'as',
  'base',
  'bool',
  'break',
  'byte',
  'case',
  'catch',
  'char',
  'checked',
  'class',
  'const',
  'continue',
  'decimal',
  'default',
  'delegate',
  'do',
  'double',
  'else',
  'enum',
  'event',
  'explicit',
  'extern',
  'false',
  'finally',
  'fixed',
  'float',
  'for',
  'foreach',
  'goto',
  'if',
  'implicit',
  'in',
  'int',
  'interface',
  'internal',
  'is',
  'lock',
  'long',
  'namespace',
  'new',
  'null',
  'object',
  'operator',
  'out',
  'override',
  'params',
  'private',
  'protected',
  'public',
  'readonly',
  'ref',
  'return',
  'sbyte',
  'sealed',
  'short',
  'sizeof',
  'stackalloc',
  'static',
  'string',
  'struct',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'uint',
  'ulong',
  'unchecked',
  'unsafe',
  'ushort',
  'using',
  'virtual',
  'void',
  'volatile',
  'while',
]);

const RUST_KEYWORDS = new Set([
  'as',
  'break',
  'const',
  'continue',
  'crate',
  'else',
  'enum',
  'extern',
  'false',
  'fn',
  'for',
  'if',
  'impl',
  'in',
  'let',
  'loop',
  'match',
  'mod',
  'move',
  'mut',
  'pub',
  'ref',
  'return',
  'self',
  'Self',
  'static',
  'struct',
  'super',
  'trait',
  'true',
  'type',
  'unsafe',
  'use',
  'where',
  'while',
  'async',
  'await',
  'dyn',
  'abstract',
  'become',
  'box',
  'do',
  'final',
  'macro',
  'override',
  'priv',
  'typeof',
  'unsized',
  'virtual',
  'yield',
]);

function sanitizeIdentifier(name: string, lang: 'CSharp' | 'Rust'): string {
  // Replace invalid characters
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
  // Ensure starts with letter or underscore
  if (/^[0-9]/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }
  // Avoid keywords
  const keywords = lang === 'CSharp' ? CSHARP_KEYWORDS : RUST_KEYWORDS;
  if (keywords.has(sanitized)) {
    sanitized = '_' + sanitized;
  }
  return sanitized || '_unnamed';
}

// ── Composite Type Detection ──

export interface CompositeTypeDetection {
  /** Start offset in the structure */
  offset: number;
  /** Total byte size of the detected composite */
  size: number;
  /** Suggested composite type name */
  suggestedType: string;
  /** Confidence [0,1] */
  confidence: number;
  /** Number of elements detected */
  elementCount: number;
}

/**
 * Detect composite types (Vector3, Matrix4x4, null-terminated arrays) in a
 * sequence of inferred structure fields.
 */
export function detectCompositeTypes(
  fields: Array<{ offset: number; size: number; type: string; name: string; value?: string }>,
): CompositeTypeDetection[] {
  const results: CompositeTypeDetection[] = [];
  if (fields.length < 2) return results;

  detectVector3(fields, results);
  detectMatrixRuns(fields, results);
  detectPointerArrays(fields, results);

  return results;
}

type StructField = { offset: number; size: number; type: string; name: string; value?: string };

/** ── Detect float[3] (Vector3) ── */
function detectVector3(fields: StructField[], results: CompositeTypeDetection[]): void {
  for (let i = 0; i <= fields.length - 3; i++) {
    const f0 = fields[i]!;
    const f1 = fields[i + 1]!;
    const f2 = fields[i + 2]!;
    if (
      !(
        f0.type === 'float' &&
        f0.size === 4 &&
        f1.type === 'float' &&
        f1.size === 4 &&
        f2.type === 'float' &&
        f2.size === 4 &&
        f1.offset === f0.offset + 4 &&
        f2.offset === f1.offset + 4
      )
    ) {
      continue;
    }
    // Check if names suggest vector components
    const names = [f0.name.toLowerCase(), f1.name.toLowerCase(), f2.name.toLowerCase()];
    const vectorScore =
      names.some((n) => /^(x|position_x|pos_x|vec_x|vx)$/.test(n)) &&
      names.some((n) => /^(y|position_y|pos_y|vec_y|vy)$/.test(n)) &&
      names.some((n) => /^(z|position_z|pos_z|vec_z|vz)$/.test(n))
        ? 0.95
        : names.every((n) => /^(float|field|unknown|fld)/.test(n))
          ? 0.7
          : 0.5;

    results.push({
      offset: f0.offset,
      size: 12,
      suggestedType: 'Vector3',
      confidence: vectorScore,
      elementCount: 3,
    });
    i += 2; // skip the next two floats (they're part of this vector)
  }
}

/** Group consecutive float fields (adjacent 4-byte floats) into runs. */
function findConsecutiveFloatRuns(fields: StructField[]): Array<{ start: number; count: number }> {
  const runs: Array<{ start: number; count: number }> = [];
  let runStart = -1;
  let runCount = 0;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (f.type === 'float' && f.size === 4) {
      if (runStart === -1) {
        runStart = i;
        runCount = 1;
      } else if (f.offset === fields[i - 1]!.offset + 4) {
        runCount++;
      } else {
        runs.push({ start: runStart, count: runCount });
        runStart = i;
        runCount = 1;
      }
    } else {
      if (runStart !== -1) {
        runs.push({ start: runStart, count: runCount });
        runStart = -1;
        runCount = 0;
      }
    }
  }
  if (runStart !== -1) runs.push({ start: runStart, count: runCount });
  return runs;
}

/** ── Detect float[16]/float[9]/float[4] matrix/vector runs ── */
function detectMatrixRuns(fields: StructField[], results: CompositeTypeDetection[]): void {
  const matrixShapes: Array<{ count: number; type: string; size: number; confidence: number }> = [
    { count: 16, type: 'Matrix4x4', size: 64, confidence: 0.9 },
    { count: 9, type: 'Matrix3x3', size: 36, confidence: 0.85 },
    { count: 4, type: 'Vector4', size: 16, confidence: 0.75 },
  ];
  for (const run of findConsecutiveFloatRuns(fields)) {
    const shape = matrixShapes.find((s) => s.count === run.count);
    if (!shape) continue;
    results.push({
      offset: fields[run.start]!.offset,
      size: shape.size,
      suggestedType: shape.type,
      confidence: shape.confidence,
      elementCount: shape.count,
    });
  }
}

/** Group consecutive 8-byte pointer fields into runs. */
function findConsecutivePointerRuns(
  fields: StructField[],
): Array<{ start: number; count: number }> {
  const runs: Array<{ start: number; count: number }> = [];
  let runStart = -1;
  let runCount = 0;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if ((f.type === 'pointer' || f.type === 'vtable_ptr') && f.size === 8) {
      if (runStart === -1) {
        runStart = i;
        runCount = 1;
      } else if (f.offset === fields[i - 1]!.offset + 8) {
        runCount++;
      } else {
        runs.push({ start: runStart, count: runCount });
        runStart = i;
        runCount = 1;
      }
    } else {
      if (runStart !== -1) {
        runs.push({ start: runStart, count: runCount });
        runStart = -1;
        runCount = 0;
      }
    }
  }
  if (runStart !== -1) runs.push({ start: runStart, count: runCount });
  return runs;
}

/** ── Detect null-terminated pointer arrays (runs of ≥3 pointers) ── */
function detectPointerArrays(fields: StructField[], results: CompositeTypeDetection[]): void {
  for (const run of findConsecutivePointerRuns(fields)) {
    if (run.count >= 3) {
      results.push({
        offset: fields[run.start]!.offset,
        size: run.count * 8,
        suggestedType: `pointer_array_${run.count}`,
        confidence: 0.6,
        elementCount: run.count,
      });
    }
  }
}

// ── Type Override State ──

/** In-memory type override registry. Key: "offset:size" → FieldType. */
const typeOverrides = new Map<string, FieldType>();

export function setTypeOverride(offset: number, size: number, type: FieldType): void {
  typeOverrides.set(`${offset}:${size}`, type);
}

export function getTypeOverride(offset: number, size: number): FieldType | undefined {
  return typeOverrides.get(`${offset}:${size}`);
}

export function clearTypeOverrides(): void {
  typeOverrides.clear();
}

export function listTypeOverrides(): Array<{ offset: number; size: number; type: FieldType }> {
  return Array.from(typeOverrides.entries()).map(([key, type]) => {
    const [offset, size] = key.split(':').map(Number);
    return { offset: offset!, size: size!, type };
  });
}
